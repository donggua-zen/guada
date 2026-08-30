const Database = require("D:/AI/ai_chat/backend-ts/node_modules/better-sqlite3");
const fs = require("fs");

const DB = "C:/Users/22071/.guada/data/ai_chat.db";
const db = new Database(DB); // 读写以正确含 WAL
const SESSION = "cmsug90mq00ym0gkzhhp5dh4t";
const ORPHAN_CONTENT = "cmsyqde1l003jtkkz253xeauc";
const OUT = "D:/AI/ai_chat/snapshot_cmsug_messages.json";

// 1) 该会话 message 表（原始）
const messages = db.prepare(
  "SELECT * FROM message WHERE session_id=? ORDER BY created_at, id"
).all(SESSION);

// 2) 所有 message_content，按 (message created_at, content created_at, content id) 排序，
//    尽量贴近真实推进顺序
const msgTime = new Map(messages.map(m => [m.id, m.created_at]));
const contents = db.prepare(`
  SELECT mc.* FROM message_content mc
  JOIN message m ON m.id=mc.message_id WHERE m.session_id=?
`).all(SESSION);
contents.sort((a, b) => {
  const ta = msgTime.get(a.message_id) || a.created_at;
  const tb = msgTime.get(b.message_id) || b.created_at;
  if (ta !== tb) return ta < tb ? -1 : 1;
  if (a.created_at !== b.created_at) return a.created_at < b.created_at ? -1 : 1;
  return a.id < b.id ? -1 : 1;
});

const idx = contents.findIndex(c => c.id === ORPHAN_CONTENT);
console.log("孤儿索引:", idx, "总条数:", contents.length);
const from = Math.max(0, idx - 10);
const slice = contents.slice(from);

// 组装快照：附上所属 message 基本信息
const msgById = new Map(messages.map(m => [m.id, m]));
const snap = {
  sessionId: SESSION,
  orphan: ORPHAN_CONTENT,
  generatedAt: new Date().toISOString(),
  note: "从孤儿往前10条到今天最新；message独立列出，message_content完整保留",
  summary: {
    totalMessages: messages.length,
    snapshotContents: slice.length,
    fromIndex: from,
    orphanIndex: idx,
  },
  messages: messages.map(m => ({
    id: m.id,
    session_id: m.session_id,
    role: m.role,
    parent_id: m.parent_id,
    current_turns_id: m.current_turns_id,
    current_version_id: m.current_version_id,
    meta_data: m.meta_data,
    created_at: m.created_at,
    updated_at: m.updated_at,
    total_duration_ms: m.total_duration_ms,
  })),
  messageContents: slice.map(c => ({
    id: c.id,
    message_id: c.message_id,
    message_role: msgById.get(c.message_id)?.role || null,
    turns_id: c.turns_id,
    role: c.role,
    content: c.content,
    reasoning_content: c.reasoning_content,
    additional_kwargs: c.additional_kwargs,
    meta_data: c.meta_data,
    created_at: c.created_at,
    updated_at: c.updated_at,
  })),
};

fs.writeFileSync(OUT, JSON.stringify(snap, null, 2), "utf-8");
console.log("快照已导出:", OUT);
console.log("快照内容条数:", slice.length);
