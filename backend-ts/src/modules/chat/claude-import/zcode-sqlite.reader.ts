/**
 * ZCode 自家会话库（~/.zcode/cli/db/db.sqlite）只读 reader → 本项目 Turn[]。
 *
 * 数据模型（见 zcode 仓库 apps/zcode-cli/packages/adapters/src/storage/session-store/）：
 * - session 表：会话元数据（title/time_created/time_updated/directory/task_type/parent_id/
 *   time_deleted）。导入候选只取 interactive|fork 且 parent_id IS NULL（subagent、workflow
 *   子会话、侧边问答是独立 session 行，靠 task_type/parent_id 过滤）。
 * - message 表：消息信封，data JSON 含 role、time{created,completed}、parentID（assistant
 *   指向触发本轮的 user 消息——轮次归属锚点）、modelId/tokens、semantics 等。正文不在这里。
 * - part 表：内容块，data JSON 按 type 判别：text/reasoning/tool（callID+state{input,output,
 *   error,...}）/file/timeline/compaction/retry/step-start/step-finish/snapshot/patch/...
 *
 * 读取规则：
 * - 权威顺序：message 按 (sequence IS NULL), sequence, time_created, rowid；part 按
 *   (sequence IS NULL), sequence, time_created, id（对齐 zcode repositories/messages.ts）。
 * - 只读打开：`mode=ro`；不执行任何 PRAGMA/写入，避免触发库内迁移账本。WAL 模式下
 *   并发只读不阻塞 zcode 写入方。用完即关。
 * - 宽容解析：data 是无 schema 演进的 JSON，旧冻结字段（providerID/modelID/variant、
 *   user 的 model:{}）忽略；坏 JSON 行跳过；sequence NULL 由排序兜底。
 * - 非对话内容全部丢弃：timeline / compaction / retry / step-start / step-finish /
 *   snapshot / patch 等 part、synthetic|ignored 的 text part、semantics 标记的系统提醒类
 *   user 消息、state 为 pending|running 的 tool part。
 * - file part 附件不迁移物理文件（artifacts 在源机器路径下），只记文件名占位文本。
 */
import * as crypto from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import Database from "better-sqlite3";
import type { ContentBlock, Message, TokenUsage, Turn } from "../../../common/types/conversation.types";

// ─── 类型 ───

export interface ZcodeSessionSummary {
  id: string;
  title?: string;
  /** 工作目录（session.directory） */
  directory?: string;
  timeCreated: number;
  timeUpdated: number;
  /** 会话内 message 行数（列表预览用；不参与导入正文重建） */
  messageCount?: number;
}

interface ZcodeMessageEnvelope {
  id: string;
  role?: string;
  timeCreated?: number;
  data: Record<string, any>;
}

interface ZcodePart {
  messageId: string;
  data: Record<string, any>;
}

export interface ParsedZcodeSession {
  turns: Turn[];
  /**
   * 源会话里的压缩点（可能多次）。导入侧据此合成我们自己的 compaction 三事件：
   * 界面全量可见 + 压缩卡片，模型侧折叠为「摘要 + 压缩后尾巴」。
   * beforeTurnIndex = 压缩点落在第几个回合之前（0 = 第一个回合之前；= turns.length = 末尾）。
   */
  compactions: ParsedZcodeCompaction[];
  meta: {
    title?: string;
    model?: string;
    createdAt?: number;
    updatedAt?: number;
    turnCount: number;
  };
}

export interface ParsedZcodeCompaction {
  beforeTurnIndex: number;
  /** 摘要正文（源 compact_summary 消息的文本；缺失时用占位文案） */
  summary: string;
  /** 源库里的压缩 part id（去重/诊断用） */
  partId?: string;
  /** 压缩时间（part.time.start，缺省用所在消息时间） */
  time?: number;
}

// ─── 数据库定位 ───

/** 多候选根：覆盖 zcode 数据目录被重定向的场景（对齐 Claude 扫描的多根策略） */
export function zcodeDbPaths(): string[] {
  const roots = new Set<string>();
  const home = os.homedir();
  if (home) roots.add(path.join(home, ".zcode", "cli", "db", "db.sqlite"));
  const envHome = process.env.HOME;
  if (envHome) roots.add(path.join(envHome, ".zcode", "cli", "db", "db.sqlite"));
  // zcode 的 getDataBaseDir() 支持 ZCODE_DATA_BASE_DIR 覆盖；我们兼容该变量与本项目惯例的 USERDATA_DIR
  const dataBase = process.env.ZCODE_DATA_BASE_DIR;
  if (dataBase) roots.add(path.join(dataBase, "cli", "db", "db.sqlite"));
  const userdata = process.env.USERDATA_DIR;
  if (userdata) roots.add(path.join(userdata, ".zcode", "cli", "db", "db.sqlite"));
  return Array.from(roots).filter((p) => {
    try {
      return fs.existsSync(p);
    } catch {
      return false;
    }
  });
}

function openReadOnly(dbPath: string): Database.Database {
  // mode=ro：不触发库内 schema 迁移账本；不设置任何 PRAGMA
  return new Database(dbPath, { readonly: true, fileMustExist: true });
}

// ─── JSON 宽容解析 ───

function parseJsonField(raw: unknown): Record<string, any> {
  if (!raw || typeof raw !== "string") return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, any>) : {};
  } catch {
    return {};
  }
}

/** zcode 的 session.revert（conversation rewind 游标） */
export interface ZcodeSessionRevert {
  targetMessageID?: string;
  createdMessageID?: string;
  keptMessageIDs?: string[];
  branchCutAfterMessageID?: string;
}

/**
 * 计算当前活跃对话分支（对齐 zcode contracts/src/rewind 的 selectActiveConversationBranch）。
 *
 * zcode 是 append-only 存储：编辑/重试走 rewind，旧分支消息仍留在库里。
 * active branch = keptMessageIDs + branchCutAfterMessageID 之后新追加的消息；
 * 旧分支（kept 之后、cut 及之前）被排除。只按最新一条 revert 记录即可：
 * keptMessageIDs 是对"当时活跃视图"算出来的，旧旧分支既不在 kept 也不在 cut 之后。
 * 无 revert（或没有可用锚点）时原样返回。
 */
export function selectActiveBranch<T extends { id: string }>(
  messages: readonly T[],
  revert: ZcodeSessionRevert | null | undefined,
): T[] {
  if (!revert) return [...messages];
  const targetId = revert.targetMessageID;
  const cutId = revert.branchCutAfterMessageID;
  if (!targetId && !cutId) return [...messages];

  const byId = new Map(messages.map((message) => [message.id, message]));

  let kept: T[];
  if (revert.keptMessageIDs) {
    // 与 zcode 一致：空数组也算「显式 kept 为空」
    kept = revert.keptMessageIDs
      .map((id) => byId.get(id))
      .filter((message): message is T => message !== undefined);
  } else if (targetId) {
    const targetIndex = messages.findIndex((message) => message.id === targetId);
    kept = targetIndex >= 0 ? messages.slice(0, targetIndex) : [...messages];
  } else {
    kept = [...messages];
  }

  let active: T[];
  if (cutId) {
    const cutIndex = messages.findIndex((message) => message.id === cutId);
    active = cutIndex >= 0 ? [...kept, ...messages.slice(cutIndex + 1)] : kept;
  } else if (revert.createdMessageID) {
    const createdIndex = messages.findIndex((message) => message.id === revert.createdMessageID);
    active = createdIndex >= 0 ? [...kept, ...messages.slice(createdIndex)] : kept;
  } else {
    active = kept;
  }

  // 去重（kept 与 cut 之后理论上不重叠，防御异常数据），保持首次出现顺序
  const seen = new Set<string>();
  return active.filter((message) => {
    if (seen.has(message.id)) return false;
    seen.add(message.id);
    return true;
  });
}

// ─── 会话清单 ───

export function listZcodeSessions(dbPath: string): ZcodeSessionSummary[] {
  const db = openReadOnly(dbPath);
  try {
    const tableExists = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='session'")
      .get();
    if (!tableExists) return [];
    const rows = db
      .prepare(
        `SELECT id, title, directory, time_created, time_updated,
                (SELECT COUNT(*) FROM message m WHERE m.session_id = session.id) AS message_count
         FROM session
         WHERE time_deleted IS NULL
           AND parent_id IS NULL
           AND task_type IN ('interactive', 'fork')
         ORDER BY time_updated DESC`,
      )
      .all() as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      id: String(row.id ?? ""),
      ...(typeof row.title === "string" && row.title ? { title: row.title } : {}),
      ...(typeof row.directory === "string" && row.directory ? { directory: row.directory } : {}),
      timeCreated: typeof row.time_created === "number" ? row.time_created : 0,
      timeUpdated: typeof row.time_updated === "number" ? row.time_updated : 0,
      // 相关子查询计数：message 按 session_id 有索引，整库一次拿完，不逐会话再开一次查询
      ...(typeof row.message_count === "number" ? { messageCount: row.message_count } : {}),
    }));
  } finally {
    db.close();
  }
}

// ─── 消息 / part 读取 ───

function loadMessages(db: Database.Database, sessionId: string): ZcodeMessageEnvelope[] {
  const rows = db
    .prepare(
      `SELECT id, data, time_created
       FROM message
       WHERE session_id = ?
       ORDER BY (sequence IS NULL), sequence, time_created, rowid`,
    )
    .all(sessionId) as Array<Record<string, unknown>>;
  return rows.map((row) => {
    const data = parseJsonField(row.data);
    return {
      id: String(row.id ?? ""),
      role: typeof data.role === "string" ? data.role : undefined,
      timeCreated: typeof row.time_created === "number" ? row.time_created : undefined,
      data,
    };
  });
}

function loadParts(db: Database.Database, sessionId: string): ZcodePart[] {
  const rows = db
    .prepare(
      `SELECT message_id, data
       FROM part
       WHERE session_id = ?
       ORDER BY (sequence IS NULL), sequence, time_created, id`,
    )
    .all(sessionId) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    messageId: String(row.message_id ?? ""),
    data: parseJsonField(row.data),
  }));
}

// ─── 内容映射 ───

function makeMessageId(): string {
  return `zimp-${crypto.randomUUID()}`;
}

/** 系统提醒类 user 消息（semantics.kind 标记），非真实输入，跳过 */
const SKIPPED_USER_SEMANTIC_KINDS = new Set([
  "system_reminder",
  "todo_reminder",
  "compact_summary",
  "background_notification",
  "peer_message",
]);

function isSkippedUserMessage(data: Record<string, any>): boolean {
  const semantics = data.semantics as Record<string, any> | undefined;
  const kind = semantics?.kind;
  if (typeof kind === "string" && SKIPPED_USER_SEMANTIC_KINDS.has(kind)) return true;
  // visibility: model-only 的 user 消息不面向用户
  if (data.visibility === "model-only") return true;
  return false;
}

/** 单条 assistant 消息的 part 集合 → content 块 + 配套 tool 消息 */
function buildAssistantContent(
  parts: ZcodePart[],
): { content: ContentBlock[]; toolMessages: Message[] } {
  const content: ContentBlock[] = [];
  const toolMessages: Message[] = [];

  for (const part of parts) {
    const d = part.data;
    const type = d.type;
    if (type === "text") {
      if (d.synthetic === true || d.ignored === true) continue;
      const text = typeof d.text === "string" ? d.text.trim() : "";
      if (text) content.push({ type: "text", text } as ContentBlock);
    } else if (type === "reasoning") {
      const text = typeof d.text === "string" ? d.text.trim() : "";
      if (text) content.push({ type: "reasoning", summary: text } as ContentBlock);
    } else if (type === "tool") {
      const state = d.state as Record<string, any> | undefined;
      const status = state?.status;
      if (status !== "completed" && status !== "error") continue; // pending/running 不导入
      const callId = typeof d.callID === "string" ? d.callID : "";
      if (!callId) continue;
      const toolName = typeof d.tool === "string" ? d.tool : "unknown";
      content.push({
        type: "tool-call",
        toolCallId: callId,
        name: toolName,
        arguments: JSON.stringify(state?.input ?? {}),
      } as ContentBlock);
      const output =
        status === "error"
          ? String(state?.error ?? "")
          : typeof state?.output === "string"
            ? state.output
            : "";
      toolMessages.push({
        id: makeMessageId(),
        role: "tool",
        kind: "model",
        source: { kind: "tool", toolCallId: callId },
        metadata: {},
        content: [
          {
            type: "tool-result",
            toolCallId: callId,
            name: toolName,
            content: output,
            ...(status === "error" ? { isError: true } : {}),
          } as ContentBlock,
        ],
        createdAt: state?.time?.end ?? state?.time?.start,
      });
    } else if (type === "file") {
      // 附件不迁移物理文件：记文件名占位文本（跨机器路径多半无效）
      const filename = typeof d.filename === "string" && d.filename ? d.filename : "attachment";
      content.push({
        type: "text",
        text: `[attachment: ${filename}]`,
      } as ContentBlock);
    }
    // timeline/compaction/retry/step-*/snapshot/patch/subtask/agent 等：非对话内容，跳过
  }

  return { content, toolMessages };
}

/** tokens（TokenUsageInfo）→ 本项目 TokenUsage 形状 */
function mapTokens(tokens: Record<string, any> | undefined): TokenUsage | undefined {
  if (!tokens || typeof tokens !== "object") return undefined;
  const promptTokens = typeof tokens.input === "number" ? tokens.input : 0;
  const completionTokens = typeof tokens.output === "number" ? tokens.output : 0;
  const usage: TokenUsage = {
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
  };
  const cache = tokens.cache as Record<string, any> | undefined;
  if (cache && (typeof cache.read === "number" || typeof cache.write === "number")) {
    usage.cachedTokens = {
      ...(typeof cache.read === "number" ? { read: cache.read } : {}),
      ...(typeof cache.write === "number" ? { written: cache.write } : {}),
    };
  }
  if (typeof tokens.reasoning === "number" && tokens.reasoning > 0) {
    usage.reasoningTokens = tokens.reasoning;
  }
  return usage;
}

/**
 * 读取并解析一个 ZCode 会话为 Turn[]。
 * 一轮 = 一条 user message + data.parentID 指向它的全部 assistant 消息；
 * 没有归属锚点的 assistant（异常数据）并入最近一轮或补空回合外壳。
 */
export function readZcodeSession(dbPath: string, sessionId: string): ParsedZcodeSession {
  const db = openReadOnly(dbPath);
  let sessionRow: Record<string, unknown> | undefined;
  let messages: ZcodeMessageEnvelope[];
  let partsByMessage: Map<string, ZcodePart[]>;
  try {
    try {
      sessionRow = db
        .prepare("SELECT id, title, time_created, time_updated, revert FROM session WHERE id = ?")
        .get(sessionId) as Record<string, unknown> | undefined;
    } catch {
      // 极旧库可能没有 revert 列：退化为不折算 rewind
      sessionRow = db
        .prepare("SELECT id, title, time_created, time_updated FROM session WHERE id = ?")
        .get(sessionId) as Record<string, unknown> | undefined;
    }
    // 编辑/重试在 zcode 里是 rewind（append-only 旧分支仍在库中）：
    // 先按 session.revert 折算出当前活跃分支，再解析
    const revertRaw = parseJsonField(sessionRow?.revert) as ZcodeSessionRevert;
    const revert = Object.keys(revertRaw).length > 0 ? revertRaw : null;
    const allMessages = loadMessages(db, sessionId);
    messages = selectActiveBranch(allMessages, revert);
    const activeMessageIds = new Set(messages.map((message) => message.id));
    partsByMessage = new Map<string, ZcodePart[]>();
    for (const part of loadParts(db, sessionId)) {
      if (!activeMessageIds.has(part.messageId)) continue; // 旧分支的 part 一并排除
      const list = partsByMessage.get(part.messageId) ?? [];
      list.push(part);
      partsByMessage.set(part.messageId, list);
    }
  } finally {
    db.close();
  }

  const turns: Turn[] = [];
  const compactions: ParsedZcodeCompaction[] = [];
  let model: string | undefined;
  let createdAt: number | undefined;
  let updatedAt: number | undefined;

  // 摘要正文预扫：semantics.kind=compact_summary 的消息不进对话，但它的文本就是压缩摘要
  const summaryTextByMessageId = new Map<string, string>();
  for (const envelope of messages) {
    const kind = (envelope.data?.semantics as Record<string, any> | undefined)?.kind;
    if (kind !== "compact_summary") continue;
    const pieces: string[] = [];
    for (const part of partsByMessage.get(envelope.id) ?? []) {
      const d = part.data;
      if (d.type !== "text") continue;
      const text = typeof d.text === "string" ? d.text.trim() : "";
      if (text) pieces.push(text);
    }
    if (pieces.length > 0) summaryTextByMessageId.set(envelope.id, pieces.join("\n\n"));
  }

  const seenCompactionPartIds = new Set<string>();

  /** 从 compaction part 解析压缩点：摘要正文取 summaryMessageId(s) 指向的摘要消息 */
  const collectCompaction = (parts: ZcodePart[], fallbackTime?: number) => {
    for (const part of parts) {
      const d = part.data;
      if (d.type !== "compaction") continue;
      const partId = typeof d.id === "string" ? d.id : undefined;
      if (partId && seenCompactionPartIds.has(partId)) continue;
      if (partId) seenCompactionPartIds.add(partId);

      const summaryIds: string[] = Array.isArray(d.compactBoundary?.summaryMessageIds)
        ? d.compactBoundary.summaryMessageIds
        : [];
      if (typeof d.summaryMessageId === "string") summaryIds.unshift(d.summaryMessageId);
      let summary = "";
      for (const id of summaryIds) {
        const text = summaryTextByMessageId.get(id);
        if (text) {
          summary = text;
          break;
        }
      }
      const partTime = typeof d.time?.start === "number" ? d.time.start : fallbackTime;
      compactions.push({
        beforeTurnIndex: turns.length,
        summary: summary || "（源会话在此处压缩过历史对话，摘要不可用）",
        ...(partId ? { partId } : {}),
        ...(typeof partTime === "number" ? { time: partTime } : {}),
      });
    }
  };

  const touch = (ms?: number) => {
    if (ms === undefined || !Number.isFinite(ms) || ms <= 0) return;
    if (createdAt === undefined || ms < createdAt) createdAt = ms;
    if (updatedAt === undefined || ms > updatedAt) updatedAt = ms;
  };

  // user message id → turn 索引（轮次归属锚点）
  const turnIndexByUserMessageId = new Map<string, number>();

  const appendTurn = (turn: Turn): void => {
    turns.push(turn);
  };

  for (const envelope of messages) {
    const role = envelope.role;
    const msgTime = typeof envelope.data?.time?.created === "number"
      ? envelope.data.time.created
      : envelope.timeCreated;
    touch(msgTime);

    // 压缩点先于消息处理收集（含被跳过的摘要消息载体）：
    // 此刻 turns.length 即压缩点之前的回合数
    const messageParts = partsByMessage.get(envelope.id) ?? [];
    collectCompaction(messageParts, msgTime);

    if (role === "user") {
      if (isSkippedUserMessage(envelope.data)) continue;
      const parts = messageParts;
      const textPieces: string[] = [];
      for (const part of parts) {
        const d = part.data;
        if (d.type !== "text") continue;
        if (d.synthetic === true || d.ignored === true) continue;
        const text = typeof d.text === "string" ? d.text.trim() : "";
        if (text) textPieces.push(text);
      }
      if (textPieces.length === 0) continue;
      appendTurn({
        id: makeMessageId(),
        kind: "turn",
        metadata: {},
        messages: [
          {
            id: makeMessageId(),
            role: "user",
            kind: "user",
            source: { kind: "user" },
            metadata: {},
            content: [{ type: "text", text: textPieces.join("\n\n") } as ContentBlock],
            createdAt: msgTime,
          },
        ],
        visible: true,
        createdAt: msgTime,
      });
      turnIndexByUserMessageId.set(envelope.id, turns.length - 1);
      continue;
    }

    if (role === "assistant") {
      const { content, toolMessages } = buildAssistantContent(messageParts);
      if (content.length === 0 && toolMessages.length === 0) continue;
      // 模型名在消息信封的 data 里（旧数据还有 providerID/modelID 冻结字段，忽略）
      const rawModel = envelope.data?.modelId ?? envelope.data?.model;
      const msgModel = typeof rawModel === "string" && rawModel ? rawModel : undefined;
      if (!model && msgModel) model = msgModel;

      const usage = mapTokens(envelope.data?.tokens);
      const message: Message = {
        id: makeMessageId(),
        role: "assistant",
        kind: "model",
        source: {
          kind: "model",
          provider: "zcode-import",
          model: msgModel ?? "unknown",
        },
        metadata: usage ? { usage } : {},
        content,
        createdAt: msgTime,
      };

      const parentId = typeof envelope.data?.parentID === "string" ? envelope.data.parentID : "";
      const targetIndex = parentId !== "" ? turnIndexByUserMessageId.get(parentId) : undefined;
      if (targetIndex !== undefined && turns[targetIndex]) {
        const turn = turns[targetIndex];
        turn.messages.push(message, ...toolMessages);
      } else if (turns.length > 0) {
        // 无锚点（异常数据）：并入最近一轮
        const turn = turns[turns.length - 1];
        turn.messages.push(message, ...toolMessages);
      } else {
        // 会话以 assistant 开头（异常）：补空回合外壳
        appendTurn({
          id: makeMessageId(),
          kind: "turn",
          metadata: {},
          messages: [message, ...toolMessages],
          visible: true,
          createdAt: msgTime,
        });
      }
      continue;
    }

    // 其他 role / 空角色：跳过
  }

  // turn/finish 的 modelName 用该轮最后一条 assistant 的 model
  for (const turn of turns) {
    const lastAssistant = [...turn.messages].reverse().find((m) => m.role === "assistant");
    const usedModel =
      lastAssistant?.source.kind === "model" ? lastAssistant.source.model : undefined;
    if (usedModel && usedModel !== "unknown") {
      turn.metadata.modelName = usedModel;
    }
  }

  const sessionTitle = typeof sessionRow?.title === "string" && sessionRow.title ? sessionRow.title : undefined;
  const rowCreated = typeof sessionRow?.time_created === "number" ? sessionRow.time_created : undefined;
  const rowUpdated = typeof sessionRow?.time_updated === "number" ? sessionRow.time_updated : undefined;
  touch(rowCreated);
  touch(rowUpdated);

  return {
    turns,
    // 保留落在导入区间内的压缩点（含末尾压缩：此刻全部历史已被摘要）；
    // 位置 0 的压缩点由导入侧跳过（无内容可遮蔽）
    compactions: compactions.filter((c) => c.beforeTurnIndex <= turns.length),
    meta: {
      ...(sessionTitle ? { title: sessionTitle } : {}),
      ...(model ? { model } : {}),
      ...(createdAt !== undefined ? { createdAt } : {}),
      ...(updatedAt !== undefined ? { updatedAt } : {}),
      turnCount: turns.length,
    },
  };
}
