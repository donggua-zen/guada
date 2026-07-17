/**
 * 导出指定会话的全部历史数据为本地 JSON 文件
 *
 * 用法:
 *   npx ts-node scripts/export-session.ts <sessionId> [db-path]
 *   npx ts-node scripts/export-session.ts cmqsvvzdk0004q0kzrtdhxps4
 *   npx ts-node scripts/export-session.ts cmqsvvzdk0004q0kzrtdhxps4 ~/.guada/data/ai_chat.db
 *
 * 输出: scripts/data/session-<sessionId>.json
 *
 * 数据库路径优先级:
 *   1. 命令行第二个参数（绝对或相对路径）
 *   2. DATABASE_URL 环境变量
 *   3. 默认 ./data/ai_chat.db（本项目开发库）
 */

import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// ── 数据库连接 ───────────────────────────────────────────────

function resolveDbPath(): string {
  // 1. 命令行参数优先
  const cliPath = process.argv[3];
  if (cliPath) {
    // 展开 ~ 为用户目录
    if (cliPath.startsWith("~")) {
      return path.resolve(os.homedir(), cliPath.slice(1));
    }
    return path.resolve(cliPath);
  }

  // 2. 环境变量
  const envUrl = process.env.DATABASE_URL;
  if (envUrl) {
    // 支持 file:./xxx.db 和 file:/absolute/path 两种格式
    const match = envUrl.match(/^file:(.+\.db)/);
    if (match) {
      return path.resolve(match[1]);
    }
    return envUrl;
  }

  // 3. 默认
  return path.resolve(__dirname, "..", "data", "ai_chat.db");
}

const dbPath = resolveDbPath();
const Database = require("better-sqlite3");
const db = new Database(dbPath);

// 验证表结构
const tables = db
  .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
  .all()
  .map((t: any) => t.name);
if (!tables.includes("session")) {
  console.error(`❌ 数据库 ${dbPath} 中不存在 session 表`);
  console.error(`   现有表: ${tables.join(", ")}`);
  process.exit(1);
}

// ── 辅助函数 ─────────────────────────────────────────────────

const colors = {
  reset: "\x1b[0m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
};

function info(msg: string) {
  console.log(`${colors.blue}ℹ️  ${msg}${colors.reset}`);
}
function success(msg: string) {
  console.log(`${colors.green}${msg}${colors.reset}`);
}
function warn(msg: string) {
  console.log(`${colors.yellow}⚠️  ${msg}${colors.reset}`);
}
function error(msg: string) {
  console.log(`${colors.red}❌ ${msg}${colors.reset}`);
}

// ── 主逻辑 ───────────────────────────────────────────────────

async function main() {
  const sessionId = process.argv[2];
  if (!sessionId) {
    error("请提供会话 ID，例如：");
    error("  npx ts-node scripts/export-session.ts cmqsvvzdk0004q0kzrtdhxps4");
    process.exit(1);
  }

  info(`正在导出会话 ${sessionId}...`);

  info(`数据库: ${dbPath}`);

  // 1. 获取 Session（含 model + provider）
  const sessionRow = db
    .prepare("SELECT * FROM session WHERE id = ?")
    .get(sessionId) as any;

  if (!sessionRow) {
    error(`会话 ${sessionId} 不存在`);
    process.exit(1);
  }
  info(`会话标题: ${sessionRow.title || "(无标题)"}`);

  const modelRow = sessionRow.model_id
    ? (db.prepare("SELECT * FROM model WHERE id = ?").get(sessionRow.model_id) as any)
    : null;
  const providerRow = modelRow
    ? (db
        .prepare("SELECT * FROM model_provider WHERE id = ?")
        .get(modelRow.provider_id) as any)
    : null;
  const characterRow = sessionRow.character_id
    ? (db
        .prepare("SELECT * FROM character WHERE id = ?")
        .get(sessionRow.character_id) as any)
    : null;

  info(
    `模型: ${modelRow?.name || "N/A"} (${modelRow?.modelName || "N/A"})`,
  );

  // 2. 获取所有 Message（按时间正序）
  const messageRows = db
    .prepare(
      "SELECT * FROM message WHERE session_id = ? ORDER BY created_at ASC",
    )
    .all(sessionId) as any[];

  info(`消息数: ${messageRows.length}`);

  // 2b. 为每条 Message 获取对应的 Content
  const messagesWithContents = messageRows.map((m: any) => {
    const contents = db
      .prepare(
        "SELECT * FROM message_content WHERE message_id = ? ORDER BY created_at ASC",
      )
      .all(m.id) as any[];
    return { ...m, contents };
  });

  // 3. 获取压缩状态（最新的）
  const contextStateRow = db
    .prepare(
      "SELECT * FROM session_context_state WHERE session_id = ? ORDER BY created_at DESC LIMIT 1",
    )
    .get(sessionId) as any;

  if (contextStateRow) {
    info(
      `压缩状态: strategy=${contextStateRow.cleaningStrategy || "N/A"}, ` +
        `summaryLength=${contextStateRow.summaryContent?.length || 0}chars`,
    );
  } else {
    warn("无压缩状态记录");
  }

  // 4. 组装导出数据
  const exportData = {
    exportedAt: new Date().toISOString(),
    sessionId,
    session: {
      id: sessionRow.id,
      title: sessionRow.title,
      userId: sessionRow.user_id,
      settings: safeJson(sessionRow.settings),
      createdAt: sessionRow.created_at,
      updatedAt: sessionRow.updated_at,
      lastActiveAt: sessionRow.last_active_at,
      sessionType: sessionRow.session_type,
      workspacePath: sessionRow.workspace_path,
      model: modelRow
        ? {
            id: modelRow.id,
            name: modelRow.name,
            modelName: modelRow.model_name,
            modelType: modelRow.model_type,
            config: safeJson(modelRow.config),
            provider: providerRow
              ? {
                  id: providerRow.id,
                  provider: providerRow.provider,
                  protocol: providerRow.protocol,
                  apiUrl: providerRow.api_url,
                  apiKey: providerRow.api_key
                    ? "***masked***"
                    : undefined,
                  headers: safeJson(providerRow.headers),
                  config: safeJson(providerRow.config),
                }
              : null,
          }
        : null,
      character: characterRow
        ? {
            id: characterRow.id,
            name: characterRow.name,
            settings: safeJson(characterRow.settings),
          }
        : null,
    },
    messages: messagesWithContents.map((m: any) => ({
      id: m.id,
      role: m.role,
      parentId: m.parent_id,
      currentTurnsId: m.current_turns_id,
      metadata: safeJson(m.meta_data),
      createdAt: m.created_at,
      contents: m.contents.map((c: any) => ({
        id: c.id,
        role: c.role,
        content: c.content,
        reasoningContent: c.reasoning_content,
        additionalKwargs: safeJson(c.additional_kwargs),
        metadata: safeJson(c.meta_data),
      })),
    })),
    compressionState: contextStateRow
      ? {
          summaryContent: contextStateRow.summary_content,
          lastCompactedMessageId: contextStateRow.last_compacted_message_id,
          lastCompactedContentId: contextStateRow.last_compacted_content_id,
          lastPrunedContentId: contextStateRow.last_pruned_content_id,
          cleaningStrategy: contextStateRow.cleaning_strategy,
          pruningMetadata: safeJson(contextStateRow.pruning_metadata),
          compressionStats: safeJson(contextStateRow.compression_stats),
          createdAt: contextStateRow.created_at,
        }
      : null,
  };

  // 5. 写入文件
  const outDir = path.resolve(__dirname, "data");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `session-${sessionId}.json`);
  fs.writeFileSync(outPath, JSON.stringify(exportData, null, 2), "utf-8");

  const fileStats = fs.statSync(outPath);
  success(`\n✅ 导出完成: ${outPath}`);
  info(`文件大小: ${(fileStats.size / 1024).toFixed(1)} KB`);
  info(`消息总数: ${messageRows.length}`);
  info(
    `Content 总数: ${messagesWithContents.reduce((s: number, m: any) => s + m.contents.length, 0)}`,
  );

  // 6. 打印会话基本配置摘要（供 compress-replay 参考）
  const model = exportData.session.model;
  if (model) {
    console.log(`\n${colors.cyan}── 模型/压缩配置摘要 ──${colors.reset}`);
    console.log(`  对话模型:       ${model.name} (${model.modelName})`);
    console.log(`  供应商:          ${model.provider?.provider || "N/A"}`);
    console.log(`  协议:            ${model.provider?.protocol || "N/A"}`);
    console.log(`  API URL:         ${model.provider?.apiUrl || "N/A"}`);
    console.log(
      `  Context Window:  ${model.config?.contextWindow || "N/A"}`,
    );
  }
}

function safeJson(val: any): any {
  if (!val) return null;
  if (typeof val === "string") {
    try {
      return JSON.parse(val);
    } catch {
      return val;
    }
  }
  return val;
}

main()
  .catch((e) => {
    error(`导出失败: ${e.message}`);
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.close());
