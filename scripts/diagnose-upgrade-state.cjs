#!/usr/bin/env node
/**
 * 升级状态只读诊断（账户 / 供应商 / 数据根）
 *
 * 背景：客户反馈「升级后密码变默认」「已添加的供应商丢失」。这两个症状的成因有多个
 * 分支（数据根错位、空库、主库读失败兜底、marker 语义），必须在客户机器上看现场才能定性。
 * 本脚本只读，不改任何文件，用于一键收集判定所需的全部事实。
 *
 * 用法：
 *   node scripts/diagnose-upgrade-state.cjs                 # 自动检测 ~/.guada、~/.guada-dev、AppData
 *   node scripts/diagnose-upgrade-state.cjs <数据根路径>      # 指定数据根
 *
 * 输出重点看：
 *   - 「数据根判定」：AppData 与 ~/.guada 谁有数据、DB 大小/行数（空壳 vs 真库）
 *   - 「账户」：account.json 的 passwordSet 是否与库里 user.password_hash 一致
 *   - 「供应商」：providers/*.yaml 数量是否与库里 model_provider 行数一致、marker 是否存在
 *   - 「会话/消息」：条数（判断是否整体空库——这是区分"域级失败"与"数据根错位"的关键）
 */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

function tryRequireBetterSqlite() {
  for (const p of [
    path.join(__dirname, "..", "backend-ts", "node_modules", "better-sqlite3"),
    "better-sqlite3",
  ]) {
    try {
      return require(p);
    } catch {
      /* 继续尝试 */
    }
  }
  return null;
}

const Database = tryRequireBetterSqlite();

function exists(p) {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

function statBrief(p) {
  if (!exists(p)) return "（不存在）";
  const s = fs.statSync(p);
  return `${(s.size / 1024 / 1024).toFixed(1)}MB  mtime=${s.mtime.toISOString()}`;
}

function openDb(dbPath, readonly = true) {
  if (!Database || !exists(dbPath)) return null;
  try {
    return new Database(dbPath, { readonly });
  } catch (e) {
    console.log(`  ! 打不开 ${dbPath}: ${e.message}`);
    return null;
  }
}

function q(db, sql, fallback = "?") {
  try {
    const row = db.prepare(sql).get();
    return row ? Object.values(row)[0] : fallback;
  } catch (e) {
    return `ERR(${e.message.split("\n")[0]})`;
  }
}

function reportDataHome(label, home) {
  console.log(`\n${"=".repeat(64)}\n=== ${label}: ${home}\n${"=".repeat(64)}`);
  if (!exists(home)) {
    console.log("  （目录不存在）");
    return;
  }

  const dbPath = path.join(home, "data", "ai_chat.db");
  const flatDbPath = path.join(home, "ai_chat.db"); // 老布局：DB 直接在数据根
  console.log(`  [数据根标志] .migrated=${exists(path.join(home, ".migrated"))}`);
  console.log(`  [主库 data/ai_chat.db] ${statBrief(dbPath)}`);
  if (exists(flatDbPath)) console.log(`  [主库 根/ai_chat.db]  ${statBrief(flatDbPath)}`);

  const db = openDb(dbPath) || openDb(flatDbPath);
  if (!db) {
    console.log("  [主库] 无法打开，后续库内检查跳过");
  } else {
    console.log("  [结构] session 有 closed_at:",
      String(q(db, `SELECT COUNT(*) FROM pragma_table_info('session') WHERE name='closed_at'`)) !== "0");
    console.log("  [迁移记录]", JSON.stringify(
      (() => { try { return db.prepare("SELECT id,name FROM _app_migrations ORDER BY id").all().map((r) => `${r.id}:${r.name}`); } catch (e) { return `ERR(${e.message.split("\n")[0]})`; } })(),
    ));
    console.log("  [完整性] integrity_check:", q(db, "PRAGMA integrity_check"));
    console.log("  [规模] session=%s message=%s kb_file=%s",
      q(db, `SELECT COUNT(*) FROM "session"`), q(db, `SELECT COUNT(*) FROM "message"`), q(db, `SELECT COUNT(*) FROM "kb_file"`));

    // 账户：库里应有密码
    console.log("  [库·账户] user 行数=%s 有 password_hash 的行=%s", q(db, `SELECT COUNT(*) FROM "user"`),
      q(db, `SELECT COUNT(*) FROM "user" WHERE password_hash IS NOT NULL AND password_hash <> ''`));
    // 供应商：库里应有行
    console.log("  [库·供应商] model_provider=%s model=%s", q(db, `SELECT COUNT(*) FROM "model_provider"`), q(db, `SELECT COUNT(*) FROM "model"`));
    try {
      db.prepare('SELECT COUNT(*) FROM "model_provider" WHERE user_id IS NULL OR api_url IS NULL').get();
      console.log("  [库·供应商] 疑似空 api_url/user_id 行:",
        q(db, `SELECT COUNT(*) FROM "model_provider" WHERE api_url IS NULL OR api_url = '' OR user_id IS NULL OR user_id = ''`));
    } catch { /* 列可能不存在 */ }
    db.close();
  }

  // 账户文件
  const accountPath = path.join(home, "account.json");
  if (exists(accountPath)) {
    try {
      const acc = JSON.parse(fs.readFileSync(accountPath, "utf8"));
      console.log(`  [文件·账户] username=${acc.username} passwordSet=${!!acc.passwordHash} nickname=${acc.nickname} updatedAt=${acc.updatedAt}`);
    } catch (e) {
      console.log(`  [文件·账户] ★解析失败（会按未设置处理）★ ${e.message}`);
    }
  } else {
    console.log("  [文件·账户] account.json 不存在（首次启动会被引导写入）");
  }

  // 供应商目录
  const pdir = path.join(home, "providers");
  if (exists(pdir)) {
    const files = fs.readdirSync(pdir);
    const yaml = files.filter((f) => f.endsWith(".yaml"));
    console.log(`  [文件·供应商] yaml=${yaml.length} marker=${exists(path.join(pdir, ".migrated-from-db"))} README=${exists(path.join(pdir, "README.md"))}`);
    console.log(`      ids: ${yaml.map((f) => f.replace(/\.yaml$/, "")).join(", ") || "（空）"}`);
  } else {
    console.log("  [文件·供应商] providers/ 不存在（首次启动会被创建）");
  }

  // 其他域（判断是否整体空）
  const sdir = path.join(home, "sessions");
  if (exists(sdir)) {
    const ents = fs.readdirSync(sdir).filter((n) => !n.startsWith("."));
    console.log(`  [文件·会话] sessions/ 会话目录数=${ents.length} 标记: ${fs.readdirSync(sdir).filter((n) => n.startsWith(".")).join(",") || "无"}`);
  }
  console.log(`  [文件·其他] agents=${exists(path.join(home, "agents")) ? fs.readdirSync(path.join(home, "agents")).length : "无"} bots=${exists(path.join(home, "bots")) ? fs.readdirSync(path.join(home, "bots")).length : "无"} kb=${exists(path.join(home, "data", "kb")) ? fs.readdirSync(path.join(home, "data", "kb")).length : "无"}`);
}

function main() {
  console.log("升级状态只读诊断 —— 账户 / 供应商 / 数据根");
  if (!Database) console.log("! 未找到 better-sqlite3，库内检查会跳过（可在 backend-ts 目录下运行本脚本）");

  const explicit = process.argv[2];
  if (explicit) {
    reportDataHome("指定数据根", path.resolve(explicit));
    return;
  }

  const homeGuada = path.join(os.homedir(), ".guada");
  const homeGuadaDev = path.join(os.homedir(), ".guada-dev");
  reportDataHome("正式数据根", homeGuada);
  if (exists(homeGuadaDev)) reportDataHome("开发数据根（仅开发机）", homeGuadaDev);

  // Electron userData（老布局）：productName=GuaDa；兼容历史名
  const appData = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
  for (const name of ["GuaDa", "guada"]) {
    const ud = path.join(appData, name);
    if (exists(ud)) {
      const hasDb = exists(path.join(ud, "ai_chat.db"));
      console.log(`\n[Electron userData·老布局] ${ud}  ai_chat.db=${hasDb ? statBrief(path.join(ud, "ai_chat.db")) : "（无）"}`);
      if (hasDb) console.log("  ★ 老布局仍有主库：若上面的 ~/.guada 主库很小/为空，说明数据根切换异常（老数据在 AppData 里）★");
    }
  }

  console.log(`
判定提示
  A. ~/.guada 主库 session/message 也为 0、而 AppData 有真库  → 数据根错位（老数据未被迁移/被空壳遮蔽）
  B. 数据都在，只有「账户 passwordSet=false」                      → 账户兜底路径（库不可读/空库时写了默认账户）
  C. 数据都在，只有「供应商 yaml=0 且 marker 存在」                 → 供应商 marker 被空库时写死，需删 marker 重导
  D. integrity_check != ok                                        → 库损坏（复制过程中被动复制等），域读取会 fail-open
日志取证（关键行，按时间倒序看首次升级的那次启动）：
  grep -E "账户已从 DB 导入|账户文件已存在，跳过导入|账户文件已创建（默认账户|DB 不可读，无法导入既有账户|Provider config migrated from DB|DB unreadable, skip provider migration|检测到全新安装|检测到旧版数据库安装" <数据根>/logs/*.log
`);
}

main();
