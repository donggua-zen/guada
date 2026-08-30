const Database = require("D:/AI/ai_chat/backend-ts/node_modules/better-sqlite3");
const fs = require("fs");

const DB = "C:/Users/22071/.guada/data/ai_chat.db";
const db = new Database(DB);
const BACKUP = "D:/AI/ai_chat/.guada_db_repair_backup3.json";

const ASSIST = "cmsyqde1l003jtkkz253xeauc"; // 孤儿 assistant：toolCalls[0] id/name 空，无后续 tool
const MSG_ID  = "cmsyq8fuu002ztkkz18wvgn7q"; // 所属 message
const synthId = `call_tmp_${crypto.randomUUID()}`;
const newContentId = `cmsyfix_${crypto.randomUUID().replace(/-/g, "").slice(0, 21)}`;
const now = new Date().toISOString();

const backup = {
  synthId,
  assist: { id: ASSIST, meta_data: db.prepare("SELECT meta_data FROM message_content WHERE id=?").get(ASSIST).meta_data },
  msgContentsBefore: db.prepare("SELECT id, role, created_at FROM message_content WHERE message_id=? ORDER BY created_at, id").all(MSG_ID),
};
fs.writeFileSync(BACKUP, JSON.stringify(backup, null, 2), "utf-8");
console.log("备份已写入:", BACKUP);

// 1) assistant：补 id/name（vite build → run_command）
const ameta = JSON.parse(db.prepare("SELECT meta_data FROM message_content WHERE id=?").get(ASSIST).meta_data || "{}");
for (const tc of (ameta.toolCalls || [])) {
  if (!tc.id) { tc.id = synthId; tc.name = tc.name || "run_command"; }
}
db.prepare("UPDATE message_content SET meta_data=? WHERE id=?").run(JSON.stringify(ameta), ASSIST);

// 2) 插入配对的 tool 响应消息（紧跟在 assistant 之后，created_at 晚于它）
const content = JSON.stringify({
  success: false,
  message: "Invalid tool call: missing tool name. Please call a valid registered tool.",
});
db.prepare(`
  INSERT INTO message_content (id, message_id, turns_id, role, content, reasoning_content, additional_kwargs, meta_data, created_at, updated_at)
  VALUES (?, ?, '', 'tool', ?, NULL, NULL, ?, ?, ?)
`).run(
  newContentId,
  MSG_ID,
  content,
  JSON.stringify({ modelName: "", finishReason: "", toolCallId: synthId }),
  now,
  now,
);

console.log("插入的 tool 消息:", newContentId, "toolCallId:", synthId);
console.log("修复后校验 assistant:", JSON.stringify(JSON.parse(db.prepare("SELECT meta_data FROM message_content WHERE id=?").get(ASSIST).meta_data)));
const check = db.prepare("SELECT id, role, meta_data FROM message_content WHERE id=?").get(newContentId);
console.log("新行校验:", JSON.stringify(check));
