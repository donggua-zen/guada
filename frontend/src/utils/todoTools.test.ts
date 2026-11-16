import { describe, expect, it } from 'vitest'
import {
  countCompletedTodos,
  isTodoListCompleted,
  parseTodoItemsFromArgs,
  parseTodoItemsFromMeta,
  pickCurrentTodo,
  TODO_TOOL_NAME,
} from './todoTools'

describe('parseTodoItemsFromMeta', () => {
  it('解析权威待办快照', () => {
    expect(
      parseTodoItemsFromMeta({
        card: 'todo',
        items: [
          { content: '实现 A', status: 'completed' },
          { content: '实现 B', status: 'in_progress' },
          { content: '实现 C', status: 'pending' },
        ],
      }),
    ).toEqual([
      { content: '实现 A', status: 'completed' },
      { content: '实现 B', status: 'in_progress' },
      { content: '实现 C', status: 'pending' },
    ])
  })

  it('空列表是合法状态（已清空 / 旧快照）', () => {
    expect(parseTodoItemsFromMeta({ card: 'todo', items: [] })).toEqual([])
  })

  it('全部完成列表正常解析（供卡片展开）', () => {
    expect(
      parseTodoItemsFromMeta({
        card: 'todo',
        items: [
          { content: '实现 A', status: 'completed' },
          { content: '实现 B', status: 'completed' },
        ],
      }),
    ).toEqual([
      { content: '实现 A', status: 'completed' },
      { content: '实现 B', status: 'completed' },
    ])
  })

  it('非 todo 卡片 / 结构非法返回 null', () => {
    expect(parseTodoItemsFromMeta(null)).toBeNull()
    expect(parseTodoItemsFromMeta({ card: 'terminal', items: [] })).toBeNull()
    expect(parseTodoItemsFromMeta({ card: 'todo', items: 'x' })).toBeNull()
    expect(
      parseTodoItemsFromMeta({
        card: 'todo',
        items: [{ content: 'A', status: 'unknown' }],
      }),
    ).toBeNull()
  })
})

describe('parseTodoItemsFromArgs', () => {
  it('create 完整参数解析', () => {
    expect(
      parseTodoItemsFromArgs({
        name: TODO_TOOL_NAME,
        arguments: JSON.stringify({
          action: 'create',
          contents: [
            { step: '第一步', status: 'in_progress' },
            { step: '第二步', status: 'pending' },
          ],
        }),
      }),
    ).toEqual([
      { content: '第一步', status: 'in_progress' },
      { content: '第二步', status: 'pending' },
    ])
  })

  it('update 流式半截 JSON 也能解析；缺 status 按 pending', () => {
    const items = parseTodoItemsFromArgs({
      name: TODO_TOOL_NAME,
      arguments: '{"action":"update","contents":[{"step":"半截',
    })
    expect(items).toEqual([{ content: '半截', status: 'pending' }])
  })

  it('add / next / 非法 JSON 返回 null', () => {
    expect(
      parseTodoItemsFromArgs({
        name: TODO_TOOL_NAME,
        arguments: JSON.stringify({
          action: 'add',
          contents: [{ step: 'A', status: 'pending' }],
        }),
      }),
    ).toBeNull()
    expect(
      parseTodoItemsFromArgs({
        name: TODO_TOOL_NAME,
        arguments: JSON.stringify({ action: 'next' }),
      }),
    ).toBeNull()
    expect(
      parseTodoItemsFromArgs({
        name: TODO_TOOL_NAME,
        arguments: '{invalid',
      }),
    ).toBeNull()
  })
})

describe('pickCurrentTodo / countCompletedTodos', () => {
  const items = [
    { content: 'A', status: 'completed' as const },
    { content: 'B', status: 'pending' as const },
    { content: 'C', status: 'in_progress' as const },
  ]

  it('优先进行中，其次待处理，最后首条', () => {
    expect(pickCurrentTodo(items)?.content).toBe('C')
    expect(pickCurrentTodo([items[0], items[1]])?.content).toBe('B')
    expect(pickCurrentTodo([items[0]])?.content).toBe('A')
    expect(pickCurrentTodo([])).toBeNull()
  })

  it('完成数统计', () => {
    expect(countCompletedTodos(items)).toBe(1)
    expect(countCompletedTodos([])).toBe(0)
  })
})

describe('isTodoListCompleted', () => {
  it('非空且全部 completed 才为 true', () => {
    expect(
      isTodoListCompleted([
        { content: 'A', status: 'completed' },
        { content: 'B', status: 'completed' },
      ]),
    ).toBe(true)
    expect(
      isTodoListCompleted([
        { content: 'A', status: 'completed' },
        { content: 'B', status: 'pending' },
      ]),
    ).toBe(false)
    expect(isTodoListCompleted([])).toBe(false)
  })
})
