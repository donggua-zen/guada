/**
 * 主进程 → 桌宠 的状态透传链路测试。
 *
 * 回归点：`tray:update-stats` 的 payload 里带了 mood（语义状态），
 * 但 main.ts 组装 petState 时曾漏掉它 —— 渲染层退回旧的 mode（walk/run），
 * atlas 素材里没有这两个动作名，于是**永远停在 idle**，看起来「不跟状态」。
 *
 * 这条测试不启真窗口，只验证「IPC 载荷 → petState → pushState」的字段完整性，
 * 避免以后再加字段时又漏。
 *
 * 用法：node scripts/test-pet-state-passthrough.js
 */
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const mainSrc = fs.readFileSync(path.join(ROOT, "electron", "main.ts"), "utf8");

function main() {
  // ── 1. tray:update-stats 的处理里必须把 mood 放进 petState ──
  const block = mainSrc.slice(
    mainSrc.indexOf('"tray:update-stats"'),
    mainSrc.indexOf("syncTaskbarUnreadBadge(stats.unread)"),
  );
  assert.ok(block.length > 0, "应能找到 tray:update-stats 处理块");
  assert.ok(
    /mood:\s*stats\.mood/.test(block),
    "petState 必须透传 mood（漏了会让 atlas 素材永远停在 idle）",
  );
  console.log("PET_STATE_OK passthrough-mood");

  // ── 2. 其余字段也不能漏（历史上逐个加过） ──
  for (const field of ["mode", "running", "unread", "title", "toolLabel", "sessionId"]) {
    assert.ok(
      new RegExp(`${field}:\\s*stats\\.${field}`).test(block) ||
        new RegExp(`${field}:\\s*stats\\.${field}\\s*\\?\\?`).test(block),
      `petState 必须透传 ${field}`,
    );
  }
  console.log("PET_STATE_OK passthrough-fields");

  // ── 3. PetStatePayload 类型里要有 mood（否则编译期就该报） ──
  const windowSrc = fs.readFileSync(path.join(ROOT, "electron", "pet-window.ts"), "utf8");
  const payload = windowSrc.slice(
    windowSrc.indexOf("export interface PetStatePayload"),
    windowSrc.indexOf("export class PetWindowController"),
  );
  assert.ok(/mood\?:\s*string/.test(payload), "PetStatePayload 应声明 mood");
  console.log("PET_STATE_OK payload-type");

  // ── 4. 渲染层要用 mood（否则主进程传了也白传） ──
  const html = fs.readFileSync(
    path.join(ROOT, "build-resources", "pet-ui", "pet.html"),
    "utf8",
  );
  assert.ok(/next\.mood/.test(html), "渲染层应优先用 mood");
  assert.ok(/function applyMood/.test(html), "渲染层应有 applyMood");
  assert.ok(/function resolveClipJs/.test(html), "渲染层应有能力回退（resolveClipJs）");
  console.log("PET_STATE_OK renderer-uses-mood");

  console.log("PET_STATE_TEST_OK");
}

main();
