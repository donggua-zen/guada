const Database = require("D:/AI/ai_chat/backend-ts/node_modules/better-sqlite3");
const fs = require("fs");
const path = require("path");

const DB = "C:/Users/22071/.guada/data/ai_chat.db";
const db = new Database(DB); // 读写（WAL）
const BACKUP = "D:/AI/ai_chat/.guada_db_repair_backup.json";

const ASSIST = "cmsyrcqh9000x3ckz00na13fa"; // 坏 assistant，toolCalls[0] id/name 为空
const TOOL   = "cmsyrd2cg00123ckzefkqdqum"; // 坏 tool 消息，缺 toolCallId

const synthId = `call_tmp_${crypto.randomUUID()}`;

function getMeta(id) {
  const r = db.prepare("SELECT meta_data FROM message_content WHERE id=?").get(id);
  return r ? JSON.parse(r.meta_data || "{}") : null;
}

const backup = {
  synthId,
  assist: { id: ASSIST, meta_data: db.prepare("SELECT meta_data FROM message_content WHERE id=?").get(ASSIST).meta_data },
  tool:  { id: TOOL,  meta_data: db.prepare("SELECT meta_data FROM message_content WHERE id=?").get(TOOL).meta_data },
};
fs.writeFileSync(BACKUP, JSON.stringify(backup, null, 2), "utf-8");
console.log("备份已写入:", BACKUP);

// 1) assistant：给 toolCalls[0] 补 id（并补 name=run_command，与相邻正常调用一致）
const ameta = getMeta(ASSIST);
if (Array.isArray(ameta.toolCalls) && ameta.toolCalls[0]) {
  ameta.toolCalls[0].id = synthId;
  ameta.toolCalls[0].name = ameta.toolCalls[0].name || "run_command";
}
db.prepare("UPDATE message_content SET meta_data=? WHERE id=?").run(JSON.stringify(ameta), ASSIST);

// 2) tool：补 toolCallId = synthId（与 assistant 配对）
const tmeta = getMeta(TOOL);
tmeta.toolCallId = synthId;
db.prepare("UPDATE message_content SET meta_data=? WHERE id=?").run(JSON.stringify(tmeta), TOOL);

console.log("修复后校验:");
console.log("  assistant meta:", JSON.stringify(getMeta(ASSIST)));
console.log("  tool meta     :", JSON.stringify(getMeta(TOOL)));
