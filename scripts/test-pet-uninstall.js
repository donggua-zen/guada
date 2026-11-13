/**
 * 桌宠卸载的安全边界测试（真实临时目录，不碰用户数据）。
 *
 * 卸载是递归 rm，必须钉死这几条：
 * - 只能删 user 根下的直接子目录
 * - 默认形象柒不可删
 * - ../ 路径穿越被挡
 * - 非形象目录（没有 pet.json/manifest.json）不删
 * - bundled / petdex / codex 根下的东西一律不动
 *
 * 用法：node scripts/test-pet-uninstall.js
 */
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { uninstallPetAvatar } = require("../electron/dist/pet-uninstall.js");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pet-uninstall-"));
const userRoot = path.join(tmp, "user");
const bundledRoot = path.join(tmp, "bundled");
const petdexRoot = path.join(tmp, "petdex");
for (const dir of [userRoot, bundledRoot, petdexRoot]) fs.mkdirSync(dir, { recursive: true });

const roots = [
  { dir: userRoot, source: "user" },
  { dir: petdexRoot, source: "petdex" },
  { dir: bundledRoot, source: "bundled" },
];

/** 造一个合法的已安装形象目录 */
function makePet(root, id) {
  const dir = path.join(root, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "pet.json"), JSON.stringify({ id }));
  fs.writeFileSync(path.join(dir, "spritesheet.webp"), "fake");
  return dir;
}

function main() {
  // ── 1. 正常卸载 ──
  const target = makePet(userRoot, "boba");
  const r = uninstallPetAvatar(roots, "boba");
  assert.deepStrictEqual(r, { ok: true });
  assert.strictEqual(fs.existsSync(target), false);
  console.log("PET_UNINSTALL_OK normal");

  // ── 2. 内置柒不可删 ──
  const qi = makePet(userRoot, "silver-haired");
  const rQi = uninstallPetAvatar(roots, "silver-haired");
  assert.strictEqual(rQi.ok, false);
  assert.match(rQi.error, /内置/);
  assert.strictEqual(fs.existsSync(qi), true, "柒的目录必须还在");
  console.log("PET_UNINSTALL_OK builtin-protected");

  // ── 3. 路径穿越 / 非法 id ──
  for (const bad of ["../etc", "../../outside", "a/b", "", " ", ".."]) {
    const res = uninstallPetAvatar(roots, bad);
    assert.strictEqual(res.ok, false, `非法 id 应被拒：${JSON.stringify(bad)}`);
  }
  console.log("PET_UNINSTALL_OK path-traversal");

  // ── 4. 其它根下的目录不能通过这里删 ──
  const ext = makePet(petdexRoot, "ext-pet");
  const rExt = uninstallPetAvatar(roots, "ext-pet");
  // user 根里没有同名目录 → 报「不存在」，但 petdex 目录必须完好
  assert.strictEqual(rExt.ok, false);
  assert.strictEqual(fs.existsSync(ext), true, "petdex 目录不该被动到");
  console.log("PET_UNINSTALL_OK external-protected");

  // ── 5. 非形象目录不删 ──
  const notPet = path.join(userRoot, "my-notes");
  fs.mkdirSync(notPet, { recursive: true });
  fs.writeFileSync(path.join(notPet, "readme.txt"), "hi");
  const rNot = uninstallPetAvatar(roots, "my-notes");
  assert.strictEqual(rNot.ok, false);
  assert.strictEqual(fs.existsSync(notPet), true);
  console.log("PET_UNINSTALL_OK non-pet-protected");

  // ── 6. 符号链接拒绝 ──
  try {
    fs.symlinkSync(bundledRoot, path.join(userRoot, "link-pet"), "dir");
    const rLink = uninstallPetAvatar(roots, "link-pet");
    assert.strictEqual(rLink.ok, false);
    console.log("PET_UNINSTALL_OK symlink-protected");
  } catch {
    console.log("PET_UNINSTALL_SKIP symlink（Windows 无权限创建链接）");
  }

  // ── 7. 不存在的 id / 无 user 根 ──
  assert.strictEqual(uninstallPetAvatar(roots, "ghost").ok, false);
  assert.strictEqual(
    uninstallPetAvatar([{ dir: bundledRoot, source: "bundled" }], "x").ok,
    false,
  );
  console.log("PET_UNINSTALL_OK missing");

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log("PET_UNINSTALL_TEST_OK");
}

main();
