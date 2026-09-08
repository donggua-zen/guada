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
    db.exec(sql);
  },
};
