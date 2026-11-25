/**
 * Markdown 正文图片：地址解析 + 卡片标记。
 *
 * 背景：模型输出的图片常写成相对路径（`./outputs/a.png`、`images/b.png`），
 * 浏览器会按「页面文档基址」解析，落到程序运行目录而不是会话工作目录。
 * 这里把地址统一换算成「会话工作区取图端点」，由后端按该会话的工作目录解析并做越界检查。
 *
 * 之所以不预先读字节再转 blob：本仓库已有带 Range/ETag/鉴权的取图端点，
 * 直接复用可以让大图按块加载，也不必把 base64 常驻内存。
 */

import { apiService } from '@/services/ApiService'
import { baseNameOf, fileUrlToPath, isAbsoluteLocalPath, toSessionAttachmentStoragePath } from '@/utils/localPath'
import { toResourceUrl } from '@/utils/url'

/** 视作「小图」的原始尺寸上限：不放大、不套宽卡片说明条 */
export const IMAGE_SMALL_MAX_WIDTH = 240
export const IMAGE_SMALL_MAX_HEIGHT = 160

/** 单图卡片的最大显示宽度（正文宽度的 50% 由 CSS 兜底，这里是像素上限） */
const IMAGE_MAX_DISPLAY_WIDTH = 600
/** 单图卡片的最大显示高度（超出则按比例收窄容器，长图不撑满一屏） */
const IMAGE_MAX_DISPLAY_HEIGHT = 340

export interface MarkdownImageResolution {
  /** 可直接放进 `<img src>` 的地址；被拒绝时为空串 */
  url: string
  /** 落盘文件名，作为卡片角标（也是无障碍文案的兜底） */
  fileName: string
  /** 被拒绝的原因（渲染成占位提示） */
  rejectedReason?: string
}

/** 词法归一：拒绝上跳越出工作目录的引用（跨平台，不依赖后端返回 403 再报错） */
export function normalizeWorkspaceRelativePath(raw: string): string | null {
  const segments: string[] = []
  for (const segment of raw.replace(/\\/g, '/').split('/')) {
    if (!segment || segment === '.') continue
    if (segment === '..') {
      if (!segments.length) return null
      segments.pop()
      continue
    }
    segments.push(segment)
  }
  return segments.join('/')
}

/** 外部地址（http/https/data/blob）不参与工作区解析 */
function isExternalImageSource(src: string): boolean {
  return /^(https?:\/\/|data:|blob:)/i.test(src)
}

/**
 * Markdown 图片地址 → 会话工作区取图 URL。
 *
 * @param src Markdown 里的原始地址
 * @param sessionId 该消息所属会话（**不是**当前激活会话，避免切换会话时串图）
 */
export function resolveMarkdownImage(src: string, sessionId: string): MarkdownImageResolution {
  const raw = src.trim()
  const fileNameOf = (value: string) => baseNameOf(value) || value

  if (!raw) {
    return { url: '', fileName: '图片', rejectedReason: '图片地址为空' }
  }

  if (isExternalImageSource(raw)) {
    return { url: raw, fileName: fileNameOf(raw), }
  }

  // 非 http/https 的协议头（vscode:、mailto: 等）不是图片，保持原样不外泄到工作区接口
  const scheme = raw.match(/^([A-Za-z][A-Za-z0-9+.-]*):/)
  const isDriveLetter = Boolean(scheme && scheme[1]!.length === 1)
  if (scheme && !isDriveLetter && !/^file:/i.test(raw)) {
    return { url: '', fileName: fileNameOf(raw), rejectedReason: `不支持的图片协议：${scheme[1]}:` }
  }

  // 会话附件自包含引用（sessions/<id>/images/...）走鉴权取图端点
  if (raw.startsWith('sessions/')) {
    return { url: toResourceUrl(raw), fileName: fileNameOf(raw) }
  }

  // file:// 与「本机绝对路径」都交给后端：工作区内的绝对路径能被正确服务，
  // 工作区外的会被路径牢笼拒绝（前端不做猜测，避免把路径拼坏）。
  const localAbsolute = fileUrlToPath(raw) ?? (isAbsoluteLocalPath(raw) ? raw.replace(/\\/g, '/') : null)
  if (localAbsolute) {
    const attachment = toSessionAttachmentStoragePath(localAbsolute, sessionId)
    if (attachment) return { url: toResourceUrl(attachment), fileName: fileNameOf(localAbsolute) }
    return { url: apiService.getWorkspaceRawFileUrl(sessionId, localAbsolute), fileName: fileNameOf(localAbsolute) }
  }

  // 工作区相对引用：先做词法归一，上跳越界直接拒绝（不必等后端 403）
  const relative = normalizeWorkspaceRelativePath(raw)
  if (!relative) {
    return { url: '', fileName: fileNameOf(raw), rejectedReason: '图片路径越出工作目录' }
  }
  return { url: apiService.getWorkspaceRawFileUrl(sessionId, relative), fileName: fileNameOf(relative) }
}

/** 重试计数追加到查询串（`raw-file` 忽略未知参数，值变化即触发浏览器重新请求） */
export function withRetryParam(url: string, retry: number): string {
  if (!retry) return url
  const separator = url.includes('?') ? '&' : '?'
  return `${url}${separator}_mdRetry=${retry}`
}

/** HTML 属性转义：alt/title/src 都来自模型输出，必须逐项转义 */
export function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

export interface MarkdownImageRenderInput {
  src: string
  alt: string
  title?: string
  sessionId: string
  /** 该图片的重试次数（0 表示首次） */
  retry: number
  /**
   * 地址解析器覆盖：默认按会话工作目录解析（生产路径）。
   * 临时预览页用它注入演示图片，从而与正式实现共用同一套卡片/分组/交互代码。
   */
  resolveImage?: (src: string) => MarkdownImageResolution
}

/** 被拦截/不可用图片的占位图标（内联 SVG，不依赖外部资源与图标库） */
const BLOCKED_IMAGE_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2.5"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="m4 17 4.5-4.5 3 3 2.5-2.5L20 18"/><path d="M3 3l18 18"/></svg>`

/**
 * 单张图片的卡片标记。行为由 MarkdownContent 的事件委托承担：
 * - 点击卡片 → 预览（同组内左右切换）
 * - 点击重试 → 换一个带 `_mdRetry` 的地址重新渲染
 * 尺寸（原尺寸 / 单图半宽 / 长图收窄）由图片 load 事件后的 DOM 同步补上。
 *
 * 被拦截（例如越出工作目录、不支持的协议）时不发请求，直接渲染占位图 + 原因，
 * 让用户看到「这里本该有一张图，但被拒绝了」，而不是一块空白。
 */
export function renderMarkdownImageCard(input: MarkdownImageRenderInput): string {
  const resolved = (input.resolveImage ?? ((src: string) => resolveMarkdownImage(src, input.sessionId)))(input.src)
  const label = input.alt.trim() || resolved.fileName
  const url = withRetryParam(resolved.url, input.retry)
  const blocked = !resolved.url
  const state = blocked ? 'blocked' : 'loading'
  const titleAttr = input.title ? ` title="${escapeHtmlAttribute(input.title)}"` : ''
  const reason = resolved.rejectedReason ?? ''
  const labelAttr = escapeHtmlAttribute(label)

  // 被拦截的卡片不可点击、不可聚焦：它不是「可预览的图片」，只是说明为什么没有图
  const interactiveAttrs = blocked
    ? `role="img" aria-label="图片不可用：${escapeHtmlAttribute(reason)}"`
    : `tabindex="0" role="button" aria-label="查看图片：${labelAttr}" title="${labelAttr}"`

  return `<span class="markdown-image-card" data-md-image-src="${escapeHtmlAttribute(input.src)}" data-md-image-state="${state}" ${interactiveAttrs}>
  <span class="markdown-image-card__body">
    ${blocked ? `<span class="markdown-image-card__blocked">${BLOCKED_IMAGE_ICON}<span class="markdown-image-card__blocked-title">图片不可用</span><span class="markdown-image-card__blocked-reason">${escapeHtmlAttribute(reason)}</span></span>` : ''}
    ${!blocked ? `<img src="${escapeHtmlAttribute(url)}" alt="${labelAttr}"${titleAttr} loading="lazy" decoding="async" />` : ''}
    ${blocked ? '' : `<span class="markdown-image-card__placeholder">
      <span class="markdown-image-card__spinner" aria-hidden="true"></span>
      <span class="markdown-image-card__message">正在加载图片…</span>
      <button type="button" class="markdown-image-card__retry" data-md-image-retry>重试</button>
    </span>`}
    <span class="markdown-image-card__expand" aria-hidden="true">↗</span>
  </span>
  <span class="markdown-image-card__caption"><span>${labelAttr}</span><span class="markdown-image-card__file">${escapeHtmlAttribute(resolved.fileName)}</span></span>
</span>`
}

/** 画廊卡片宽度：按缩略图高度反推比例，宽图占得宽、竖图占得窄，避免整行空出一大片 */
const GALLERY_HEIGHT = 176
const GALLERY_MIN_WIDTH = 140
const GALLERY_MAX_WIDTH = 360

/**
 * 卡片在图片 load 后按原始尺寸决定显示宽度：
 * - 单图：`--md-image-width`（小图不放大、长图收窄容器）
 * - 画廊：`--md-gallery-width`（按缩略图高度反推，图片不变形且不浪费横向空间）
 */
export function applyImageNaturalSize(card: HTMLElement, naturalWidth: number, naturalHeight: number): void {
  const ratio = naturalWidth / Math.max(1, naturalHeight)
  const width = Math.min(naturalWidth, IMAGE_MAX_DISPLAY_WIDTH, IMAGE_MAX_DISPLAY_HEIGHT * ratio)
  card.style.setProperty('--md-image-width', `${Math.round(width)}px`)

  const galleryWidth = Math.min(GALLERY_MAX_WIDTH, Math.max(GALLERY_MIN_WIDTH, GALLERY_HEIGHT * ratio))
  card.style.setProperty('--md-gallery-width', `${Math.round(galleryWidth)}px`)

  card.dataset.mdImageSmall = String(naturalWidth <= IMAGE_SMALL_MAX_WIDTH && naturalHeight <= IMAGE_SMALL_MAX_HEIGHT)
}
