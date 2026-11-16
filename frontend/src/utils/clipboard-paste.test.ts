import { describe, expect, it } from 'vitest'
import {
  PASTE_TEXT_ATTACHMENT_THRESHOLD,
  planClipboardPaste,
  shouldPreferSpreadsheetClipboardText,
} from './clipboard-paste'

function makeFile(name: string, size = 4, type = 'image/png'): File {
  return new File([new Uint8Array(size)], name, { type })
}

describe('shouldPreferSpreadsheetClipboardText', () => {
  it('有制表符时判定为表格文本', () => {
    expect(shouldPreferSpreadsheetClipboardText('a\tb\nc\td', '')).toBe(true)
  })

  it('Excel 的 HTML 标记（单格/单列没有制表符）也判定为表格文本', () => {
    const html = '<html xmlns:x="urn:schemas-microsoft-com:office:excel"><body><table><tr><td>x</td></tr></table></body></html>'
    expect(shouldPreferSpreadsheetClipboardText('x', html)).toBe(true)
  })

  it('普通文本不是表格', () => {
    expect(shouldPreferSpreadsheetClipboardText('hello world', '<b>hello</b>')).toBe(false)
    expect(shouldPreferSpreadsheetClipboardText('', '<table></table>')).toBe(false)
  })
})

describe('planClipboardPaste', () => {
  it('图片 + 代码文本：文件优先，文本被丢弃', () => {
    const image = makeFile('image.png')
    const plan = planClipboardPaste({
      files: [image],
      text: 'const answer = 42',
      html: '<pre>const answer = 42</pre>',
    })

    expect(plan.kind).toBe('files')
    if (plan.kind === 'files') {
      expect(plan.files).toEqual([image])
    }
  })

  it('图片 + 只有 HTML 表示：仍然文件优先', () => {
    const plan = planClipboardPaste({
      files: [makeFile('image.png')],
      text: '',
      html: '<img src="https://example.com/a.png">',
    })

    expect(plan.kind).toBe('files')
  })

  it('Excel 表格（TSV + Excel HTML + 合成 PNG）：文本优先', () => {
    const plan = planClipboardPaste({
      files: [makeFile('image.png')],
      text: 'a\tb\n1\t2',
      html: '<table><tr><td>a</td><td>b</td></tr></table>',
    })

    expect(plan.kind).toBe('text-inline')
    if (plan.kind === 'text-inline') {
      expect(plan.text).toBe('a\tb\n1\t2')
    }
  })

  it('超长纯文本转为附件', () => {
    const text = 'x'.repeat(PASTE_TEXT_ATTACHMENT_THRESHOLD + 1)
    const plan = planClipboardPaste({ files: [], text, html: '' })

    expect(plan.kind).toBe('text-attachment')
    if (plan.kind === 'text-attachment') {
      expect(plan.text).toHaveLength(PASTE_TEXT_ATTACHMENT_THRESHOLD + 1)
    }
  })

  it('阈值内的纯文本插入正文', () => {
    const text = 'x'.repeat(PASTE_TEXT_ATTACHMENT_THRESHOLD)
    expect(planClipboardPaste({ files: [], text, html: '' }).kind).toBe('text-inline')
  })

  it('0 字节文件不参与文件优先，与文本一起时按文本处理', () => {
    const plan = planClipboardPaste({
      files: [makeFile('', 0, '')],
      text: 'hello',
      html: '',
    })

    expect(plan.kind).toBe('text-inline')
  })

  it('只有 0 字节文件且没有文本时什么都不做', () => {
    expect(planClipboardPaste({ files: [makeFile('', 0, '')], text: '', html: '' }).kind).toBe('none')
  })

  it('空剪贴板返回 none', () => {
    expect(planClipboardPaste({ files: [], text: '', html: '' }).kind).toBe('none')
  })
})
