import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  applyImageNaturalSize,
  escapeHtmlAttribute,
  normalizeWorkspaceRelativePath,
  renderMarkdownImageCard,
  resolveMarkdownImage,
  withRetryParam,
} from './markdownImages'

/**
 * 正文图片地址解析契约：相对路径必须落到「会话工作区取图端点」，
 * 而不是让浏览器按页面基址解析（那会指向程序运行目录）。
 */

const SESSION = 's1'

beforeEach(() => {
  vi.unstubAllGlobals()
  // 让 toResourceUrl / getWorkspaceRawFileUrl 走 Web 同源分支（Node 测试环境没有 storage）
  const storage = { getItem: () => null, setItem: () => {}, removeItem: () => {} }
  vi.stubGlobal('window', {})
  vi.stubGlobal('sessionStorage', storage)
  vi.stubGlobal('localStorage', storage)
})

describe('normalizeWorkspaceRelativePath', () => {
  it('归一化 ./ 与重复分隔符', () => {
    expect(normalizeWorkspaceRelativePath('./outputs/./a.png')).toBe('outputs/a.png')
    expect(normalizeWorkspaceRelativePath('outputs//a.png')).toBe('outputs/a.png')
    expect(normalizeWorkspaceRelativePath('outputs\\a.png')).toBe('outputs/a.png')
  })

  it('允许在目录内回退', () => {
    expect(normalizeWorkspaceRelativePath('outputs/../images/a.png')).toBe('images/a.png')
  })

  it('上跳越出工作目录一律拒绝', () => {
    expect(normalizeWorkspaceRelativePath('../secret.png')).toBeNull()
    expect(normalizeWorkspaceRelativePath('a/../../secret.png')).toBeNull()
  })
})

describe('resolveMarkdownImage', () => {
  it('相对路径走会话工作区 raw-file（不再按页面基址解析）', () => {
    const resolved = resolveMarkdownImage('./outputs/chart.png', SESSION)
    expect(resolved.url).toContain(`/sessions/${SESSION}/workspace/raw-file`)
    expect(decodeURIComponent(resolved.url)).toContain('path=outputs/chart.png')
    expect(resolved.fileName).toBe('chart.png')
  })

  it('外部地址原样保留', () => {
    expect(resolveMarkdownImage('https://example.com/a.png', SESSION).url).toBe('https://example.com/a.png')
    expect(resolveMarkdownImage('data:image/png;base64,AAA', SESSION).url).toBe('data:image/png;base64,AAA')
  })

  it('越界引用被拒绝并给出原因', () => {
    const resolved = resolveMarkdownImage('../../etc/passwd', SESSION)
    expect(resolved.url).toBe('')
    expect(resolved.rejectedReason).toContain('越出工作目录')
  })

  it('非图片协议被拒绝', () => {
    const resolved = resolveMarkdownImage('vscode://file/a.png', SESSION)
    expect(resolved.url).toBe('')
    expect(resolved.rejectedReason).toContain('不支持的图片协议')
  })

  it('本机绝对路径交给工作区接口（越界由后端拒绝）', () => {
    const resolved = resolveMarkdownImage('D:/ws/outputs/a.png', SESSION)
    expect(resolved.url).toContain(`/sessions/${SESSION}/workspace/raw-file`)
  })

  it('会话附件存储引用走鉴权取图端点', () => {
    const resolved = resolveMarkdownImage(`sessions/${SESSION}/images/2026/a.png`, SESSION)
    expect(resolved.url).toContain(`/sessions/${SESSION}/attachments/raw-file`)
  })
})

describe('renderMarkdownImageCard', () => {
  const base = { src: './outputs/chart.png', alt: '增长图', sessionId: SESSION, retry: 0 }

  it('产出可预览的卡片骨架', () => {
    const html = renderMarkdownImageCard(base)
    expect(html).toContain('markdown-image-card')
    expect(html).toContain('data-md-image-state="loading"')
    expect(html).toContain('loading="lazy"')
    expect(html).toContain('decoding="async"')
    expect(html).toContain('data-md-image-retry')
  })

  it('alt/title 逐项转义，引号不会提前结束属性', () => {
    const html = renderMarkdownImageCard({ ...base, alt: 'a" onerror="alert(1)' })
    expect(html).not.toContain('onerror="alert(1)"')
    expect(html).toContain('&quot;')
  })

  it('被拒绝的地址渲染成 blocked 占位，不生成 img', () => {
    const html = renderMarkdownImageCard({ ...base, src: '../secret.png' })
    expect(html).toContain('data-md-image-state="blocked"')
    expect(html).not.toContain('<img')
  })

  it('被拦截时给出可视化占位（图标 + 原因），而不是一片空白', () => {
    const html = renderMarkdownImageCard({ ...base, src: '../secret.png' })
    expect(html).toContain('markdown-image-card__blocked')
    expect(html).toContain('<svg')
    expect(html).toContain('图片不可用')
    expect(html).toContain('越出工作目录')
    // 不可预览：不提供 tabindex / 重试按钮
    expect(html).not.toContain('tabindex')
    expect(html).not.toContain('data-md-image-retry')
  })

  it('重试次数体现在查询串上（同地址也能重新请求）', () => {
    const first = renderMarkdownImageCard({ ...base, retry: 0 })
    const retried = renderMarkdownImageCard({ ...base, retry: 2 })
    expect(first).not.toContain('_mdRetry')
    expect(retried).toContain('_mdRetry=2')
  })

  it('解析器可覆盖（预览页注入演示来源）', () => {
    const html = renderMarkdownImageCard({ ...base, resolveImage: () => ({ url: 'blob:demo', fileName: 'demo.png' }) })
    expect(html).toContain('src="blob:demo"')
  })
})

describe('applyImageNaturalSize', () => {
  function fakeCard() {
    const props = new Map<string, string>()
    return {
      style: { setProperty: (key: string, value: string) => props.set(key, value) },
      dataset: {} as Record<string, string>,
      props,
    } as unknown as HTMLElement & { props: Map<string, string> }
  }

  it('小图按原始尺寸显示并标记 small', () => {
    const card = fakeCard()
    applyImageNaturalSize(card, 96, 96)
    expect(card.dataset.mdImageSmall).toBe('true')
    expect((card as unknown as { props: Map<string, string> }).props.get('--md-image-width')).toBe('96px')
  })

  it('长图按最大高度收窄容器', () => {
    const card = fakeCard()
    applyImageNaturalSize(card, 720, 1200)
    const width = Number((card as unknown as { props: Map<string, string> }).props.get('--md-image-width')?.replace('px', ''))
    expect(width).toBeLessThanOrEqual(340)
    expect(card.dataset.mdImageSmall).toBe('false')
  })

  it('超大图受 600px 上限约束', () => {
    const card = fakeCard()
    applyImageNaturalSize(card, 4000, 2000)
    expect((card as unknown as { props: Map<string, string> }).props.get('--md-image-width')).toBe('600px')
  })
})

describe('withRetryParam / escapeHtmlAttribute', () => {
  it('按是否已有查询串选择分隔符', () => {
    expect(withRetryParam('/a', 1)).toBe('/a?_mdRetry=1')
    expect(withRetryParam('/a?x=1', 1)).toBe('/a?x=1&_mdRetry=1')
    expect(withRetryParam('/a', 0)).toBe('/a')
  })

  it('转义 HTML 属性特殊字符', () => {
    expect(escapeHtmlAttribute('a&b"c<d>e')).toBe('a&amp;b&quot;c&lt;d&gt;e')
  })
})
