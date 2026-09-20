/**
 * 会话消息迁移 CLI（手动重迁入口）
 *
 * 常态迁移走启动期 bootstrap：SessionMessageMigrationBootstrapService
 * （marker `<sessions根>/.migrated-session-messages` 门控，失败下次启动重试）。
 * 本脚本只承担手动场景：--force 覆盖重迁（bootstrap 对已有会话恒为跳过）、
 * 指定会话局部重迁、--context-window 覆盖窗口。
 *
 * 迁移核心在 SessionMessageDbMigratorService（与 bootstrap 共用同一实现，
 * 事件映射/锚点/压缩记录/meta 修复口径完全一致）。
 *
 * 用法（指定要迁移的会话，先用少量测试）：
 *   npx ts-node src/scripts/migrate-messages.ts --sessions=<sessionId1>,<sessionId2>
 *   npx ts-node src/scripts/migrate-messages.ts --sessions=<sessionId> --force
 *   npx ts-node src/scripts/migrate-messages.ts --all --force
 *   # 不带 --sessions/--all 时：列出所有有消息的会话，需手动指定（防误迁移全部）
 *   # 可选 --context-window=N 覆盖有效窗口（缺省读 model.config.contextWindow，兜底 128000）
 *
 * 真实数据目录（GUADA_DEV_DATA）示例：
 *   DB:      C:\Users\<user>\.guada-dev\data\ai_chat.db
 *   sessions: C:\Users\<user>\.guada-dev\sessions
 *   SESSION_DATA_DIR 需指向 .guada-dev 根（backend 会再拼 sessions/）
 *
 * ⚠️ 只读 DB、只写文件，不删除原数据库数据（可回滚/重新迁移）。
 */

// 在 Electron 生产环境中确保加载正确的原生模块
if (process.env.NODE_MODULES_PATH) {
  const Module = require("module");
  Module.globalPaths.unshift(process.env.NODE_MODULES_PATH);
}

import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { JsonlBackend } from "../common/persistence/jsonl-backend";
import { MetadataBootstrapGate } from "../common/database/metadata-bootstrap.gate";
import { SessionMessageDbMigratorService } from "../common/database/bootstrap/session-message-db-migrator.service";

const databaseUrl = process.env.DATABASE_URL || "file:./data/ai_chat.db";
const adapter = new PrismaBetterSqlite3({ url: databaseUrl });
const prisma = new PrismaClient({ adapter });
const backend = new JsonlBackend();
// migrator 内部自持 _meta.db 连接（仅 meta 骨架修复用）与 JSONL 后端
const migrator = new SessionMessageDbMigratorService(
  prisma as any,
  backend,
  new MetadataBootstrapGate(),
);

// ─── 参数解析 ───

function parseArgs(): {
  sessions?: string[];
  force: boolean;
  all: boolean;
  contextWindow?: number;
} {
  const args = process.argv.slice(2);
  const sessionsArg = args.find((a) => a.startsWith("--sessions="));
  const contextWindowArg = args.find((a) => a.startsWith("--context-window="));
  const force = args.includes("--force");
  const all = args.includes("--all");
  const sessions = sessionsArg
    ? sessionsArg.split("=")[1].split(",").filter(Boolean)
    : undefined;
  const contextWindow = contextWindowArg
    ? Number(contextWindowArg.split("=")[1])
    : undefined;
  return {
    sessions,
    force,
    all,
    ...(Number.isFinite(contextWindow) ? { contextWindow } : {}),
  };
}

// ─── 主流程 ───

async function main() {
  const { sessions, force, all, contextWindow } = parseArgs();

  if (sessions && sessions.length > 0) {
    console.log(`迁移 ${sessions.length} 个指定会话...\n`);
    for (const sid of sessions) {
      try {
        const r = await migrator.migrateSession(sid, {
          force,
          ...(contextWindow !== undefined ? { contextWindowOverride: contextWindow } : {}),
        });
        console.log(
          `  ✅ ${sid}: 迁移 ${r.migrated}，跳过(已有) ${r.skipped}，meta 修复 ${r.metaRepaired}`,
        );
      } catch (e: any) {
        console.error(`  ❌ 会话 ${sid} 迁移失败: ${e?.message}`);
      }
    }
  } else if (all) {
    const candidates = await migrator.listSessionsWithMessages();
    console.log(`全量迁移 ${candidates.length} 个有消息的会话...\n`);
    const result = await migrator.migrateAll({
      force,
      ...(contextWindow !== undefined ? { contextWindowOverride: contextWindow } : {}),
    });
    console.log(
      `\n全量迁移完成: 新迁 ${result.migrated}, 跳过(已有) ${result.skipped}, ` +
        `meta 修复 ${result.metaRepaired}, 失败 ${result.failed}`,
    );
    if (result.failed > 0) process.exitCode = 1;
  } else {
    // 未指定 → 列出候选，要求显式指定（防误迁移）
    const candidates = await migrator.listSessionsWithMessages();
    console.log("未指定 --sessions/--all，列出所有有消息的会话：\n");
    for (const c of candidates.slice(0, 30)) {
      console.log(`  ${c.id}  (${c.count} 条消息) ${c.title || ""}`);
    }
    console.log(`\n共 ${candidates.length} 个有消息的会话。`);
    console.log("请用 --sessions=<id1>,<id2> 指定，或 --all 全量迁移。");
    console.log("例：npx ts-node src/scripts/migrate-messages.ts --sessions=xxx,yyy");
    console.log("    npx ts-node src/scripts/migrate-messages.ts --all --force");
    console.log(
      "    可选 --context-window=N 覆盖有效窗口（缺省读 model.config.contextWindow，兜底 128000）",
    );
  }
}

main()
  .catch((e) => {
    console.error("FATAL:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
