import { Injectable, Logger } from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";
import * as fs from "fs/promises";
import * as path from "path";
import { z } from "zod";
import { PluginBase } from "../base-plugin";
import { PluginContext } from "../types/plugin.types";
import { PluginApi } from "../api/plugin-api";

interface TodoItem {
  id: number;
  content: string;
  status: "pending" | "in_progress" | "completed";
}

interface TodoStore {
  todos: TodoItem[];
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
    name: "Todo",
    description: "Task breakdown and todo management tool",
    version: "2.0.0",
    category: "extended" as const,
  };

  constructor() {
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
    // ── todo 工具 ──
    api.registerTool({
      name: "todo",
      description: `Manage to-do items. Each operation returns a fully formatted to-do list.  
This tool is designed for you to manage your own execution progress. When you determine that fulfilling the user's request requires 3 or more consecutive actions, you **must** use this TODO list to track each subtask.

**Critical Rules:**  
1. Use \`action="next"\` to advance to the next step. When no step is in progress, the first pending step is started. When the current step is the last one, it is simply marked as completed.  
2. **After completing each individual subtask**, call \`action="next"\` immediately to mark it as completed and move to the next step. Do **not** wait until all subtasks are finished. Use \`action="update"\` only when you need to manually adjust a specific task's status.  
3. The final summary output should **not** be listed as a subtask.

Actions:
- action="add" → Batch add tasks. Params: contents (string[], optional), merge (boolean, default false).
  * merge=false (default): Requires ALL existing todos to be completed, then clears them before adding new ones. 
  * merge=true: Appends new items without deleting anything.
  * To clear completed todos without adding, explicitly pass contents=[] with merge=false.
  * IDs are auto-generated. Do NOT include number prefixes in contents.

- action="next" → Advance to the next step. Params: id (number, optional). When id is omitted, advances to the next pending step automatically. Completes the current in_progress step first.
- action="update" → Change task status. Params: id (number), status ("pending"|"in_progress"|"completed").

- action="list" → Show all tasks with current status.

Display format:
  [X] 1. Task     (completed)
  [>] 2. Task     (in_progress)
  [ ] 3. Task     (pending)
 `,
      inputSchema: z.object({
        action: z.enum(["add", "update", "next", "list"]),
        contents: z
          .array(z.string())
          .optional()
          .describe(
            "Task descriptions (IDs are auto-generated; do NOT include number prefixes like '1. ')",
          ),
        id: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Todo item ID (required for action=update)"),
        status: z
          .enum(["in_progress", "completed"])
          .optional()
          .describe(
            "New status (required for action=update); Status flow: `pending` → `in_progress` → `completed`",
          ),
        merge: z
          .boolean()
          .optional()
          .default(false)
          .describe(
            "Only for action=add. When false (default), auto-clean completed todos before adding new ones. When true, append without cleaning.",
          ),
      }),
      execute: async (args, ctx) => {
        return this.handleTodo(args, ctx);
      },
      display: { action: "管理待办", argsKey: "action", icon: "generic" },
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
        if (store.todos.length === 0) return "";
        if (store.todos.every((t) => t.status === "completed")) return "";

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
        return `[Current todos — IDs are auto-generated, use them when updating status]\n${list}\n[Current todos — end]`;
      },
    });
  }

  private async handleTodo(
    args: Record<string, any>,
    ctx: PluginContext,
  ): Promise<string> {
    const { action, contents, id, status, merge } = args;
    switch (action) {
      case "add":
        return await this.addTodos(contents, merge, ctx);
      case "update":
        return await this.updateTodo(id, status, ctx);
      case "next":
        return await this.nextTodo(id, ctx);
      case "list":
        return await this.listTodos(ctx);
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

    const isSubAgent = ctx?.session?.sessionType === "sub_agent";
    const fileName = isSubAgent ? `${ctx.session.sessionId}.json` : "main.json";
    return path.join(workspaceDir, ".guada", "todo", fileName);
  }

  private async readStore(ctx: PluginContext): Promise<TodoStore> {
    const filePath = this.resolveTodoPath(ctx);
    try {
      const raw = await fs.readFile(filePath, "utf-8");
      return JSON.parse(raw) as TodoStore;
    } catch (e: any) {
      if (e.code === "ENOENT") {
        return { todos: [] };
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
  }

  private formatTodoList(store: TodoStore): string {
    if (store.todos.length === 0) {
      return "(no todos)";
    }
    return store.todos
      .sort((a, b) => a.id - b.id)
      .map((t) => `[${STATUS_DISPLAY[t.status]}] ${t.id}. ${t.content}`)
      .join("\n");
  }

  private async addTodos(
    contents: string[] | undefined,
    merge: boolean | undefined,
    ctx: PluginContext,
  ): Promise<string> {
    return this.runSerialized(async () => {
      const store = await this.readStore(ctx);
      const wasEmpty = store.todos.length === 0;

      // merge=false 时要求所有旧任务都已完成，否则报错
      if (!merge && store.todos.length > 0) {
        const allCompleted = store.todos.every((t) => t.status === "completed");
        if (!allCompleted) {
          const incomplete = store.todos.filter(
            (t) => t.status !== "completed",
          ).length;
          throw new Error(
            `${incomplete} todo(s) still in progress, cannot add with merge=false. Complete or update them first.`,
          );
        }
        store.todos = [];
      }

      const maxId = store.todos.reduce((max, t) => Math.max(max, t.id), 0);

      const newItems: TodoItem[] = (contents ?? []).map((content, i) => ({
        id: maxId + i + 1,
        content: content.trim(),
        status: "pending" as const,
      }));

      // 列表为空时添加（或 merge=false 清空后），自动将第一个标记为进行中
      if (newItems.length > 0 && (wasEmpty || store.todos.length === 0)) {
        newItems[0].status = "in_progress";
      }

      store.todos.push(...newItems);
      await this.writeStore(store, ctx);

      return this.formatTodoList(store);
    });
  }

  private async updateTodo(
    id: number | undefined,
    newStatus: string | undefined,
    ctx: PluginContext,
  ): Promise<string> {
    if (id === undefined) throw new Error("update requires id parameter");
    if (!newStatus) throw new Error("update requires status parameter");

    return this.runSerialized(async () => {
      const store = await this.readStore(ctx);
      const todo = store.todos.find((t) => t.id === id);
      if (!todo) {
        throw new Error(`todo item #${id} not found`);
      }

      todo.status = newStatus as TodoItem["status"];
      await this.writeStore(store, ctx);

      return this.formatTodoList(store);
    });
  }

  private async nextTodo(
    id: number | undefined,
    ctx: PluginContext,
  ): Promise<string> {
    return this.runSerialized(async () => {
      const store = await this.readStore(ctx);

      // 完成当前 in_progress 的任务
      const currentInProgress = store.todos.find(
        (t) => t.status === "in_progress",
      );
      if (currentInProgress) {
        currentInProgress.status = "completed";
      }

      // 确定下一个要进行的任务
      let nextTodo: TodoItem | undefined;
      if (id !== undefined) {
        // 指定 id
        nextTodo = store.todos.find((t) => t.id === id);
        if (!nextTodo) {
          throw new Error(`todo item #${id} not found`);
        }
      } else if (currentInProgress) {
        // 顺序执行：找当前之后的下一个 pending
        nextTodo = store.todos
          .filter((t) => t.status === "pending")
          .sort((a, b) => a.id - b.id)
          .find((t) => t.id > currentInProgress.id);
      } else {
        // 没有进行中的任务：找第一个 pending
        nextTodo = store.todos
          .filter((t) => t.status === "pending")
          .sort((a, b) => a.id - b.id)[0];
      }

      if (nextTodo) {
        nextTodo.status = "in_progress";
      }

      await this.writeStore(store, ctx);
      return this.formatTodoList(store);
    });
  }

  private async listTodos(ctx: PluginContext): Promise<string> {
    return this.runSerialized(async () => {
      const store = await this.readStore(ctx);
      const lines = this.formatTodoList(store);

      if (store.todos.length === 0) {
        return lines;
      }

      const total = store.todos.length;
      const done = store.todos.filter((t) => t.status === "completed").length;
      const progress = store.todos.filter(
        (t) => t.status === "in_progress",
      ).length;
      const pending = total - done - progress;

      return `${lines}\n\nTotal: ${total} | Done: ${done} | In Progress: ${progress} | Pending: ${pending}`;
    });
  }
}
