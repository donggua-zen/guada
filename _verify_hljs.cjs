// 验证 GitChangesPanel highlightLine 的单行高亮行为（模拟前端 useHighlight 逻辑）
const hljs = require("D:/AI/ai_chat/frontend/node_modules/highlight.js/lib/core");
const ts = require("D:/AI/ai_chat/frontend/node_modules/highlight.js/lib/languages/typescript");
const js = require("D:/AI/ai_chat/frontend/node_modules/highlight.js/lib/languages/javascript");
const json = require("D:/AI/ai_chat/frontend/node_modules/highlight.js/lib/languages/json");
hljs.registerLanguage("typescript", ts);
hljs.registerLanguage("javascript", js);
hljs.registerLanguage("json", json);

function highlightLine(line, lang) {
  if (!line) return "&nbsp;";
  try {
    const r = hljs.highlight(line, { language: lang });
    // 前端 highlightCode 返回 <div class="line-content">${line}</div>，这里直接看 token 输出
    return r.value;
  } catch (e) {
    return line;
  }
}

const cases = [
  ["import { ref, computed } from \"vue\";", "typescript"],
  ["const x: number = 42;", "typescript"],
  ["  name: \"test\",", "typescript"],
  ["    \"key\": \"value\",", "json"],
  ["// comment line", "typescript"],
  ["function foo(a: string): void {", "typescript"],
  ["  return a.toUpperCase();", "typescript"],
  ["}", "typescript"],
  ["let s = `template", "typescript"], // 多行模板字符串：第一行
  ["some text inside", "typescript"], // 多行模板字符串：中间行（单行高亮丢上下文）
  ["`;", "typescript"], // 多行模板字符串：结束行
  ["/* block comment", "typescript"], // 块注释开始
  ["middle of comment", "typescript"], // 块注释中间
  ["*/", "typescript"], // 块注释结束
  ["<div>", "html"], // 未注册语言
];

for (const [line, lang] of cases) {
  const out = highlightLine(line, lang);
  const hasToken = /hljs-[a-z-]+/.test(out);
  console.log(`${hasToken ? "TOKEN " : "PLAIN "} [${lang}] ${JSON.stringify(line)} -> ${out.slice(0, 100)}`);
}
