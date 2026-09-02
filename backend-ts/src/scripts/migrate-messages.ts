/**
 * 数据迁移脚本：SQLite Message/MessageContent → JSONL 事件（新事件模型）
 *
 * 用途：把老会话的对话记录从数据库转换为 JSONL 事件日志。
 * 注意：只读 DB、只写 JSONL，**不删除原数据库数据**（可回滚/重新迁移）。
 *
 * 用法（指定要迁移的会话，先用少量测试）：
 *   npx ts-node src/scripts/migrate-messages.ts --sessions=<sessionId1>,<sessionId2>
 *   npx ts-node src/scripts/migrate-messages.ts --sessions=<sessionId> --force
 *   # 不带 --sessions 时：列出所有有消息的会话，需手动指定（防误迁移全部）
 *
 * 转换映射（对齐 DSH 分层事件模型，assistant/message 原生存储 ContentBlock[]）：
 *   Message（外壳）       → turn/start（kind=turn）
 *   user MessageContent   → user/message（content 文本 + files；hidden 注入 → kind='model'）
 *   assistant MessageContent → assistant/message（DB 平铺字段组装为块：
 *                           reasoningContent → reasoning 块；文本 → text 块；
 *                           metadata.toolCalls → tool-call 块）
 *   tool MessageContent   → tool/result（toolCallId/name/isError）
 *   File                  → message.files
 *   metadata.usage/finishReason/modelName → turn/finish
 *
 * 真实数据目录（GUADA_DEV_DATA）示例：
 *   DB:      C:\Users\<user>\.guada-dev\data\ai_chat.db
 *   sessions: C:\Users\<user>\.guada-dev\sessions
 *   SESSION_DATA_DIR 需指向 .guada-dev 根（backend 会再拼 sessions/），或直接改 backend basePath。
 *
 * ⚠️ 旧格式 JSONL（content 字符串 + reasoningContent/toolCalls 并列）已废弃，
 *    replayer 读到会 fail-fast。重跑本脚本（--force / --all）即可用新格式重新生成。
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
import { BaseEvent } from "../common/persistence/types";
import { resolve, dirname } from "path";

const databaseUrl = process.env.DATABASE_URL || "file:./data/ai_chat.db";
const adapter = new PrismaBetterSqlite3({ url: databaseUrl });
const prisma = new PrismaClient({ adapter });
const backend = new JsonlBackend();

// ─── 参数解析 ───

function parseArgs(): { sessions?: string[]; force: boolean; all: boolean } {
  const args = process.argv.slice(2);
  const sessionsArg = args.find(a => a.startsWith("--sessions="));
  const force = args.includes("--force");
  const all = args.includes("--all");
  const sessions = sessionsArg
    ? sessionsArg.split("=")[1].split(",").filter(Boolean)
    : undefined;
  return { sessions, force, all };
}

// ─── 会话选择 ───

async function listSessionsWithMessages(): Promise<Array<{ id: string; title: string | null; count: number }>> {
  const sessions = await prisma.session.findMany({
    where: { messages: { some: {} } },
    select: {
      id: true,
      title: true,
      _count: { select: { messages: true } },
    },
    orderBy: { updatedAt: "desc" },
  });
  return sessions.map(s => ({ id: s.id, title: s.title, count: s._count.messages }));
}

// ─── 核心转换 ───

async function migrateSession(sessionId: string, force: boolean): Promise<number> {
  if (await backend.hasSession(sessionId)) {
    // 已损坏会话（seq 缺口等）无法 getAllEvents（会抛 CorruptSessionLogError）——
    // catch 后视为"需重迁"，无论是否 --force 都删除重建（损坏日志不可用，重建是唯一出路）
    let existing: BaseEvent[] = [];
    let corrupted = false;
    try {
      existing = await backend.getAllEvents(sessionId);
    } catch (e: any) {
      corrupted = true;
      console.log(`  ⚠️ 会话 ${sessionId} 已有 JSONL 但损坏（${e?.message}），删除重迁`);
    }
    if (existing.length > 1) {
      if (!force) {
        console.log(`  ⚠️ 会话 ${sessionId} 已有 JSONL（${existing.length} 事件），跳过（用 --force 覆盖重迁）`);
        return 0;
      }
      // JSONL 切换后新建的会话在 DB 里可能没有消息行——按测试数据处理，直接删除重迁。
      const dbCount = await prisma.message.count({ where: { sessionId } });
      if (dbCount === 0) {
        console.log(
          `  🔁 --force 覆盖重迁（JSONL 有 ${existing.length} 事件但 DB 无消息，视为测试数据直接重建）`,
        );
      } else {
        console.log(`  🔁 --force 覆盖重迁（DB 有 ${dbCount} 条消息）`);
      }
      await removeSessionDir(sessionId);
    } else {
      // 空壳（只有 session/init）或损坏（getAllEvents 抛错）→ 删除重迁
      console.log(
        `  ♻️ 会话 ${sessionId} ${corrupted ? '损坏' : '为空壳'}，删除重迁`,
      );
      await removeSessionDir(sessionId);
    }
  }

  // 先读取 DB 消息，成功后再建会话（避免失败留下空壳）
  const messages = await loadMessagesBatched(sessionId);
  if (messages.length === 0) {
    console.log(`  ⚠️ 会话 ${sessionId} 无消息`);
    return 0;
  }

  // 创建 JSONL 会话
  await backend.createSession(sessionId, { title: "" });

  const events: BaseEvent[] = [];
  // seq 从 1 开始：createSession 已写入 seq=0 的 session/init（会话首事件约定），
  // 迁移事件必须接续（从 0 开始会与 init 冲突 → 两个 seq 0 → 扫描报"期望 1，实际 0"缺口）
  let seq = 1;

  for (const msg of messages) {
    // 仅 user 消息（parentId 为空）开新回合；assistant 版本由下方按组归并
    if (msg.parentId) continue;

    // 回合外壳：turn/start
    events.push({
      type: "turn/start",
      seq: seq++,
      time: new Date(msg.createdAt).getTime(),
      data: {
        turnId: msg.id,
        kind: "turn",
        metadata: msg.metadata,
      },
    });

    // 该 user 的 assistant 版本（parentId=本 user）：只保留最新一条为完整轮次
    const versions = messages.filter((m: any) => m.parentId === msg.id);
    const latestAssistant = versions.sort(
      (a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    )[0];

    // 待写消息：user 外壳 + 最新 assistant 版本（含其全部内容块）
    const roundMsgs = latestAssistant ? [msg, latestAssistant] : [msg];

    // 消息级三事件（对齐 DSH：tool/result、assistant/message、user/message，合并原 content 块）
    for (const m of roundMsgs) {
      for (const content of m.contents) {
        const meta = (content.metadata as any) || {};
        const files = content.files.map((f: any) => ({
          fileId: f.id,
          fileName: f.fileName,
          displayName: f.displayName || f.fileName,
          fileSize: f.fileSize || 0,
          fileType: f.fileType,
          fileExtension: f.fileExtension,
          url: f.url,
          previewUrl: f.previewUrl,
          contentHash: f.contentHash,
        }));

        const isTool = content.role === "tool";

        if (isTool) {
          // 工具结果 → tool/result（归属由当前回合括号界定，不带 turnId）
          events.push({
            type: "tool/result",
            seq: seq++,
            time: new Date(content.createdAt).getTime(),
            data: {
              messageId: content.id,
              toolCallId: meta.toolCallId ?? "",
              name: meta.name,
              content: content.content || "",
              isError: meta.isError,
              metadata: meta,
            },
          });
        } else if (content.role === "assistant") {
          // 助手回答 → assistant/message（content 原生存储 ContentBlock[]，与内存/SSE 结构一致零转换）
          // 由 DB 平铺字段组装为块：reasoningContent → reasoning 块；content 文本 → text 块；
          // metadata.toolCalls → tool-call 块。顺序对齐运行时组装约定（reasoning → text → tool-call）。
          const cid = content.id;
          const blocks: Array<Record<string, unknown>> = [];
          if (content.reasoningContent) {
            blocks.push({ type: "reasoning", summary: content.reasoningContent });
          }
          if (content.content) {
            blocks.push({ type: "text", text: content.content });
          }
          for (const tc of (meta.toolCalls ?? []) as any[]) {
            blocks.push({
              type: "tool-call",
              toolCallId: tc?.id ?? "",
              name: tc?.name ?? "",
              arguments:
                typeof tc?.arguments === "string"
                  ? tc.arguments
                  : JSON.stringify(tc?.arguments ?? {}),
            });
          }

          events.push({
            type: "assistant/message",
            seq: seq++,
            time: new Date(content.createdAt).getTime(),
            data: {
              messageId: content.id,
              content: blocks,
              files: files.length > 0 ? files : undefined,
              metadata: meta,
            },
          });
        } else {
          // 用户消息 → user/message（真实用户 kind='user'；注入 kind='model'；归属由当前回合括号界定，不带 turnId）
          // P6：统一 blocks 格式（text 块 + image/file 附件块），不再平铺 content/files
          const cid = content.id;
          const userBlocks: Array<Record<string, unknown>> = [];
          if (content.content) {
            userBlocks.push({ type: "text", text: content.content });
          }
          for (const f of files) {
            const isImage = String(f.fileType ?? "")
              .toLowerCase()
              .startsWith("image/");
            userBlocks.push({
              type: isImage ? "image" : "file",
              attachment: {
                attachmentId: f.fileId ?? f.url ?? "",
                mediaType: f.fileType ?? "application/octet-stream",
                bytes: f.fileSize || 0,
                name: f.displayName ?? f.fileName,
                url: f.url ?? f.previewUrl,
              },
            });
          }
          events.push({
            type: "user/message",
            seq: seq++,
            time: new Date(content.createdAt).getTime(),
            data: {
              messageId: content.id,
              kind: meta.hidden === true ? "model" : "user",
              blocks: userBlocks,
              metadata: meta,
            },
          });
        }
      }
    }

    // 回合完成信息 → turn/finish（从最新 assistant 版本内容块最后一步提取 usage/finishReason/modelName；
    // 耗时取 Message 外壳 totalDurationMs 列；外壳 meta_data 仅 133 条有 usage，块级才是真源）
    const finishMsg = latestAssistant ?? msg;
    const lastAssistantContent = [...finishMsg.contents]
      .reverse()
      .find((c: any) => c.role === "assistant");
    const lastMeta = (lastAssistantContent?.metadata as any) || {};
    const hasFinish =
      finishMsg.totalDurationMs != null ||
      lastMeta.usage ||
      lastMeta.finishReason ||
      lastMeta.modelName;
    if (hasFinish) {
      const usage = lastMeta.usage || {};
      events.push({
        type: "turn/finish",
        seq: seq++,
        time: new Date((lastAssistantContent?.updatedAt ?? finishMsg.updatedAt)).getTime(),
        data: {
          turnId: msg.id,
          promptTokens: usage.promptTokens ?? 0,
          completionTokens: usage.completionTokens ?? 0,
          cachedTokens: usage.cachedTokens?.read ?? 0,
          totalTokens: usage.totalTokens ?? 0,
          ...(lastMeta.finishReason !== undefined ? { finishReason: lastMeta.finishReason } : {}),
          ...(finishMsg.totalDurationMs != null ? { totalDurationMs: finishMsg.totalDurationMs } : {}),
          ...(lastMeta.modelName !== undefined ? { modelName: lastMeta.modelName } : {}),
        },
      });
    }
  }

  // 批量写入
  await backend.appendEvents(sessionId, events);
  console.log(`  ✅ 迁移 ${messages.length} 条消息, ${events.length} 个事件 → ${sessionId}`);
  return events.length;
}

/** 分批加载会话消息，规避 SQLite 参数限制 */
async function loadMessagesBatched(sessionId: string): Promise<any[]> {
  const BATCH_SIZE = 30;
  const totalCount = await prisma.message.count({ where: { sessionId } });
  const messages = [];
  for (let skip = 0; skip < totalCount; skip += BATCH_SIZE) {
    const batch = await prisma.message.findMany({
      where: { sessionId },
      include: {
        contents: {
          orderBy: { createdAt: "asc" },
          include: { files: { orderBy: { createdAt: "asc" } } },
        },
      },
      orderBy: { createdAt: "asc" },
      skip,
      take: BATCH_SIZE,
    });
    messages.push(...batch);
  }
  return messages;
}

/** 删除会话 JSONL 目录（仅用于清理空壳/失败残留） */
async function removeSessionDir(sessionId: string): Promise<void> {
  const { rm } = await import("fs/promises");
  const dir = (backend as any).getSessionDir(sessionId);
  await rm(dir, { recursive: true, force: true });
}

// ─── 主流程 ───

async function main() {
  const { sessions, force, all } = parseArgs();

  if (sessions && sessions.length > 0) {
    console.log(`迁移 ${sessions.length} 个指定会话...\n`);
    for (const sid of sessions) {
      try {
        await migrateSession(sid, force);
      } catch (e: any) {
        console.error(`  ❌ 会话 ${sid} 迁移失败: ${e?.message}`);
      }
    }
  } else if (all) {
    // 全量迁移所有有消息的会话
    const candidates = await listSessionsWithMessages();
    console.log(`全量迁移 ${candidates.length} 个有消息的会话...\n`);
    let ok = 0, skip = 0, fail = 0;
    for (const c of candidates) {
      try {
        const n = await migrateSession(c.id, force);
        if (n > 0) ok++;
        else skip++;
      } catch (e: any) {
        fail++;
        console.error(`  ❌ 会话 ${c.id} 迁移失败: ${e?.message}`);
      }
    }
    console.log(`\n全量迁移完成: 成功 ${ok}, 跳过(已有JSONL) ${skip}, 失败 ${fail}`);
  } else {
    // 未指定 → 列出候选，要求显式指定（防误迁移）
    const candidates = await listSessionsWithMessages();
    console.log("未指定 --sessions，列出所有有消息的会话：\n");
    for (const c of candidates.slice(0, 30)) {
      console.log(`  ${c.id}  (${c.count} 条消息) ${c.title || ''}`);
    }
    console.log(`\n共 ${candidates.length} 个有消息的会话。`);
    console.log('请用 --sessions=<id1>,<id2> 指定，或 --all 全量迁移。');
    console.log('例：npx ts-node src/scripts/migrate-messages.ts --sessions=xxx,yyy');
    console.log('    npx ts-node src/scripts/migrate-messages.ts --all');
  }
}

main()
  .catch(e => { console.error("FATAL:", e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
