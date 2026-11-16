/**
 * 聊天输入框的粘贴分流（纯逻辑，便于单测）。
 *
 * 规则与 zcode 的 useComposerAttachments 对齐：
 * - 剪贴板里有文件（图片等）时文件优先，附带的 text/plain、text/html 一律丢弃。
 *   网页「复制图片」通常同时写 image/png 和 text/html，两边都处理会出现
 *   「附件有图片、正文又插了一段代码/标记」的双份内容。
 * - 例外：Excel/表格文本（制表符或 Excel HTML 标记）优先于其合成的 PNG，
 *   否则从 Excel 复制单元格会被错误地变成一张图片。
 * - 无文件时：短文本插入正文，超长文本转 .txt 附件。
 */

/** 纯文本超过该长度时转为 .txt 附件（沿用原 ChatInput 的阈值） */
export const PASTE_TEXT_ATTACHMENT_THRESHOLD = 2000

/** Excel/Sheet 复制单元格时写入的 HTML 特征（单格、单列没有制表符，只能靠标记识别） */
const SPREADSHEET_CLIPBOARD_HTML_PATTERN =
  /(?:<table\b|urn:schemas-microsoft-com:office:excel|\bExcel\.Sheet\b|\bMicrosoft\s+Excel\b|\bmso-(?:number-format|displayed-decimal-separator)\b)/iu

/**
 * 剪贴板是否同时带有「表格文本」证据。
 * Excel 会同时写入 text/plain、Excel HTML 和一张合成 PNG，此时应让文本获胜。
 */
export function shouldPreferSpreadsheetClipboardText(text: string, html: string): boolean {
  if (!text) return false
  return text.includes('\t') || SPREADSHEET_CLIPBOARD_HTML_PATTERN.test(html)
}

export interface ClipboardPastePayload {
  files: File[]
  /** 优先取 text/plain；只有 HTML 表示时由调用方退化为纯文本 */
  text: string
  html: string
}

export type ClipboardPastePlan =
  | { kind: 'files'; files: File[] }
  | { kind: 'text-attachment'; text: string }
  | { kind: 'text-inline'; text: string }
  | { kind: 'none' }

export function planClipboardPaste(payload: ClipboardPastePayload): ClipboardPastePlan {
  // 0 字节条目是拖入文件夹时 files 里的产物，粘贴时也可能出现，直接忽略
  const files = payload.files.filter((file) => file.size > 0)

  if (files.length > 0 && !shouldPreferSpreadsheetClipboardText(payload.text, payload.html)) {
    return { kind: 'files', files }
  }
  if (!payload.text) {
    return { kind: 'none' }
  }
  if (payload.text.length > PASTE_TEXT_ATTACHMENT_THRESHOLD) {
    return { kind: 'text-attachment', text: payload.text }
  }
  return { kind: 'text-inline', text: payload.text }
}
