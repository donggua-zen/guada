const Database = require("D:/AI/ai_chat/backend-ts/node_modules/better-sqlite3");
const db = new Database("C:/Users/22071/.guada/data/ai_chat.db", { readonly: true });

// 两条坏 assistant 记录
const BAD_ASSIST = [
  "cmsyqde1l003jtkkz253xeauc", // 14:01
  "cmsyrcqh9000x3ckz00na13fa", // 14:28
];

const badTool = "cmsyrd2cg00123ckzefkqdqum"; // 缺 toolCallId 的 tool 消息

for (const aid of BAD_ASSIST) {
  const row = db.prepare("SELECT id, message_id, role, meta_data, content FROM message_content WHERE id=?").get(aid);
  console.log("=== ASSIST", aid, "message_id=", row.message_id);
  console.log("  meta:", row.meta_data);
  // 该 message 下所有 tool 消息
  const tools = db.prepare("SELECT id, role, meta_data, content FROM message_content WHERE message_id=? AND role='tool' ORDER BY created_at").all(row.message_id);
  console.log("  tool msgs under this message:", tools.length);
  for (const t of tools) {
    console.log("    tool id=", t.id, "meta=", t.meta_data, "content=", String(t.content).slice(0,60));
  }
}

console.log("=== BAD TOOL", badTool, "===");
const bt = db.prepare("SELECT id, message_id, role, meta_data, content FROM message_content WHERE id=?").get(badTool);
console.log("  message_id=", bt.message_id);
console.log("  meta:", bt.meta_data);
