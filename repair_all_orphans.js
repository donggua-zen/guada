const Database = require("D:/AI/ai_chat/backend-ts/node_modules/better-sqlite3");
const fs = require("fs");

const DB = "C:/Users/22071/.guada/data/ai_chat.db";
const db = new Database(DB); // 读写含 WAL
const BACKUP = "D:/AI/ai_chat/.guada_db_repair_backup4_orphans.json";

// 要修复的孤儿 assistant 内容
const ORPHANS = [
  { id: "cmsyqde1l003jtkkz253xeauc", name: "run_command" }, // cmsug90mq
  { id: "cmsycaew5000xookza0qt0eac", name: "run_command" }, // cmswmlqal...
  { id: "cmsygnz3o000ftkkz0asud15k", name: "run_command" }, // cmswmlqal...
];

const getRow = (id) => db.prepare("SELECT * FROM message_content WHERE id=?").get(id);

const backup = [];
for (const o of ORPHANS) {
  const row = getRow(o.id);
  const before = db.prepare("SELECT id, role, created_at FROM message_content WHERE message_id=? ORDER BY created_at, id")
    .all(row.message_id);
  backup.push({ orphan: o.id, messageId: row.message_id, meta_before: row.meta_data, contentsBefore: before });
}
fs.writeFileSync(BACKUP, JSON.stringify(backup, null, 2), "utf-8");
console.log("备份: ", BACKUP);

let done = 0;
for (const o of ORPHANS) {
  const row = getRow(o.id);
  const md = JSON.parse(row.meta_data || "{}");
  const toolCalls = Array.isArray(md.toolCalls) ? md.toolCalls : [];
  if (toolCalls.length === 0) { console.log("跳过(无 toolCalls):", o.id); continue; }

  // 取该 assistant 里第一个空 id 的 toolCall，给它合成 id 并补 name
  let target = null;
  for (const tc of toolCalls) { if (!tc.id) { target = tc; break; } }
  if (!target) { console.log("跳过(无空id toolCall):", o.id); continue; }

  const synthId = `call_tmp_${crypto.randomUUID()}`;
  target.id = synthId;
  if (!target.name) target.name = o.name || "run_command";
  db.prepare("UPDATE message_content SET meta_data=? WHERE id=?").run(JSON.stringify(md), o.id);

  // 插入配对 tool 响应（created_at = 孤儿 + 1ms，保证紧跟在它后面排序）
  const ts = new Date(new Date(row.created_at).getTime() + 1).toISOString();
  const newContentId = `cmsyfix_${crypto.randomUUID().replace(/-/g, "").slice(0, 21)}`;
  const content = JSON.stringify({
    success: false,
    message: "Invalid tool call: missing tool name. Please call a valid registered tool.",
  });
  db.prepare(`
    INSERT INTO message_content (id, message_id, turns_id, role, content, reasoning_content, additional_kwargs, meta_data, created_at, updated_at)
    VALUES (?, ?, '', 'tool', ?, NULL, NULL, ?, ?, ?)
  `).run(newContentId, row.message_id, content,
    JSON.stringify({ modelName: "", finishReason: "", toolCallId: synthId }), ts, ts);

  console.log(`[OK] orphan=${o.id} session=${db.prepare("SELECT session_id FROM message WHERE id=?").get(row.message_id).session_id} synthId=${synthId} newTool=${newContentId}`);
  done++;
}
console.log("完成修复孤儿数:", done, "/", ORPHANS.length);
