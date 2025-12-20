// composables/useMarkdown.js
import { Marked } from "marked";
import { markedHighlight } from 'marked-highlight';
// import hljs from 'highlight.js';
import hljs from 'highlight.js/lib/core'; // 只导入核心

import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import python from 'highlight.js/lib/languages/python';
import java from 'highlight.js/lib/languages/java';
import cpp from 'highlight.js/lib/languages/cpp';
import c from 'highlight.js/lib/languages/c';
import csharp from 'highlight.js/lib/languages/csharp';
import php from 'highlight.js/lib/languages/php';
import ruby from 'highlight.js/lib/languages/ruby';
import go from 'highlight.js/lib/languages/go';
import rust from 'highlight.js/lib/languages/rust';
import sql from 'highlight.js/lib/languages/sql';
import html from 'highlight.js/lib/languages/xml';
import xml from 'highlight.js/lib/languages/css';
import css from 'highlight.js/lib/languages/css';
import scss from 'highlight.js/lib/languages/scss';
import json from 'highlight.js/lib/languages/json';
import yaml from 'highlight.js/lib/languages/yaml';
import bash from 'highlight.js/lib/languages/bash';
import shell from 'highlight.js/lib/languages/shell';
import markdown from 'highlight.js/lib/languages/markdown';
import dockerfile from 'highlight.js/lib/languages/dockerfile';
import nginx from 'highlight.js/lib/languages/nginx';
import powershell from 'highlight.js/lib/languages/powershell';
import ini from 'highlight.js/lib/languages/ini';
import apache from 'highlight.js/lib/languages/apache';
import makefile from 'highlight.js/lib/languages/makefile';
import perl from 'highlight.js/lib/languages/perl';
import r from 'highlight.js/lib/languages/r';
import swift from 'highlight.js/lib/languages/swift';
import kotlin from 'highlight.js/lib/languages/kotlin';
import scala from 'highlight.js/lib/languages/scala';
import vbnet from 'highlight.js/lib/languages/vbnet';
import lua from 'highlight.js/lib/languages/lua';
import lisp from 'highlight.js/lib/languages/lisp';
import dart from 'highlight.js/lib/languages/dart';
import plaintext from 'highlight.js/lib/languages/plaintext';


hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('python', python);
hljs.registerLanguage('java', java);
hljs.registerLanguage('cpp', cpp);
hljs.registerLanguage('c', c);
hljs.registerLanguage('csharp', csharp);
hljs.registerLanguage('php', php);
hljs.registerLanguage('ruby', ruby);
hljs.registerLanguage('go', go);
hljs.registerLanguage('rust', rust);
hljs.registerLanguage('sql', sql);
hljs.registerLanguage('html', html);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('css', css);
hljs.registerLanguage('scss', scss);
hljs.registerLanguage('json', json);
hljs.registerLanguage('yaml', yaml);
hljs.registerLanguage('bash', bash);
hljs.registerLanguage('shell', shell);
hljs.registerLanguage('markdown', markdown);
hljs.registerLanguage('dockerfile', dockerfile);
hljs.registerLanguage('nginx', nginx);
hljs.registerLanguage('powershell', powershell);
hljs.registerLanguage('ini', ini);
hljs.registerLanguage('apache', apache);
hljs.registerLanguage('makefile', makefile);
hljs.registerLanguage('perl', perl);
hljs.registerLanguage('r', r);
hljs.registerLanguage('swift', swift);
hljs.registerLanguage('kotlin', kotlin);
hljs.registerLanguage('scala', scala);
hljs.registerLanguage('vbnet', vbnet);
hljs.registerLanguage('lua', lua);
hljs.registerLanguage('lisp', lisp);
hljs.registerLanguage('dart', dart);
hljs.registerLanguage('plaintext', plaintext);


// 单例实例
let markedInstance = null;
// const loadedLanguages = new Set(['plaintext']);


// // 异步加载语言
// async function loadLanguage(lang) {
//     if (loadedLanguages.has(lang)) {
//         return true;
//     }

//     const langModule = languageModules[lang];
//     if (!langModule) {
//         return false;
//     }

//     try {
//         const module = await langModule();
//         hljs.registerLanguage(lang, module.default);
//         loadedLanguages.add(lang);
//         return true;
//     } catch (error) {
//         console.warn(`Failed to load language: ${lang}`, error);
//         return false;
//     }
// }

function createMarkedInstance() {
    const coypysvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24">
  <path fill="currentColor" d="M8 7h11v14H8z" opacity=".3"/>
  <path fill="currentColor" d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/>
</svg>`
    const marked = new Marked(
        markedHighlight({
            // async: true,
            emptyLangClass: 'hljs',
            langPrefix: 'hljs language-',
            highlight(code, lang, info) {
                const language = hljs.getLanguage(lang) ? lang : 'plaintext';
                return hljs.highlight(code, { language }).value;
            },
            // highlight(code, lang, info) {
            //     return new Promise(async (resolve, reject) => {
            //         try {
            //             const normalizedLang = (lang || 'text').toLowerCase();

            //             // 检查语言是否已加载，如果没有则动态加载
            //             if (!loadedLanguages.has(normalizedLang) && languageModules[normalizedLang]) {
            //                 await loadLanguage(normalizedLang);
            //             }

            //             // 确定要使用的语言
            //             const language = hljs.getLanguage(normalizedLang) ? normalizedLang : 'plaintext';

            //             try {
            //                 const result = hljs.highlight(code, { language });
            //                 resolve(result.value);
            //             } catch (highlightError) {
            //                 // 如果高亮失败，回退到纯文本
            //                 const fallbackResult = hljs.highlight(code, { language: 'plaintext' });
            //                 resolve(fallbackResult.value);
            //             }
            //         } catch (error) {
            //             console.error('Highlight error:', error);
            //             // 最终回退：直接返回转义后的代码
            //             resolve(hljs.highlight(code, { language: 'plaintext' }).value);
            //         }
            //     });
            // }
        }),
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