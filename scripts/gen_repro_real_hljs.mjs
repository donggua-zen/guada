// 用项目真实的 highlight.js 复现 highlightLine 的产物，生成一个忠实复现页
import hljs from "highlight.js/lib/core";
import typescript from "highlight.js/lib/languages/typescript";
import javascript from "highlight.js/lib/languages/javascript";
import plaintext from "highlight.js/lib/languages/plaintext";

hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("plaintext", plaintext);

function escapeHtml(text) {
  const map = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" };
  return text.replace(/[&<>"']/g, (m) => map[m]);
}

function highlightCode(code, language) {
  if (!code) return "";
  const lang = hljs.getLanguage(language) ? language : "plaintext";
  const result = hljs.highlight(code, { language: lang });
  const lines = result.value.split("\n");
  const digitCount = String(lines.length).length;
  const lineNumWidth = `${Math.max(digitCount, 2)}ch`;
  const codeLines = lines
    .map((line, i) => {
      const num = i + 1;
      return `<div class="line"><span class="line-num" style="min-width:${lineNumWidth}">${num}</span><div class="line-content">${line || " "}</div></div>`;
    })
    .join("\n");
  return `<pre><code class="hljs language-${lang}"><div class="code-lines">${codeLines}</div></code></pre>`;
}

function highlightLine(line, lang) {
  if (!line) return "&nbsp;";
  try {
    const highlighted = highlightCode(line, lang);
    const match = highlighted.match(/<div class="line-content">(.*?)<\/div>/s);
    if (match) return match[1];
    return escapeHtml(line);
  } catch {
    return escapeHtml(line);
  }
}

// 模拟一段真实 diff（typescript 文件）：含长行、短行、空行、纯注释
const sampleLines = [
  "+import { useStorage } from \"@vueuse/core\";",
  "+const { t } = useI18n();",
  "+const rowMetrics = computed<{ tops: number[]; total: number }>(() => {",
  "+  // 注释行：不参与高亮的块注释内容说明，这里是一段比较长的注释文字用来模拟真实代码，aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "+  const lines = displaySplitLines.value;",
  "+  const tops: number[] = [];",
  "+  let total = 0;",
  "+  for (const l of lines) {",
  "+    tops.push(total);",
  "+    total += l.type === \"gap\" || l.type === \"gap-close\" ? GAP_ROW_H : ROW_H;",
  "+  }",
  "+  return { tops, total };",
  "+});",
  "",
  "+export function veryLongFunctionNameWithLotsOfArguments(arg1: string, arg2: number, arg3: boolean, arg4: Record<string, unknown>, arg5: (x: number) => void): Promise<GitDiff> {",
  "+  return await apiService.getGitDiff(sessionId, path, staged);",
  "+}",
];

const htmls = sampleLines.map((l, i) => {
  const h = highlightLine(l, "typescript");
  return `<div class="git-diff-line git-diff-add" style="top:${i * 20}px"><span class="git-diff-line-num">${i + 1}</span><span class="git-diff-content">${h}</span></div>`;
});

// 宽度锚层：真实 v-html="line.html || line.oldHtml || line.newHtml || '&nbsp;'"
const anchorSpans = sampleLines
  .map((l) => `<span class="git-diff-size-line">${highlightLine(l, "typescript")}</span>`)
  .join("\n");

import fs from "node:fs";
const page = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
body { margin: 8px; font-family: "SF Mono", Consolas, monospace; font-size: 12px; }
:root { --color-bg: #ffffff; }
.col { width: 860px; height: 300px; overflow-x: scroll; overflow-y: hidden; border: 1px solid #ccc; background: var(--color-bg); }
.inner { position: relative; width: max-content; min-width: 100%; will-change: transform; }
.size { position: relative; visibility: hidden; height: 0; overflow: hidden; width: max-content; pointer-events: none; }
.size-line { display: block; width: max-content; white-space: pre; }
.row { position: absolute; left: 0; width: max-content; min-width: 100%; }
.line { display: flex; align-items: stretch; height: 20px; }
.num { flex: 0 0 48px; width: 48px; padding: 0 12px 0 4px; text-align: right; position: sticky; left: 0; background-color: var(--color-bg); border-right: 2px solid var(--color-bg); }
.content { white-space: pre; flex: 1; min-width: max-content; padding: 0 12px 0 8px; }
.add { background: #e6ffec; }
.add .content { background: #e6ffec; }
</style>
</head>
<body>
<h3>忠实复现：真实 hljs 高亮 html + 精确 CSS（模拟 split 视图单列）</h3>
<div class="col" id="col">
  <div class="inner">
    <div class="size">${anchorSpans}</div>
    ${htmls.join("\n")}
  </div>
</div>
<pre id="out"></pre>
<script>
const col = document.getElementById('col');
const inner = col.querySelector('.inner');
const size = col.querySelector('.size');
const rows = col.querySelectorAll('.row');
const w = (el) => Math.round(el.getBoundingClientRect().width);
let out = 'col.clientWidth=' + col.clientWidth + ' col.scrollWidth=' + col.scrollWidth + '\\n';
out += 'size.width=' + w(size) + ' inner.width=' + w(inner) + '\\n';
rows.forEach((r, i) => out += 'row' + i + '.width=' + w(r) + ' contentTextLen=' + r.querySelector('.content').textContent.length + '\\n');
document.getElementById('out').textContent = out;
</script>
</body>
</html>`;

fs.writeFileSync("repro_real_hljs.html", page);
console.log("written repro_real_hljs.html");
// 打印每个 line 的 html 长度与 text 长度，检查是否有异常
for (let i = 0; i < sampleLines.length; i++) {
  const h = highlightLine(sampleLines[i], "typescript");
  console.log(`line ${i}: html.length=${h.length} containsDiv=${h.includes("</div>")} containsBr=${h.includes("<br")} textLen=${sampleLines[i].length}`);
}
