import { Injectable, Logger } from "@nestjs/common";
import { OnEvent, EventEmitter2 } from "@nestjs/event-emitter";
import * as fs from "fs/promises";
import * as path from "path";
import { z } from "zod";
import { PluginBase } from "../base-plugin";
import { PluginContext } from "../types/plugin.types";
import { PluginApi } from "../api/plugin-api";
import { TodoUpdatedEvent } from "../../../common/events/stream.events";
import langZh from "./todo.lang.zh.json";
import langEn from "./todo.lang.en.json";

interface TodoItem {
  content: string;
  status: "pending" | "in_progress" | "completed";
}

interface TodoStore {
  items: TodoItem[];
}

const STATUS_DISPLAY: Record<string, string> = {
  pending: " ",
  in_progress: ">",
  completed: "x",
};

@Injectable()
export class TodoPlugin extends PluginBase {
  private readonly logger = new Logger(TodoPlugin.name);

  /** sessionId → todo prompt text（压缩后清空，下次重建） */
  private todoPromptCache = new Map<string, string>();

  /** 全局串行锁，所有文件读写操作排队执行 */
  private todoLock: Promise<void> = Promise.resolve();

  manifest = {
    id: "todo",
    name: "%todo.name%",
    description: "%todo.description%",
    version: "3.0.0",
    category: "core" as const,
  };

  constructor(private readonly eventEmitter: EventEmitter2) {
    super();
  }

  /** 压缩发生后清除缓存，下次 getMessages 时自动重建 */
  @OnEvent("memory.compacted")
  handleCompacted(payload: { sessionId: string }) {
    if (this.todoPromptCache.has(payload.sessionId)) {
      this.todoPromptCache.delete(payload.sessionId);
      this.logger.debug(
        `Todo prompt cache cleared for session ${payload.sessionId} after compression`,
      );
    }
  }

  async onLoad(api: PluginApi) {
    api.registerNls("zh", langZh);
    api.registerNls("en", langEn);
    // ── todo 工具 ──
    api.registerTool({
      name: "todo",
      description: `You have access to a todo tool which tracks steps and progress and renders them to the user. Using the tool helps demonstrate that you've understood the task and conveys how you're approaching it. A todo list can help make complex, ambiguous, or multi-phase work clearer and more collaborative for the user. A good todo list should break the task into meaningful, logically ordered steps that are easy to verify as you go.

Note that todos are not for padding out simple work with filler steps or stating the obvious. The content of your todo should not involve doing anything that you aren't capable of doing (i.e. don't try to test things that you can't test). Do not use todos for simple or single-step queries that you can just do or answer immediately.

When you are ready to act, before running a command, consider whether or not you have completed the previous step, and make sure to mark it as completed (via \`action="next"\`) before moving on to the next step. 
It may be the case that you complete all steps in your todo after a single pass of implementation — if so, you can mark all remaining steps as completed via \`action="update"\`. 
Sometimes, you may need to change todos in the middle of a task: call \`action="update"\` with the updated todo and make sure to provide an explanation of the rationale when doing so.

**Pro tip:** Mark the first step as \`in_progress\`, then advance step by step using \`action="next"\`.

**Use a todo when:**  
- The task is non-trivial and will require multiple actions over a long time horizon.  
- There are logical phases or dependencies where sequencing matters.  
- The work has ambiguity that benefits from outlining high-level goals.  
- You want intermediate checkpoints for feedback and validation.  
- The user asked you to do more than one thing in a single prompt.  
- You have generated additional steps while working, and plan to do them before yielding to the user.

**Actions:**
- action="create" → Params: contents (object[]). Creates a brand-new todo list with the given items, clearing any previous todo data.
- action="add" / action="update" → Params: contents (object[], optional).
  * Each item: { step, status }
  * add → append steps to the existing todo; update → replace the entire todo.
- action="next" → Advance to the next step. Completes the current in_progress step, then starts the next pending step. If there is no next step, the todo is considered complete.

**Validation:** At most one item can have status \`in_progress\`. Calls violating this rule will return an error.

**Display format:**
  [x] Step     (completed)  
  [>] Step     (in_progress)  
  [ ] Step     (pending)  
`,
      inputSchema: z.object({
        action: z.enum(["create", "add", "update", "next"]),
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
            "Todo items. create → start a brand-new todo; add → append to existing; update → replace entire todo.",
          ),
      }),
      execute: async (args, ctx) => {
        return this.handleTodo(args, ctx);
      },
      display: {
        actionType: "todo",
        text: { executing: "%todo.executing%", completed: "%todo.completed%" },
        aggregate: { executing: "%todo.aggregate.executing%", completed: "%todo.aggregate.completed%" },
        argsKey: "action",
        icon: "generic",
      },
    });

    // ── 待办状态 user 提示词（仅首次加载 + 压缩后重建时注入） ──
    api.registerPrompt({
      frequency: "VOLATILE",
      type: "user",
      description: "Current todo items status",
      content: async (context: PluginContext) => {
        const sessionId = context.session.sessionId;

        // 缓存命中 → 直接返回
        const cached = this.todoPromptCache.get(sessionId);
        if (cached !== undefined) return cached;

        // 预置空缓存（防并发重复扫描）
        this.todoPromptCache.set(sessionId, "");

        const store = await this.readStore(context);
        if (store.items.length === 0) return "";
        if (store.items.every((t) => t.status === "completed")) return "";

        // 扫描历史中是否有 todo 工具调用
        try {
          const history = await context.session.getHistory();
          const hasTodoCall = history?.some(
            (msg) =>
              msg.role === "assistant" &&
              msg.toolCalls?.some((tc) => tc.name === "todo"),
          );
          if (hasTodoCall) return "";
        } catch {
          // getHistory 失败则保守回退 — 不注入
          return "";
        }

        const list = this.formatTodoList(store);
        this.todoPromptCache.set(sessionId, list);
        return `[Current todo]\n${list}\n[Current todo — end]`;
      },
    });
  }

  private async handleTodo(
    args: Record<string, any>,
    ctx: PluginContext,
  ): Promise<string> {
    const { action, contents } = args;
    switch (action) {
      case "add":
        return await this.addTodoItems(contents, ctx);
      case "update":
        return await this.updateTodoItems(contents, ctx);
      case "create":
        return await this.createTodoItems(contents, ctx);
      case "next":
        return await this.nextTodoItem(ctx);
      default:
        throw new Error(`Unknown action: ${action}`);
    }
  }

  /** 全局串行执行：确保并发文件读写不互相覆盖 */
  private async runSerialized<T>(fn: () => Promise<T>): Promise<T> {
    const prev = this.todoLock;
    const next = prev.then(fn, fn);
    this.todoLock = next.then(
      () => {},
      () => {},
    );
    return next;
  }

  private resolveTodoPath(ctx: PluginContext): string {
    const workspaceDir = ctx?.session?.workspacePath;
    if (!workspaceDir) throw new Error("missing workspace directory");

    const fileName = `${ctx.session.sessionId}.json`;
    return path.join(workspaceDir, ".guada", "todo", fileName);
  }

  private async readStore(ctx: PluginContext): Promise<TodoStore> {
    const filePath = this.resolveTodoPath(ctx);
    try {
      const raw = await fs.readFile(filePath, "utf-8");
      return JSON.parse(raw) as TodoStore;
    } catch (e: any) {
      if (e.code === "ENOENT") {
        return { items: [] };
      }
      throw e;
    }
  }

  private async writeStore(
    store: TodoStore,
    ctx: PluginContext,
  ): Promise<void> {
    const filePath = this.resolveTodoPath(ctx);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(store, null, 2), "utf-8");
    this.emitTodoUpdated(ctx);
  }

  /** 发射 todo.updated 事件，通知前端刷新 */
  private emitTodoUpdated(ctx: PluginContext) {
    const event: TodoUpdatedEvent = {
      userId: ctx.session.userId,
      sessionId: ctx.session.sessionId,
      timestamp: new Date().toISOString(),
    };
    this.eventEmitter.emit("todo.updated", event);
  }

  /** 删除存储文件（全部完成或创建新待办时使用） */
  private async deleteStoreFile(ctx: PluginContext): Promise<void> {
    const filePath = this.resolveTodoPath(ctx);
    try {
      await fs.unlink(filePath);
    } catch (e: any) {
      if (e.code !== "ENOENT") throw e;
    }
    this.emitTodoUpdated(ctx);
  }

  private formatTodoList(store: TodoStore): string {
    if (store.items.length === 0) {
      return "(no todo items)";
    }
    return store.items
      .map((t) => `[${STATUS_DISPLAY[t.status]}] ${t.content}`)
      .join("\n");
  }

  /**
   * 校验 items 中最多只有一个 in_progress。
   * 不满足时返回错误信息，满足时返回 null。
   */
  private validateMaxOneInProgress(items: TodoItem[]): string | null {
    const count = items.filter((i) => i.status === "in_progress").length;
    if (count > 1) {
      return "Error: At most one todo item can have status 'in_progress'. Please correct the items and try again.";
    }
    return null;
  }

  /**
   * 格式化列表并写入存储。
   * 若全部步骤已完成，先保留格式化结果（供 AI 查看）再删除存储文件。
   */
  private async finalizeAndFormat(
    store: TodoStore,
    ctx: PluginContext,
  ): Promise<string> {
    const result = this.formatTodoList(store);

    const allCompleted =
      store.items.length > 0 &&
      store.items.every((t) => t.status === "completed");

    if (allCompleted) {
      // 全部完成 → 删除存储文件（AI 仍能看到已完成的列表）
      await this.deleteStoreFile(ctx);
    } else {
      await this.writeStore(store, ctx);
    }

    return result;
  }

  /** 追加步骤到现有待办 */
  private async addTodoItems(
    contents: Array<{ step: string; status: string }> | undefined,
    ctx: PluginContext,
  ): Promise<string> {
    return this.runSerialized(async () => {
      const store = await this.readStore(ctx);

      const newItems: TodoItem[] = (contents ?? []).map((c) => ({
        content: c.step.trim(),
        status: c.status as TodoItem["status"],
      }));

      const allItems = [...store.items, ...newItems];
      const error = this.validateMaxOneInProgress(allItems);
      if (error) return error;

      store.items = allItems;

      return this.finalizeAndFormat(store, ctx);
    });
  }

  /** 全量替换待办 */
  private async updateTodoItems(
    contents: Array<{ step: string; status: string }> | undefined,
    ctx: PluginContext,
  ): Promise<string> {
    return this.runSerialized(async () => {
      const items: TodoItem[] = (contents ?? []).map((c) => ({
        content: c.step.trim(),
        status: c.status as TodoItem["status"],
      }));

      const error = this.validateMaxOneInProgress(items);
      if (error) return error;

      const store: TodoStore = { items };

      return this.finalizeAndFormat(store, ctx);
    });
  }

  /** 新建待办（清空旧数据后全量设置新待办） */
  private async createTodoItems(
    contents: Array<{ step: string; status: string }> | undefined,
    ctx: PluginContext,
  ): Promise<string> {
    return this.runSerialized(async () => {
      // 清除残留文件，确保从干净状态开始
      await this.deleteStoreFile(ctx);

      const items: TodoItem[] = (contents ?? []).map((c) => ({
        content: c.step.trim(),
        status: c.status as TodoItem["status"],
      }));

      const error = this.validateMaxOneInProgress(items);
      if (error) return error;

      const store: TodoStore = { items };

      return this.finalizeAndFormat(store, ctx);
    });
  }

  /** 推进到下一步：完成当前 in_progress，启动下一个 pending */
  private async nextTodoItem(ctx: PluginContext): Promise<string> {
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
