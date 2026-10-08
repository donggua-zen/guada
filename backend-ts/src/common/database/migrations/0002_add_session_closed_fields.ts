import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import type { Migration } from "../migration.interface";

export const addSessionClosedFieldsMigration: Migration = {
  id: 2,
  name: "add_session_closed_fields",
  description: "session 加 closed_at/close_reason 冻结标记（子代理结束后不删会话，仅供回放）",

  up: async (db) => {
    const sqlPath = resolve(dirname(__filename), "0002_add_session_closed_fields.sql");
    const sql = readFileSync(sqlPath, "utf-8");

    // 幂等：旧库升级路径会先把 schema 增量对齐到 baseline（closed_at 可能已被补上），
    // 且迁移是「先执行、后写记录」——记录写入失败后的重跑也会再进这里。
    // 逐条按列存在性过滤，避免 duplicate column name 卡住启动。
    const existing = new Set(
      (
        db.prepare(`PRAGMA table_info("session")`).all() as Array<{ name: string }>
      ).map((c) => c.name),
    );
    const statements = sql
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("--"))
      .join("\n")
      .split(";")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    for (const statement of statements) {
      const addColumn = /^ALTER\s+TABLE\s+"?(\w+)"?\s+ADD\s+COLUMN\s+"?(\w+)"?/i.exec(
        statement,
      );
      if (addColumn && existing.has(addColumn[2])) continue;
      db.exec(statement);
      if (addColumn) existing.add(addColumn[2]);
    }
  },
};
