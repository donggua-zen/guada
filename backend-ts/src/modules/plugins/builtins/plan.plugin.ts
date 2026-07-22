import { Injectable, Logger } from "@nestjs/common";
import { OnEvent, EventEmitter2 } from "@nestjs/event-emitter";
import * as fs from "fs/promises";
import * as path from "path";
import { z } from "zod";
import { PluginBase } from "../base-plugin";
import { PluginContext } from "../types/plugin.types";
import { PluginApi } from "../api/plugin-api";
import { PlanUpdatedEvent } from "../../../common/events/stream.events";

interface PlanItem {
  content: string;
  status: "pending" | "in_progress" | "completed";
}

interface PlanStore {
  items: PlanItem[];
}

const STATUS_DISPLAY: Record<string, string> = {
  pending: " ",
  in_progress: ">",
  completed: "x",
};

@Injectable()
export class PlanPlugin extends PluginBase {
  private readonly logger = new Logger(PlanPlugin.name);

  /** sessionId → plan prompt text（压缩后清空，下次重建） */
  private planPromptCache = new Map<string, string>();

  /** 全局串行锁，所有文件读写操作排队执行 */
  private planLock: Promise<void> = Promise.resolve();

  manifest = {
    id: "plan",
    name: "Plan",
    description: "Task breakdown and plan management tool",
    version: "3.0.0",
    category: "core" as const,
  };

  constructor(private readonly eventEmitter: EventEmitter2) {
    super();
  }

  /** 压缩发生后清除缓存，下次 getMessages 时自动重建 */
  @OnEvent("memory.compacted")
  handleCompacted(payload: { sessionId: string }) {
    if (this.planPromptCache.has(payload.sessionId)) {
      this.planPromptCache.delete(payload.sessionId);
      this.logger.debug(
        `Plan prompt cache cleared for session ${payload.sessionId} after compression`,
      );
    }
  }

  async onLoad(api: PluginApi) {
    // ── plan 工具 ──
    api.registerTool({
      name: "plan",
      description: `You have access to a plan tool which tracks steps and progress and renders them to the user. Using the tool helps demonstrate that you've understood the task and conveys how you're approaching it. Plans can help make complex, ambiguous, or multi-phase work clearer and more collaborative for the user. A good plan should break the task into meaningful, logically ordered steps that are easy to verify as you go.

Note that plans are not for padding out simple work with filler steps or stating the obvious. The content of your plan should not involve doing anything that you aren't capable of doing (i.e. don't try to test things that you can't test). Do not use plans for simple or single-step queries that you can just do or answer immediately.

When you are ready to act, before running a command, consider whether or not you have completed the previous step, and make sure to mark it as completed (via \`action="next"\`) before moving on to the next step. 
It may be the case that you complete all steps in your plan after a single pass of implementation — if so, you can mark all remaining steps as completed via \`action="update"\`. 
Sometimes, you may need to change plans in the middle of a task: call \`action="update"\` with the updated plan and make sure to provide an explanation of the rationale when doing so.

**Pro tip:** Mark the first step as \`in_progress\`, then advance step by step using \`action="next"\`.

**Use a plan when:**  
- The task is non-trivial and will require multiple actions over a long time horizon.  
- There are logical phases or dependencies where sequencing matters.  
- The work has ambiguity that benefits from outlining high-level goals.  
- You want intermediate checkpoints for feedback and validation.  
- The user asked you to do more than one thing in a single prompt.  
- You have generated additional steps while working, and plan to do them before yielding to the user.

**Actions:**  
- action="add" / action="update" → Params: contents (object[], optional).  
  * Each item: { step, status }  
  * add → append steps to the existing plan; update → replace the entire plan.  

- action="next" → Advance to the next step. Completes the current in_progress step, then starts the next pending step. If there is no next step, the plan is considered complete. No params needed. 

**Display format:**  
  [x] Step     (completed)  
  [>] Step     (in_progress)  
  [ ] Step     (pending)  
`,
      inputSchema: z.object({
        action: z.enum(["add", "update", "next"]),
        contents: z
          .array(
            z.object({
              step: z.string().describe("Step description text."),
              status: z
                .enum(["pending", "in_progress", "completed"])
                .describe("Step status."),
            }),
          )
          .optional()
          .describe(
            "Plan items. add → append to existing; update → replace entire plan.",
          ),
      }),
      execute: async (args, ctx) => {
        return this.handlePlan(args, ctx);
      },
      display: { action: "管理计划", argsKey: "action", icon: "generic" },
    });

    // ── 计划状态 user 提示词（仅首次加载 + 压缩后重建时注入） ──
    api.registerPrompt({
      frequency: "VOLATILE",
      type: "user",
      description: "Current plan items status",
      content: async (context: PluginContext) => {
        const sessionId = context.session.sessionId;

        // 缓存命中 → 直接返回
        const cached = this.planPromptCache.get(sessionId);
        if (cached !== undefined) return cached;

        // 预置空缓存（防并发重复扫描）
        this.planPromptCache.set(sessionId, "");

        const store = await this.readStore(context);
        if (store.items.length === 0) return "";
        if (store.items.every((t) => t.status === "completed")) return "";

        // 扫描历史中是否有 plan 工具调用
        try {
          const history = await context.session.getHistory();
          const hasPlanCall = history?.some(
            (msg) =>
              msg.role === "assistant" &&
              msg.toolCalls?.some((tc) => tc.name === "plan"),
          );
          if (hasPlanCall) return "";
        } catch {
          // getHistory 失败则保守回退 — 不注入
          return "";
        }

        const list = this.formatPlanList(store);
        this.planPromptCache.set(sessionId, list);
        return `[Current plan]\n${list}\n[Current plan — end]`;
      },
    });
  }

  private async handlePlan(
    args: Record<string, any>,
    ctx: PluginContext,
  ): Promise<string> {
    const { action, contents } = args;
    switch (action) {
      case "add":
        return await this.addPlanItems(contents, ctx);
      case "update":
        return await this.updatePlanItems(contents, ctx);
      case "next":
        return await this.nextPlanItem(ctx);
      default:
        throw new Error(`Unknown action: ${action}`);
    }
  }

  /** 全局串行执行：确保并发文件读写不互相覆盖 */
  private async runSerialized<T>(fn: () => Promise<T>): Promise<T> {
    const prev = this.planLock;
    const next = prev.then(fn, fn);
    this.planLock = next.then(
      () => {},
      () => {},
    );
    return next;
  }

  private resolvePlanPath(ctx: PluginContext): string {
    const workspaceDir = ctx?.session?.workspacePath;
    if (!workspaceDir) throw new Error("missing workspace directory");

    const fileName = `${ctx.session.sessionId}.json`;
    return path.join(workspaceDir, ".guada", "plan", fileName);
  }

  private async readStore(ctx: PluginContext): Promise<PlanStore> {
    const filePath = this.resolvePlanPath(ctx);
    try {
      const raw = await fs.readFile(filePath, "utf-8");
      return JSON.parse(raw) as PlanStore;
    } catch (e: any) {
      if (e.code === "ENOENT") {
        return { items: [] };
      }
      throw e;
    }
  }

  private async writeStore(
    store: PlanStore,
    ctx: PluginContext,
  ): Promise<void> {
    const filePath = this.resolvePlanPath(ctx);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(store, null, 2), "utf-8");
    this.emitPlanUpdated(ctx);
  }

  /** 发射 plan.updated 事件，通知前端刷新 */
  private emitPlanUpdated(ctx: PluginContext) {
    const event: PlanUpdatedEvent = {
      userId: ctx.session.userId,
      sessionId: ctx.session.sessionId,
      timestamp: new Date().toISOString(),
    };
    this.eventEmitter.emit("plan.updated", event);
  }

  private formatPlanList(store: PlanStore): string {
    if (store.items.length === 0) {
      return "(no plan items)";
    }
    return store.items
      .map((t) => `[${STATUS_DISPLAY[t.status]}] ${t.content}`)
      .join("\n");
  }

  /**
   * 格式化列表并写入存储。
   * 若全部步骤已完成，先保留格式化结果（供 AI 查看）再清空存储。
   */
  private async finalizeAndFormat(
    store: PlanStore,
    ctx: PluginContext,
  ): Promise<string> {
    const result = this.formatPlanList(store);

    const allCompleted =
      store.items.length > 0 &&
      store.items.every((t) => t.status === "completed");

    if (allCompleted) {
      // 全部完成 → 清空存储（AI 仍能看到已完成的列表）
      await this.writeStore({ items: [] }, ctx);
    } else {
      await this.writeStore(store, ctx);
    }

    return result;
  }

  /** 追加步骤到现有计划 */
  private async addPlanItems(
    contents: Array<{ step: string; status: string }> | undefined,
    ctx: PluginContext,
  ): Promise<string> {
    return this.runSerialized(async () => {
      const store = await this.readStore(ctx);

      const newItems: PlanItem[] = (contents ?? []).map((c) => ({
        content: c.step.trim(),
        status: c.status as PlanItem["status"],
      }));

      store.items.push(...newItems);

      return this.finalizeAndFormat(store, ctx);
    });
  }

  /** 全量替换计划 */
  private async updatePlanItems(
    contents: Array<{ step: string; status: string }> | undefined,
    ctx: PluginContext,
  ): Promise<string> {
    return this.runSerialized(async () => {
      const items: PlanItem[] = (contents ?? []).map((c) => ({
        content: c.step.trim(),
        status: c.status as PlanItem["status"],
      }));

      const store: PlanStore = { items };

      return this.finalizeAndFormat(store, ctx);
    });
  }

  /** 推进到下一步：完成当前 in_progress，启动下一个 pending */
  private async nextPlanItem(ctx: PluginContext): Promise<string> {
    return this.runSerialized(async () => {
      const store = await this.readStore(ctx);

      // 完成当前 in_progress 的任务
      const currentInProgress = store.items.find(
        (t) => t.status === "in_progress",
      );
      if (currentInProgress) {
        currentInProgress.status = "completed";
      }

      // 启动下一个 pending 的任务
      const nextItem = store.items.find((t) => t.status === "pending");

      if (nextItem) {
        nextItem.status = "in_progress";
      }

      return this.finalizeAndFormat(store, ctx);
    });
  }
}
