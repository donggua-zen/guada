/**
 * DSH(deepseek-harness)会话日志只读 reader。
 *
 * 数据位置：`$DSH_HOME/sessions`（默认 `~/.dsh/sessions`），结构：
 *   <root>/--<cwd 转义>--/<sessionId>/session.jsonl[.zstd]
 *
 * 物理格式：append-only 事件日志，首行为 header（`{type:"session",version:0,...}`），
 * 之后每行一个事件 `{type,data,seq,time,surfaceOp?,sourceEventSeqs?}`。
 * 默认按批次写 zstd 帧：**多帧独立压缩后直接拼接**（首帧只有 header）。因此不能用
 * 一次性解压，必须按 RFC 8878 切帧后逐帧解压（Node 24 的 zstdDecompressSync 只读首帧）。
 *
 * 对话事件只有三类：
 *   - `user/message`：source.kind=user 是真实输入；source.kind=plugin 是注入上下文（跳过）；
 *   - `assistant/message`：一条 assistant 消息（content 块 + usage，最终态）；
 *   - `tool/result`：工具结果（role=user + tool-result 块 + source.kind=tool）。
 * `assistant/chunk` 与 `text-chunks`/`reasoning-chunks`/`tool-call-chunks` 打包行是流式增量，
 * 最终内容已包含在 assistant/message 中，导入时全部跳过。
 *
 * 编辑/重试不是 rewind，而是 fork 新会话（header 带 parentSession + seedLength，
 * 子会话日志含父会话前缀事件）；本期按独立会话导入，不做去重。
 * 压缩为 `compaction/*` 事件 + 紧随的 `surfaceOp: replace` 摘要消息：合成我们自己的
 * 压缩三事件（摘要消息本身不作为对话导入）。
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as zlib from "zlib";
import type { ContentBlock, Message, TokenUsage, Turn } from "../../../common/types/conversation.types";

// ─── 类型 ───

export interface DshSessionHeader {
  id: string;
  version: number;
  createdAt: number;
  cwd?: string;
  parentSession?: string;
  seedLength?: number;
  origin?: string;
  delegationDepth?: number;
}

export interface DshSessionSummary {
  id: string;
  sourcePath: string;
  cwd?: string;
  createdAt?: number;
  updatedAt: number;
  previewTitle?: string;
}

export interface ParsedDshCompaction {
  /** 压缩点落在第几个导入回合之前（吸附回合边界） */
  beforeTurnIndex: number;
  /** 摘要正文（compaction/summary.summary 的文本块拼接） */
  summary: string;
  /** 压缩点之前**已导入的消息条数**（精确到消息，优先于按回合求和） */
  rawBeforeMessages: number;
  time?: number;
}

export interface ParsedDshSession {
  turns: Turn[];
  compactions: ParsedDshCompaction[];
  meta: {
    title?: string;
    model?: string;
    createdAt?: number;
    updatedAt?: number;
    turnCount: number;
  };
}

interface DshEvent {
  type?: string;
  seq?: number;
  time?: number;
  data?: Record<string, any>;
  surfaceOp?: unknown;
  sourceEventSeqs?: unknown;
}

// ─── 路径定位 ───

/** DSH home：$DSH_HOME 优先，否则 ~/.dsh */
export function resolveDshHome(): string | undefined {
  const env = process.env.DSH_HOME?.trim();
  if (env) return env;
  const home = os.homedir();
  if (home) return path.join(home, ".dsh");
  return undefined;
}

/** 会话根目录（<dsh home>/sessions） */
export function dshSessionsRoot(): string | undefined {
  const home = resolveDshHome();
  return home ? path.join(home, "sessions") : undefined;
}

// ─── 多帧 zstd 解压 ───

const ZSTD_MAGIC = 0xfd2fb528;

function hasZstdSupport(): boolean {
  return typeof (zlib as unknown as { zstdDecompressSync?: unknown }).zstdDecompressSync === "function";
}

/**
 * 按 RFC 8878 切出每个完整 zstd 帧的边界；末尾不完整帧（追加写中途）返回截止位置。
 * 返回 null 表示该位置不是合法帧头（损坏），调用方应停止解析。
 */
export function splitZstdFrames(buffer: Buffer): { frames: Array<{ start: number; end: number }>; truncatedAt?: number } {
  const frames: Array<{ start: number; end: number }> = [];
  let offset = 0;

  while (offset < buffer.length) {
    const start = offset;
    if (offset + 4 > buffer.length) return { frames, truncatedAt: offset };
    if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) {
      // 非帧头：可能是写入中途的残片，按 torn tail 处理
      return { frames, truncatedAt: offset };
    }
    offset += 4;
    if (offset + 1 > buffer.length) return { frames, truncatedAt: start };
    const descriptor = buffer[offset];
    offset += 1;

    const fcsFlag = (descriptor >> 6) & 0x03;
    const singleSegment = (descriptor >> 5) & 0x01;
    const checksumFlag = (descriptor >> 2) & 0x01;
    const dictIdFlag = descriptor & 0x03;

    if (!singleSegment) {
      if (offset + 1 > buffer.length) return { frames, truncatedAt: start };
      offset += 1; // Window_Descriptor
    }

    const dictIdSize = dictIdFlag === 0 ? 0 : dictIdFlag === 1 ? 1 : dictIdFlag === 2 ? 2 : 4;
    if (offset + dictIdSize > buffer.length) return { frames, truncatedAt: start };
    offset += dictIdSize;

    const fcsSize =
      fcsFlag === 0 ? (singleSegment ? 1 : 0) : fcsFlag === 1 ? 2 : fcsFlag === 2 ? 4 : 8;
    if (offset + fcsSize > buffer.length) return { frames, truncatedAt: start };
    offset += fcsSize;

    // Data_Block 序列
    let truncated = false;
    while (true) {
      if (offset + 3 > buffer.length) {
        truncated = true;
        break;
      }
      const blockHeader = buffer[offset] | (buffer[offset + 1] << 8) | (buffer[offset + 2] << 16);
      offset += 3;
      const lastBlock = blockHeader & 0x01;
      const blockType = (blockHeader >> 1) & 0x03;
      const blockSize = blockHeader >>> 3;
      const dataSize = blockType === 1 ? 1 : blockSize; // RLE 只占 1 字节
      if (blockType === 3) return { frames, truncatedAt: start }; // Reserved: 非法
      if (offset + dataSize > buffer.length) {
        truncated = true;
        break;
      }
      offset += dataSize;
      if (lastBlock) break;
    }
    if (truncated) return { frames, truncatedAt: start };

    if (checksumFlag) {
      if (offset + 4 > buffer.length) return { frames, truncatedAt: start };
      offset += 4;
    }

    frames.push({ start, end: offset });
  }

  return { frames };
}

/** 解压多帧拼接的 zstd 缓冲；容忍末尾 torn frame。 */
export function decompressZstdFrames(buffer: Buffer): Buffer {
  if (!hasZstdSupport()) {
    throw new Error("zstd_unsupported");
  }
  const decompress = (zlib as unknown as { zstdDecompressSync: (buf: Buffer) => Buffer }).zstdDecompressSync;
  const { frames } = splitZstdFrames(buffer);
  const parts: Buffer[] = [];
  for (const frame of frames) {
    try {
      parts.push(decompress(buffer.subarray(frame.start, frame.end)));
    } catch (err: any) {
      // 单帧损坏：停止解析，保留之前已解出的内容
      if (parts.length === 0) throw err;
      break;
    }
  }
  return Buffer.concat(parts);
}

// ─── 文件读取 ───

/** 按后缀解出会话日志的明文（jsonl 文本） */
export function readDshLogText(filePath: string): string {
  const raw = fs.readFileSync(filePath);
  if (filePath.endsWith(".zstd")) {
    return decompressZstdFrames(raw).toString("utf8");
  }
  return raw.toString("utf8");
}

/** 逐行解析；只接受完整行，损坏行跳过 */
function parseLines(text: string, onLine: (parsed: Record<string, any>) => void): void {
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === "object") onLine(parsed as Record<string, any>);
    } catch {
      // 半行/坏行（可能正在追加写）：跳过
    }
  }
}

/** 读 header 行并校验版本 */
function readHeader(filePath: string): DshSessionHeader {
  const text = readDshLogText(filePath);
  let header: Record<string, any> | null = null;
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      header = JSON.parse(trimmed);
    } catch {
      continue;
    }
    break;
  }
  if (!header || header.type !== "session") {
    throw new Error("read_failed: invalid session header");
  }
  const version = typeof header.version === "number" ? header.version : -1;
  if (version !== 0) {
    throw new Error("unsupported_version");
  }
  return {
    id: String(header.id ?? ""),
    version,
    createdAt: typeof header.createdAt === "number" ? header.createdAt : 0,
    ...(typeof header.cwd === "string" && header.cwd ? { cwd: header.cwd } : {}),
    ...(typeof header.parentSession === "string" ? { parentSession: header.parentSession } : {}),
    ...(typeof header.seedLength === "number" ? { seedLength: header.seedLength } : {}),
    ...(typeof header.origin === "string" ? { origin: header.origin } : {}),
    ...(typeof header.delegationDepth === "number" ? { delegationDepth: header.delegationDepth } : {}),
  };
}

/** 读投影缓存里的标题（best-effort；不存在/损坏返回 undefined） */
function readProjcacheTitle(dshHome: string | undefined, sessionId: string): string | undefined {
  if (!dshHome) return undefined;
  const file = path.join(dshHome, "storages", "session_projcache", "sessions", `${sessionId}.json`);
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    const title = parsed?.record?.rows?.title?.val;
    return typeof title === "string" && title.trim() ? title.trim() : undefined;
  } catch {
    return undefined;
  }
}

// ─── 扫描 ───

/** 收集 <root>/<projectDir>/<sessionDir>/session.jsonl[.zstd] */
export function collectDshSessionFiles(root: string): string[] {
  const files: string[] = [];
  let projects: fs.Dirent[];
  try {
    projects = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return files;
  }
  for (const project of projects) {
    if (!project.isDirectory()) continue;
    const projectPath = path.join(root, project.name);
    let sessions: fs.Dirent[];
    try {
      sessions = fs.readdirSync(projectPath, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const session of sessions) {
      if (!session.isDirectory()) continue;
      const sessionDir = path.join(projectPath, session.name);
      const zstd = path.join(sessionDir, "session.jsonl.zstd");
      const plain = path.join(sessionDir, "session.jsonl");
      if (fs.existsSync(zstd)) {
        files.push(zstd);
      } else if (fs.existsSync(plain)) {
        files.push(plain);
      }
    }
  }
  return files;
}

/**
 * 扫描会话候选（只解首帧拿 header；标题优先投影缓存，缺失时取首条真实 user 文本）。
 * 过滤 subagent 会话（header.origin === "subagent"）。
 */
export function scanDshSessions(rootOverride?: string): DshSessionSummary[] {
  const home = resolveDshHome();
  const root = rootOverride ?? (home ? path.join(home, "sessions") : undefined);
  if (!root) return [];

  const summaries: DshSessionSummary[] = [];
  for (const filePath of collectDshSessionFiles(root)) {
    try {
      const header = readHeader(filePath);
      if (header.origin === "subagent") continue;
      const stat = fs.statSync(filePath);
      const title = readProjcacheTitle(home, header.id);
      const previewTitle = title ?? readFirstUserText(filePath);
      summaries.push({
        id: header.id,
        sourcePath: filePath,
        ...(header.cwd ? { cwd: header.cwd } : {}),
        ...(header.createdAt > 0 ? { createdAt: header.createdAt } : {}),
        updatedAt: Math.round(stat.mtimeMs),
        ...(previewTitle ? { previewTitle } : {}),
      });
    } catch {
      // 单会话读失败（版本不符/损坏/运行时无 zstd）不影响其他候选
    }
  }
  return summaries.sort((a, b) => b.updatedAt - a.updatedAt);
}

/** 头部扫描：取首条真实 user 消息文本（扫描预览用） */
function readFirstUserText(filePath: string): string | undefined {
  try {
    const text = readDshLogText(filePath);
    let found: string | undefined;
    parseLines(text, (event) => {
      if (found || event.type !== "user/message") return;
      const data = event.data as Record<string, any> | undefined;
      if (data?.source?.kind !== "user") return;
      const textPieces = extractTextBlocks(data?.content);
      if (textPieces) found = textPieces;
    });
    return found;
  } catch {
    return undefined;
  }
}

function extractTextBlocks(content: unknown): string | undefined {
  if (!Array.isArray(content)) return undefined;
  const pieces: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const b = block as Record<string, any>;
    if (b.type === "text" && typeof b.text === "string" && b.text.trim()) {
      pieces.push(b.text.trim());
    }
  }
  return pieces.length > 0 ? pieces.join("\n\n") : undefined;
}

// ─── 事件 → Turn[] ───

function makeMessageId(): string {
  return `dimp-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

function mapDshUsage(usage: Record<string, any> | undefined): TokenUsage | undefined {
  if (!usage || typeof usage !== "object") return undefined;
  const input = typeof usage.inputTokens === "number" ? usage.inputTokens : 0;
  const cacheRead = typeof usage.cacheReadTokens === "number" ? usage.cacheReadTokens : 0;
  const cacheWrite = typeof usage.cacheWriteTokens === "number" ? usage.cacheWriteTokens : 0;
  const output = typeof usage.outputTokens === "number" ? usage.outputTokens : 0;
  // inputTokens 仅未缓存输入：完整 prompt = 未缓存 + 缓存读 + 缓存写
  const promptTokens = input + cacheRead + cacheWrite;
  const total = typeof usage.totalTokens === "number" ? usage.totalTokens : promptTokens + output;
  const result: TokenUsage = {
    promptTokens,
    completionTokens: output,
    totalTokens: total,
  };
  if (cacheRead > 0 || cacheWrite > 0) {
    result.cachedTokens = {
      ...(cacheRead > 0 ? { read: cacheRead } : {}),
      ...(cacheWrite > 0 ? { written: cacheWrite } : {}),
    };
  }
  if (typeof usage.reasoningTokens === "number" && usage.reasoningTokens > 0) {
    result.reasoningTokens = usage.reasoningTokens;
  }
  return result;
}

/** DSH content 块 → 我们的内容块（image 不迁移，记占位文本） */
function mapContentBlocks(content: unknown): ContentBlock[] {
  if (!Array.isArray(content)) return [];
  const blocks: ContentBlock[] = [];
  for (const item of content) {
    if (!item || typeof item !== "object") continue;
    const b = item as Record<string, any>;
    if (b.type === "text") {
      if (typeof b.text === "string" && b.text) blocks.push({ type: "text", text: b.text } as ContentBlock);
    } else if (b.type === "reasoning") {
      if (typeof b.text === "string" && b.text) blocks.push({ type: "reasoning", summary: b.text } as ContentBlock);
    } else if (b.type === "tool-call") {
      const toolCallId = typeof b.id === "string" ? b.id : "";
      if (!toolCallId) continue;
      blocks.push({
        type: "tool-call",
        toolCallId,
        name: typeof b.name === "string" ? b.name : "unknown",
        arguments: typeof b.arguments === "string" ? b.arguments : JSON.stringify(b.arguments ?? {}),
      } as ContentBlock);
    } else if (b.type === "tool-result") {
      // 极少出现在 assistant content；按文本占位
      const text = flattenToolResultContent(b.content);
      blocks.push({ type: "text", text: text || "[tool result]" } as ContentBlock);
    } else if (b.type === "image") {
      const name = b.attachment?.name;
      blocks.push({ type: "text", text: `[attachment${typeof name === "string" && name ? `: ${name}` : ""}]` } as ContentBlock);
    }
  }
  return blocks;
}

/** tool-result 的嵌套 content 数组拍平为文本 */
function flattenToolResultContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const pieces: string[] = [];
  for (const item of content) {
    if (typeof item === "string") {
      pieces.push(item);
      continue;
    }
    if (item && typeof item === "object") {
      const b = item as Record<string, any>;
      if (typeof b.text === "string") pieces.push(b.text);
      else if (Array.isArray(b.content)) pieces.push(flattenToolResultContent(b.content));
    }
  }
  return pieces.filter(Boolean).join("\n\n");
}

function isReplaceSurface(event: DshEvent): boolean {
  const op = event.surfaceOp;
  return !!op && typeof op === "object" && (op as Record<string, any>).op === "replace";
}

/** 摘要事件：compaction/summary.summary（ContentBlock[]）→ 纯文本 */
function compactionSummaryText(data: Record<string, any> | undefined): string {
  const blocks = data?.summary;
  const text = extractTextBlocks(Array.isArray(blocks) ? blocks : []);
  return text ?? "";
}

/**
 * 读取并解析一个 DSH 会话。
 * 轮次聚合：真实 user 消息开新 Turn；其后的 assistant/tool 消息挂到最近回合。
 */
export function readDshSession(filePath: string): ParsedDshSession {
  const header = readHeader(filePath);
  const text = readDshLogText(filePath);

  const turns: Turn[] = [];
  const compactions: ParsedDshCompaction[] = [];
  /** 事件 seq → 处理完该事件后的累计导入消息条数（压缩点换算用） */
  const importedCountBySeq = new Map<number, number>();
  let importedMessageCount = 0;
  let model: string | undefined;
  let title: string | undefined;
  let updatedAt = header.createdAt;

  const appendMessage = (turn: Turn, message: Message): void => {
    turn.messages.push(message);
    importedMessageCount += 1;
  };

  parseLines(text, (raw) => {
    const event = raw as DshEvent;
    const type = event.type;
    if (!type || type === "session") return;
    const seq = typeof event.seq === "number" ? event.seq : -1;
    if (typeof event.time === "number" && event.time > updatedAt) updatedAt = event.time;
    const data = (event.data ?? {}) as Record<string, any>;

    if (type === "session/title") {
      if (typeof data.title === "string" && data.title.trim()) title = data.title.trim();
      importedCountBySeq.set(seq, importedMessageCount);
      return;
    }

    if (type === "compaction/summary") {
      const summary = compactionSummaryText(data);
      // 被遮蔽的 surface 事件 seq → 该位置之前的累计导入消息数
      const shadowedSeqs: number[] = Array.isArray(data.shadowedSeqs)
        ? (data.shadowedSeqs as unknown[]).filter((v): v is number => typeof v === "number")
        : [];
      let rawBeforeMessages = 0;
      for (const shadowedSeq of shadowedSeqs) {
        const count = importedCountBySeq.get(shadowedSeq);
        if (typeof count === "number" && count > rawBeforeMessages) rawBeforeMessages = count;
      }
      if (rawBeforeMessages > 0) {
        compactions.push({
          beforeTurnIndex: turns.length,
          summary: summary || "（源会话在此处压缩过历史对话，摘要不可用）",
          rawBeforeMessages,
          ...(typeof event.time === "number" ? { time: event.time } : {}),
        });
      }
      importedCountBySeq.set(seq, importedMessageCount);
      return;
    }

    if (type === "user/message") {
      // 注入上下文（AGENTS.md/skills/通知等）不是真实对话
      if (data.source?.kind !== "user") {
        importedCountBySeq.set(seq, importedMessageCount);
        return;
      }
      // 压缩摘要的 surface 替换消息：由 compaction 合成路径承担
      if (isReplaceSurface(event)) {
        importedCountBySeq.set(seq, importedMessageCount);
        return;
      }
      const blocks = mapContentBlocks(data.content);
      if (blocks.length === 0) {
        importedCountBySeq.set(seq, importedMessageCount);
        return;
      }
      const turn: Turn = {
        id: makeMessageId(),
        kind: "turn",
        metadata: {},
        messages: [],
        visible: true,
        createdAt: typeof event.time === "number" ? event.time : header.createdAt,
      };
      turns.push(turn);
      appendMessage(turn, {
        id: makeMessageId(),
        role: "user",
        kind: "user",
        source: { kind: "user" },
        metadata: {},
        content: blocks,
        createdAt: typeof event.time === "number" ? event.time : undefined,
      });
      importedCountBySeq.set(seq, importedMessageCount);
      return;
    }

    if (type === "assistant/message") {
      const message = data.message as Record<string, any> | undefined;
      const blocks = mapContentBlocks(message?.content);
      if (blocks.length === 0) {
        importedCountBySeq.set(seq, importedMessageCount);
        return;
      }
      const msgModel = typeof message?.source?.model === "string" ? message.source.model : undefined;
      if (msgModel) model = msgModel;
      const usage = mapDshUsage(data.usage as Record<string, any> | undefined);
      const assistant: Message = {
        id: makeMessageId(),
        role: "assistant",
        kind: "model",
        source: {
          kind: "model",
          provider: typeof message?.source?.provider === "string" ? message.source.provider : "dsh-import",
          model: msgModel ?? "unknown",
        },
        metadata: usage ? { usage } : {},
        content: blocks,
        createdAt: typeof event.time === "number" ? event.time : undefined,
      };
      if (turns.length === 0) {
        const turn: Turn = {
          id: makeMessageId(),
          kind: "turn",
          metadata: {},
          messages: [],
          visible: true,
          createdAt: typeof event.time === "number" ? event.time : header.createdAt,
        };
        turns.push(turn);
      }
      appendMessage(turns[turns.length - 1], assistant);
      importedCountBySeq.set(seq, importedMessageCount);
      return;
    }

    if (type === "tool/result") {
      const message = data.message as Record<string, any> | undefined;
      const toolResultBlocks = Array.isArray(message?.content)
        ? (message.content as Array<Record<string, any>>).filter((b) => b?.type === "tool-result")
        : [];
      if (toolResultBlocks.length === 0) {
        importedCountBySeq.set(seq, importedMessageCount);
        return;
      }
      if (turns.length === 0) {
        const turn: Turn = {
          id: makeMessageId(),
          kind: "turn",
          metadata: {},
          messages: [],
          visible: true,
          createdAt: typeof event.time === "number" ? event.time : header.createdAt,
        };
        turns.push(turn);
      }
      const turn = turns[turns.length - 1];
      for (const block of toolResultBlocks) {
        const toolCallId = typeof block.toolCallId === "string" && block.toolCallId
          ? block.toolCallId
          : typeof message?.source?.callId === "string"
            ? message.source.callId
            : "";
        if (!toolCallId) continue;
        const content = flattenToolResultContent(block.content);
        const isError = block.isError === true || !!data.error;
        appendMessage(turn, {
          id: makeMessageId(),
          role: "tool",
          kind: "model",
          source: { kind: "tool", toolCallId },
          metadata: {},
          content: [
            {
              type: "tool-result",
              toolCallId,
              name: toolCallId,
              content,
              ...(isError ? { isError: true } : {}),
            } as ContentBlock,
          ],
          createdAt: typeof event.time === "number" ? event.time : undefined,
        });
      }
      importedCountBySeq.set(seq, importedMessageCount);
      return;
    }

    // assistant/chunk、text-chunks/reasoning-chunks/tool-call-chunks、turn/step/request/* 等：
    // 非对话内容（增量块最终内容已在 assistant/message），跳过但记录计数快照
    importedCountBySeq.set(seq, importedMessageCount);
  });

  // turn/finish 的 modelName 用该轮最后一条 assistant 的 model
  for (const turn of turns) {
    const lastAssistant = [...turn.messages].reverse().find((m) => m.role === "assistant");
    const usedModel =
      lastAssistant?.source.kind === "model" ? lastAssistant.source.model : undefined;
    if (usedModel && usedModel !== "unknown") turn.metadata.modelName = usedModel;
  }

  return {
    turns,
    compactions,
    meta: {
      ...(title ? { title } : {}),
      ...(model ? { model } : {}),
      ...(header.createdAt > 0 ? { createdAt: header.createdAt } : {}),
      ...(updatedAt > 0 ? { updatedAt } : {}),
      turnCount: turns.length,
    },
  };
}
