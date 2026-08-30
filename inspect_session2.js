const Database = require("D:/AI/ai_chat/backend-ts/node_modules/better-sqlite3");
const db = new Database("C:/Users/22071/.guada/data/ai_chat.db", { readonly: true });

const SESSION = "cmsyqx3d800095gkz7ltspsjt";

console.log("message rows:", db.prepare("SELECT id FROM message WHERE session_id=?").all(SESSION).length);

// 1) tool 消息缺 toolCallId
const toolContent = db.prepare(`
  SELECT mc.id, mc.message_id, mc.meta_data, mc.content, mc.created_at
  FROM message_content mc
  WHERE mc.message_id IN (SELECT id FROM message WHERE session_id=?)
    AND mc.role='tool'
`).all(SESSION);
let badToolRows=[];
for (const t of toolContent) {
  let md={}; try{md=JSON.parse(t.meta_data||"{}");}catch(e){}
  if (!md.toolCallId) badToolRows.push(t);
}
console.log(`tool msgs: ${toolContent.length}, 缺 toolCallId: ${badToolRows.length}`);
badToolRows.forEach(t=>console.log(`  [BAD-TOOL] id=${t.id} msgId=${t.message_id} created=${t.created_at} content=${String(t.content).slice(0,60)}`));

// 2) assistant toolCalls id/name 为空
const asst = db.prepare(`
  SELECT mc.id, mc.message_id, mc.meta_data, mc.created_at
  FROM message_content mc
  WHERE mc.message_id IN (SELECT id FROM message WHERE session_id=?)
    AND mc.role='assistant'
`).all(SESSION);
console.log(`assistant msgs: ${asst.length}`);
for (const a of asst) {
  let md={}; try{md=JSON.parse(a.meta_data||"{}");}catch(e){}
  if (!Array.isArray(md.toolCalls)) continue;
  for (const tc of md.toolCalls) {
    if (!tc.id || !tc.name) {
      console.log(`  [BAD-ASSIST] id=${a.id} msgId=${a.message_id} created=${a.created_at} tc=${JSON.stringify(tc).slice(0,160)}`);
    }
  }
}
