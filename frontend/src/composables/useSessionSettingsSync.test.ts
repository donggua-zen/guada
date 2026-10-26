import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

const apiMocks = vi.hoisted(() => ({
  updateSession: vi.fn(),
}))
vi.mock('@/services/ApiService', () => ({ apiService: apiMocks }))

const messageMocks = vi.hoisted(() => ({ error: vi.fn() }))
vi.mock('element-plus', () => ({ ElMessage: messageMocks }))

vi.mock('@/locales', () => ({ t: (key: string) => key }))

import { useSessionStore } from '@/stores/session'
import { ApiError } from '@/utils/errors'
import {
  useSessionSettingsSync,
  __resetSessionSettingsSyncForTests,
} from './useSessionSettingsSync'

const makeSession = (patch: Record<string, unknown> = {}): any => ({
  id: 's1',
  title: 't',
  agent: { id: 'a1' },
  agentId: 'a1',
  modelId: 'm1',
  settings: { thinkingEffort: 'high' },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...patch,
})

const deferred = <T = any>() => {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('useSessionSettingsSync', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    __resetSessionSettingsSyncForTests()
    apiMocks.updateSession.mockReset()
    messageMocks.error.mockReset()
  })

  it('scheduleSave 立即保存，成功后把服务端快照写回 store', async () => {
    const store = useSessionStore()
    store.setSession(makeSession())
    apiMocks.updateSession.mockResolvedValue(makeSession({ modelId: 'm2' }))

    const { scheduleSave, flushSession } = useSessionSettingsSync()
    scheduleSave('s1', { modelId: 'm2', settings: { thinkingEffort: 'low' } })
    await flushSession('s1')

    expect(apiMocks.updateSession).toHaveBeenCalledWith('s1', {
      modelId: 'm2',
      settings: { thinkingEffort: 'low' },
    })
    expect(store.getSession('s1')!.modelId).toBe('m2')
  })

  it('合并服务端快照时保留前端注入字段（如 isStreaming）', async () => {
    const store = useSessionStore()
    store.setSession(makeSession({ isStreaming: true }))
    apiMocks.updateSession.mockResolvedValue(makeSession({ modelId: 'm2' }))

    const { scheduleSave, flushSession } = useSessionSettingsSync()
    scheduleSave('s1', { modelId: 'm2' })
    await flushSession('s1')

    expect(store.getSession('s1')!.isStreaming).toBe(true)
    expect(store.getSession('s1')!.modelId).toBe('m2')
  })

  it('在途期间的新变更不会被旧响应覆盖，最终落最新快照', async () => {
    const store = useSessionStore()
    store.setSession(makeSession({ modelId: 'local-0' }))

    const first = deferred()
    const second = deferred()
    apiMocks.updateSession
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)

    const { scheduleSave, flushSession } = useSessionSettingsSync()
    store.patchSession('s1', { modelId: 'local-1' })
    scheduleSave('s1', { modelId: 'local-1' })
    store.patchSession('s1', { modelId: 'local-2' })
    scheduleSave('s1', { modelId: 'local-2' })

    // 在途合并：第二次变更只进 pending，不再并发发请求
    expect(apiMocks.updateSession).toHaveBeenCalledTimes(1)

    // 旧响应先到：revision 已变，不得覆盖本地新值
    first.resolve(makeSession({ modelId: 'server-1' }))
    await tick()

    expect(store.getSession('s1')!.modelId).toBe('local-2')
    expect(apiMocks.updateSession).toHaveBeenCalledTimes(2)
    expect(apiMocks.updateSession.mock.calls[1][1]).toEqual({ modelId: 'local-2' })

    second.resolve(makeSession({ modelId: 'server-2' }))
    await flushSession('s1')

    expect(store.getSession('s1')!.modelId).toBe('server-2')
  })

  it('按 sessionId 隔离：A 的 pending 不会写到 B', async () => {
    const store = useSessionStore()
    store.setSession(makeSession({ id: 's1' }))
    store.setSession(makeSession({ id: 's2' }))

    const a = deferred()
    const b = deferred()
    apiMocks.updateSession.mockImplementation((id: string) =>
      id === 's1' ? a.promise : b.promise,
    )

    const { scheduleSave, flushAll } = useSessionSettingsSync()
    scheduleSave('s1', { modelId: 'a-model' })
    scheduleSave('s2', { modelId: 'b-model' })

    expect(apiMocks.updateSession).toHaveBeenNthCalledWith(1, 's1', {
      modelId: 'a-model',
    })
    expect(apiMocks.updateSession).toHaveBeenNthCalledWith(2, 's2', {
      modelId: 'b-model',
    })

    a.resolve(makeSession({ id: 's1', modelId: 'a-server' }))
    b.resolve(makeSession({ id: 's2', modelId: 'b-server' }))
    await flushAll()

    expect(store.getSession('s1')!.modelId).toBe('a-server')
    expect(store.getSession('s2')!.modelId).toBe('b-server')
  })

  it('保存失败保留 pending、只提示一次，flush 重试后成功', async () => {
    const store = useSessionStore()
    store.setSession(makeSession())
    apiMocks.updateSession
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce(makeSession({ modelId: 'm2' }))

    const { scheduleSave, flushSession } = useSessionSettingsSync()
    scheduleSave('s1', { modelId: 'm2' })
    await flushSession('s1')

    expect(apiMocks.updateSession).toHaveBeenCalledTimes(2)
    expect(messageMocks.error).toHaveBeenCalledTimes(1)
    expect(store.getSession('s1')!.modelId).toBe('m2')
  })

  it('前一次保存失败时把其字段并入后续快照，避免丢字段', async () => {
    const store = useSessionStore()
    store.setSession(makeSession())

    const first = deferred()
    apiMocks.updateSession
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(
        makeSession({ modelId: 'm2', settings: { thinkingEffort: 'low' } }),
      )

    const { scheduleSave, flushSession } = useSessionSettingsSync()
    store.patchSession('s1', { modelId: 'm2' })
    scheduleSave('s1', { modelId: 'm2' })
    store.patchSessionSettings('s1', { thinkingEffort: 'low' })
    scheduleSave('s1', { settings: { thinkingEffort: 'low' } })

    first.reject(new Error('network'))
    await flushSession('s1')

    // 第二次请求同时带失败的 modelId 与新的 settings
    expect(apiMocks.updateSession.mock.calls[1][1]).toEqual({
      modelId: 'm2',
      settings: { thinkingEffort: 'low' },
    })
    expect(store.getSession('s1')!.modelId).toBe('m2')
  })

  it('空 payload 不产生请求', async () => {
    const { scheduleSave, flushSession } = useSessionSettingsSync()
    scheduleSave('s1', {})
    await flushSession('s1')
    expect(apiMocks.updateSession).not.toHaveBeenCalled()
  })

  it('无待保存项时 flush 不产生请求', async () => {
    const { flushSession } = useSessionSettingsSync()
    await flushSession('s1')
    expect(apiMocks.updateSession).not.toHaveBeenCalled()
  })

  it('404 时丢弃待保存项且不提示（会话已删除）', async () => {
    apiMocks.updateSession.mockRejectedValue(new ApiError('not found', 404))

    const { scheduleSave, flushSession } = useSessionSettingsSync()
    scheduleSave('s1', { modelId: 'm2' })
    await flushSession('s1')

    expect(apiMocks.updateSession).toHaveBeenCalledTimes(1)
    expect(messageMocks.error).not.toHaveBeenCalled()
  })

  it('快照在 schedule 时克隆，后续修改不影响已排队请求', async () => {
    apiMocks.updateSession.mockResolvedValue(makeSession())

    const settings = { thinkingEffort: 'high' as string }
    const { scheduleSave, flushSession } = useSessionSettingsSync()
    scheduleSave('s1', { settings })
    settings.thinkingEffort = 'low'

    expect(apiMocks.updateSession.mock.calls[0][1].settings).toEqual({
      thinkingEffort: 'high',
    })
    await flushSession('s1')
  })
})
