const Database = require("D:/AI/ai_chat/backend-ts/node_modules/better-sqlite3");
const db = new Database("C:/Users/22071/.guada/data/ai_chat.db", { readonly: true });

const SESSION = "cmsug90mq00ym0gkzhhp5dh4t";

// 直接看 cmsyqde1l 所在 message 的顺序
const msgId = "cmsyq8fuu002ztkkz18wvgn7q";
const list = db.prepare("SELECT id, role, meta_data, created_at, content FROM message_content WHERE message_id=? ORDER BY created_at, id").all(msgId);
console.log("message cmsyq8fu contents:", list.length);
list.forEach((c, i) => {
  let md={}; try{md=JSON.parse(c.meta_data||"{}");}catch(e){}
  const tag = c.role==="assistant" && Array.isArray(md.toolCalls) ? ` toolCalls=[${md.toolCalls.map(t=>`${t.id}(${t.name})`).join(",")}]` : "";
  const tcid = md.toolCallId ? ` toolCallId=${md.toolCallId}` : "";
  console.log(`[${i}] ${c.id} role=${c.role} created=${c.created_at}${tag}${tcid} content=${String(c.content).slice(0,40)}`);
});

console.log("---- 全会话孤儿扫描（含空id）----");
const contents = db.prepare(`
  SELECT mc.id, mc.message_id, mc.role, mc.meta_data, mc.created_at, mc.content
  FROM message_content mc
  WHERE mc.message_id IN (SELECT id FROM message WHERE session_id=?)
  ORDER BY mc.created_at, mc.id
`).all(SESSION);
const byMsg = new Map();
for (const c of contents) { if (!byMsg.has(c.message_id)) byMsg.set(c.message_id, []); byMsg.get(c.message_id).push(c); }

let orphanCount = 0;
for (const [mid, l] of byMsg) {
  for (let i = 0; i < l.length; i++) {
    const c = l[i];
    if (c.role !== "assistant") continue;
    let md = {}; try { md = JSON.parse(c.meta_data || "{}"); } catch (e) {}
    if (!Array.isArray(md.toolCalls) || md.toolCalls.length === 0) continue;
    // 需要匹配的 callId：保留空 id 也要（"" 也算一个需要响应的 tool_call）
    const callIds = md.toolCalls.map(t => t.id); // 不 filter
    const followingTools = l.slice(i + 1).filter(x => x.role === "tool");
    const toolIds = followingTools.map(t => { try { return JSON.parse(t.meta_data||"{}").toolCallId; } catch(e){ return null; } });
    const missing = callIds.filter(id => !toolIds.includes(id));
    if (missing.length > 0) {
      orphanCount++;
      console.log(`[ORPHAN] assistant=${c.id} msgId=${mid} created=${c.created_at} missing=${JSON.stringify(missing)}`);
      console.log(`  next roles:`, l.slice(i+1, i+3).map(x=>x.role+":"+x.id).join(" | "));
    }
  }
}
console.log("孤儿数量(含空id):", orphanCount);
