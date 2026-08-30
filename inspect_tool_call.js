const Database = require("D:/AI/ai_chat/backend-ts/node_modules/better-sqlite3");
const db = new Database("C:/Users/22071/.guada/data/ai_chat.db", { readonly: true });

const SESSION = "cmsug90mq00ym0gkzhhp5dh4t";

// 所有 assistant 消息里的 toolCalls 统计
const asst = db.prepare(`
  SELECT mc.id contentId, mc.message_id, mc.role, mc.meta_data, mc.created_at
  FROM message_content mc
  WHERE mc.message_id IN (SELECT id FROM message WHERE session_id=?)
    AND mc.role='assistant'
`).all(SESSION);

let total=0, noId=0, noName=0, noIdName=0;
const emptySamples=[];
for (const a of asst) {
  let md={}; try{md=JSON.parse(a.meta_data||"{}");}catch(e){}
  if (!Array.isArray(md.toolCalls)) continue;
  for (const tc of md.toolCalls) {
    total++;
    if (!tc.id && !tc.name) { noIdName++; emptySamples.push({contentId:a.contentId,msgId:a.message_id,created:a.created_at,args:(tc.arguments||"").slice(0,80)}); }
    if (!tc.id) noId++;
    if (!tc.name) noName++;
  }
}
console.log(`assistant messages with toolCalls rows: ${asst.length}`);
console.log(`total toolCalls items: ${total}, empty-id: ${noId}, empty-name: ${noName}, empty-id&name: ${noIdName}`);
console.log("---- empty id&name samples (up to 10):");
emptySamples.slice(0,10).forEach(s=>console.log(`  msg=${s.msgId} content=${s.contentId} created=${s.created} args=${s.args}`));

// 与 BAD#555 配对的 assistant 消息（同一 message_id）
console.log("---- BAD#555 message_id = cmsyr0wif00033ckz04r32shh 下的所有 contents:");
const pair = db.prepare(`SELECT id, role, meta_data, content FROM message_content WHERE message_id='cmsyr0wif00033ckz04r32shh'`).all();
console.log("rows:", pair.length);
for (const p of pair) {
  console.log(`  role=${p.role} id=${p.id} meta=${p.meta_data}`);
}
