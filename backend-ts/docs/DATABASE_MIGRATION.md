# 数据库迁移规范

> 本文档定义了 GuaDa 项目的数据库迁移开发规范。所有涉及数据库结构或数据变更的操作必须遵循此规范。

## 1. 架构概览

```
NestJS OnModuleInit (Electron / Docker / Web 通用)
  └→ MigrationRunner
       ├→ 全新安装（无业务表）:
       │    执行 baseline.sql（最新 schema）+ seed-data.ts（最新数据）
       │    → 标记所有迁移为已应用 → 一步到位
       ├→ 0.5.2 旧版升级（有业务表无记录）:
       │    标记所有迁移为已应用 → 仅执行后续新增迁移
       └→ 已迁移版本升级:
            WAL checkpoint + 备份 → 按 id 顺序执行 pending 迁移
```

**核心原则**：
- **baseline.sql 和 seed-data.ts 始终代表最新完整快照** — 全新安装一步到位，不走迁移链
- 增量迁移（0002, 0003, ...）仅用于老用户升级
- 运行时 **零 Prisma CLI 依赖**，使用 `better-sqlite3` 直接执行 DDL
- 迁移在 `app.listen()` **之前**执行，确保后端启动时 schema 已就绪
- Electron / Docker / Web 三端共用同一套迁移逻辑

## 2. 文件结构

```
backend-ts/src/common/database/
├── migration.interface.ts          # Migration 接口定义
├── migration-runner.service.ts     # 迁移运行器（自动执行）
├── database.module.ts              # 注册 MigrationRunner
└── migrations/
    ├── index.ts                     # 迁移注册表（唯一入口）
    ├── 0001_baseline.ts             # 基线迁移
    ├── 0001_baseline.sql            # 基线 DDL（prisma migrate diff 生成）
    └── seed-data.ts                 # 默认数据创建逻辑
```

## 3. Migration 接口

```typescript
interface Migration {
  id: number;        // 全局唯一且递增（1, 2, 3, ...）
  name: string;      // snake_case 名称，存入 _app_migrations 表
  description: string; // 描述，仅用于日志
  up: (db: Database.Database, prisma: PrismaClientLike) => Promise<void>;
  down?: (db: Database.Database, prisma: PrismaClientLike) => Promise<void>;
}
```

- `db`：better-sqlite3 实例（同步 API），用于执行 DDL 和原始 SQL
- `prisma`：PrismaClient 实例（异步 API），用于类型安全的数据 CRUD
- `down`：可选的回滚逻辑。提供后可通过 `npm run db:rollback` 程序化降级

## 4. 迁移类型与编写方式

### 4.1 纯结构变更（DDL）

最常见的场景：加列、改类型、加索引等。

**步骤**：

```bash
# 1. 修改 prisma/schema.prisma

# 2. 一键生成（增量迁移 + baseline 一起更新）
cd backend-ts
npm run db:migrate:gen -- --name add_user_avatar

# 3. 在 migrations/index.ts 注册（脚本会提示）
```

> `db:migrate:gen` 同时完成两件事：
> - 生成增量迁移 SQL + TS 模板（给老用户升级）
> - 重新生成 baseline.sql（给全新安装）

生成的文件：

```typescript
// 0002_add_user_avatar.ts
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import type { Migration } from "../migration.interface";

export const addUserAvatarMigration: Migration = {
  id: 2,
  name: "add_user_avatar",
  description: "add_user_avatar",

  up: async (db) => {
    const sqlPath = resolve(dirname(__filename), "0002_add_user_avatar.sql");
    const sql = readFileSync(sqlPath, "utf-8");
    db.exec(sql);
  },

  // 可选：回滚逻辑（删列）
  down: async (db) => {
    db.exec(`ALTER TABLE "user" DROP COLUMN "avatar_url";`);
  },
};
```

### 4.2 纯数据迁移

需要修改已有数据但不改表结构。

```typescript
// 0003_cleanup_orphan_files.ts
import type { Migration } from "../migration.interface";

export const cleanupOrphanFilesMigration: Migration = {
  id: 3,
  name: "cleanup_orphan_files",
  description: "清理孤立的文件记录",

  up: async (db, prisma) => {
    await prisma.file.deleteMany({
      where: { contentId: null, sessionId: null },
    });
  },

  // 纯数据迁移通常不可逆，不提供 down
};
```

### 4.3 混合迁移（DDL + 数据）

先改结构，再迁移数据。

```typescript
// 0004_add_status_column_and_migrate.ts
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import type { Migration } from "../migration.interface";

export const addStatusColumnMigration: Migration = {
  id: 4,
  name: "add_status_column_and_migrate",
  description: "添加 status 列并迁移已有数据",

  up: async (db, prisma) => {
    // 1. DDL：添加列
    const sqlPath = resolve(dirname(__filename), "0004_add_status_column_and_migrate.sql");
    const sql = readFileSync(sqlPath, "utf-8");
    db.exec(sql);

    // 2. 数据迁移：设置默认值
    await prisma.session.updateMany({
      where: { status: null },
      data: { status: "active" },
    });
  },
};
```

## 5. 注册迁移

**每次新增迁移，必须**在 `migrations/index.ts` 中注册：

```typescript
import { baselineMigration } from "./0001_baseline";
import { addUserAvatarMigration } from "./0002_add_user_avatar";
import { cleanupOrphanFilesMigration } from "./0003_cleanup_orphan_files";

export const allMigrations: Migration[] = [
  baselineMigration,
  addUserAvatarMigration,
  cleanupOrphanFilesMigration,
  // ← 在此追加新迁移
];
```

**不注册的迁移不会执行。**

## 6. 迁移 ID 规则

- `id` 从 `1` 开始，**全局唯一且递增**
- 文件名格式：`NNNN_snake_case_name`（NNNN 为 4 位补零 id）
- 新迁移的 id = `allMigrations` 中最大 id + 1
- **不允许**插入到中间位置或修改已有迁移的 id

## 7. 向后兼容

| 场景 | 检测条件 | 行为 |
|------|---------|------|
| 全新安装 | 无 `session` 表 + 无 `_app_migrations` 记录 | 执行 baseline（最新 schema + seed），标记所有迁移为已应用 |
| 0.5.2 旧版升级 | 有 `session` 表但无 `_app_migrations` 记录 | 标记所有已注册迁移为已应用，仅执行后续新迁移 |
| 已迁移版本升级 | `_app_migrations` 有记录 | 仅执行 pending 迁移 |

**不支持 < 0.5.2 的直接升级**，必须先升级到 0.5.2。

> **为什么全新安装不走路迁移链？**
> baseline.sql 每次发布时重新生成，始终代表最新完整 schema。seed-data.ts 同步更新为最新默认数据。因此新安装一步到位，增量迁移只服务老用户。

## 8. 备份策略

- 迁移执行前自动 WAL checkpoint + 备份 DB 文件
- 保留最近 **3 份**备份，自动清理更旧的
- 备份文件命名：`ai_chat.db.bak.2026-08-09T12-00-00.000Z`
- 旧版引导（bootstrap）跳过备份（因为不执行实际迁移）
- 回滚操作同样会先备份

## 9. 降级与回滚

### 9.1 程序化回滚（推荐，需迁移提供 `down`）

当迁移提供了 `down` 方法时，可通过命令行回滚：

```bash
cd backend-ts

# 回滚最后 1 个迁移
npm run db:rollback

# 回滚最后 3 个迁移
npm run db:rollback -- --count 3
```

回滚流程：
1. 从 `_app_migrations` 表获取最新已应用迁移
2. 备份当前数据库
3. 逆序执行每个迁移的 `down` 方法
4. 从 `_app_migrations` 表删除对应记录

**注意**：回滚后必须使用旧版本代码启动应用，否则 MigrationRunner 会重新执行被回滚的迁移。

### 9.2 备份恢复（兜底，当 `down` 未提供时）

迁移未提供 `down` 方法时，程序化回滚不可用，需手动恢复备份：

```bash
# 1. 关闭应用
# 2. 找到备份文件（时间戳最新的）
ls ~/.guada/data/ai_chat.db.bak.*

# 3. 恢复备份
cp ~/.guada/data/ai_chat.db.bak.2026-08-09T12-00-00.000Z ~/.guada/data/ai_chat.db

# 4. 删除 WAL/SHM 文件（避免冲突）
rm -f ~/.guada/data/ai_chat.db-wal ~/.guada/data/ai_chat.db-shm

# 5. 使用旧版本代码启动应用
```

### 9.3 编写 `down` 的建议

| 迁移类型 | 是否提供 `down` | 说明 |
|---------|----------------|------|
| 加列（ADD COLUMN） | ✅ 推荐 | `ALTER TABLE ... DROP COLUMN` |
| 加索引 | ✅ 推荐 | `DROP INDEX` |
| 加表 | ✅ 推荐 | `DROP TABLE` |
| 删列/删表 | ⚠️ 谨慎 | 数据已丢失，down 无法恢复数据 |
| 数据迁移（UPDATE/DELETE） | ❌ 通常不提供 | 被删除/修改的数据无法恢复 |
| 复杂结构重组 | ❌ 不提供 | 依赖备份恢复 |

> SQLite 限制：SQLite 3.35+ 支持 `DROP COLUMN`。若需兼容更旧版本，使用「创建新表→复制数据→删旧表→重命名」模式。

## 10. 禁止事项

| 禁止 | 原因 | 正确做法 |
|------|------|---------|
| `prisma db push` | dev-only 工具，不追踪历史，可静默丢数据 | 编写 Migration |
| `prisma migrate deploy` | 运行时依赖 Prisma CLI，ABI 脆弱 | MigrationRunner 自动执行 |
| 修改已发布的迁移文件 | 已应用的迁移被改动会导致状态不一致 | 新写一个迁移来修正 |
| 在迁移中使用应用层 Service | 迁移应自包含，不依赖业务逻辑 | 直接使用 `db` / `prisma` |
| 在 `schema.prisma` 改动后不生成迁移 | Prisma Client 与实际 DB schema 不一致 | 运行 `db:migrate:gen` |
| schema 变更后不重新生成 baseline.sql | 全新安装走旧 schema + 迁移链，性能差且可能出错 | `db:migrate:gen` 已自动处理 |

## 11. 开发环境重置数据库

```bash
cd backend-ts
npm run db:seed --force
```

此命令会：删除旧 DB 文件 → 执行 baseline SQL → 创建默认数据。

**不要**在生产环境使用此命令。

## 12. 重新生成基线 SQL

`db:migrate:gen` 已自动重新生成 baseline.sql，通常不需要手动执行。

如需单独重新生成（如手动修改了 schema.prisma 但不需要增量迁移）：

```bash
cd backend-ts
npm run db:generate-baseline
```

此命令执行 `prisma migrate diff --from-empty --to-schema`，生成完整建表 SQL，覆盖 `0001_baseline.sql`。

| 文件 | 作用 | 更新时机 |
|------|------|---------|
| `0001_baseline.sql` | 全新安装创建最新 schema | **每次 schema 变更后必须重新生成** |
| `seed-data.ts` | 全新安装创建默认数据 | 默认数据有变化时手动更新 |

> baseline.sql 仅影响全新安装，不影响已安装用户。已安装用户的升级通过增量迁移完成。

## 13. 调试迁移

### 查看已应用的迁移

```sql
SELECT * FROM _app_migrations ORDER BY id;
```

### 手动标记迁移为已应用（调试用）

```sql
INSERT INTO _app_migrations (id, name) VALUES (5, 'some_migration');
```

### 查看迁移日志

迁移日志输出在 NestJS 日志中，搜索 `MigrationRunner`：

```
[MigrationRunner] 检测到 2 个待执行迁移
[MigrationRunner] 执行迁移 2: add_user_avatar — add_user_avatar
[MigrationRunner] 迁移 2: add_user_avatar 完成
[MigrationRunner] 数据库迁移完成，共执行 2 个迁移
```

## 14. 快速参考

| 操作 | 命令 |
|------|------|
| 生成迁移（增量 + baseline） | `npm run db:migrate:gen -- --name xxx` |
| 单独重新生成 baseline | `npm run db:generate-baseline` |
| 回滚迁移 | `npm run db:rollback [-- --count N]` |
| 重置开发数据库 | `npm run db:seed --force` |
| 生成 Prisma Client | `npx prisma generate` |
| 检查 TypeScript 编译 | `npx tsc --noEmit` |
