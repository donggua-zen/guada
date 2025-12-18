// composables/useMarkdown.js
import { Marked } from "marked";
import { markedHighlight } from 'marked-highlight';
import hljs from 'highlight.js';
import { ref, shallowRef } from 'vue';

// 单例实例
let markedInstance = null;

function parseTokens(tokens) {

}

function createMarkedInstance() {
    const coypysvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24">
  <path fill="currentColor" d="M8 7h11v14H8z" opacity=".3"/>
  <path fill="currentColor" d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/>
</svg>`
    const marked = new Marked(
        markedHighlight({
            emptyLangClass: 'hljs',
            langPrefix: 'hljs language-',
            highlight(code, lang, info) {
                const language = hljs.getLanguage(lang) ? lang : 'plaintext';
                return hljs.highlight(code, { language }).value;
            }
        })
    );

    const renderer = {
        table(table) {
            let h = '<thead><tr>';
            table.header.forEach(header => {
                h += `<th align="${header.align || 'left'}">${this.parser.parseInline(header.tokens)}</th>`;
            });
            h += '</tr></thead><tbody>';

            table.rows.forEach(row => {
                h += '<tr>';
                row.forEach(item => {
                    h += `<td align="${item.align || 'left'}">${this.parser.parseInline(item.tokens)}</td>`;
                });
                h += '</tr>';
            });

            h += '</tbody>';
            return `<div class="custom-table-block"><table>${h}</table></div>`;
        },
        code(code) {
            const lang = code.lang || 'text';
            return `
        <div class="custom-code-block">
          <div class="code-header">
            <span class="code-language">${lang}</span>
            <button class="copy-code-button"><i role="img">${coypysvg}</i></button>
          </div>
          <pre class="hljs language-${lang}"><code class="hljs language-${lang}">${code.text}</code></pre>
        </div>
      `;
        }
    };

    marked.use({ renderer, breaks: true });
    // marked.use({
    //     extensions: [{
    //         name: 'table',
    //         renderer(token) {
    //             return renderer.table(token);
    //         }
    //     }]
    // })
    return marked;
}

export function useMarkdown() {
    if (!markedInstance) {
        markedInstance = createMarkedInstance();
    }

    const parseMarkdown = (content) => {
        if (!content?.trim()) return "";

        try {
            return markedInstance.parse(content.trim());
        } catch (error) {
            console.error("Markdown解析错误:", error);
            return content;
        }
    };

    // 带缓存的解析（优化性能）
    const cache = new Map();
    const parseWithCache = (content) => {
        if (!content) return "";

        const cacheKey = content.length < 1000 ? content : content.substring(0, 1000) + content.length;

        if (cache.has(cacheKey)) {
            return cache.get(cacheKey);
        }

        const result = parseMarkdown(content);

        // 限制缓存大小
        if (cache.size > 50) {
            const firstKey = cache.keys().next().value;
            cache.delete(firstKey);
        }

        cache.set(cacheKey, result);
        return result;
    };

    return {
        parseMarkdown: parseWithCache,
        marked: markedInstance
    };
}