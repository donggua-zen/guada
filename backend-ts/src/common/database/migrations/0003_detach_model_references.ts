import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import type { Migration } from "../migration.interface";

export const detachModelReferencesMigration: Migration = {
  id: 3,
  name: "detach_model_references",
  description:
    "解除 session/character/knowledge_base 对 model 表的外键（模型引用改由 providers/*.yaml 解析）",

  up: async (db) => {
    const sqlPath = resolve(dirname(__filename), "0003_detach_model_references.sql");
    const sql = readFileSync(sqlPath, "utf-8");
    db.exec(sql);
  },
  // 无 down：重建回带外键的形态需要 model 行存在（且该表上线前删除），
  // 回滚依赖迁移前自动备份（.bak.*）
};
