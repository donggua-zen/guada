/**
 * 把一份 Codex 桌宠（pet.json + spritesheet.webp）领养进本仓库/用户目录。
 *
 * 用法：
 *   node scripts/adopt-codex-pet.mjs --src "C:/pets/qi" [--dest build-resources/pets] [--id qi]
 *
 * 做的事：
 * 1. 用 scripts/validate-pet-atlas.mjs 做契约校验（尺寸/帧数/透明/未用格）
 * 2. 校验通过才复制；目标目录已存在则拒绝（避免覆盖已有形象）
 * 3. 打印落点，提示重启或在设置页刷新
 *
 * 说明：设置页的「从文件夹导入」走的是主进程的同名逻辑（能拿到 userData 路径）；
 * 这个脚本是给开发/CI 用的命令行版本。
 */
import fs from "node:fs";
import path from "node:path";
import { validatePetDir } from "./validate-pet-atlas.mjs";

function parseArgs(argv) {
  const args = { src: null, dest: "build-resources/pets", id: null, force: false };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const next = argv[i + 1];
    if (key === "--src" && next) { args.src = next; i += 1; }
    else if (key === "--dest" && next) { args.dest = next; i += 1; }
    else if (key === "--id" && next) { args.id = next; i += 1; }
    else if (key === "--force") args.force = true;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.src) {
    console.error("用法: node scripts/adopt-codex-pet.mjs --src <含 pet.json 的目录> [--dest build-resources/pets] [--id name]");
    process.exit(1);
  }

  const srcDir = path.resolve(args.src);
  if (!fs.existsSync(srcDir)) {
    console.error(`[adopt] 源目录不存在: ${srcDir}`);
    process.exit(1);
  }

  // ── 1. 契约校验（不合格直接拒绝，避免把坏素材装进仓库） ──
  const result = await validatePetDir(srcDir);
  if (!result.ok) {
    console.error(`[adopt] ✖ ${srcDir} 不符合 Codex 桌宠契约：`);
    for (const e of result.errors) console.error(`        · ${e}`);
    process.exit(1);
  }

  const id = (args.id || path.basename(srcDir)).trim();
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id)) {
    console.error(`[adopt] 非法形象 id: ${id}（只允许字母数字、下划线、短横线）`);
    process.exit(1);
  }

  const destDir = path.join(path.resolve(args.dest), id);
  if (fs.existsSync(destDir) && !args.force) {
    console.error(`[adopt] 目标已存在，拒绝覆盖: ${destDir}（确需覆盖加 --force）`);
    process.exit(1);
  }

  fs.rmSync(destDir, { recursive: true, force: true });
  fs.mkdirSync(destDir, { recursive: true });
  fs.cpSync(srcDir, destDir, { recursive: true });

  const name = result.info?.config?.displayName ?? id;
  console.log(`[adopt] ✔ ${name}（${id}）→ ${destDir}`);
  console.log(`[adopt]   图集 ${result.info?.size?.w}×${result.info?.size?.h}，9 段动画`);
  console.log("[adopt]   在设置 → 桌面宠物 里选它即可（已运行的应用可能需要重新打开设置页）");
}

main().catch((error) => {
  console.error("[adopt] 失败:", error);
  process.exit(1);
});
