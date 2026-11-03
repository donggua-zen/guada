/**
 * Claude Code 原生会话 JSONL 解析器（源格式 → 本项目 Turn[]）。
 *
 * 源格式：~/.claude/projects/{转义项目目录}/{sessionId}.jsonl，每行一个 JSON 对象。
 * 目录名是项目路径的转义形式，本解析器不解读它——真实 cwd 从记录的 cwd 字段读。
 *
 * 解析规则（参照 zcode claudeNativeSessionImportParser 的口径，输出换成我们的 Turn[]）：
 * - 一条可见 user 记录开一个新 Turn；其后到下一条 user 之间的 assistant / tool_result
 *   记录都归入该 Turn。
 * - assistant 连续多条记录（text / tool_use 混合）合成一条 assistant Message：
 *   content = text 块 + tool-call 块按出现顺序排列。
 * - user 记录里的 tool_result 转成 role='tool' Message（source={kind:'tool',toolCallId}，
 *   content=[tool-result 块]）；tool_use_id 找不到对应调用时生成占位 tool-call 块，
 *   避免悬空结果（对齐 tool-pairing.guard 的形状要求）。
 * - isMeta:true 的 user 记录跳过（工具回执等非真实输入）；isApiErrorMessage 的 assistant
 *   内容保留（用户真实看到的错误气泡）；model '<synthetic>' 的 SDK 占位丢弃。
 * - isSidechain:true 的文件是 subagent 日志——由调用方（head 扫描）整体跳过，本文件不负责。
 * - 时间字段多形态（秒/毫秒数字、数字串、ISO 串）统一归一为 Unix ms。
 * - 对未知 type / 未知字段一律宽容：提取不到可见文本即自然忽略。
 */
import { randomUUID } from "crypto";
import type { ContentBlock, Message, Turn } from "../../../common/types/conversation.types";

// ─── 源记录类型（宽容：全部字段可选，未知字段保留在源对象上） ───

export interface ClaudeJsonlRecord {
  type?: string;
  cwd?: string;
  sessionId?: string;
  uuid?: string;
  isSidechain?: boolean;
  isMeta?: boolean;
  isApiErrorMessage?: boolean;
  timestamp?: unknown;
  model?: string;
  message?: {
    role?: string;
    model?: string;
    cwd?: string;
    content?: unknown;
    stop_reason?: string;
  };
  [key: string]: unknown;
}

export interface ParsedClaudeSession {
  turns: Turn[];
  meta: {
    cwd?: string;
    previewTitle?: string;
    model?: string;
    createdAt?: number;
    updatedAt?: number;
    /** 真实可见轮次数（turns.length） */
    turnCount: number;
  };
}

// ─── 工具函数 ───

/** 多形态时间 → Unix ms；解析不出返回 undefined */
export function toTimestampMs(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value > 1e12) return value; // 已是 ms
    if (value > 1e9) return Math.round(value * 1000); // 秒 → ms
    return undefined;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    if (/^\d+$/.test(trimmed)) return toTimestampMs(Number(trimmed));
    const parsed = Date.parse(trimmed);
    return Number.isNaN(parsed) ? undefined : parsed;
  }
  return undefined;
}

/** 记录时间候选链：timestamp / message.timestamp / createdAt / updated_at … */
function recordTimestamp(record: ClaudeJsonlRecord): number | undefined {
  const candidates = [
    record.timestamp,
    (record.message as Record<string, unknown> | undefined)?.timestamp,
    record.createdAt,
    record.created_at,
    record.updatedAt,
    record.updated_at,
  ];
  for (const c of candidates) {
    const ms = toTimestampMs(c);
    if (ms !== undefined) return ms;
  }
  return undefined;
}

/** 剥掉 Claude 侧的注入标签块（IDE 状态、本地命令回显），CRLF 归一 */
export function sanitizeClaudeVisibleText(text: string): string {
  return text
    .replace(/<ide_opened_file>[\s\S]*?<\/ide_opened_file>/g, "")
    .replace(/<local-command-[^>]*>[\s\S]*?<\/local-command-[^>]*>/g, "")
    .replace(/<command-[^>]*>[\s\S]*?<\/command-[^>]*>/g, "")
    .replace(/\r\n/g, "\n")
    .trim();
}

function isSynthetic(record: ClaudeJsonlRecord): boolean {
  const model = record.message?.model ?? record.model;
  return typeof model === "string" && model === "<synthetic>";
}

function assistantModelOf(record: ClaudeJsonlRecord): string | undefined {
  const model = record.message?.model ?? record.model;
  if (typeof model === "string" && model && model !== "<synthetic>") return model;
  return undefined;
}

/** 从首条可见 user 文本派生预览标题（截前 50 字符） */
export function derivePreviewTitle(firstUserText: string | undefined): string | undefined {
  if (!firstUserText) return undefined;
  const oneLine = firstUserText.replace(/\s+/g, " ").trim();
  return oneLine ? oneLine.slice(0, 50) : undefined;
}

// ─── 可见文本 / 块提取 ───

interface ExtractedContent {
  text: string;
  toolUses: Array<{ id: string; name: string; input: string }>;
  toolResults: Array<{
    toolUseId: string;
    content: string;
    isError?: boolean;
  }>;
}

/** content 归一为 string（Claude 的 tool_result content 可能是字符串或块数组） */
function resultContentToString(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((item: any) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object" && typeof item.text === "string") return item.text;
        return "";
      })
      .filter(Boolean)
      .join("\n\n");
  }
  return "";
}

function extractUserContent(
  record: ClaudeJsonlRecord,
): { text: string; toolResults: ExtractedContent["toolResults"] } {
  const raw = record.message?.content;
  if (typeof raw === "string") {
    return { text: sanitizeClaudeVisibleText(raw), toolResults: [] };
  }
  if (!Array.isArray(raw)) return { text: "", toolResults: [] };

  let text = "";
  const toolResults: ExtractedContent["toolResults"] = [];
  for (const item of raw) {
    if (typeof item === "string") {
      text += (text ? "\n\n" : "") + item;
      continue;
    }
    if (!item || typeof item !== "object") continue;
    const block = item as Record<string, any>;
    if (block.type === "tool_result") {
      toolResults.push({
        toolUseId: String(block.tool_use_id ?? ""),
        content: resultContentToString(block.content),
        isError: block.is_error === true ? true : undefined,
      });
      continue;
    }
    // 其余按文本收集（text 块与裸字符串混合形态）
    const piece = typeof block.text === "string" ? block.text : typeof block.content === "string" ? block.content : "";
    if (piece) text += (text ? "\n\n" : "") + piece;
  }
  return { text: sanitizeClaudeVisibleText(text), toolResults };
}

function extractAssistantContent(record: ClaudeJsonlRecord): {
  text: string;
  toolUses: ExtractedContent["toolUses"];
} {
  const raw = record.message?.content;
  if (typeof raw === "string") {
    return { text: sanitizeClaudeVisibleText(raw), toolUses: [] };
  }
  if (!Array.isArray(raw)) return { text: "", toolUses: [] };

  let text = "";
  const toolUses: ExtractedContent["toolUses"] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const block = item as Record<string, any>;
    if (block.type === "text" && typeof block.text === "string") {
      const piece = sanitizeClaudeVisibleText(block.text);
      if (piece) text += (text ? "\n\n" : "") + piece;
    } else if (block.type === "tool_use") {
      toolUses.push({
        id: String(block.id ?? ""),
        name: String(block.name ?? "unknown"),
        input: JSON.stringify(block.input ?? {}),
      });
    }
    // thinking / redacted_thinking 等块不导入（来源端推理态，不进历史）
  }
  return { text, toolUses };
}

// ─── 主解析 ───

function makeMessageId(): string {
  return `imp-${randomUUID()}`;
}

/**
 * 解析 Claude Code 会话 JSONL 行（已 JSON.parse 的记录序列）。
 * 零可见轮次时 turns 为空数组（调用方决定报错还是跳过）。
 */
export function parseClaudeJsonlRecords(records: ClaudeJsonlRecord[]): ParsedClaudeSession {
  const turns: Turn[] = [];
  let cwd: string | undefined;
  let firstUserText: string | undefined;
  let model: string | undefined;
  let createdAt: number | undefined;
  let updatedAt: number | undefined;

  // 当前回合的累计 assistant 内容（多条 assistant 记录合成一条 Message）
  let pendingAssistant: {
    createdAt: number;
    blocks: ContentBlock[];
    model?: string;
    isApiError: boolean;
    hasVisible: boolean;
  } | null = null;

  const flushAssistant = () => {
    if (!pendingAssistant?.hasVisible) {
      pendingAssistant = null;
      return;
    }
    const current = turns[turns.length - 1];
    const message: Message = {
      id: makeMessageId(),
      role: "assistant",
      kind: "model",
      source: {
        kind: "model",
        provider: "claude-import",
        model: pendingAssistant.model ?? "unknown",
      },
      metadata: pendingAssistant.isApiError ? { apiError: true } : {},
      content: pendingAssistant.blocks,
      createdAt: pendingAssistant.createdAt,
    };
    if (current) {
      current.messages.push(message);
    } else {
      // assistant 首条（缺 user 锚点的残缺会话）：补一个空回合外壳，避免消息悬空
      turns.push({
        id: makeMessageId(),
        kind: "turn",
        metadata: {},
        messages: [message],
        visible: true,
        createdAt: pendingAssistant.createdAt,
      });
    }
    pendingAssistant = null;
  };

  for (const record of records) {
    if (!record || typeof record !== "object") continue;
    const ts = recordTimestamp(record);
    if (ts !== undefined) {
      if (createdAt === undefined || ts < createdAt) createdAt = ts;
      if (updatedAt === undefined || ts > updatedAt) updatedAt = ts;
    }

    // 任一记录标 isSidechain 即整文件是 subagent 日志：由调用方处理，这里直接终止
    if (record.isSidechain === true) {
      return { turns: [], meta: { cwd, previewTitle: undefined, model, createdAt, updatedAt, turnCount: 0 } };
    }

    const type = record.type;

    if (type === "user") {
      if (record.isMeta === true) continue;
      const { text, toolResults } = extractUserContent(record);
      const recordCwd = record.cwd ?? (record.message as Record<string, unknown> | undefined)?.cwd;
      if (!cwd && typeof recordCwd === "string" && recordCwd && text) cwd = recordCwd;

      if (toolResults.length === 0 && !text) continue;

      // 工具结果 → tool Message（挂当前回合）
      if (toolResults.length > 0) {
        flushAssistant();
        const current = turns[turns.length - 1];
        if (!current) continue; // 悬空 tool_result（无回合归属）丢弃
        for (const tr of toolResults) {
          if (!tr.toolUseId) continue;
          current.messages.push({
            id: makeMessageId(),
            role: "tool",
            kind: "model",
            source: { kind: "tool", toolCallId: tr.toolUseId },
            metadata: {},
            content: [
              {
                type: "tool-result",
                toolCallId: tr.toolUseId,
                name: tr.toolUseId, // name 未知时用 toolCallId 占位（UI 卡片兜底展示）
                content: tr.content,
                ...(tr.isError !== undefined ? { isError: tr.isError } : {}),
              } as ContentBlock,
            ],
            createdAt: ts,
          });
        }
        // 工具结果记录通常同时带一段文本（命令回显等）；可见则并入同回合 user 锚点缺失处——
        // 这里只处理纯 tool_result 载体（isMeta 已滤掉真实回执），带文本的走下方 user 锚点
        if (!text) continue;
      }

      if (!text) continue;

      // 可见 user 输入 → 关闭上一轮 assistant，开新 Turn
      flushAssistant();
      if (!firstUserText) firstUserText = text;
      turns.push({
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
            content: [{ type: "text", text } as ContentBlock],
            createdAt: ts,
          },
        ],
        visible: true,
        createdAt: ts,
      });
      continue;
    }

    if (type === "assistant") {
      if (isSynthetic(record) && record.isApiErrorMessage !== true) continue;
      const { text, toolUses } = extractAssistantContent(record);
      if (!text && toolUses.length === 0) continue;
      if (pendingAssistant === null) {
        pendingAssistant = {
          createdAt: ts ?? Date.now(),
          blocks: [],
          model: assistantModelOf(record),
          isApiError: record.isApiErrorMessage === true,
          hasVisible: false,
        };
      }
      const pm = pendingAssistant;
      if (text) {
        pm.blocks.push({ type: "text", text } as ContentBlock);
        pm.hasVisible = true;
      }
      for (const tu of toolUses) {
        if (!tu.id) continue;
        pm.blocks.push({
          type: "tool-call",
          toolCallId: tu.id,
          name: tu.name,
          arguments: tu.input,
        } as ContentBlock);
        pm.hasVisible = true;
      }
      if (!pm.model && assistantModelOf(record)) pm.model = assistantModelOf(record);
      if (!model && pm.model) model = pm.model;
      continue;
    }

    // 其他 type（system/summary/progress/queue…）：黑名单式宽容，忽略
  }

  flushAssistant();

  // tool-result 需要与同回合的 tool-call 配对：占位补齐悬空结果
  for (const turn of turns) {
    const calledIds = new Set(
      turn.messages
        .flatMap((m) => (m.role === "assistant" ? m.content : []))
        .filter((b): b is Extract<ContentBlock, { type: "tool-call" }> => b.type === "tool-call")
        .map((b) => b.toolCallId),
    );
    for (const msg of turn.messages) {
      if (msg.role !== "tool") continue;
      for (const block of msg.content) {
        if (block.type !== "tool-result" || calledIds.has(block.toolCallId)) continue;
        // 悬空：在 assistant 消息里补占位 tool-call（取同回合最后一条 assistant，无则造一条）
        const placeholderBlock: ContentBlock = {
          type: "tool-call",
          toolCallId: block.toolCallId,
          name: block.name,
          arguments: "{}",
        } as ContentBlock;
        const lastAssistant = [...turn.messages]
          .reverse()
          .find((m) => m.role === "assistant");
        if (lastAssistant) {
          lastAssistant.content.push(placeholderBlock);
        } else {
          turn.messages.unshift({
            id: makeMessageId(),
            role: "assistant",
            kind: "model",
            source: { kind: "model", provider: "claude-import", model: "unknown" },
            metadata: {},
            content: [placeholderBlock],
            createdAt: msg.createdAt,
          });
        }
      }
    }
  }

  return {
    turns,
    meta: {
      ...(cwd ? { cwd } : {}),
      ...(firstUserText ? { previewTitle: derivePreviewTitle(firstUserText) } : {}),
      ...(model ? { model } : {}),
      ...(createdAt !== undefined ? { createdAt } : {}),
      ...(updatedAt !== undefined ? { updatedAt } : {}),
      turnCount: turns.length,
    },
  };
}

/** 头部预览信息（扫描用：只看前 N 行即可拿到标题 / cwd / 时间 / 是否 sidechain） */
export function parseClaudeHeadInfo(records: ClaudeJsonlRecord[]): {
  previewTitle?: string;
  cwd?: string;
  createdAt?: number;
  updatedAt?: number;
  isSidechain: boolean;
} {
  for (const record of records) {
    if (record?.isSidechain === true) {
      return { isSidechain: true };
    }
  }
  const full = parseClaudeJsonlRecords(records);
  return {
    previewTitle: full.meta.previewTitle,
    cwd: full.meta.cwd,
    createdAt: full.meta.createdAt,
    updatedAt: full.meta.updatedAt,
    isSidechain: false,
  };
}
