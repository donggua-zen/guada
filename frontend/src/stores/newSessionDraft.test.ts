import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useNewSessionDraftStore } from './newSessionDraft'
import type { ChatFileView } from '../types/session'
import type { NewSessionDraftConfig } from './newSessionDraft'

/**
 * 新建会话页草稿 store 测试
 *
 * 覆盖"切走再切回不丢内容"所依赖的几条约束:
 * - 初始空态 / hasDraft 判定(仅空白字符不算草稿)
 * - saveConfig 快照深拷贝(面板后续改配置不串改快照)
 * - 提交快照 → 失败回填出副本(不与被清空的输入框、新会话草稿共享数组)
 * - clear 重新赋值(不能就地清空: 数组实例可能已交给新会话草稿)
 */
const makeConfig = (): NewSessionDraftConfig => ({
  agentId: 'agent-1',
  modelId: 'model-1',
  workspacePath: 'D:/ws',
  groupId: 'group-1',
  settings: { referencedKbs: ['kb-1'], sandboxMode: 'workspace-write', planEnabled: true },
})

const makeFile = (name: string): ChatFileView => ({ id: name, displayName: name, fileType: 'file' })

describe('newSessionDraftStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('初始为空态', () => {
    const store = useNewSessionDraftStore()
    expect(store.content).toBe('')
    expect(store.files).toEqual([])
    expect(store.config).toBeNull()
    expect(store.submitted).toBeNull()
    expect(store.hasDraft).toBe(false)
  })

  it('hasDraft 只认正文与附件:纯空白不算草稿', () => {
    const store = useNewSessionDraftStore()
    store.content = '   \n '
    expect(store.hasDraft).toBe(false)

    store.content = 'hello'
    expect(store.hasDraft).toBe(true)

    store.content = ''
    store.files = [makeFile('a.png')]
    expect(store.hasDraft).toBe(true)
  })

  it('saveConfig 存快照且不与面板对象共享引用', () => {
    const store = useNewSessionDraftStore()
    const panelConfig = makeConfig()
    store.saveConfig(panelConfig)

    // 面板侧后续改动(顶层 + settings)不串改快照
    panelConfig.agentId = 'agent-2'
    panelConfig.settings.planEnabled = false

    expect(store.config?.agentId).toBe('agent-1')
    expect(store.config?.settings.planEnabled).toBe(true)
    expect(store.config?.groupId).toBe('group-1')
  })

  it('提交后清空输入框 → 回填出副本,内容等价但不是同一数组', () => {
    const store = useNewSessionDraftStore()
    const files = [makeFile('a.png')]
    store.content = '要问的问题'
    store.markSubmitted({ content: store.content, files })

    // ChatInput 发送后自清空编辑器与附件列表
    store.content = ''
    store.files = []
    expect(store.hasDraft).toBe(false)
    expect(store.submitted).not.toBeNull()

    expect(store.restoreSubmitted()).toBe(true)
    expect(store.content).toBe('要问的问题')
    expect(store.files).toEqual([makeFile('a.png')])
    // 回填的是副本:之后操作回填数组不应影响已清空的提交快照
    expect(store.files).not.toBe(files)
    // 回填后提交快照即消费掉
    expect(store.submitted).toBeNull()
    expect(store.restoreSubmitted()).toBe(false)
  })

  it('clear 清空四项,且不就地清空外部数组(同一实例已交给新会话草稿)', () => {
    const store = useNewSessionDraftStore()
    const files = [makeFile('a.png')]
    store.content = 'hello'
    store.files = files
    store.saveConfig(makeConfig())
    store.markSubmitted({ content: 'hello', files })

    store.clear()

    expect(store.content).toBe('')
    expect(store.files).toEqual([])
    expect(store.config).toBeNull()
    expect(store.submitted).toBeNull()
    // 关键:原数组实例(新会话 setInputMessage 持有的那份)不受影响
    expect(files).toEqual([makeFile('a.png')])
  })

  it('markSubmitted 未传 files 时按空列表记录', () => {
    const store = useNewSessionDraftStore()
    store.markSubmitted({ content: '只有文字' })
    expect(store.submitted?.files).toEqual([])
    store.restoreSubmitted()
    expect(store.content).toBe('只有文字')
    expect(store.files).toEqual([])
  })
})
