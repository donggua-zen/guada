import type { Marked, Token, Tokens } from 'marked'

/**
 * Markdown 图片分组 + 块级缓存渲染器。
 *
 * 为什么在 token 阶段分组：
 * 1. 不需要「先渲染成 HTML，再建临时 DOM 找段落」的二次扫描——流式输出时那次扫描
 *    每 150ms 跑一遍全文，长回复会成为明显开销；
 * 2. marked 的 space token 只在顶层出现，不会误伤代码围栏里的同名文本。
 *
 * 与 createBlockCachedRenderer 的关系：复用同一套「尾部 N 块不稳定」的稳定块缓存，
 * 只是输出阶段多了一步「相邻纯图片段落合并」。正文没有连续图片时行为完全一致。
 */

const UNSTABLE_TAIL_BLOCKS = 2
const REFERENCE_DEFINITION_RE = /^ {0,3}\[[^\]]+\]:/m

/** 段落内联 token 是否只由图片与空白组成 */
export function isImageOnlyInline(tokens: Token[] | undefined): boolean {
  if (!tokens?.length) return false
  let images = 0
  for (const token of tokens) {
    if (token.type === 'image') {
      images += 1
      continue
    }
    // 段落内的换行与纯空白文本不破坏「纯图片」语义
    if (token.type === 'br' || token.type === 'escape') continue
    if (token.type === 'text' && !(token as Tokens.Text).text.trim()) continue
    return false
  }
  return images > 0
}

function isImageOnlyParagraph(token: Token): boolean {
  return token.type === 'paragraph' && isImageOnlyInline((token as Tokens.Paragraph).tokens)
}

/** 从段落 HTML 里剥掉外层 `<p>`：画廊用 grid 排版，段落外边距会破坏列宽与对齐 */
function stripParagraphWrapper(html: string): string {
  return html.replace(/^\s*<p>\s*/i, '').replace(/\s*<\/p>\s*$/i, '')
}

export interface GroupedRenderResult {
  html: string
  /** 本次 lex 出的顶层块数量 */
  blocks: number
  /** 本次复用缓存、未重新渲染的块数量 */
  reused: number
  /** 本次输出中包含的图片画廊数量 */
  galleries: number
}

export interface GroupedBlockRenderer {
  render(text: string): GroupedRenderResult
  reset(): void
}

export function createGroupedBlockRenderer(
  marked: Marked,
  unstableTailBlocks: number = UNSTABLE_TAIL_BLOCKS,
): GroupedBlockRenderer {
  let prevText = ''
  let cache = new Map<string, string>()

  function reset(): void {
    prevText = ''
    cache.clear()
  }

  function render(text: string): GroupedRenderResult {
    if (!text) {
      reset()
      return { html: '', blocks: 0, reused: 0, galleries: 0 }
    }

    // 非追加（编辑/覆盖/切换内容）→ 旧缓存不可复用
    if (!text.startsWith(prevText)) cache.clear()
    prevText = text

    // 引用定义会影响任意块的渲染结果，块级复用不安全 → 整篇解析（不分组，退回原始输出）
    if (REFERENCE_DEFINITION_RE.test(text)) {
      cache.clear()
      return { html: marked.parse(text) as string, blocks: 0, reused: 0, galleries: 0 }
    }

    const tokens = marked.lexer(text)
    const stableCount = Math.max(0, tokens.length - unstableTailBlocks)
    const nextCache = new Map<string, string>()
    const out: string[] = []
    let reused = 0
    let galleries = 0
    let run: string[] = []
    // lexer 会在相邻段落之间插入 space token。分组时它是透明的（画廊自带外边距），
    // 但若下一块不是图片段落就必须原样吐回去，否则段落间距丢失。
    let pendingSpaces: string[] = []

    const flushRun = () => {
      if (!run.length) return
      if (run.length >= 2) {
        const items = run.map(stripParagraphWrapper)
        out.push(`<div class="md-image-gallery" data-md-image-gallery>${items.join('')}</div>`)
        galleries += 1
      } else {
        out.push(run[0]!)
      }
      run = []
    }

    for (let i = 0; i < tokens.length; i += 1) {
      const token = tokens[i]!
      const key = `${token.type}\u0000${token.raw}`
      let html: string
      if (i < stableCount && cache.has(key)) {
        html = cache.get(key)!
        reused += 1
      } else {
        html = marked.parser([token])
        // 只缓存稳定块；尾部块每次都会变，缓存只会堆积无用的历史版本
        if (i < stableCount) nextCache.set(key, html)
      }

      if (token.type === 'space') {
        if (run.length) pendingSpaces.push(html)
        else out.push(html)
        continue
      }

      if (isImageOnlyParagraph(token)) {
        // 连续图片之间的空行直接丢弃
        pendingSpaces = []
        run.push(html)
      } else {
        flushRun()
        out.push(...pendingSpaces, html)
        pendingSpaces = []
      }
    }

    // 收尾：未归组的 space 也要保留，避免末尾间距丢失
    flushRun()
    out.push(...pendingSpaces)

    cache = nextCache
    return { html: out.join(''), blocks: tokens.length, reused, galleries }
  }

  return { render, reset }
}
