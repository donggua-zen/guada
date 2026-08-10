import type { Migration } from "../migration.interface";
import { baselineMigration } from "./0001_baseline";

/**
 * 迁移注册表
 *
 * 新增迁移时：
 * 1. 创建 `NNNN_name.ts` 文件（纯 DDL 迁移可仅引用同名 .sql 文件）
 * 2. 在此数组中追加导入
 * 3. id 必须全局唯一且递增
 *
 * 开发者工作流：
 *   纯结构变更：修改 schema.prisma → npm run db:migrate:gen -- --name xxx
 *     → 自动生成 NNNN_xxx.sql（prisma migrate diff）
 *     → 手动创建 NNNN_xxx.ts 引用该 SQL 文件
 *   数据迁移：创建 NNNN_xxx.ts，实现 up(db, prisma) 接口
 */
export const allMigrations: Migration[] = [
  baselineMigration,
  // 在此追加新迁移...
];
