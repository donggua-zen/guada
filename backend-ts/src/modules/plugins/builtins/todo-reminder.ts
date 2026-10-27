/**
 * Todo 周期性提醒（对齐 ZCode 的 todo_reminder）。
 *
 * 模型在长会话里容易忘记维护 todo：这里按 assistant 轮次做 cadence 提醒——
 * 距最近一次 todo 工具调用达到 {@link TODO_REMINDER_TURNS} 轮，且距上一次
 * 提醒达到 {@link TODO_REMINDER_GAP_TURNS} 轮时，注入一条隐藏提醒。
 *
 * 约束：
 * - 只在该会话确实解析出 todo 工具（插件/toolkit 过滤后）时生效；
 * - 只在存储里存在未完成项时提醒；
 * - 提醒作为隐藏 user 消息落库（模型可见、UI/transcript 不可见），
 *   靠 metadata.todoReminder 识别上一次提醒，避免每个 LLM 迭代重复注入。
 */
import * as fs from "fs/promises";
import type { Message } from "../../../common/types/conversation.types";
import { wrapSystemReminder } from "../../../common/utils/system-reminder.util";
import {
  TODO_TOOL_NAME,
  resolveTodoFilePath,
  type TodoItem,
  type TodoStore,
} from "../../../common/utils/todo-store.util";
import type { ISessionContext } from "../../chat/session-context";
import type { ResolvedPluginInfo } from "../types/plugin.types";
import type { TurnReminderProvider } from "../turn-reminders/turn-reminder.types";

/** todo 插件 id（落库消息的 source/metadata 标识） */
export const TODO_PLUGIN_ID = "todo";

/** 距最近一次 todo 调用达到该 assistant 轮次数后提醒 */
export const TODO_REMINDER_TURNS = 10;

/** 两次提醒之间至少间隔的 assistant 轮次数 */
export const TODO_REMINDER_GAP_TURNS = 10;

/** 提醒列表最多展示的条目数，避免超长 todo 把提醒撑大 */
const MAX_REMINDER_ITEMS = 20;

const STATUS_DISPLAY: Record<string, string> = {
  pending: " ",
  in_progress: ">",
  completed: "x",
};

/** 本会话解析出的工具里是否存在 todo（插件/toolkit 过滤后的口径） */
export function isTodoToolAvailable(
  resolved: readonly ResolvedPluginInfo[],
): boolean {
  return resolved.some(
    (rp) =>
      rp.enabled &&
      rp.enabledTools.some((tool) => tool.name === TODO_TOOL_NAME),
  );
}

/** 读取会话的 todo 存储；不存在/解析失败返回 null */
export async function readTodoStore(
  sessionContext: ISessionContext,
): Promise<TodoStore | null> {
  const workspaceDir = sessionContext.getWorkspacePath();
  if (!workspaceDir) return null;
  const filePath = resolveTodoFilePath(workspaceDir, sessionContext.sessionId);
  try {
    return JSON.parse(await fs.readFile(filePath, "utf-8")) as TodoStore;
  } catch {
    return null;
  }
}

/** 是否有未完成项（空列表/全部完成都返回 false） */
export function hasUnfinishedTodos(store: TodoStore | null): boolean {
  if (!store || store.items.length === 0) return false;
  return store.items.some((item) => item.status !== "completed");
}

/** 提醒里的待办列表格式（与 todo 工具结果一致） */
export function formatTodoListForReminder(store: TodoStore): string {
  const items = store.items.slice(0, MAX_REMINDER_ITEMS);
  const lines = items.map(
    (item: TodoItem) => `[${STATUS_DISPLAY[item.status] ?? " "}] ${item.content}`,
  );
  if (store.items.length > MAX_REMINDER_ITEMS) {
    lines.push(`... ${store.items.length - MAX_REMINDER_ITEMS} more`);
  }
  return lines.join("\n");
}

/** 提醒正文 */
export function buildTodoReminderText(store: TodoStore): string {
  return [
    "You haven't updated the todo list recently. If you're working on a multi-step task, update it now:",
    '- Mark the current step completed with action="next" before moving on.',
    '- If the plan changed, call action="update" with the full updated list.',
    "- Keep at most one item in_progress.",
    "If this reminder is not applicable, ignore it.",
    "",
    "Current todo:",
    formatTodoListForReminder(store),
  ].join("\n");
}

/** 构造隐藏提醒消息（模型可见、UI/transcript 隐藏；落库后作为 cadence marker） */
export function createTodoReminderMessage(
  sessionContext: ISessionContext,
  text: string,
): Message {
  return {
    id: sessionContext.generateMessageId(),
    role: "user",
    kind: "model",
    source: { kind: "plugin", plugin: TODO_PLUGIN_ID },
    metadata: {
      plugin: TODO_PLUGIN_ID,
      hidden: true,
      todoReminder: true,
    },
    content: [{ type: "text", text: wrapSystemReminder(text) }],
  };
}

/** 历史里是否已有 assistant 的 todo 工具调用 */
export function hasTodoToolCall(message: Message): boolean {
  return (
    message.role === "assistant" &&
    message.content.some(
      (block) => block.type === "tool-call" && block.name === TODO_TOOL_NAME,
    )
  );
}

/** 历史里是否是上一次 todo 提醒 */
export function isTodoReminderMessage(message: Message): boolean {
  const metadata = message.metadata as Record<string, unknown> | undefined;
  return metadata?.todoReminder === true;
}

/**
 * 统计两个 cadence 计数：
 * - 距最近一次 todo 工具调用的 assistant 轮次数
 * - 距最近一次 todo 提醒的 assistant 轮次数
 * 没有对应 marker 时返回总 assistant 轮次数。
 */
export function getTodoReminderTurnCounts(history: readonly Message[]): {
  turnsSinceLastTodoCall: number;
  turnsSinceLastReminder: number;
} {
  let assistantTurns = 0;
  let turnsSinceLastTodoCall: number | undefined;
  let turnsSinceLastReminder: number | undefined;

  for (let i = history.length - 1; i >= 0; i--) {
    const message = history[i];
    if (turnsSinceLastReminder === undefined && isTodoReminderMessage(message)) {
      turnsSinceLastReminder = assistantTurns;
    }
    if (turnsSinceLastTodoCall === undefined && hasTodoToolCall(message)) {
      turnsSinceLastTodoCall = assistantTurns;
    }
    if (
      turnsSinceLastTodoCall !== undefined &&
      turnsSinceLastReminder !== undefined
    ) {
      break;
    }
    if (message.role === "assistant") assistantTurns++;
  }

  return {
    turnsSinceLastTodoCall: turnsSinceLastTodoCall ?? assistantTurns,
    turnsSinceLastReminder: turnsSinceLastReminder ?? assistantTurns,
  };
}

/**
 * 注册到 TurnReminderRegistry 的 provider。
 *
 * 先做便宜的轮次判断，只有 cadence 到期才去读 todo 文件，避免每个 LLM 迭代都碰磁盘。
 */
export function createTodoReminderProvider(): TurnReminderProvider {
  return {
    id: "todo-reminders",
    // 排在计划模式提醒（order=100）之后
    order: 110,
    build: async ({ sessionContext, history }) => {
      const counts = getTodoReminderTurnCounts(history);
      if (
        counts.turnsSinceLastTodoCall < TODO_REMINDER_TURNS ||
        counts.turnsSinceLastReminder < TODO_REMINDER_GAP_TURNS
      ) {
        return {};
      }

      const resolved = sessionContext.getResolvedPlugins();
      if (!isTodoToolAvailable(resolved)) return {};

      const store = await readTodoStore(sessionContext);
      if (!store || !hasUnfinishedTodos(store)) return {};

      return {
        persist: [
          createTodoReminderMessage(
            sessionContext,
            buildTodoReminderText(store),
          ),
        ],
      };
    },
  };
}
