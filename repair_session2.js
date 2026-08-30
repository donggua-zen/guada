const Database = require("D:/AI/ai_chat/backend-ts/node_modules/better-sqlite3");
const fs = require("fs");

const DB = "C:/Users/22071/.guada/data/ai_chat.db";
const db = new Database(DB);
const BACKUP = "D:/AI/ai_chat/.guada_db_repair_backup2.json";

const ASSIST = "cmsys10hu002d3ckz9iseh543"; // toolCalls[0] id/name 为空
const TOOL   = "cmsys34fd002i3ckzmq6dlo64"; // 缺 toolCallId
const synthId = `call_tmp_${crypto.randomUUID()}`;

const backup = {
  synthId,
  assist: { id: ASSIST, meta_data: db.prepare("SELECT meta_data FROM message_content WHERE id=?").get(ASSIST).meta_data },
  tool:  { id: TOOL,  meta_data: db.prepare("SELECT meta_data FROM message_content WHERE id=?").get(TOOL).meta_data },
};
fs.writeFileSync(BACKUP, JSON.stringify(backup, null, 2), "utf-8");
console.log("备份已写入:", BACKUP);

const getMeta = (id) => JSON.parse(db.prepare("SELECT meta_data FROM message_content WHERE id=?").get(id).meta_data || "{}");

// assistant: 给第一个空 id 的 toolCall 补 id/name
const ameta = getMeta(ASSIST);
if (Array.isArray(ameta.toolCalls)) {
  for (const tc of ameta.toolCalls) {
    if (!tc.id) { tc.id = synthId; tc.name = tc.name || "run_command"; }
  }
}
db.prepare("UPDATE message_content SET meta_data=? WHERE id=?").run(JSON.stringify(ameta), ASSIST);

// tool: 补 toolCallId
const tmeta = getMeta(TOOL);
tmeta.toolCallId = synthId;
db.prepare("UPDATE message_content SET meta_data=? WHERE id=?").run(JSON.stringify(tmeta), TOOL);

console.log("修复后校验:");
console.log("  assistant:", JSON.stringify(getMeta(ASSIST)));
console.log("  tool     :", JSON.stringify(getMeta(TOOL)));
