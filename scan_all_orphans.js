const Database = require("D:/AI/ai_chat/backend-ts/node_modules/better-sqlite3");
const db = new Database("C:/Users/22071/.guada/data/ai_chat.db", { readonly: true });

// 全库孤儿 assistant toolCalls（无后续 tool 响应），按会话分组
const contents = db.prepare(`
  SELECT mc.id, mc.message_id, mc.role, mc.meta_data, mc.created_at, m.session_id
  FROM message_content mc
  JOIN message m ON m.id = mc.message_id
  ORDER BY mc.created_at, mc.id
`).all();

const byMsg = new Map();
for (const c of contents) { if (!byMsg.has(c.message_id)) byMsg.set(c.message_id, []); byMsg.get(c.message_id).push(c); }

const bySession = new Map();
let total=0;
for (const [mid, l] of byMsg) {
  for (let i=0;i<l.length;i++){
    const c=l[i];
    if (c.role!=="assistant") continue;
    let md={}; try{md=JSON.parse(c.meta_data||"{}");}catch(e){}
    if (!Array.isArray(md.toolCalls)||md.toolCalls.length===0) continue;
    const callIds = md.toolCalls.map(t=>t.id);
    const toolIds = l.slice(i+1).filter(x=>x.role==="tool").map(t=>{try{return JSON.parse(t.meta_data||"{}").toolCallId;}catch(e){return null;}});
    const missing = callIds.filter(id=>!toolIds.includes(id));
    if (missing.length>0){
      total++;
      if(!bySession.has(c.session_id)) bySession.set(c.session_id,[]);
      bySession.get(c.session_id).push({assistant:c.id, created:c.created_at, missing, toolCalls:md.toolCalls.map(t=>({id:t.id,name:t.name}))});
    }
  }
}
console.log("全库孤儿总数:", total);
for (const [sid, arr] of bySession) {
  console.log(`\n=== session ${sid}  (${arr.length} 条孤儿) ===`);
  arr.forEach(o=>console.log(`  assistant=${o.assistant} created=${o.created_at} missing=${JSON.stringify(o.missing)} toolCalls=${JSON.stringify(o.toolCalls)}`));
}
