import { parse as partialParse } from 'partial-json'
import {
  getToolArgs,
  TODO_TOOL_NAME,
  type ToolCall,
} from './toolDisplay'

/**
 * TODO 工具（内置插件 `todo`）的展示数据解析。
 *
 * 权威数据来自工具结果 `meta.card === "todo"` 的 `items[]`（后端在每次调用后
 * 写入完整持久态）；流式期间结果未到时，对 `create` / `update` 的参数
 * `contents[]` 做 partial-json 解析，先渲染半截列表。
 *
 * `TODO_TOOL_NAME` 定义在 toolDisplay（standalone 集合需要它），这里重新导出，
 * 供 TODO 卡片与测试统一取用。
 */
export { TODO_TOOL_NAME }

export type TodoStatus = 'pending' | 'in_progress' | 'completed'

export interface TodoCallItem {
  content: string
  status: TodoStatus
}

const TODO_STATUSES: ReadonlySet<string> = new Set([
  'pending',
  'in_progress',
  'completed',
])

function normalizeStatus(value: unknown): TodoStatus | null {
  return typeof value === 'string' && TODO_STATUSES.has(value)
    ? (value as TodoStatus)
    : null
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : null
}

/**
 * 解析工具结果 meta 里的待办快照。
 *
 * 返回 null = 不是 todo 卡片或结构非法；返回 [] = 合法但列表为空
 * （已清空；改造前的旧「全部完成」快照也可能是空数组）。
 * 新数据全部完成时元数据会携带完整列表，卡片据此可展开。
 */
export function parseTodoItemsFromMeta(
  meta: unknown,
): TodoCallItem[] | null {
  const record = asRecord(meta)
  if (!record || record.card !== 'todo' || !Array.isArray(record.items)) {
    return null
  }
  const items: TodoCallItem[] = []
  for (const raw of record.items) {
    const item = asRecord(raw)
    if (!item) return null
    const status = normalizeStatus(item.status)
    if (typeof item.content !== 'string' || !status) return null
    items.push({ content: item.content, status })
  }
  return items
}

/**
 * 从流式参数解析待办预览（仅 create / update 携带完整列表）。
 *
 * `add` 是追加、`next` 是推进，参数里没有完整列表，返回 null 由调用方
 * 显示「整理中」；结果 meta 到达后自然切换为权威快照。
 */
export function parseTodoItemsFromArgs(
  tool: ToolCall,
): TodoCallItem[] | null {
  const args = getToolArgs(tool)
  if (!args) return null

  let parsed: unknown = args
  if (typeof args === 'string') {
    try {
      parsed = partialParse(args)
    } catch {
      return null
    }
  }

  const record = asRecord(parsed)
  if (!record) return null
  if (record.action !== 'create' && record.action !== 'update') return null
  if (!Array.isArray(record.contents)) return null

  const items: TodoCallItem[] = []
  for (const raw of record.contents) {
    const item = asRecord(raw)
    if (!item) continue
    // 参数协议是 { step, status }；兼容 content 字段便于历史/测试数据
    const content =
      typeof item.step === 'string'
        ? item.step
        : typeof item.content === 'string'
          ? item.content
          : null
    if (!content) continue
    items.push({
      content,
      // 流式半截 JSON 可能还没到 status，先按 pending 展示
      status: normalizeStatus(item.status) ?? 'pending',
    })
  }
  return items.length > 0 ? items : null
}

/** 当前事项：进行中 → 首个待处理 → 首条 */
export function pickCurrentTodo(
  items: readonly TodoCallItem[],
): TodoCallItem | null {
  return (
    items.find((item) => item.status === 'in_progress') ??
    items.find((item) => item.status === 'pending') ??
    items[0] ??
    null
  )
}

export function countCompletedTodos(
  items: readonly TodoCallItem[],
): number {
  return items.filter((item) => item.status === 'completed').length
}

/** 非空且全部完成（用于「全部完成」摘要，避免取首条已完成项当当前项） */
export function isTodoListCompleted(
  items: readonly TodoCallItem[],
): boolean {
  return items.length > 0 && items.every((item) => item.status === 'completed')
}
