/**
 * 会话 TODO 存储的路径解析、写入与「从事件历史取锚点时刻状态」—— 单一真相。
 *
 * 存储形态：`<workspaceDir>/.guada/todo/<sessionId>.json`，内容 `{ items: [...] }`，
 * 由 todo 插件（modules/plugins/builtins/todo.plugin.ts）读写。TODO 不进对话事件流，
 * 因此分支会话时无法靠复制事件得到它；但 todo 工具每次调用都把「调用后的权威状态」
 * 写进工具结果的 meta（见 ToolResultBlock.meta），该 meta 随事件流持久化、随分支原样
 * 复制，于是可按锚点从历史还原。
 *
 * 本模块不含 TODO 的 action 语义（create/add/update/next 由插件负责），只做路径与
 * 「读 meta」；这样分支路径不必复制一份状态机，也就不会与插件漂移。
 */

import * as fs from "fs/promises";
import * as path from "path";
import type { BaseEvent } from "../persistence/types";

export type TodoStatus = "pending" | "in_progress" | "completed";

export interface TodoItem {
  content: string;
  status: TodoStatus;
}

export interface TodoStore {
  items: TodoItem[];
}

/** todo 工具名（插件注册名即裸名，无命名空间前缀） */
export const TODO_TOOL_NAME = "todo";

/** 工具结果 meta 的卡片标识：todo 插件据此标记，分支重建据此识别 */
export const TODO_META_CARD = "todo";

const TODO_STATUSES: ReadonlySet<string> = new Set([
  "pending",
  "in_progress",
  "completed",
]);

/** TODO 存储文件绝对路径（不做存在性保证） */
export function resolveTodoFilePath(
  workspaceDir: string,
  sessionId: string,
): string {
  return path.join(workspaceDir, ".guada", "todo", `${sessionId}.json`);
}

/** 写入 TODO 存储（形状对齐插件：mkdir recursive + 2 空格缩进 JSON） */
export async function writeTodoStore(
  workspaceDir: string,
  sessionId: string,
  store: TodoStore,
): Promise<void> {
  const filePath = resolveTodoFilePath(workspaceDir, sessionId);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(store, null, 2), "utf-8");
}

/** 整条 meta 是否可用的严格校验：任一项不合法即整体弃用，避免写出残缺列表 */
function isTodoItems(value: unknown): value is TodoItem[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        !!item &&
        typeof item === "object" &&
        typeof (item as TodoItem).content === "string" &&
        TODO_STATUSES.has((item as TodoItem).status),
    )
  );
}

/**
 * 取锚点时刻的 TODO 状态：返回最后一个由 todo 工具写入 meta 的结果所携带的列表。
 *
 * 入参事件须已按分支锚点截断（`seq <= 锚点 turn/finish`），此时「最后一个」即
 * 锚点时刻的状态——从早期回合分支不会带上之后的进度。
 *
 * 返回 null 表示历史里没有可用的 TODO 状态（存量会话的工具结果无 meta，或锚点前
 * 从未调用过 todo），调用方应据此跳过写入。
 */
export function extractTodoStateFromEvents(
  events: BaseEvent[],
): TodoStore | null {
  let found: TodoStore | null = null;
  for (const event of events) {
    if (event.type !== "tool/result") continue;
    const data = event.data as { name?: unknown; meta?: unknown };
    if (data.name !== TODO_TOOL_NAME) continue;
    const meta = data.meta as Record<string, unknown> | null | undefined;
    if (!meta || meta.card !== TODO_META_CARD) continue;
    if (!isTodoItems(meta.items)) continue;
    found = { items: meta.items };
  }
  return found;
}
