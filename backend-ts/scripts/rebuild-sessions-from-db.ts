/**
 * 从数据库重建会话 JSONL（迁移脚本）
 *
 * 背景：消息 id 改为有序 ULID（m_<ULID> / c_<ULID>）后，旧日志中的乱序 id（m_<ts>_<rand>）
 * 无法作为遮蔽分界点。本脚本清空指定会话的 JSONL 日志，从数据库（message + message_content）
 * 重新生成——所有消息/回合 id 重新分配为有序 ULID。
 *
 * 用法：
 *   npx ts-node scripts/rebuild-sessions-from-db.ts                    # 全量重建（先预览，确认后执行）
 *   npx ts-node scripts/rebuild-sessions-from-db.ts --session <id>     # 只重建指定会话
 *   npx ts-node scripts/rebuild-sessions-from-db.ts --yes              # 跳过确认直接执行
 *   npx ts-node scripts/rebuild-sessions-from-db.ts [db-path]          # 指定 SQLite 路径
 *
 * 数据库路径优先级：命令行参数 > DATABASE_URL > ./data/ai_chat.db
 *
 * ⚠️ 数据映射说明（旧 3-tier 格式 → 新三层 Message）：
 * - message.role + message_content 按 created_at 排序还原回合与消息顺序；
 * - text 块来自 message_content.content，reasoning 块来自 reasoning_content；
 * - 工具调用（tool-call/tool-result）尽力从 additional_kwargs / metadata 还原，
 *   无法识别时降级为文本块（内容不丢，语义可能简化）——建议重建后抽查关键会话。
 */

import "dotenv/config";
import * as path from "path";
import * as os from "os";
import { JsonlBackend } from "../src/common/persistence/jsonl-backend";
import { JsonlMessageService } from "../src/common/persistence/jsonl-message.service";
import { generateOrderedMessageId } from "../src/common/utils/ordered-id.util";
import type { Turn, Message, ContentBlock } from "../src/common/types/conversation.types";

// ── 数据库连接（与 export-session.ts 同款直连）──

function resolveDbPath(): string {
  const cliPath = process.argv.find((a, i) => i > 1 && !a.startsWith("--"));
  if (cliPath) {
    return cliPath.startsWith("~")
      ? path.resolve(os.homedir(), cliPath.slice(1))
      : path.resolve(cliPath);
  }
  const envUrl = process.env.DATABASE_URL;
  if (envUrl) {
    const match = envUrl.match(/^file:(.+\.db)/);
    if (match) return path.resolve(match[1]);
    return envUrl;
  }
  return path.resolve(__dirname, "..", "data", "ai_chat.db");
}

const dbPath = resolveDbPath();
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Database = require("better-sqlite3");
const db = new Database(dbPath);

const sessionFilter = (() => {
  const i = process.argv.indexOf("--session");
  return i >= 0 ? process.argv[i + 1] : undefined;
})();
const yesFlag = process.argv.includes("--yes");

// ── 数据库 → Turn[]（新有序 id）──

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

/** 从 additional_kwargs / metadata 尽力还原工具调用（旧 OpenAI 风格 tool_calls/toolCalls） */
function toolCallsFrom(additionalKwargs: any, meta: any): Array<{
  toolCallId: string;
  name: string;
  arguments: string;
}> {
  const kwargs = additionalKwargs && typeof additionalKwargs === "object" ? additionalKwargs : {};
  const list = kwargs.tool_calls ?? kwargs.toolCalls ?? meta?.toolCalls;
  if (!Array.isArray(list)) return [];
  return list
    .filter((tc: any) => tc && typeof tc === "object")
    .map((tc: any) => {
      const rawArgs = tc.function?.arguments ?? tc.arguments;
      return {
        toolCallId: String(tc.id ?? tc.toolCallId ?? tc.tool_call_id ?? ""),
        name: String(tc.function?.name ?? tc.name ?? "unknown"),
        arguments:
          typeof rawArgs === "string" ? rawArgs : JSON.stringify(rawArgs ?? {}),
      };
    });
}

/**
 * 单条 DB message（含 contents）→ 三层 Message[]（id 重新分配为有序 ULID）。
 * - user 消息：内容行文本 → text 块；
 * - assistant 消息：文本/reasoning 块 + meta_data.toolCalls → tool-call 块；
 *   **其下 role='tool' 的内容行是工具结果**（meta_data.toolCallId + content）→ 拆为独立的
 *   tool 消息（tool-result 块），importTurns 据此写 tool/result 事件（与原始 JSONL 事件形态一致）。
 * 注意 DB 列名：message_content 的列是 meta_data / additional_kwargs（下划线）。
 */
function dbMessageToMessage(m: any): Message[] {
  const role = m.role;
  const contents: Array<any> = m.contents ?? [];
  const out: Message[] = [];

  if (role === "tool") {
    const meta = safeJson(m.meta_data) ?? {};
    const toolCallId = String(meta.toolCallId ?? meta.tool_call_id ?? "");
    out.push({
      id: generateOrderedMessageId("m"),
      role: "tool",
      kind: "model",
      source: { kind: "tool", toolCallId },
      metadata: { ...meta },
      content: [
        {
          type: "tool-result",
          contentId: "",
          toolCallId,
          name: String(meta.name ?? "tool"),
          content: m.content ?? "",
          isError: !!meta.isError,
        },
      ],
    });
    return out;
  }

  const blocks: ContentBlock[] = [];
  const toolResults: Array<{ toolCallId: string; content: string; name?: string; isError?: boolean }> = [];
  const callNames = new Map<string, string>(); // toolCallId → 工具名（tool-result 显示用）
  for (const c of contents) {
    // 工具结果内容行（role='tool'）→ 独立 tool 消息
    if (c.role === "tool") {
      const tmeta = safeJson(c.meta_data) ?? {};
      toolResults.push({
        toolCallId: String(tmeta.toolCallId ?? tmeta.tool_call_id ?? ""),
        content: c.content ?? "",
        name: tmeta.name,
        isError: !!tmeta.isError,
      });
      continue;
    }
    const text = c.content;
    if (text) {
      blocks.push({ type: "text", contentId: "", text });
    }
    if (c.reasoningContent) {
      blocks.push({ type: "reasoning", contentId: "", summary: c.reasoningContent });
    }
    const tcs = toolCallsFrom(c.additional_kwargs, safeJson(c.meta_data));
    for (const tc of tcs) {
      callNames.set(tc.toolCallId, tc.name);
      blocks.push({
        type: "tool-call",
        contentId: "",
        toolCallId: tc.toolCallId,
        name: tc.name,
        arguments: tc.arguments,
      });
    }
  }
  if (blocks.length === 0) {
    blocks.push({ type: "text", contentId: "", text: "" });
  }

  if (role === "assistant") {
    out.push({
      id: generateOrderedMessageId("m"),
      role: "assistant",
      kind: "model",
      source: { kind: "model", provider: "", model: "" },
      metadata: safeJson(m.meta_data) ?? {},
      content: blocks,
    });
    // 工具结果 → 独立 tool 消息（紧随 assistant 之后，与原始事件序一致）
    for (const tr of toolResults) {
      out.push({
        id: generateOrderedMessageId("m"),
        role: "tool",
        kind: "model",
        source: { kind: "tool", toolCallId: tr.toolCallId },
        metadata: {},
        content: [
          {
            type: "tool-result",
            contentId: "",
            toolCallId: tr.toolCallId,
            name: tr.name ?? callNames.get(tr.toolCallId) ?? "tool",
            content: tr.content,
            isError: tr.isError,
          },
        ],
      });
    }
    return out;
  }
  // user / 其余 → user 消息
  out.push({
    id: generateOrderedMessageId("m"),
    role: "user",
    kind: "user",
    source: { kind: "user" },
    metadata: safeJson(m.meta_data) ?? {},
    content: blocks,
  });
  return out;
}

/**
 * 按 parent 链分组回合：回合 = 一条用户消息（parent 为空的锚点）+ 其 parent 指向它/其子孙的全部消息。
 * DB 中 assistant.parent_id = 所属用户消息 id；current_turns_id 为每条消息独立值，不可用于分组。
 */
function buildTurns(messages: any[]): Turn[] {
  const byId = new Map<string, any>();
  for (const m of messages) byId.set(m.id, m);

  // 锚点：无 parent / parent 不在本会话的消息（用户消息无 parent），按时间序
  const roots = messages
    .filter((m) => !m.parent_id || !byId.has(m.parent_id))
    .sort((a, b) => (a.created_at > b.created_at ? 1 : -1));

  // 消息 → 所属根（沿 parent 链上溯，缓存）
  const rootOf = new Map<string, any>();
  const findRoot = (m: any): any => {
    const cached = rootOf.get(m.id);
    if (cached) return cached;
    if (m.parent_id && byId.has(m.parent_id)) {
      const root = findRoot(byId.get(m.parent_id));
      rootOf.set(m.id, root);
      return root;
    }
    rootOf.set(m.id, m);
    return m;
  };

  const turns: Turn[] = [];
  for (const root of roots) {
    const members = messages
      .filter((m) => findRoot(m) === root)
      .sort((a, b) => (a.created_at > b.created_at ? 1 : -1));
    // 回合完成信息：最后一条 assistant 消息的 finishReason/usage/modelName + 消息表 total_duration_ms
    const lastAssistant = [...members].reverse().find((mm) => mm.role === "assistant");
    const lastMd = lastAssistant ? safeJson(lastAssistant.meta_data) ?? {} : {};
    const metadata: Record<string, any> = {};
    if (lastMd.finishReason) metadata.finishReason = lastMd.finishReason;
    if (lastMd.usage) metadata.usage = lastMd.usage;
    if (lastMd.modelName) metadata.modelName = lastMd.modelName;
    if (lastAssistant?.total_duration_ms != null) {
      metadata.totalDurationMs = lastAssistant.total_duration_ms;
    }
    turns.push({
      // 回合 id 复用根消息 id（稳定、与 DB 可追溯；有序分界只依赖消息 id）
      id: root.id,
      kind: "turn",
      metadata,
      messages: members.flatMap(dbMessageToMessage),
      visible: true,
    });
  }
  return turns;
}

/** 从模型配置解析有效上下文窗口（config 为单层 JSON 字符串；解析失败或缺省 → undefined） */
function modelContextWindow(modelRow: any): number | undefined {
  if (!modelRow?.config) return undefined;
  let cfg: any = modelRow.config;
  if (typeof cfg === "string") {
    try {
      cfg = JSON.parse(cfg);
    } catch {
      return undefined;
    }
  }
  const win = cfg?.contextWindow ?? cfg?.config?.contextWindow;
  return typeof win === "number" && win > 0 ? win : undefined;
}

// ── 主逻辑 ──

async function main() {
  const store = new JsonlMessageService(new JsonlBackend());

  const sessionRows = sessionFilter
    ? (db.prepare("SELECT * FROM session WHERE id = ?").all(sessionFilter) as any[])
    : (db.prepare("SELECT * FROM session ORDER BY created_at ASC").all() as any[]);

  if (sessionRows.length === 0) {
    console.log(`❌ 无匹配会话${sessionFilter ? `（${sessionFilter}）` : ""}`);
    process.exit(1);
  }

  console.log(`ℹ️ 数据库: ${dbPath}`);
  console.log(`ℹ️ 待重建会话数: ${sessionRows.length}`);
  console.log(`ℹ️ 会话 id 与消息 id 将全部重新分配为有序 ULID（m_<ULID> / c_<ULID>）\n`);

  let totalImported = 0;
  for (const s of sessionRows) {
    const messages = db
      .prepare(
        "SELECT * FROM message WHERE session_id = ? ORDER BY created_at ASC",
      )
      .all(s.id) as any[];
    const withContents = messages.map((m: any) => ({
      ...m,
      contents: db
        .prepare(
          "SELECT * FROM message_content WHERE message_id = ? ORDER BY created_at ASC",
        )
        .all(m.id),
    }));
    const turns = buildTurns(withContents);
    const msgCount = turns.reduce((acc, t) => acc + t.messages.length, 0);
    // 会话模型的有效上下文窗口（turn/finish 锚点用；解析失败则锚点不写窗口字段）
    const modelRow = s.model_id
      ? (db.prepare("SELECT config FROM model WHERE id = ?").get(s.model_id) as any)
      : null;
    const effectiveContextWindow = modelContextWindow(modelRow);
    console.log(
      `- ${s.id} (${s.title || "无标题"}): ${turns.length} 回合 / ${msgCount} 消息` +
        (effectiveContextWindow ? ` (window=${effectiveContextWindow})` : ""),
    );

    if (!yesFlag) continue; // 预览模式：仅列出，不执行

    await store.clearSessionTurns(s.id); // 清旧日志（幂等，目录级删除）
    await store.ensureSession(s.id); // 目录被清 → 重新建壳（manifest + session/init）
    const { imported } = await store.importTurns(s.id, turns, {
      effectiveContextWindow,
    });
    totalImported += imported;
  }

  if (!yesFlag) {
    console.log(`\n⚠️  预览模式（未执行）。确认无误后加 --yes 真正重建。`);
    process.exit(0);
  }

  console.log(`\n✅ 重建完成：共导入 ${totalImported} 条消息`);
  console.log(`⚠️  旧 JSONL 已清空并重建；数据库未改动（备份仍保留）。`);
}

main()
  .catch((e) => {
    console.error(`❌ 迁移失败: ${e?.message ?? e}`);
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.close());
