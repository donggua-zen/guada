import { workspaceApi } from '@/services/modules/workspace.api'
import type { ApiContext } from '@/services/modules/api-context'

export type Workspace = 'alpha' | 'beta'
export type ImageSource = { url: string; target: string; kind: string; blocked?: boolean }

const fixtureUrls = new Map<string, string>()

function fixture(workspace: Workspace, name: string): string {
  const key = `${workspace}/${name}`
  const cached = fixtureUrls.get(key)
  if (cached) return cached
  const beta = workspace === 'beta'
  const accent = beta ? '#dc8b42' : '#7287e9'
  const background = beta ? '#fff4e5' : '#edf1ff'
  if (name === 'logo' || name === 'badge' || name === 'narrow') {
    const width = name === 'logo' ? 96 : name === 'badge' ? 160 : 180
    const height = name === 'logo' ? 96 : name === 'badge' ? 40 : 420
    const art = name === 'logo'
      ? `<rect x="8" y="8" width="80" height="80" rx="24" fill="${accent}"/><text x="48" y="64" text-anchor="middle" fill="white" font-family="sans-serif" font-size="48" font-weight="600">G</text>`
      : name === 'badge'
        ? `<rect width="160" height="40" rx="8" fill="${background}"/><circle cx="20" cy="20" r="5" fill="${accent}"/><text x="36" y="25" fill="#30364c" font-family="sans-serif" font-size="14">Build passed</text>`
        : `<rect width="180" height="420" rx="16" fill="${background}"/><rect x="12" y="16" width="156" height="388" rx="10" fill="white"/><rect x="24" y="36" width="132" height="64" rx="8" fill="${accent}"/><text x="90" y="76" text-anchor="middle" fill="white" font-family="sans-serif" font-size="16">Mobile UI</text>${[124, 200, 276].map(y => `<rect x="24" y="${y}" width="132" height="56" rx="8" fill="${background}"/><path d="M36 ${y + 20}H132M36 ${y + 34}H108" stroke="${accent}" stroke-width="4"/>`).join('')}`
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${art}</svg>`
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
    fixtureUrls.set(key, url)
    return url
  }
  const tall = name === 'flow'
  const width = tall ? 720 : 1280
  const height = tall ? 1200 : 720
  const cards = tall
    ? `<path d="M360 290V925" stroke="${accent}" stroke-width="8" stroke-dasharray="12 12"/>${[220, 490, 760].map((y, i) => `<rect x="130" y="${y}" width="460" height="170" rx="24" fill="white"/><circle cx="195" cy="${y + 85}" r="28" fill="${accent}"/><text x="195" y="${y + 94}" text-anchor="middle" fill="white" font-size="26">${i + 1}</text><text x="250" y="${y + 94}" fill="#30364c" font-size="28">${['Resolve path', 'Load image', 'Open preview'][i]}</text>`).join('')}`
    : `<rect x="70" y="170" width="1140" height="480" rx="28" fill="white"/><path d="M150 570H1130M150 480H1130M150 390H1130M150 300H1130" stroke="#e7eaf1" stroke-width="2"/>${[150, 260, 210, 340, 300, beta ? 360 : 410].map((h, i) => `<rect x="${210 + i * 150}" y="${570 - h}" width="76" height="${h}" rx="12" fill="${accent}" opacity="${0.4 + i * 0.1}"/><text x="${248 + i * 150}" y="610" text-anchor="middle" fill="#73798a" font-size="22">${i + 1}月</text>`).join('')}`
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" rx="28" fill="${background}"/><text x="70" y="90" fill="#30364c" font-family="sans-serif" font-size="36" font-weight="600">${tall ? 'Image rendering workflow' : beta ? 'Workspace B · Growth report' : 'Workspace A · Growth report'}</text><text x="70" y="132" fill="#73798a" font-family="sans-serif" font-size="22">${tall ? 'Full image available in preview' : 'Same relative path, different workspace'}</text><g font-family="sans-serif">${cards}</g></svg>`
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
  fixtureUrls.set(key, url)
  return url
}

export function workspaceRoot(workspace: Workspace): string {
  return workspace === 'alpha' ? 'D:/projects/workspace-a' : 'D:/projects/workspace-b'
}

export function resolvePreviewImage(
  src: string,
  options: { workspace: Workspace; sessionId?: string; workspacePath?: string; recovered?: boolean; retry?: number },
): ImageSource {
  const raw = src.trim()
  if (/^https?:\/\//i.test(raw) || /^data:image\/(?:png|jpeg|gif|webp|avif|bmp);/i.test(raw)) {
    return { url: raw, target: raw, kind: '外部图片' }
  }
  if (!raw || (/^[a-z][a-z\d+.-]*:/i.test(raw) && !/^[a-z]:[/\\]/i.test(raw) && !/^file:/i.test(raw)) || raw.startsWith('//')) {
    return { url: '', target: '不支持的图片地址', kind: '已拦截', blocked: true }
  }
  let path = raw
  if (/^file:/i.test(path)) {
    try {
      const parsed = new URL(path)
      if (parsed.host && parsed.host !== 'localhost') throw new Error('UNC is not enabled in this preview')
      path = decodeURIComponent(parsed.pathname).replace(/^\/([a-z]:\/)/i, '$1')
    } catch {
      return { url: '', target: '无法解析 file URL', kind: '已拦截', blocked: true }
    }
  }
  path = path.replace(/\\/g, '/')
  if (options.sessionId) {
    // 复用生产工作区 URL 构造器；这里是独立 Web 入口，使用同源 Vite 代理。
    const context = { baseURL: '/api/v1' } as ApiContext
    let url = workspaceApi.getWorkspaceRawFileUrl.call(context, options.sessionId, path)
    if (options.retry) url += `&_previewRetry=${options.retry}`
    return {
      url,
      target: /^[a-z]:\//i.test(path) || path.startsWith('/') ? path : `${options.workspacePath || '会话工作目录'}/${path}`,
      kind: '真实会话文件',
    }
  }
  const root = workspaceRoot(options.workspace)
  if (path.toLowerCase().startsWith(`${root.toLowerCase()}/`)) path = path.slice(root.length + 1)
  else if (/^[a-z]:\//i.test(path) || path.startsWith('/')) {
    return { url: '', target: '路径位于演示工作目录之外', kind: '已拦截', blocked: true }
  }
  const segments: string[] = []
  for (const segment of path.split('/')) {
    if (!segment || segment === '.') continue
    if (segment === '..') {
      if (!segments.length) return { url: '', target: '路径越出工作目录', kind: '已拦截', blocked: true }
      segments.pop()
    } else segments.push(segment)
  }
  const relative = segments.join('/')
  const target = `${root}/${relative}`
  if (relative === 'outputs/chart.svg') return { url: fixture(options.workspace, 'chart'), target, kind: '相对工作目录' }
  if (relative === 'outputs/flow.svg') return { url: fixture(options.workspace, 'flow'), target, kind: '相对工作目录' }
  const smallFixture = relative.match(/^outputs\/(logo|badge|narrow)\.svg$/)
  if (smallFixture) return { url: fixture(options.workspace, smallFixture[1]), target, kind: '保持原始尺寸' }
  if (relative === 'outputs/pending.svg' && options.recovered) return { url: fixture(options.workspace, 'chart'), target, kind: '重试成功' }
  return { url: `/_markdown_preview_missing_/${encodeURIComponent(relative)}.png?retry=${options.retry || 0}`, target, kind: '文件不存在' }
}

export function disposeFixtures(): void {
  fixtureUrls.forEach(url => URL.revokeObjectURL(url))
  fixtureUrls.clear()
}
