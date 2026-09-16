import { describe, it, expect } from 'vitest'

import { classifyAttachment, extensionFromName, isRasterImageFile, planAttachment } from './attachment-classify'
import { RASTER_IMAGE_EXTENSIONS } from './media-type'

/**
 * 附件分流规则测试。
 *
 * 这是「取消类型白名单」之后唯一保留的判定：位图走图片通道（转码 + 内联字节），
 * 其余一律走路径引用通道。判错的两个方向都很难受——
 * 把 PDF 当图片会让 sharp 直接报错；把位图当普通文件则模型拿不到画面。
 */
describe('extensionFromName', () => {
  it('取最后一个后缀，小写', () => {
    expect(extensionFromName('报告.PDF')).toBe('pdf')
    expect(extensionFromName('archive.tar.gz')).toBe('gz')
    expect(extensionFromName('a.b.c.docx')).toBe('docx')
  })

  it('无扩展名/空值 → 空串', () => {
    expect(extensionFromName('README')).toBe('')
    expect(extensionFromName('')).toBe('')
    expect(extensionFromName(undefined)).toBe('')
    expect(extensionFromName(null)).toBe('')
  })

  it('目录名里的点不算扩展名', () => {
    expect(extensionFromName('my.folder/README')).toBe('')
    expect(extensionFromName('C:\\my.dir\\README')).toBe('')
  })
})

describe('isRasterImageFile', () => {
  it('所有光栅扩展名都判为图片（与后端表同源）', () => {
    const notDetected = RASTER_IMAGE_EXTENSIONS.filter(
      (ext) => !isRasterImageFile({ name: `a.${ext}` }),
    )
    expect(notDetected).toEqual([])
  })

  it('非位图"图片"格式不算图片（它们不能被 sharp 转码、也不能内联给模型）', () => {
    const wronglyImage = ['a.svg', 'a.ico', 'a.psd', 'a.ai', 'a.eps'].filter((name) =>
      isRasterImageFile({ name }),
    )
    expect(wronglyImage).toEqual([])
  })

  it('无文件名时回退 MIME（粘贴的 Blob 文件可能没有 name）', () => {
    expect(isRasterImageFile({ name: '', type: 'image/png' })).toBe(true)
    expect(isRasterImageFile({ name: '', type: 'image/jpeg' })).toBe(true)
    // svg 的 MIME 是 image/svg+xml，仍不该走图片通道
    expect(isRasterImageFile({ name: '', type: 'image/svg+xml' })).toBe(false)
    expect(isRasterImageFile({ name: '', type: 'application/pdf' })).toBe(false)
  })

  it('文件名优先于 MIME（异常 MIME 不该把位图挤出图片通道）', () => {
    expect(isRasterImageFile({ name: 'shot.png', type: '' })).toBe(true)
    expect(isRasterImageFile({ name: 'shot.png', type: 'application/octet-stream' })).toBe(true)
  })
})

describe('classifyAttachment', () => {
  it('任意类型都能落进某个通道，没有"不支持"这回事', () => {
    const samples = [
      { name: 'a.pdf', expected: 'file' },
      { name: 'a.docx', expected: 'file' },
      { name: 'a.xlsx', expected: 'file' },
      { name: 'a.zip', expected: 'file' },
      { name: 'a.exe', expected: 'file' },
      { name: 'a.mp3', expected: 'file' },
      { name: 'a.unknownext', expected: 'file' },
      { name: 'a.tar.gz', expected: 'file' },
      { name: 'no-extension', expected: 'file' },
      { name: 'a.png', expected: 'image' },
      { name: 'a.JPEG', expected: 'image' },
      { name: 'a.webp', expected: 'image' },
      { name: 'a.svg', expected: 'file' },
    ]
    for (const { name, expected } of samples) {
      expect(classifyAttachment({ name }), name).toBe(expected)
    }
  })
})

/**
 * planAttachment：决定落点与「字节要不要过网络」。
 *
 * needsUpload 是上传限额的唯一适用范围判据——Electron 下非图片附件只发本机
 * 绝对路径，字节始终留在本机，拿上传限额去卡它没有意义。
 */
describe('planAttachment', () => {
  const isElectron = { isElectron: true }
  const isWeb = { isElectron: false }

  it('Web：一律上传（图片与普通文件都过网络），因此都受限额约束', () => {
    expect(planAttachment({ name: 'a.pdf' }, isWeb)).toEqual({
      kind: 'file',
      useLocalPath: false,
      needsUpload: true,
    })
    expect(planAttachment({ name: 'a.png' }, isWeb)).toEqual({
      kind: 'image',
      useLocalPath: false,
      needsUpload: true,
    })
  })

  it('Electron 普通文件：引用本机路径，不上传 → 不受限额约束', () => {
    expect(
      planAttachment({ name: 'big.iso' }, { ...isElectron, localPath: 'D:\\big.iso' }),
    ).toEqual({ kind: 'file', useLocalPath: true, needsUpload: false })
  })

  it('Electron 图片：仍要上传（需转码 + 内联给模型）→ 受限额约束', () => {
    expect(
      planAttachment({ name: 'a.png' }, { ...isElectron, localPath: 'D:\\a.png' }),
    ).toEqual({ kind: 'image', useLocalPath: false, needsUpload: true })
  })

  it('Electron 但拿不到本机路径（粘贴的 Blob）→ 只能上传，受限额约束', () => {
    expect(planAttachment({ name: 'pasted.txt' }, isElectron)).toEqual({
      kind: 'file',
      useLocalPath: false,
      needsUpload: true,
    })
    // getPathForFile 返回空串与"没有这个字段"等价，都不能当成有本机路径
    expect(
      planAttachment({ name: 'pasted.txt' }, { ...isElectron, localPath: '' }),
    ).toEqual({ kind: 'file', useLocalPath: false, needsUpload: true })
  })

  it('needsUpload 与 useLocalPath 始终互斥（不存在既不上传又不是本机路径的情况）', () => {
    const cases = [
      planAttachment({ name: 'a.pdf' }, isWeb),
      planAttachment({ name: 'a.png' }, isWeb),
      planAttachment({ name: 'a.iso' }, { ...isElectron, localPath: 'D:\\a.iso' }),
      planAttachment({ name: 'a.png' }, { ...isElectron, localPath: 'D:\\a.png' }),
      planAttachment({ name: 'p.txt' }, isElectron),
    ]
    expect(cases.filter((p) => p.needsUpload === p.useLocalPath)).toEqual([])
  })
})
