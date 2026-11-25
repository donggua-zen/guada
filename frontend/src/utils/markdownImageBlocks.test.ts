import { describe, expect, it } from 'vitest'
import { createMarkedInstance } from '@/composables/useMarkdown'
import { createGroupedBlockRenderer, isImageOnlyInline } from './markdownImageBlocks'

/**
 * 图片分组的行为契约（对齐 zcode 的 MarkdownImageParagraph）：
 * 只有「相邻的纯图片段落」才合并成画廊；文字段落、代码围栏、单图都不受影响。
 */

function createMarked() {
  return createMarkedInstance({ escapeHtml: true })
}

function render(markdown: string) {
  return createGroupedBlockRenderer(createMarked()).render(markdown)
}

const galleries = (html: string) => (html.match(/data-md-image-gallery/g) || []).length

describe('isImageOnlyInline', () => {
  it('只有图片（含空白/换行）才算纯图片段落', () => {
    expect(isImageOnlyInline([{ type: 'image' } as never])).toBe(true)
    expect(isImageOnlyInline([{ type: 'image' } as never, { type: 'br' } as never])).toBe(true)
    expect(isImageOnlyInline([{ type: 'text', text: '   ' } as never])).toBe(false)
  })

  it('图片旁边有文字就不是纯图片段落', () => {
    expect(
      isImageOnlyInline([{ type: 'image' } as never, { type: 'text', raw: ' 说明', text: ' 说明' } as never]),
    ).toBe(false)
  })
})

describe('createGroupedBlockRenderer（相邻图片分组）', () => {
  it('连续两张图片合并成一个画廊', () => {
    const result = render('![a](./a.png)\n\n![b](./b.png)\n')
    expect(result.galleries).toBe(1)
    expect(galleries(result.html)).toBe(1)
    expect(result.html).toContain('md-image-gallery')
  })

  it('三张连续图片仍然只有一个画廊', () => {
    const result = render('![a](./a.png)\n\n![b](./b.png)\n\n![c](./c.png)\n')
    expect(result.galleries).toBe(1)
    expect(galleries(result.html)).toBe(1)
  })

  it('单张图片不分组（保持独立卡片）', () => {
    const result = render('![a](./a.png)\n')
    expect(result.galleries).toBe(0)
    expect(result.html).not.toContain('md-image-gallery')
  })

  it('说明文字会中断分组', () => {
    const result = render('![a](./a.png)\n\n![b](./b.png)\n\n这里说明\n\n![c](./c.png)\n\n![d](./d.png)\n')
    expect(result.galleries).toBe(2)
  })

  it('代码围栏里的图片语法不参与分组', () => {
    const result = render('```md\n![a](./a.png)\n\n![b](./b.png)\n```\n')
    expect(result.galleries).toBe(0)
  })

  it('画廊内剥掉段落外壳（避免 grid 列被段落外边距影响）', () => {
    const result = render('![a](./a.png)\n\n![b](./b.png)\n')
    expect(result.html).toMatch(/<div class="md-image-gallery"[^>]*><img/)
  })

  it('追加文本时复用未变化的块（块级缓存仍生效）', () => {
    const renderer = createGroupedBlockRenderer(createMarked())
    const head = '# 标题\n\n第一段\n\n![a](./a.png)\n\n![b](./b.png)\n'
    renderer.render(head)
    const grown = renderer.render(`${head}\n新增一段\n\n新增第二段\n\n新增第三段\n`)
    expect(grown.reused).toBeGreaterThan(0)
  })

  it('引用式定义退回整篇解析，不误做分组', () => {
    const result = render('[x][ref]\n\n[ref]: https://example.com\n')
    expect(result.galleries).toBe(0)
  })
})
