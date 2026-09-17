import { Injectable, Logger } from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";
import * as fs from "fs/promises";
import * as path from "path";
import { z } from "zod";
import { PluginBase } from "../base-plugin";
import { PluginContext } from "../types/plugin.types";
import { PluginApi } from "../api/plugin-api";
import { TodoUpdatedEvent } from "../../../common/events/stream.events";
import { EventBusService } from "../../../common/events/event-bus.service";
import { HOOKS } from "../../../modules/chat/types/hooks.contract";
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

  /** 全局串行锁，所有文件读写操作排队执行 */
  private todoLock: Promise<void> = Promise.resolve();

  manifest = {
    id: "todo",
    name: "%todo.name%",
    description: "%todo.description%",
    version: "3.0.0",
    category: "core" as const,
  };

  constructor(private readonly eventBus: EventBusService) {
    super();
  }

  /**
   * 压缩后遗忘防护：有待办但历史无 todo 工具调用 → 注入隐藏 user 消息提醒 AI。
   * 压缩会遮蔽早期 todo 调用（AI 可能遗忘待办）；注入条件驱动幂等——
   * AI 更新过 todo（历史出现新调用）则不再注入；未更新则下次压缩再提醒。
   */
  @OnEvent(HOOKS.MEMORY_COMPACTED)
  async handleCompacted(payload: {
    sessionId: string;
    sessionContext: import("../../chat/session-context").ISessionContext;
  }) {
    await this.maybeInjectTodoReminder(payload.sessionContext);
  }

  /** 注入条件：store 有待办 && 历史（压缩后视图）无 todo 工具调用 */
  private async maybeInjectTodoReminder(
    sessionContext: import("../../chat/session-context").ISessionContext,
  ): Promise<void> {
    try {
      const workspaceDir = sessionContext.getWorkspacePath();
      const filePath = path.join(
        workspaceDir,
        ".guada",
        "todo",
        `${sessionContext.sessionId}.json`,
      );
      let store: TodoStore;
      try {
        store = JSON.parse(await fs.readFile(filePath, "utf-8")) as TodoStore;
      } catch (e: any) {
        if (e.code === "ENOENT") return; // 无 todo 存储 → 无需提醒
        throw e;
      }
      if (store.items.length === 0) return;
      if (store.items.every((t) => t.status === "completed")) return;

      // 压缩后视图扫描：已有 todo 工具调用 → 模型知道待办，不注入
      const history = await sessionContext.getHistory();
      const hasTodoCall = history?.some(
        (msg) =>
          msg.role === "assistant" &&
          msg.content.some(
            (b) => b.type === "tool-call" && b.name === "todo",
          ),
      );
      if (hasTodoCall) return;

      const text = `[Current todo]\n${this.formatTodoList(store)}\n[Current todo — end]`;
      await sessionContext.injectUserPrompt(text, "todo");
      this.logger.debug(
        `[todo] injected todo reminder for session ${sessionContext.sessionId}`,
      );
    } catch (e) {
      // 注入失败不阻断压缩流程
      this.logger.warn(`[todo] inject todo reminder failed: ${e}`);
    }
  }

  async onLoad(api: PluginApi) {
    api.registerNls("zh", langZh);
    api.registerNls("en", langEn);
    // ── todo 能力包：工具 + 待办状态提示词统一挂载，智能体层按包启停 ──
    const todoKit = api.registerToolKit({
      id: "todo",
      name: "%todo.name%",
      description: "%todo.toolkitDescription%",
      activator:
        "Track task steps and progress with a visible todo list for multi-step work.",
    });
    // ── todo 工具 ──
    todoKit.registerTool({
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

    // ── 待办状态提醒：由 MEMORY_COMPACTED 处理器在压缩后落库注入隐藏消息（见 handleCompacted）──
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
      sessionId: ctx.session.sessionId,
      timestamp: new Date().toISOString(),
    };
    this.eventBus.emit(HOOKS.TODO_UPDATED, event);
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
