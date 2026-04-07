import Database from 'better-sqlite3';
import * as path from 'path';

const dbPath = path.join(process.cwd(), 'data', 'vector_db.sqlite');
const db = new Database(dbPath);

// 假设我们要测试的知识库表名
const kbId = 'cmnmuac280001hhywsy64y8ng';
const tableName = `kb_${kbId}`;
const ftsTableName = `${tableName}_fts`;

console.log(`🔍 正在检查知识库: ${kbId}`);

try {
  // 1. 检查 FTS 表是否存在
  const tableExists = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(ftsTableName);
  if (!tableExists) {
    console.error(`❌ FTS 表不存在: ${ftsTableName}`);
    process.exit(1);
  }
  console.log(`✅ FTS 表存在: ${ftsTableName}`);

  // 2. 检查 FTS 表中的总记录数
  const count = db.prepare(`SELECT COUNT(*) as c FROM "${ftsTableName}"`).get() as any;
  console.log(`📊 FTS 表总记录数: ${count.c}`);

  // 3. 尝试直接搜索关键词
  const keyword = 'DV430FBM';
  console.log(`\n🔎 正在搜索关键词: "${keyword}"`);
  
  // 尝试不同的查询方式
  const queries = [
    `"${keyword}"*`,
    `${keyword}`,
    `"${keyword}"`
  ];

  for (const q of queries) {
    console.log(`\n--- 测试查询: ${q} ---`);
    try {
      const sql = `
        SELECT fts.rowid, main.id, bm25("${ftsTableName}") as score
        FROM "${ftsTableName}" AS fts
        JOIN "${tableName}" AS main ON fts.rowid = main.rowid
        WHERE "${ftsTableName}" MATCH ?
        LIMIT 5
      `;
      const rows = db.prepare(sql).all(q) as any[];
      console.log(`找到 ${rows.length} 条结果:`);
      rows.forEach(r => {
        console.log(`  ID: ${r.id}, RowID: ${r.rowid}, BM25 Score: ${r.score}`);
      });
    } catch (e: any) {
      console.error(`查询失败: ${e.message}`);
    }
  }

  // 4. 随机抽取几条数据看看内容
  console.log(`\n📄 随机抽取 3 条主表内容预览:`);
  const samples = db.prepare(`SELECT id, content FROM "${tableName}" LIMIT 3`).all() as any[];
  samples.forEach(s => {
    const hasKeyword = s.content.includes(keyword);
    console.log(`  ID: ${s.id}, 包含关键词 "${keyword}": ${hasKeyword}`);
    console.log(`  内容片段: ${s.content.substring(0, 100)}...`);
  });

} catch (error: any) {
  console.error('❌ 脚本执行出错:', error.message);
} finally {
  db.close();
}
