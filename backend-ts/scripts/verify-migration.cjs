/* 迁移完整性断言：DB（只读）↔ 导出文件逐域比对
 *
 * ⚠️ 迁移脚手架配套工具（临时）：随主库移除时一并删除。
 * 用法：node scripts/verify-migration.cjs <数据根目录>
 *   例：node scripts/verify-migration.cjs "C:\Users\me\.guada"
 * 覆盖：account.json、agents(含 .rekey.json)、providers(含内嵌模型数)、
 *       sessions(含 _groups.json)、bots、data/kb、mcp-servers 各域与 DB 行一致性。
 */
const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");
const Database = require("better-sqlite3");

const ROOT = (process.argv[2] || process.env.USERDATA_DIR || "").replace(/\\/g, "/").replace(/\/$/, "");
if (!ROOT) {
  console.error("用法: node scripts/verify-migration.cjs <数据根目录>");
  process.exit(2);
}
const db = new Database(`${ROOT}/data/ai_chat.db`, { readonly: true });

let pass = 0, fail = 0;
const ok = (cond, label) => {
  if (cond) { pass++; }
  else { fail++; console.log("FAIL: " + label); }
};

// ── account ──
const acc = JSON.parse(fs.readFileSync(path.join(ROOT, "account.json"), "utf8"));
const u = db.prepare("SELECT * FROM user WHERE role='primary'").get();
ok(acc.username === u.username, "account.username");
ok((u.password_hash ? !!acc.passwordHash : !acc.passwordHash), "account.passwordHash 与 DB 状态一致");

// ── agents / rekey ──
const rekey = JSON.parse(fs.readFileSync(path.join(ROOT, "agents/.rekey.json"), "utf8"));
const chars = db.prepare("SELECT id, title FROM character").all();
ok(Object.keys(rekey).length === chars.length, `rekey 映射数 ${Object.keys(rekey).length} === ${chars.length}`);
const agentDirs = fs.readdirSync(path.join(ROOT, "agents"), { withFileTypes: true })
  .filter(d => d.isDirectory()).map(d => d.name);
for (const c of chars) {
  ok(typeof rekey[c.id] === "string" && agentDirs.includes(rekey[c.id]), `角色目录存在: ${c.title} → ${rekey[c.id]}`);
  ok(fs.existsSync(path.join(ROOT, "agents", rekey[c.id], "AGENT.md")), `AGENT.md 存在: ${rekey[c.id]}`);
}

// ── providers ──
const provRows = db.prepare("SELECT * FROM model_provider").all();
const modelRows = db.prepare("SELECT * FROM model").all();
const provFiles = fs.readdirSync(path.join(ROOT, "providers")).filter(f => f.endsWith(".yaml"));
ok(provFiles.length === provRows.length, `providers 文件数 ${provFiles.length} === ${provRows.length}`);
const provIds = new Set();
let yamlModelCount = 0;
for (const f of provFiles) {
  const cfg = yaml.load(fs.readFileSync(path.join(ROOT, "providers", f), "utf8"));
  provIds.add(cfg.id);
  ok(path.basename(f, ".yaml") === cfg.id, `provider id=文件名: ${cfg.id}`);
  yamlModelCount += Array.isArray(cfg.models) ? cfg.models.length : 0;
}
ok(provIds.size === provRows.length, "provider id 零重键");
for (const r of provRows) ok(provIds.has(r.id), `provider 行有对应文件: ${r.id}`);
ok(yamlModelCount === modelRows.length, `yaml 内嵌模型总数 ${yamlModelCount} === DB model ${modelRows.length}`);

// ── sessions ──
const sessRows = db.prepare("SELECT id, character_id, model_id FROM session").all();
const sessDir = path.join(ROOT, "sessions");
const metaFiles = fs.readdirSync(sessDir).filter(f => {
  try { return fs.statSync(path.join(sessDir, f)).isDirectory() && fs.existsSync(path.join(sessDir, f, "meta.json")); }
  catch { return false; }
});
ok(metaFiles.length === sessRows.length, `meta.json 数 ${metaFiles.length} === session 行数 ${sessRows.length}`);
let badChar = 0, badModel = 0;
for (const s of sessRows) {
  const mp = path.join(sessDir, s.id, "meta.json");
  if (!fs.existsSync(mp)) { badChar++; continue; }
  const meta = JSON.parse(fs.readFileSync(mp, "utf8"));
  if (meta.characterId && !agentDirs.includes(meta.characterId)) badChar++;
  if (meta.modelId && !meta.modelId.includes(":")) badModel++;
}
ok(badChar === 0, `全部会话 characterId 可解析（异常 ${badChar}）`);
ok(badModel === 0, `全部会话 modelId 为 null 或复合 id（异常 ${badModel}）`);
const groups = JSON.parse(fs.readFileSync(path.join(sessDir, "_groups.json"), "utf8"));
const gRows = db.prepare("SELECT id FROM session_group").all();
ok(groups.length === gRows.length, `分组数 ${groups.length} === ${gRows.length}`);

// ── bots ──
const botRows = db.prepare("SELECT id, name, enabled, default_character_id, default_model_id FROM bot_instance").all();
const botFiles = fs.readdirSync(path.join(ROOT, "bots")).filter(f => f.endsWith(".yaml"));
ok(botFiles.length === botRows.length, `bots 文件数 ${botFiles.length} === ${botRows.length}`);
for (const b of botRows) {
  const cfg = yaml.load(fs.readFileSync(path.join(ROOT, "bots", `${b.id}.yaml`), "utf8"));
  ok(cfg.name === b.name && cfg.enabled === (b.enabled !== 0), `bot ${b.name}: name/enabled 一致 (enabled=${cfg.enabled})`);
  ok(!b.default_character_id || agentDirs.includes(cfg.defaultCharacterId), `bot ${b.name} defaultCharacterId 可解析: ${cfg.defaultCharacterId}`);
  ok(!b.default_model_id || (cfg.defaultModelId || "").includes(":"), `bot ${b.name} defaultModelId 复合: ${cfg.defaultModelId}`);
}

// ── kb（每库一个自包含目录：kb.json + kb.db + raw/） ──
const kbRows = db.prepare("SELECT id, name, embedding_model_id FROM knowledge_base").all();
const fRows = db.prepare("SELECT id, knowledge_base_id FROM kb_file").all();
const kbHasSqliteForm = (kbId) => fs.existsSync(path.join(ROOT, "data/kb", kbId, "kb.db"));

for (const k of kbRows) {
  const configPath = path.join(ROOT, "data/kb", k.id, "kb.json");
  if (!fs.existsSync(configPath)) {
    ok(false, `kb ${k.name} 缺 kb.json`);
    continue;
  }
  const kb = JSON.parse(fs.readFileSync(configPath, "utf8"));
  ok(kb.name === k.name, `kb ${k.name} 名称一致`);
  ok(kb.embeddingModelId === k.embedding_model_id && kb.embeddingModelId.includes(":"), `kb ${k.name} embeddingModelId 复合且一致`);

  // kb.db 存在时逐条比对条目行（权威来源已迁到库内 item 表）
  if (!kbHasSqliteForm(k.id)) continue;
  const kbDb = new Database(path.join(ROOT, "data/kb", k.id, "kb.db"), { readonly: true });
  const items = kbDb.prepare("SELECT id, display_name, processing_status, raw_name FROM item").all();
  const expected = fRows.filter((f) => f.knowledge_base_id === k.id);
  ok(items.length === expected.length, `kb ${k.name} 条目数 ${items.length} === ${expected.length}`);
  for (const f of expected) {
    const item = items.find((i) => i.id === f.id);
    if (!item) {
      // 允许的唯一情况：原件已不在（物理文件与元信息都消失的 DB 残留行）
      const row = db.prepare("SELECT file_path, is_directory FROM kb_file WHERE id = ?").get(f.id);
      let physMissing = true;
      if (row && row.is_directory !== 1 && row.file_path) {
        physMissing = !fs.existsSync(
          path.isAbsolute(row.file_path) ? row.file_path : path.join(ROOT, "data", row.file_path),
        );
      }
      ok(physMissing, `kb_file ${f.id} 不在 kb.db 且原件仍在——迁移丢失！`);
      continue;
    }
    // 有原件的条目：raw/<itemId>/ 下必须真有文件
    if (item.raw_name) {
      const rawPath = path.join(ROOT, "data/kb", k.id, "raw", f.id, item.raw_name);
      ok(fs.existsSync(rawPath), `kb ${k.name} 条目 ${item.display_name} 原件入库: ${item.raw_name}`);
    }
  }
  const chunkCount = kbDb.prepare("SELECT COUNT(*) c FROM chunk").get().c;
  const ftsCount = kbDb.prepare("SELECT COUNT(*) c FROM chunk_fts").get().c;
  ok(chunkCount === ftsCount, `kb ${k.name} chunk 与 FTS 行数一致 (${chunkCount})`);
  kbDb.close();
}

// 旧形态残留检查：迁移完成后不应再有 file.json / chunks.jsonl
const legacyLeftovers = [];
const kbRoot = path.join(ROOT, "data/kb");
if (fs.existsSync(kbRoot)) {
  for (const kbEntry of fs.readdirSync(kbRoot, { withFileTypes: true })) {
    if (!kbEntry.isDirectory() || kbEntry.name.startsWith(".")) continue;
    const kbDir = path.join(kbRoot, kbEntry.name);
    for (const itemEntry of fs.readdirSync(kbDir, { withFileTypes: true })) {
      if (!itemEntry.isDirectory()) continue;
      if (itemEntry.name === "raw") continue;
      if (fs.existsSync(path.join(kbDir, itemEntry.name, "file.json"))) {
        legacyLeftovers.push(path.join(kbDir, itemEntry.name, "file.json"));
      }
      if (fs.existsSync(path.join(kbDir, itemEntry.name, "chunks.jsonl"))) {
        legacyLeftovers.push(path.join(kbDir, itemEntry.name, "chunks.jsonl"));
      }
    }
  }
}
ok(
  legacyLeftovers.length === 0,
  `无旧形态残留（file.json/chunks.jsonl）：发现 ${legacyLeftovers.length} 处 ${legacyLeftovers.slice(0, 3).join(", ")}`,
);

// ── mcp ──
const mcpRows = db.prepare("SELECT id, name, enabled FROM mcp_server").all();
const mcpFiles = fs.readdirSync(path.join(ROOT, "mcp-servers")).filter(f => f.endsWith(".yaml") && !f.endsWith(".tools.json"));
ok(mcpFiles.length === mcpRows.length, `mcp yaml 数 ${mcpFiles.length} === ${mcpRows.length}`);
for (const m of mcpRows) {
  const cfg = yaml.load(fs.readFileSync(path.join(ROOT, "mcp-servers", `${m.id}.yaml`), "utf8"));
  ok(cfg.name === m.name && cfg.enabled === (m.enabled !== 0), `mcp ${m.name}: name/enabled 一致 (enabled=${cfg.enabled})`);
  ok(fs.existsSync(path.join(ROOT, "mcp-servers", `${m.id}.tools.json`)), `mcp ${m.id} tools.json 存在`);
}

console.log(`\n===== 断言结果: ${pass} 通过, ${fail} 失败 =====`);
db.close();
process.exit(fail > 0 ? 1 : 0);
