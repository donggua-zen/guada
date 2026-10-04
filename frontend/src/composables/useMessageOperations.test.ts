import { describe, it, expect } from 'vitest'

import { toPayloadFileRef, toPayloadFileRefs } from './useMessageOperations'

/**
 * 附件 → 发送 payload（FileRef）的契约测试。
 *
 * 这是 Electron 与 Web 统一后的唯一分派点（req 4）：
 * - 已上传 / 编辑回填 → 原样透传引用（含 refType）
 * - Electron 非图片 → refType='local' + 本机绝对路径，不经上传
 * - 新选未上传 → null（调用方负责先上传）
 */
describe('toPayloadFileRef', () => {
  it('上传响应原样透传（含 refType / fileExtension / 完整文件名）', () => {
    const ref = toPayloadFileRef({
      mediaType: 'application/pdf',
      bytes: 2048,
      name: '季度报告.pdf',
      url: 'uploads/20260915/季度报告_1430_ab12cd.pdf',
      fileExtension: 'pdf',
      refType: 'workspace',
    })
    expect(ref).toEqual({
      mediaType: 'application/pdf',
      bytes: 2048,
      name: '季度报告.pdf',
      url: 'uploads/20260915/季度报告_1430_ab12cd.pdf',
      fileExtension: 'pdf',
      refType: 'workspace',
    })
  })

  it('Electron 本机路径 → refType=local，url 用绝对路径', () => {
    const ref = toPayloadFileRef({
      id: 1,
      fileName: '报告.pdf',
      fileExtension: 'PDF',
      fileSize: 100,
      fileType: 'file',
      displayName: '报告',
      localPath: 'D:\\docs\\报告.pdf',
      file: undefined,
    })
    expect(ref).toEqual({
      mediaType: 'application/pdf',
      bytes: 100,
      name: '报告.pdf',
      url: 'D:\\docs\\报告.pdf',
      fileExtension: 'PDF',
      refType: 'local',
    })
  })

  it('历史数据（无 refType 的编辑回填）按 store 解释', () => {
    const ref = toPayloadFileRef({
      name: 'a.png',
      url: 'uploads/images/20250101/a.jpg',
      type: 'image/jpeg',
      ext: 'jpg',
      size: 10,
      previewUrl: 'uploads/previews/20250101/a.jpg',
    })
    expect(ref).toMatchObject({ refType: 'store', fileExtension: 'jpg' })
    expect(ref!.previewUrl).toBe('uploads/previews/20250101/a.jpg')
  })

  it('name 优先取完整文件名（含扩展名），不再用剥掉扩展名的 displayName', () => {
    const ref = toPayloadFileRef({
      fileName: '季度报告.pdf',
      displayName: '季度报告',
      fileExtension: 'pdf',
      localPath: 'D:\\季度报告.pdf',
      fileSize: 1,
    })
    expect(ref!.name).toBe('季度报告.pdf')
  })

  it('新选未上传（无 url、无 localPath）→ null，不进入 payload', () => {
    expect(
      toPayloadFileRef({
        id: 1,
        fileName: 'a.pdf',
        fileExtension: 'pdf',
        fileType: 'file',
        file: new File(['x'], 'a.pdf'),
      }),
    ).toBeNull()
  })

  it('localPath 为空串按缺失处理（粘贴生成的 Blob 文件拿不到本机路径）', () => {
    expect(
      toPayloadFileRef({
        id: 2,
        fileName: 'pasted.txt',
        fileExtension: 'txt',
        localPath: '',
        file: new File(['x'], 'pasted.txt'),
      }),
    ).toBeNull()
  })

  it('mediaType 非法时由扩展名兜底归一', () => {
    const ref = toPayloadFileRef({
      mediaType: 'text',
      fileExtension: 'docx',
      url: 'uploads/20260915/a.docx',
      refType: 'workspace',
    })
    expect(ref!.mediaType).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    )
  })
})

describe('toPayloadFileRefs', () => {
  it('过滤掉无法解析的项，保留其余（顺序不变）', () => {
    const refs = toPayloadFileRefs([
      { url: 'uploads/files/a.txt', mediaType: 'text/plain' },
      { fileName: 'pending.pdf', file: new File(['x'], 'pending.pdf') },
      { localPath: 'D:\\b.docx', fileName: 'b.docx', fileSize: 5 },
    ])
    expect(refs).toHaveLength(2)
    expect(refs[0].url).toBe('uploads/files/a.txt')
    expect(refs[1]).toMatchObject({ refType: 'local', url: 'D:\\b.docx' })
  })

  it('空输入安全', () => {
    expect(toPayloadFileRefs([])).toEqual([])
    expect(toPayloadFileRefs(undefined as any)).toEqual([])
  })
})
