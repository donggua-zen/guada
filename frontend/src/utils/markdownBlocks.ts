import type { Marked, Token } from 'marked'

/**
 * 流式 Markdown 的块级渲染缓存（对齐 zcode 的 "Block memo" 思路）。
 *
 * 背景：MarkdownContent 对 content 的每次变化都会整篇 parse + 全树 diff。流式追加时
 * 正文只有尾部块在增长，稳定块（历史段落/列表/表格/代码块）的 HTML 完全不变。
 * 这里按 top-level token 缓存稳定块的渲染结果，只重渲染尾部 token：
 *
 * - 全量 `marked.lexer`（纯切块，高亮已移到 code renderer，不在 lex 阶段）；
 * - 稳定段（除末尾 `unstableTailBlocks` 块外）按 `${type}\0${raw}` 复用缓存 HTML；
 * - 尾部块每次重渲染（追加文本可能重塑最后一两块：setext、表格 delimiter、列表延续）。
 *
 * 缓存只在追加（`text.startsWith(prevText)`）时复用；编辑/重新生成等非追加变更清空重建。
 * 引用式链接的定义是全文级表（`[x][ref]` 可引用后文定义），保守起见检测到定义语法时
 * 直接退回整篇解析，避免块级缓存复用到旧解析结果。
 */
const UNSTABLE_TAIL_BLOCKS = 2
const REFERENCE_DEFINITION_RE = /^ {0,3}\[[^\]]+\]:/m

export interface BlockRenderResult {
  html: string
  /** 本次 lex 出的顶层块数量 */
  blocks: number
  /** 本次复用缓存、未重新渲染的块数量 */
  reused: number
}

export interface BlockCachedRenderer {
  render(text: string): BlockRenderResult
  reset(): void
}

function blockKey(token: Token): string {
  return `${token.type}\u0000${token.raw}`
}

export function createBlockCachedRenderer(
  marked: Marked,
  unstableTailBlocks: number = UNSTABLE_TAIL_BLOCKS,
): BlockCachedRenderer {
  let prevText = ''
  let cache = new Map<string, string>()

  function reset(): void {
    prevText = ''
    cache.clear()
  }

  function render(text: string): BlockRenderResult {
    if (!text) {
      reset()
      return { html: '', blocks: 0, reused: 0 }
    }

    // 非追加（编辑/覆盖/切换内容）→ 旧缓存不可复用
    if (!text.startsWith(prevText)) {
      cache.clear()
    }
    prevText = text

    // 引用定义会影响任意块的渲染结果，块级复用不安全 → 整篇解析
    if (REFERENCE_DEFINITION_RE.test(text)) {
      cache.clear()
      return { html: marked.parse(text) as string, blocks: 0, reused: 0 }
    }

    const tokens = marked.lexer(text)
    const stableCount = Math.max(0, tokens.length - unstableTailBlocks)
    const nextCache = new Map<string, string>()
    const parts: string[] = []
    let reused = 0

    for (let i = 0; i < tokens.length; i += 1) {
      const token = tokens[i]
      const key = blockKey(token)
      if (i < stableCount) {
        const cached = cache.get(key)
        if (cached !== undefined) {
          parts.push(cached)
          nextCache.set(key, cached)
          reused += 1
          continue
        }
      }

      const html = marked.parser([token])
      parts.push(html)
      // 只缓存稳定块；尾部块每次都会变，缓存只会堆积无用的历史版本
      if (i < stableCount) nextCache.set(key, html)
    }

    cache = nextCache
    return { html: parts.join(''), blocks: tokens.length, reused }
  }

  return { render, reset }
}
