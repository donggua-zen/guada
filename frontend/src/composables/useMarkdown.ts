// composables/useMarkdown.ts
import { Marked, type Renderer, type Tokens, type TokenizerAndRendererExtension } from "marked"
import { markedHighlight } from 'marked-highlight'
import hljs from 'highlight.js/lib/core'

// 导入语言包
import javascript from 'highlight.js/lib/languages/javascript'
import typescript from 'highlight.js/lib/languages/typescript'
import python from 'highlight.js/lib/languages/python'
import java from 'highlight.js/lib/languages/java'
import cpp from 'highlight.js/lib/languages/cpp'
import c from 'highlight.js/lib/languages/c'
import csharp from 'highlight.js/lib/languages/csharp'
import php from 'highlight.js/lib/languages/php'
import ruby from 'highlight.js/lib/languages/ruby'
import go from 'highlight.js/lib/languages/go'
import rust from 'highlight.js/lib/languages/rust'
import sql from 'highlight.js/lib/languages/sql'
import html from 'highlight.js/lib/languages/xml'
import css from 'highlight.js/lib/languages/css'
import scss from 'highlight.js/lib/languages/scss'
import json from 'highlight.js/lib/languages/json'
import yaml from 'highlight.js/lib/languages/yaml'
import bash from 'highlight.js/lib/languages/bash'
import shell from 'highlight.js/lib/languages/shell'
import markdown from 'highlight.js/lib/languages/markdown'
import dockerfile from 'highlight.js/lib/languages/dockerfile'
import nginx from 'highlight.js/lib/languages/nginx'
import powershell from 'highlight.js/lib/languages/powershell'
import ini from 'highlight.js/lib/languages/ini'
import apache from 'highlight.js/lib/languages/apache'
import makefile from 'highlight.js/lib/languages/makefile'
import perl from 'highlight.js/lib/languages/perl'
import r from 'highlight.js/lib/languages/r'
import swift from 'highlight.js/lib/languages/swift'
import kotlin from 'highlight.js/lib/languages/kotlin'
import scala from 'highlight.js/lib/languages/scala'
import vbnet from 'highlight.js/lib/languages/vbnet'
import lua from 'highlight.js/lib/languages/lua'
import lisp from 'highlight.js/lib/languages/lisp'
import dart from 'highlight.js/lib/languages/dart'
import plaintext from 'highlight.js/lib/languages/plaintext'

// 注册语言
hljs.registerLanguage('javascript', javascript)
hljs.registerLanguage('typescript', typescript)
hljs.registerLanguage('python', python)
hljs.registerLanguage('java', java)
hljs.registerLanguage('cpp', cpp)
hljs.registerLanguage('c', c)
hljs.registerLanguage('csharp', csharp)
hljs.registerLanguage('php', php)
hljs.registerLanguage('ruby', ruby)
hljs.registerLanguage('go', go)
hljs.registerLanguage('rust', rust)
hljs.registerLanguage('sql', sql)
hljs.registerLanguage('html', html)
hljs.registerLanguage('vue', html)
hljs.registerLanguage('css', css)
hljs.registerLanguage('scss', scss)
hljs.registerLanguage('json', json)
hljs.registerLanguage('yaml', yaml)
hljs.registerLanguage('bash', bash)
hljs.registerLanguage('shell', shell)
hljs.registerLanguage('markdown', markdown)
hljs.registerLanguage('dockerfile', dockerfile)
hljs.registerLanguage('nginx', nginx)
hljs.registerLanguage('powershell', powershell)
hljs.registerLanguage('ini', ini)
hljs.registerLanguage('apache', apache)
hljs.registerLanguage('makefile', makefile)
hljs.registerLanguage('perl', perl)
hljs.registerLanguage('r', r)
hljs.registerLanguage('swift', swift)
hljs.registerLanguage('kotlin', kotlin)
hljs.registerLanguage('scala', scala)
hljs.registerLanguage('vbnet', vbnet)
hljs.registerLanguage('lua', lua)
hljs.registerLanguage('lisp', lisp)
hljs.registerLanguage('dart', dart)
hljs.registerLanguage('plaintext', plaintext)

// 单例实例
let markedInstance: Marked | null = null

/**
 * 自定义渲染器类型
 */
interface CustomRenderer extends Renderer {
    table(token: Tokens.Table): string
    code(token: Tokens.Code): string
    link(token: Tokens.Link): string
}

/**
 * 创建 Marked 实例
 */
function createMarkedInstance(): Marked {
    const coypysvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24">
  <path fill="currentColor" d="M8 7h11v14H8z" opacity=".3"/>
  <path fill="currentColor" d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/>
</svg>`

    const marked = new Marked(
        markedHighlight({
            emptyLangClass: 'hljs',
            langPrefix: 'hljs language-',
            highlight(code: string, lang: string): string {
                const language = hljs.getLanguage(lang) ? lang : 'plaintext'
                return hljs.highlight(code, { language }).value
            }
        })
    )

    const renderer: Partial<CustomRenderer> = {
        table(table: Tokens.Table): string {
            let h = '<thead><tr>'
            table.header.forEach(header => {
                h += `<th align="${header.align || 'left'}">${this.parser?.parseInline(header.tokens)}</th>`
            })
            h += '</tr></thead><tbody>'

            table.rows.forEach(row => {
                h += '<tr>'
                row.forEach(item => {
                    h += `<td align="${item.align || 'left'}">${this.parser?.parseInline(item.tokens)}</td>`
                })
                h += '</tr>'
            })

            h += '</tbody>'
            return `<div class="custom-table-block"><table>${h}</table></div>`
        },
        code(code: Tokens.Code): string {
            const lang = code.lang || 'text'
            return `
        <div class="custom-code-block">
          <div style="position: sticky; top: 0;background-color: var(--color-bubble-assitant-bg)">
            <div class="code-header">
                <span class="code-language">${lang}</span>
                <button class="copy-code-button"><i role="img">${coypysvg}</i></button>
            </div>
          </div>
          <pre class="hljs language-${lang}"><code class="hljs language-${lang}">${code.text}</code></pre>
        </div>
      `
        },
        link(token: Tokens.Link): string {
            const href = token.href
            const title = token.title ? ` title="${token.title}"` : ''
            const text = this.parser?.parseInline(token.tokens) || token.text
            
            // 检测是否为 Electron 环境
            const isElectron = typeof window !== 'undefined' && (window as any).electronAPI !== undefined
            
            if (isElectron) {
                // Electron 环境：添加 data-url 属性和点击事件处理
                return `<a href="#" data-url="${href}"${title} onclick="event.preventDefault(); window.electronAPI.openExternal('${href}'); return false;">${text}</a>`
            } else {
                // Web 环境：使用 target="_blank" 和 rel 属性
                return `<a href="${href}"${title} target="_blank" rel="noopener noreferrer">${text}</a>`
            }
        }
    }

    marked.use({ renderer, breaks: true })

    return marked
}

/**
 * Markdown 解析缓存
 */
interface MarkdownCache extends Map<string, string> { }

/**
 * useMarkdown 返回值类型
 */
export interface UseMarkdownReturn {
    parseMarkdown: (content: string) => string
    marked: Marked
}

/**
 * Markdown 解析 Composable
 */
export function useMarkdown(): UseMarkdownReturn {
    if (!markedInstance) {
        markedInstance = createMarkedInstance()
    }

    const parseMarkdown = (content: string): string => {
        if (!content?.trim()) return ""

        try {
            const result = markedInstance!.parse(content.trim())
            // parse 可能返回 Promise（异步模式），但我们使用同步模式
            return typeof result === 'string' ? result : content
        } catch (error) {
            console.error("Markdown 解析错误:", error)
            return content
        }
    }

    // 带缓存的解析（优化性能）
    const cache: MarkdownCache = new Map()
    const parseWithCache = (content: string): string => {
        if (!content) return ""

        const cacheKey = content.length < 1000
            ? content
            : content.substring(0, 1000) + content.length.toString()

        if (cache.has(cacheKey)) {
            return cache.get(cacheKey)!
        }

        const result = parseMarkdown(content)

        // 限制缓存大小
        if (cache.size > 50) {
            const firstKey = cache.keys().next().value
            if (firstKey) {
                cache.delete(firstKey)
            }
        }

        cache.set(cacheKey, result)
        return result
    }

    return {
        parseMarkdown: parseWithCache,
        marked: markedInstance
    }
}

export default useMarkdown
