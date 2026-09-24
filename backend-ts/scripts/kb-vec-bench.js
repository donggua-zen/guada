/**
 * vec0 索引 vs 全表扫描：真实规模性能对比
 *
 * 目的：量化「P0 向量检索没有索引」的改造收益。
 * 用法：node outputs/kb-vec-bench.js [chunks] [dim]
 */
const Database = require("better-sqlite3");
const sqliteVec = require("sqlite-vec");

const N = Number(process.argv[2] || 20000);
const DIM = Number(process.argv[3] || 1024);
const QUERIES = 20;

const db = new Database(":memory:");
sqliteVec.load(db);
db.exec("PRAGMA journal_mode = MEMORY");

// 与 kb-schema.ts 一致的最小表结构
db.exec(`
CREATE TABLE chunk (
  id TEXT PRIMARY KEY, item_id TEXT NOT NULL, chunk_index INTEGER NOT NULL,
  content TEXT NOT NULL, token_count INTEGER NOT NULL DEFAULT 0,
  embedding BLOB, embedding_dimensions INTEGER, metadata_json TEXT, created_at TEXT NOT NULL
);
`);

function unit(seed) {
  let x = seed >>> 0;
  const out = new Float32Array(DIM);
  let norm = 0;
  for (let i = 0; i < DIM; i++) {
    x = (Math.imul(x, 1103515245) + 12345) >>> 0;
    const v = (x / 4294967296) * 2 - 1;
    out[i] = v;
    norm += v * v;
  }
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < DIM; i++) out[i] /= norm;
  return out;
}

console.log(`规模：${N} 条分块 × ${DIM} 维（向量数据 ${((N * DIM * 4) / 1024 / 1024).toFixed(0)} MB）`);
console.log("");

// ---- 灌数据（模拟 replaceChunks 的双写）----
const insChunk = db.prepare(
  `INSERT INTO chunk (id,item_id,chunk_index,content,token_count,embedding,embedding_dimensions,metadata_json,created_at)
   VALUES (?,?,?,?,?,?,?,?,?)`,
);
const t0 = Date.now();
db.exec(`CREATE VIRTUAL TABLE chunk_vec USING vec0(embedding float[${DIM}] distance_metric=cosine)`);
const insVec = db.prepare(`INSERT INTO chunk_vec(rowid, embedding) VALUES (?, ?)`);
db.transaction(() => {
  for (let i = 1; i <= N; i++) {
    const v = unit(i * 7919);
    const buf = Buffer.from(v.buffer.slice(0));
    insChunk.run(`c${i}`, `f${i % 500}`, i, `内容片段 ${i}`, 10, buf, DIM, "{}", "2026-01-01T00:00:00.000Z");
    insVec.run(BigInt(i), buf);
  }
})();
console.log(`写入 ${N} 条（chunk + chunk_vec 双写）：${Date.now() - t0} ms`);

// ---- 对比两种召回 ----
const scanStmt = db.prepare(`
  SELECT * FROM (
    SELECT id, item_id, content, metadata_json,
           vec_distance_cosine(embedding, ?) as distance
    FROM chunk
    WHERE embedding IS NOT NULL AND LENGTH(embedding) = ?
  ) WHERE distance IS NOT NULL
  ORDER BY distance ASC LIMIT ?
`);
const knnStmt = db.prepare(
  `SELECT rowid, distance FROM chunk_vec WHERE embedding MATCH ? AND k = ?`,
);

function bench(label, fn) {
  // 预热
  for (let i = 0; i < 3; i++) fn(unit(i + 1));
  const times = [];
  for (let q = 0; q < QUERIES; q++) {
    const qv = unit(q * 104729 + 13);
    const s = process.hrtime.bigint();
    fn(qv);
    times.push(Number(process.hrtime.bigint() - s) / 1e6);
  }
  times.sort((a, b) => a - b);
  const avg = times.reduce((s, v) => s + v, 0) / times.length;
  const p50 = times[Math.floor(times.length / 2)];
  const max = times[times.length - 1];
  console.log(
    `${label.padEnd(26)} avg=${avg.toFixed(1).padStart(8)} ms  p50=${p50.toFixed(1).padStart(8)} ms  max=${max.toFixed(1).padStart(8)} ms`,
  );
  return avg;
}

console.log("");
const scanAvg = bench("全表扫描（改造前）", (qv) => {
  const buf = Buffer.from(new Float32Array(qv).buffer);
  return scanStmt.all(buf, DIM * 4, 20);
});
const knnAvg = bench("vec0 KNN（改造后）", (qv) => {
  const buf = Buffer.from(new Float32Array(qv).buffer);
  return knnStmt.all(buf, 20);
});

console.log("");
console.log(`加速比：${(scanAvg / knnAvg).toFixed(1)}x`);
console.log(
  `注意：全表扫描是 better-sqlite3 同步调用，这段时间 Node 事件循环被完全占住；` +
    `KNN 则短到基本不影响其他请求。`,
);
