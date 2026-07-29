// composables/useMarkdown.ts
import { Marked, type Renderer, type Tokens, type TokenizerAndRendererExtension } from "marked"
import { markedHighlight } from 'marked-highlight'
import hljs from 'highlight.js/lib/core'
import markdownCssRaw from '@/assets/markdown.css?raw'
import hljsCssRaw from 'highlight.js/styles/foundation.css?raw'

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
 * HTML 属性转义，防止 href 中含特殊字符导致注入
 */
function escapeHtmlAttribute(str: string): string {
    return str
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
}

/**
 * 全局点击事件委托：拦截 markdown 渲染的外部链接
 * 通过 data-url + 事件委托避免内联 onclick 注入风险
 * 链接打开方式由 workspacePreview 根据用户设置决定（内置浏览器 / 外部浏览器 / 每次询问）
 */
let linkClickHandlerInstalled = false
function installLinkClickHandler(): void {
    if (linkClickHandlerInstalled || typeof document === 'undefined') return
    linkClickHandlerInstalled = true
    document.addEventListener('click', (e: MouseEvent) => {
        const target = e.target as HTMLElement
        const link = target.closest('a[data-url]') as HTMLAnchorElement | null
        if (!link) return
        const url = link.dataset.url
        if (!url) return
        e.preventDefault()
        // 动态导入避免循环依赖，且不影响首屏加载
        import('@/utils/workspacePreview').then(({ openLink }) => {
            openLink(url)
        })
    })
}

/**
 * 自定义渲染器类型
 */
interface CustomRenderer extends Renderer {
    table(token: Tokens.Table): string
    code(token: Tokens.Code): string
    link(token: Tokens.Link): string
    image(token: Tokens.Image): string
}

/**
 * Markdown 解析选项
 */
export interface MarkdownOptions {
    resolveImageUrl?: (src: string) => string;
}

/**
 * 创建 Marked 实例
 */
export function createMarkedInstance(options?: MarkdownOptions): Marked {
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
                h += `<th _align="${header.align || 'left'}">${this.parser?.parseInline(header.tokens)}</th>`
            })
            h += '</tr></thead><tbody>'

            table.rows.forEach(row => {
                h += '<tr>'
                row.forEach(item => {
                    h += `<td _align="${item.align || 'left'}">${this.parser?.parseInline(item.tokens)}</td>`
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
          <div class="code-header">
                <span class="code-language">${lang}</span>
                <button class="copy-code-button"><i role="img">${coypysvg}</i></button>
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
            const isElectron = typeof window !== 'undefined' && window.electronAPI !== undefined

            if (isElectron) {
                // Electron 环境：通过 data-url + 事件委托处理，避免内联 onclick 注入风险
                return `<a href="#" data-url="${escapeHtmlAttribute(href)}"${title}>${text}</a>`
            } else {
                // Web 环境：使用 target="_blank" 和 rel 属性
                return `<a href="${href}"${title} target="_blank" rel="noopener noreferrer">${text}</a>`
            }
        },
        image(token: Tokens.Image): string {
            const href = token.href
            const text = token.text || ''
            const title = token.title ? ` title="${token.title}"` : ''

            let resolvedUrl = href

            // 如果有自定义图片路径解析函数，使用它
            if (options?.resolveImageUrl) {
                resolvedUrl = options.resolveImageUrl(href)
            }

            return `<img src="${resolvedUrl}" alt="${text}"${title} style="max-width: 100%;" />`
        }
    }

    // 配置 marked 选项
    marked.use({
        breaks: true,
        gfm: true,
        async: false
    })

    // 禁用 autolink - 通过覆盖 tokenizer
    marked.use({
        tokenizer: {
            url(src: string) {
                // 返回 undefined 以禁用 URL 自动链接
                return undefined
            }
        }
    })

    // 设置自定义渲染器
    marked.use({ renderer })

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
export function useMarkdown(options?: MarkdownOptions): UseMarkdownReturn {
    if (!markedInstance) {
        markedInstance = createMarkedInstance(options)
    }
    installLinkClickHandler()

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

/**
 * 构建用于 iframe srcdoc 的完整 HTML 文档
 * 通过 <base> 标签让浏览器原生解析所有相对路径（markdown 语法 + 内嵌 HTML <img>）
 *
 * @param html 已由 marked.parse() 渲染的 HTML 内容
 * @param baseUrl <base href> 值，指向工作目录对应的资源端点
 * @param isDark 是否暗色模式
 */
export function buildMarkdownSrcDoc(html: string, baseUrl: string, isDark: boolean): string {
    const themeVars = isDark
        ? `--color-text:#d3d3d3;--color-bg:#222;--color-surface:#222;--color-border:oklch(32% 0.02 250);--color-bubble-assitant-text-strong:#d3d3d3;--color-sidebar-bg-active:#2f3131;--size-text-base:15px;`
        : `--color-text:#171717;--color-bg:#fff;--color-surface:#f5f5f5;--color-border:#d1d5db;--color-bubble-assitant-text-strong:#17181a;--color-sidebar-bg-active:rgba(40,5,5,0.05);--size-text-base:15px;`

    return `<!DOCTYPE html><html class="${isDark ? 'dark' : ''}"><head>
<meta charset="utf-8">
<base href="${baseUrl}">
<style>${markdownCssRaw}</style>
<style>${hljsCssRaw}</style>
<style>:root{${themeVars}}html,body{margin:0;padding:0;font-size:15px;background:var(--color-bg);color:var(--color-text);}.markdown-text{max-width:768px;margin:0 auto;}</style>
</head><body class="markdown-text" style="padding:16px;overflow-x:hidden;">
${html}
<script>
(function(){
  // 代码块复制
  document.addEventListener('click', function(e){
    var btn = e.target.closest('.copy-code-button');
    if(!btn) return;
    var block = btn.closest('.custom-code-block');
    var code = block && block.querySelector('code');
    if(code && navigator.clipboard){
      navigator.clipboard.writeText(code.textContent || '').catch(function(){});
    }
  });
  // 链接点击 → postMessage 通知父页面
  document.addEventListener('click', function(e){
    var link = e.target.closest('a[data-url]') || e.target.closest('a[href]');
    if(!link) return;
    e.preventDefault();
    var url = link.dataset.url || link.getAttribute('href');
    if(url && url !== '#'){
      parent.postMessage({ type: 'md-preview-link', url: url }, '*');
    }
  });
})();
<\/script>
</body></html>`
}

/**
 * 预览专用 Markdown 解析 Composable
 * 每次调用创建独立的 Marked 实例
 * 用于 WorkspaceSidebar 文件预览场景（配合 buildMarkdownSrcDoc + <base> 标签）
 */
export function usePreviewMarkdown(): UseMarkdownReturn {
    const instance = createMarkedInstance()
    installLinkClickHandler()

    const parseMarkdown = (content: string): string => {
        if (!content?.trim()) return ""

        try {
            const result = instance.parse(content.trim())
            return typeof result === 'string' ? result : content
        } catch (error) {
            console.error("Markdown 解析错误:", error)
            return content
        }
    }

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
        marked: instance
    }
}
