/**
 * 聊天附件分流：一个文件该走「图片通道」还是「文件通道」。
 *
 * 背景：文件通道不再有任何扩展名白名单——普通文件对模型而言只是一个路径引用，
 * 限制可附类型没有意义。唯一必须保留的区分是「是不是位图」：
 *
 * - 位图 → 上传到全局附件目录，经 sharp 转码（缩放 + 缩略图），并以字节内联给模型
 * - 其余 → 落会话工作目录，只给路径引用，模型按扩展名自行选工具读取
 *
 * 判定表与后端 RASTER_IMAGE_EXTENSIONS 同源（见 utils/media-type.ts 的镜像契约测试），
 * 因此不会出现「前端当图片选、后端当文件存」这类前后端分叉。
 */

import { isRasterImageExtension, normalizeExtension } from './media-type'

/** 从文件名取扩展名（不含点，小写；无扩展名返回空串） */
export function extensionFromName(fileName?: string | null): string {
  const match = (fileName ?? '').match(/\.([^./\\]+)$/)
  return match ? match[1].toLowerCase() : ''
}

/** 从 MIME 取扩展名（粘贴的 Blob 文件可能没有文件名，只有 MIME） */
function extensionFromMime(mimeType?: string | null): string {
  const subtype = (mimeType ?? '').split('/')[1]
  if (!subtype) return ''
  // 归一 jpeg→jpg 之类的差异，让后续判定走同一张表
  return normalizeExtension(subtype === 'svg+xml' ? 'svg' : subtype)
}

/** 是否为需要转码/可内联的位图（文件名扩展名优先，缺失时回退 MIME） */
export function isRasterImageFile(file: { name?: string | null; type?: string | null }): boolean {
  const ext = extensionFromName(file?.name) || extensionFromMime(file?.type)
  return isRasterImageExtension(ext)
}

/** 分流：'image' 走图片通道，'file' 走路径引用通道 */
export function classifyAttachment(file: {
  name?: string | null
  type?: string | null
}): 'image' | 'file' {
  return isRasterImageFile(file) ? 'image' : 'file'
}

/** 附件的处理计划：决定落点与「字节要不要过网络」 */
export interface AttachmentPlan {
  /** 'image' = 图片通道（上传 + 转码 + 内联字节）；'file' = 路径引用通道 */
  kind: 'image' | 'file'
  /** 只引用本机绝对路径，不读字节（Electron 非图片） */
  useLocalPath: boolean
  /** 字节是否需要经 HTTP 上传到服务端 —— 上传限额只对这类文件有意义 */
  needsUpload: boolean
}

/**
 * 决定一个附件的处理方式。
 *
 * `needsUpload` 是「是否该受上传限额约束」的唯一判据：
 * Electron 下非图片文件只把本机绝对路径作为引用发出去，字节始终留在本机，
 * 给它们套上传限额（默认 100MB）是没有意义的——本服务既不接收也不存储这些字节。
 *
 * `localPath` 由调用方通过 Electron 的 getPathForFile 取得：粘贴生成的 Blob 文件
 * 拿不到本机路径（返回空串），这种只能走上传，因此同样受限额约束。
 */
export function planAttachment(
  file: { name?: string | null; type?: string | null },
  ctx: { isElectron: boolean; localPath?: string | null },
): AttachmentPlan {
  const kind = classifyAttachment(file)
  const useLocalPath = ctx.isElectron && kind === 'file' && !!ctx.localPath
  return { kind, useLocalPath, needsUpload: !useLocalPath }
}
