import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import type { Migration } from "../migration.interface";

export const detachCharacterReferencesMigration: Migration = {
  id: 4,
  name: "detach_character_references",
  description:
    "解除 session 对 character 表的外键（角色定义改由 agents/<id>/AGENT.md 解析）",

  up: async (db) => {
    const sqlPath = resolve(
      dirname(__filename),
      "0004_detach_character_references.sql",
    );
    const sql = readFileSync(sqlPath, "utf-8");
    db.exec(sql);
  },
  // 无 down：重建回带外键的形态需要 character 行包含文件侧 id（且该表上线前删除），
  // 回滚依赖迁移前自动备份（.bak.*）
};
