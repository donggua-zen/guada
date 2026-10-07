#!/usr/bin/env node
/**
 * 亚像素静态检查（棘轮：默认扫全 src，当前全绿）
 *
 * 背景：小数几何会让文字/边框落在设备像素之间（发虚，缩放后更明显），
 * 奇数尺寸的居中余量更是半像素（元素随容器奇偶跳一个设备像素）。
 * 运行时自检见 src/utils/devSubpixelAudit.ts，但它有两个盲区：
 *   1) 只看元素 rect —— **边框宽度的小数**（1.5px / 0.5px）它看不见；
 *   2) 只反映当前渲染到的那一屏。
 * 所以补一个纯源码扫描，两者互补、都不进生产包。
 *
 * 规则：
 *   R1 行高：同一规则块内 font-size 与 line-height 都是字面量时，乘积必须为整数；
 *          任一侧是 var()/calc() 时，无单位小数行高（除 1 / 2）需要人工确认
 *   R2 分数 px 字面量（含边框宽度，如 6.0085px / 1.5px）
 *   R3 奇数图标尺寸（el-icon 的 size="13" / :size="15" 等；约定取偶数）
 *   R4 Tailwind 奇数盒（w-3.75 / h-4.25 这类 .25/.75 刻度 = 4n±1 px，必为奇数）
 *
 * 已知盲区（靠运行时自检补）：
 *   - 只认 CSS 声明里的 font-size；Tailwind 类（text-[15px] / text-sm）看不到
 *   - calc() 里的小数乘除（* 0.85 / 2.33）静态求不出来，需人工算
 *
 * 豁免：行内、或上方两行内写 `/* subpixel-ok: 原因 *\/` 即跳过（原因必须写清楚）。
 *
 * 用法：node scripts/check-subpixel.mjs [路径...]     默认扫 src/
 */
import { readFileSync, statSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url)); // frontend/

/** 默认扫描范围：整个前端源码（当前全绿，用作棘轮） */
const SCOPED = ["src"];

const SKIP_DIRS = new Set(["node_modules", "dist", ".git"]);

/** 无单位行高白名单：1（贴字号）与 2 在任何字号下都是整数 */
const SAFE_UNITLESS_LINE_HEIGHTS = new Set(["1", "2"]);

const RULES = {
  R1: "行高与字号乘积不是整数（小数行高会让每行基线落在设备像素之间）",
  R2: "分数 px 字面量（含边框宽度：半像素边框在 1x 下必然发虚）",
  R3: "奇数图标尺寸（居中余量会成半像素 → 元素跳一个设备像素）",
  R4: "Tailwind .25/.75 刻度 = 4n±1 px，必为奇数盒",
};

async function collect(targets) {
  const files = [];
  const walk = async (p) => {
    let st;
    try {
      st = statSync(p);
    } catch {
      return;
    }
    if (st.isDirectory()) {
      const entries = await readdir(p, { withFileTypes: true });
      for (const e of entries) {
        if (e.isDirectory() && SKIP_DIRS.has(e.name)) continue;
        await walk(join(p, e.name));
      }
      return;
    }
    if (/\.(vue|css)$/.test(p)) files.push(p);
  };
  for (const t of targets) await walk(t);
  return files.sort();
}

/**
 * 注释屏蔽：把 /* … *\/ 与 <!-- … --> 的内容换成空格（保留换行与列位置）。
 * 必须做——本次修复的解释性注释里全是"原 22.4px 是小数"这类字样，
 * 不屏蔽的话规则会被自己的说明触发一大片（实测 40+ 误报）。
 */
function maskComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, " "));
}

/** 逐行判定的规则：行内无法静态求值时给出"需人工确认"而不是误报
 *  豁免：本行、或上方两行内出现 subpixel-ok（多行 CSS 值一行豁免不够用） */
function checkLine(file, lineNo, masked, original, originalLines) {
  const out = [];
  const marked = [original, originalLines[lineNo - 2] ?? "", originalLines[lineNo - 3] ?? ""]
    .some((l) => l.includes("subpixel-ok"));
  if (marked) return out;
  const line = masked.trim();
  if (!line || line.startsWith("//") || line.startsWith("*")) return out;
  const push = (rule, detail) => out.push({ file, line: lineNo, rule, detail, text: original.trim().slice(0, 90) });

  // R2：分数 px 字面量（0.5px 之类也要报——半像素边框不是"更细的 1px"）
  const fracPx = line.match(/(?<![\d.])(\d+\.\d+)px/g);
  if (fracPx) push("R2", fracPx.join(" "));

  // R3：奇数 size（el-icon 尺寸约定取偶数）。
  // 边界必须收紧：`:max-size="85"` / `:min-pane2-size="320"` 也含 size="NN"，
  // 前面是 `-` 或 `:`（作为前缀的 :size 已由 (?::)? 覆盖）时不算图标尺寸。
  const iconSize = line.match(/(?<![\w:-]):?size="(\d+)"/g);
  if (iconSize) {
    for (const m of iconSize) {
      const n = Number(m.match(/\d+/)[0]);
      if (n % 2 === 1) push("R3", `${m} 是奇数`);
    }
  }

  // R4：Tailwind .25/.75 刻度
  const oddBox = line.match(/\b[wh]-(\d+\.(?:25|75))\b/g);
  if (oddBox) push("R4", oddBox.join(" "));

  return out;
}

/** CSS 规则块级判定：font-size × line-height 都是字面量时直接算乘积 */
function checkBlocks(file, masked, originalLines) {
  const out = [];
  const lineOf = (idx) => masked.slice(0, idx).split(/\r?\n/).length;

  const blockRe = /\{([^{}]*)\}/g; // 只取最内层块（@media 外层不匹配）
  let m;
  while ((m = blockRe.exec(masked))) {
    const body = m[1];
    const startLine = lineOf(m.index);
    const endLine = lineOf(m.index + m[0].length);
    const blockLines = originalLines.slice(startLine - 1, endLine);
    if (blockLines.some((l) => l.includes("subpixel-ok"))) continue;

    const fs = body.match(/font-size:\s*([\d.]+)px/);
    const lh = body.match(/line-height:\s*([^;]+);?/);
    if (!fs || !lh) continue;

    const lhRaw = lh[1].trim();
    const fsPx = Number(fs[1]);
    const lhLine = lineOf(m.index + body.indexOf(lh[1]));
    const text = (originalLines[lhLine - 1] || "").trim();

    if (/^[\d.]+$/.test(lhRaw)) {
      // 字面量行高：按乘积判定（1.5 × 12 = 18 ✓；1.5 × 13 = 19.5 ✗）
      const product = fsPx * Number(lhRaw);
      if (Math.abs(product - Math.round(product)) > 1e-6 && !SAFE_UNITLESS_LINE_HEIGHTS.has(lhRaw)) {
        out.push({
          file, line: lhLine, rule: "R1",
          detail: `${fsPx}px × ${lhRaw} = ${product}px 小数行盒`,
          text: text.slice(0, 90),
        });
      }
      continue;
    }
    if (/^[\d.]+px$/.test(lhRaw)) continue; // 已经是 px：分数由 R2 管，整数没问题
    // var()/calc()/inherit：静态算不出来。无单位小数行高（除 1/2）提示人工确认
    const risky = lhRaw.match(/^\d+\.\d+$/);
    if (risky && !SAFE_UNITLESS_LINE_HEIGHTS.has(lhRaw)) {
      out.push({
        file, line: lhLine, rule: "R1*",
        detail: `line-height: ${lhRaw} 无法静态求值（字号 ${fsPx}px）→ 请确认乘积为整数`,
        text: text.slice(0, 90),
      });
    }
  }
  return out;
}

const targets = process.argv.slice(2).length
  ? process.argv.slice(2)
  : SCOPED.map((p) => join(ROOT, p));

const files = await collect(targets);
const findings = [];
for (const f of files) {
  const src = readFileSync(f, "utf8");
  const rel = relative(ROOT, f).split(sep).join("/");
  const srcLines = src.split(/\r?\n/);
  const masked = maskComments(src);
  const maskedLines = masked.split(/\r?\n/);
  srcLines.forEach((l, i) => findings.push(...checkLine(rel, i + 1, maskedLines[i] ?? "", l, srcLines)));
  findings.push(...checkBlocks(rel, masked, srcLines));
}

findings.sort((a, b) => (a.file === b.file ? a.line - b.line : a.file < b.file ? -1 : 1));

if (!findings.length) {
  console.log(`[subpixel] 通过：${files.length} 个文件无小数/奇数几何`);
  process.exit(0);
}

const byRule = {};
for (const f of findings) byRule[f.rule] = (byRule[f.rule] || 0) + 1;
console.log(`[subpixel] ${findings.length} 处待处理（${files.length} 个文件）：`);
let lastFile = "";
for (const f of findings) {
  if (f.file !== lastFile) {
    console.log(`\n  ${f.file}`);
    lastFile = f.file;
  }
  console.log(`    ${f.line}  [${f.rule}] ${f.detail}`);
  console.log(`        ${f.text}`);
}
console.log("\n规则说明：");
for (const [k, v] of Object.entries(RULES)) {
  const bare = k.replace("*", "");
  const note = k.endsWith("*") ? "（提示级，需人工确认；不计入退出码）" : "";
  if (byRule[k]) console.log(`  ${k} ×${byRule[k]}  ${v}${note}`);
}
const errors = findings.filter((f) => !f.rule.endsWith("*")).length;
if (errors) {
  console.log(`\n确认是几何问题就用整数；确属有意为之就在行内写 /* subpixel-ok: 原因 *\/ 豁免。`);
  process.exit(1);
}
console.log("\n仅有提示级项。");
