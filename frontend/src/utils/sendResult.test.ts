import { describe, expect, it } from 'vitest'
import { isSameFileList, shouldClearComposerAfterSend } from './sendResult'
import type { ChatFileView } from '@/types/session'

/** 最小附件桩：只比较引用，字段内容无关紧要 */
function file(id: number): ChatFileView {
  return { id } as ChatFileView
}

describe('isSameFileList', () => {
  it('同一批元素（引用一致）判定为相同', () => {
    const a = file(1)
    const b = file(2)
    expect(isSameFileList([a, b], [a, b])).toBe(true)
  })

  it('长度不同判定为不同', () => {
    expect(isSameFileList([file(1)], [])).toBe(false)
    expect(isSameFileList([], [file(1)])).toBe(false)
  })

  it('同 id 但对象被替换（上传进度回写 / 编辑回填映射）仍判定为同一个附件', () => {
    expect(isSameFileList([file(1)], [file(1)])).toBe(true)
  })

  it('id 不同判定为不同', () => {
    expect(isSameFileList([file(1)], [file(2)])).toBe(false)
  })

  it('顺序变化判定为不同', () => {
    const a = file(1)
    const b = file(2)
    expect(isSameFileList([b, a], [a, b])).toBe(false)
  })

  it('无 id 时按 url / localPath / 文件名+大小 兜底识别', () => {
    const byUrl = (url: string): ChatFileView => ({ url } as ChatFileView)
    expect(isSameFileList([byUrl('/a.png')], [byUrl('/a.png')])).toBe(true)
    expect(isSameFileList([byUrl('/a.png')], [byUrl('/b.png')])).toBe(false)

    const byPath = (localPath: string): ChatFileView => ({ localPath } as ChatFileView)
    expect(isSameFileList([byPath('D:/a.txt')], [byPath('D:/a.txt')])).toBe(true)

    const byName = (name: string, size: number): ChatFileView => ({ fileName: name, fileSize: size } as ChatFileView)
    expect(isSameFileList([byName('a.txt', 10)], [byName('a.txt', 10)])).toBe(true)
    expect(isSameFileList([byName('a.txt', 10)], [byName('a.txt', 11)])).toBe(false)
  })
})

describe('shouldClearComposerAfterSend', () => {
  const sentFile = file(1)

  it('正文与附件都未变动：可以清空', () => {
    expect(shouldClearComposerAfterSend({
      currentContent: '你好',
      sentContent: '你好',
      currentFiles: [sentFile],
      sentFiles: [sentFile],
    })).toBe(true)
  })

  it('等待期间用户续写正文：保留输入，不清空', () => {
    expect(shouldClearComposerAfterSend({
      currentContent: '你好，再补充一句',
      sentContent: '你好',
      currentFiles: [],
      sentFiles: [],
    })).toBe(false)
  })

  it('等待期间删光正文：保留当前（空）状态，不再按旧快照清空', () => {
    expect(shouldClearComposerAfterSend({
      currentContent: '',
      sentContent: '你好',
      currentFiles: [],
      sentFiles: [],
    })).toBe(false)
  })

  it('等待期间新增附件：保留输入，不清空', () => {
    expect(shouldClearComposerAfterSend({
      currentContent: '你好',
      sentContent: '你好',
      currentFiles: [sentFile, file(2)],
      sentFiles: [sentFile],
    })).toBe(false)
  })

  it('等待期间移除附件：保留输入，不清空', () => {
    expect(shouldClearComposerAfterSend({
      currentContent: '你好',
      sentContent: '你好',
      currentFiles: [],
      sentFiles: [sentFile],
    })).toBe(false)
  })
})
