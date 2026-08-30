const Database = require("D:/AI/ai_chat/backend-ts/node_modules/better-sqlite3");
const db = new Database("C:/Users/22071/.guada/data/ai_chat.db");

const SINCE = "2026-08-18T00:00:00.000+00:00"; // 近一天都扫，重点看今天

// 1) tool 消息缺 toolCallId（含空串），近一天
console.log("=== 近一天内 tool 消息缺 toolCallId ===");
const badTools = db.prepare(`
  SELECT mc.id, mc.message_id, mc.meta_data, mc.content, mc.created_at, m.session_id
  FROM message_content mc
  JOIN message m ON m.id = mc.message_id
  WHERE mc.role='tool' AND mc.created_at >= ?
  ORDER BY mc.created_at DESC
`).all(SINCE);
let missingTool = badTools.filter(t => {
  let md={}; try{md=JSON.parse(t.meta_data||"{}");}catch(e){}
  return !md.toolCallId;
});
console.log(`tool msgs(近一天): ${badTools.length}, 缺 toolCallId: ${missingTool.length}`);
missingTool.forEach(t=>console.log(`  id=${t.id} session=${t.session_id} created=${t.created_at} content=${String(t.content).slice(0,60)}`));

// 2) 孤儿 assistant（toolCalls 无后续 tool 响应），近一天，按真实加载顺序
console.log("\n=== 近一天内孤儿 assistant toolCalls ===");
const contents = db.prepare(`
  SELECT mc.id, mc.message_id, mc.role, mc.meta_data, mc.created_at, m.session_id
  FROM message_content mc
  JOIN message m ON m.id = mc.message_id
  WHERE mc.created_at >= ? 
  ORDER BY mc.created_at, mc.id
`).all(SINCE);
const byMsg = new Map();
for (const c of contents) { if (!byMsg.has(c.message_id)) byMsg.set(c.message_id, []); byMsg.get(c.message_id).push(c); }
let orphanCount=0;
for (const [mid, l] of byMsg) {
  for (let i=0;i<l.length;i++){
    const c=l[i];
    if (c.role!=="assistant") continue;
    let md={}; try{md=JSON.parse(c.meta_data||"{}");}catch(e){}
    if (!Array.isArray(md.toolCalls)||md.toolCalls.length===0) continue;
    const callIds = md.toolCalls.map(t=>t.id); // 空 id 也算
    const toolIds = l.slice(i+1).filter(x=>x.role==="tool").map(t=>{try{return JSON.parse(t.meta_data||"{}").toolCallId;}catch(e){return null;}});
    const missing = callIds.filter(id=>!toolIds.includes(id));
    if (missing.length>0){
      orphanCount++;
      console.log(`[ORPHAN] assistant=${c.id} session=${c.session_id} created=${c.created_at} missing=${JSON.stringify(missing)}`);
      console.log(`   toolCalls=${JSON.stringify(md.toolCalls.map(t=>({id:t.id,name:t.name})))} nextRoles=${l.slice(i+1,i+2).map(x=>x.role).join(",")||'(无)'}`);
    }
  }
}
console.log("孤儿数量(近一天):", orphanCount);
