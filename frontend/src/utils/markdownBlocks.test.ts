import { describe, expect, it } from 'vitest'
import { createMarkedInstance } from '@/composables/useMarkdown'
import { createBlockCachedRenderer } from './markdownBlocks'

/** 与 MarkdownContent 使用的单例配置对齐（escapeHtml=true） */
function createMarked() {
  return createMarkedInstance({ escapeHtml: true })
}

const CORPUS = [
  '# 标题',
  '',
  '第一段，包含 **粗体**、*斜体*、`行内代码` 和 [链接](https://example.com)。',
  '',
  '第二段，第一行',
  '第二行（breaks 应产生 br）',
  '',
  '- 列表项一',
  '- 列表项二',
  '  - 嵌套项',
  '',
  '> 引用块',
  '> 第二行',
  '',
  '| 列 A | 列 B |',
  '| --- | --- |',
  '| 1 | 2 |',
  '',
  '```ts',
  'const a = 1;',
  'function f() { return a; }',
  '```',
  '',
  '```',
  'plain fence',
  '```',
  '',
  '---',
  '',
  'Setext 标题',
  '===',
  '',
  '![图片](https://example.com/a.png)',
  '',
  '<div>raw html</div>',
  '',
].join('\n')

const REF_CORPUS = [
  '使用 [引用链接][ref] 的段落。',
  '',
  '[ref]: https://example.com/ref',
  '',
].join('\n')

describe('markdownBlocks 块级渲染缓存', () => {
  it('契约：逐块渲染拼接结果与整篇 marked.parse 逐字符一致', () => {
    const marked = createMarked()
    const renderer = createBlockCachedRenderer(marked)

    for (const sample of [CORPUS, REF_CORPUS, '只有一段。\n', '']) {
      const result = renderer.render(sample)
      expect(result.html).toBe(marked.parse(sample) as string)
    }
  })

  it('追加流：每个前缀都与整篇解析一致，且稳定块命中缓存', () => {
    const marked = createMarked()
    const renderer = createBlockCachedRenderer(marked)

    const cuts = [
      Math.floor(CORPUS.length * 0.3),
      Math.floor(CORPUS.length * 0.6),
      CORPUS.length,
    ]
    for (const cut of cuts) {
      const text = CORPUS.slice(0, cut)
      expect(renderer.render(text).html).toBe(marked.parse(text) as string)
    }

    // 再追加一段：稳定段应全部命中缓存（尾部 2 块除外）
    const appended = CORPUS + '追加的新段落。\n'
    const result = renderer.render(appended)
    expect(result.html).toBe(marked.parse(appended) as string)
    expect(result.blocks).toBeGreaterThan(3)
    expect(result.reused).toBeGreaterThan(0)
    expect(result.reused).toBeLessThanOrEqual(result.blocks - 2)
  })

  it('非追加变更（编辑/覆盖）清空缓存并正确重建', () => {
    const marked = createMarked()
    const renderer = createBlockCachedRenderer(marked)
    renderer.render(CORPUS)

    const replaced = '# 新标题\n\n完全不同的正文。\n'
    const result = renderer.render(replaced)
    expect(result.html).toBe(marked.parse(replaced) as string)
    expect(result.reused).toBe(0)
  })

  it('引用式链接定义退回整篇解析，渲染结果正确', () => {
    const marked = createMarked()
    const renderer = createBlockCachedRenderer(marked)

    const result = renderer.render(REF_CORPUS)
    expect(result.html).toContain('https://example.com/ref')
    expect(result.html).toBe(marked.parse(REF_CORPUS) as string)
  })

  it('空文本清空缓存并返回空串，之后可重新渲染', () => {
    const marked = createMarked()
    const renderer = createBlockCachedRenderer(marked)
    renderer.render(CORPUS)

    expect(renderer.render('')).toEqual({ html: '', blocks: 0, reused: 0 })

    const restarted = '# 重新开始\n\n正文\n'
    expect(renderer.render(restarted).html).toBe(marked.parse(restarted) as string)
  })

  it('高亮已迁移到 code renderer：代码块仍输出 hljs token', () => {
    const marked = createMarked()
    const renderer = createBlockCachedRenderer(marked)

    const html = renderer.render('```ts\nconst a = 1;\n```\n').html
    expect(html).toContain('class="hljs language-ts"')
    expect(html).toContain('hljs-keyword')
  })

  it('reset 后不残留旧缓存', () => {
    const marked = createMarked()
    const renderer = createBlockCachedRenderer(marked)
    renderer.render(CORPUS)

    renderer.reset()
    const result = renderer.render(CORPUS)
    expect(result.html).toBe(marked.parse(CORPUS) as string)
    expect(result.reused).toBe(0)
  })
})
