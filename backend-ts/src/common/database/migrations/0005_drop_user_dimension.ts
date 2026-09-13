import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import type { Migration } from "../migration.interface";

export const dropUserDimensionMigration: Migration = {
  id: 5,
  name: "drop_user_dimension",
  description:
    "移除 userId 数据维度（单账户模型）：mcp_server.user_id 与 file.upload_user_id",

  up: async (db) => {
    const sqlPath = resolve(
      dirname(__filename),
      "0005_drop_user_dimension.sql",
    );
    const sql = readFileSync(sqlPath, "utf-8");
    db.exec(sql);
  },
  // 无 down：恢复 userId 维度需要为每行重新指派用户，语义上不可逆；
  // 回滚依赖迁移前自动备份（.bak.*）与保留的 user/user_setting 快照表
};
