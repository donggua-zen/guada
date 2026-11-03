/**
 * Codex(ChatGPT CLI / Codex Desktop) rollout 日志只读 reader。
 *
 * 数据位置：`$CODEX_HOME/sessions`（默认 `~/.codex/sessions`）按 YYYY/MM/DD 分层，
 * 另有扁平的 `archived_sessions`；每个会话一个/多个 `rollout-*.jsonl`。
 *
 * 分页机制（新版 Codex CLI）：同一 thread 的 rollout 拆成多个文件，文件名共享
 * `rollout-<时间戳>-<threadId>` 前缀，后续页带 `_<pageId>` 后缀；按文件名内嵌时间戳排序
 * 后按页拼接（**必须用换行连接**，否则上一页末行会与下一页首行粘成一行）。
 *
 * 行格式：`{timestamp, ordinal?, type, payload}`。
 * - `session_meta`：`{id(thread), session_id?, cwd, timestamp, parent_thread_id?,
 *   thread_source?, source?{subagent?}, originator?, cli_version?}`；子代理 rollout 跳过。
 * - `turn_context`：`{model?, cwd, ...}`（会话中途可切换模型）。
 * - `compacted`：`{message}` —— 压缩边界，message 是交接摘要正文。
 * - `event_msg`：`token_count` 携带 `info.last_token_usage` + `model_context_window`
 *   （用量/上下文窗口的真源）；`user_message`/`agent_message` 是 response_item 的重复，
 *   一律忽略；`turn_aborted` 忽略。
 * - `response_item`：`message`(user/assistant/developer)、`function_call`、
 *   `function_call_output`、`custom_tool_call`、`custom_tool_call_output`、`reasoning`。
 *   `reasoning` 的可读文本在 `summary[].text`，`encrypted_content` 不读。
 *
 * 注入过滤（与 dsh-chat-import 插件同口径）：user 消息里以 `<` 开头的环境块、
 * `# AGENTS.md` 等注入前缀、以及 `<external_codex_apps_open_page>…</…>` 页面上下文
 * 都不是人类输入，过滤后为空的消息不开轮。图片不迁移，记 `[attachment]` 占位。
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { ContentBlock, Message, TokenUsage, Turn } from "../../../common/types/conversation.types";

// ─── 类型 ───

export interface CodexSessionMeta {
  /** thread id（payload.id；旧版可能是 session_id） */
  id: string;
  cwd?: string;
  createdAt?: number;
  parentThreadId?: string;
  originator?: string;
  cliVersion?: string;
  subagent?: string;
}

export interface CodexRolloutPage {
  filePath: string;
  nameTimestamp?: string;
}

export interface CodexSessionSummary {
  id: string;
  /** 链的首页（幂等锚点/展示路径） */
  sourcePath: string;
  pages: CodexRolloutPage[];
  cwd?: string;
  createdAt?: number;
  updatedAt: number;
  previewTitle?: string;
}

export interface ParsedCodexCompaction {
  beforeTurnIndex: number;
  summary: string;
  rawBeforeMessages: number;
  time?: number;
}

export interface ParsedCodexSession {
  turns: Turn[];
  compactions: ParsedCodexCompaction[];
  meta: {
    title?: string;
    model?: string;
    contextWindow?: number;
    createdAt?: number;
    updatedAt?: number;
    turnCount: number;
  };
}

interface CodexRecord {
  timestamp?: string;
  ordinal?: number;
  type?: string;
  payload?: Record<string, any>;
}

// ─── 路径与扫描 ───

export function resolveCodexHome(): string | undefined {
  const env = process.env.CODEX_HOME?.trim();
  if (env) return env;
  const home = os.homedir();
  return home ? path.join(home, ".codex") : undefined;
}

export function codexSessionRoots(): string[] {
  const home = resolveCodexHome();
  if (!home) return [];
  return [path.join(home, "sessions"), path.join(home, "archived_sessions")].filter((root) => {
    try {
      return fs.existsSync(root);
    } catch {
      return false;
    }
  });
}

function collectRolloutFiles(dir: string, out: string[], depth = 0): void {
  if (depth > 10) return;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectRolloutFiles(full, out, depth + 1);
    else if (entry.isFile() && entry.name.toLowerCase().endsWith(".jsonl")) out.push(full);
  }
}

const UUID_RE = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/;
const NAME_TS_RE = /rollout-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})-/;

/** 文件名里第一个 UUID 即 thread id（分页共享）；取不到返回 undefined */
export function codexThreadIdFromName(name: string): string | undefined {
  const match = name.match(UUID_RE);
  return match ? match[0] : undefined;
}

function nameTimestamp(name: string): string | undefined {
  const match = name.match(NAME_TS_RE);
  return match ? match[1] : undefined;
}

/** 读文件头（最多 256KB）：解析 session_meta 与首条真实 user 提问（扫描预览用） */
function readSessionHead(filePath: string): {
  meta: CodexRecord["payload"] | null;
  firstUserPrompt?: string;
} {
  let head: string;
  try {
    const fd = fs.openSync(filePath, "r");
    try {
      const buffer = Buffer.alloc(256 * 1024);
      const bytes = fs.readSync(fd, buffer, 0, buffer.length, 0);
      head = buffer.subarray(0, bytes).toString("utf8");
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return { meta: null };
  }

  let meta: CodexRecord["payload"] | null = null;
  let firstUserPrompt: string | undefined;
  for (const line of head.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let record: CodexRecord;
    try {
      record = JSON.parse(trimmed) as CodexRecord;
    } catch {
      break; // 截断的尾行：停止
    }
    if (!record || typeof record !== "object") continue;
    if (!meta && record.type === "session_meta" && record.payload && typeof record.payload === "object") {
      meta = record.payload;
      continue;
    }
    if (firstUserPrompt !== undefined) continue;
    if (
      record.type === "response_item" &&
      record.payload?.type === "message" &&
      record.payload.role === "user"
    ) {
      const prompt = codexUserPrompt(record.payload.content);
      if (prompt) firstUserPrompt = prompt.replace(/\s+/g, " ").slice(0, 50);
    }
  }
  return {
    meta,
    ...(firstUserPrompt ? { firstUserPrompt } : {}),
  };
}

/** 子代理 rollout 判定（与插件同口径），返回命中标记名 */
export function codexSubagentMarker(payload: Record<string, any> | null | undefined): string | null {
  if (!payload || typeof payload !== "object") return null;
  if (payload.thread_source === "subagent") return "thread_source=subagent";
  const src = payload.source as Record<string, any> | undefined;
  if (src && typeof src === "object" && src.subagent) return "source.subagent";
  return null;
}

function toTimeMs(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value > 1e12 ? value : value * 1000;
  if (typeof value === "string" && value) {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? undefined : parsed;
  }
  return undefined;
}

/** 标题索引：~/.codex/session_index.jsonl（{id, thread_name}，后写覆盖） */
function readCodexTitleIndex(home: string | undefined): Map<string, string> {
  const titles = new Map<string, string>();
  if (!home) return titles;
  const file = path.join(home, "session_index.jsonl");
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return titles;
  }
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const row = JSON.parse(trimmed);
      if (typeof row?.id === "string" && typeof row?.thread_name === "string" && row.thread_name.trim()) {
        titles.set(row.id, row.thread_name.trim());
      }
    } catch {
      // 坏行跳过
    }
  }
  return titles;
}

const INJECT_MARKERS = [
  "<environment_context>",
  "<system-reminder>",
  "<user_instructions>",
  "<local-command-caveat>",
  "<local-command-stdout>",
  "<command-name>",
  "<permissions>",
  "# agents.md",
  "# files mentioned",
  "the user is asking about",
  "# context from my ide setup:",
  "<user_info>",
];

const PAGE_CONTEXT_RE = /<external_codex_apps_open_page>[\s\S]*?<\/external_codex_apps_open_page>/g;

/** user 消息 → 真实提问文本（过滤注入块与页面上下文信封） */
export function codexUserPrompt(content: unknown): string {
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const b = block as Record<string, any>;
    if (b.type !== "input_text" || typeof b.text !== "string") continue;
    const text = b.text.replace(PAGE_CONTEXT_RE, "").trim();
    if (!text) continue;
    const lower = text.toLowerCase();
    if (text.startsWith("<")) continue;
    if (INJECT_MARKERS.some((marker) => lower.startsWith(marker))) continue;
    parts.push(text);
  }
  return parts.join("\n").trim();
}

// ─── 扫描 ───

interface ThreadGroup {
  threadId: string;
  pages: CodexRolloutPage[];
}

function groupThreads(files: string[]): Map<string, CodexRolloutPage[]> {
  const groups = new Map<string, CodexRolloutPage[]>();
  for (const filePath of files) {
    const name = path.basename(filePath);
    const threadId = codexThreadIdFromName(name) ?? `file:${filePath.replace(/\\/g, "/").toLowerCase()}`;
    const pages = groups.get(threadId) ?? [];
    pages.push({ filePath, nameTimestamp: nameTimestamp(name) });
    groups.set(threadId, pages);
  }
  return groups;
}

/** 页序：文件名内嵌时间戳优先，mtime 回退，最后文件名稳定排序 */
function sortPages(pages: CodexRolloutPage[]): CodexRolloutPage[] {
  const withStat = pages.map((page) => {
    let mtime = 0;
    try {
      mtime = fs.statSync(page.filePath).mtimeMs;
    } catch {
      // 读不到按 0
    }
    return { page, mtime };
  });
  withStat.sort((a, b) => {
    const ta = a.page.nameTimestamp ?? "";
    const tb = b.page.nameTimestamp ?? "";
    if (ta !== tb) return ta < tb ? -1 : 1;
    if (a.mtime !== b.mtime) return a.mtime - b.mtime;
    return a.page.filePath < b.page.filePath ? -1 : a.page.filePath > b.page.filePath ? 1 : 0;
  });
  return withStat.map((item) => item.page);
}

/** 扫描全部 Codex 会话（按 thread 聚合分页） */
export function scanCodexSessions(rootsOverride?: string[]): CodexSessionSummary[] {
  const home = resolveCodexHome();
  const roots = rootsOverride ?? codexSessionRoots();
  const titles = readCodexTitleIndex(home);
  const files: string[] = [];
  for (const root of roots) collectRolloutFiles(root, files);

  const summaries: CodexSessionSummary[] = [];
  for (const [threadId, rawPages] of groupThreads(files)) {
    const pages = sortPages(rawPages);
    const head = pages[0];
    const headInfo = head ? readSessionHead(head.filePath) : { meta: null };
    const meta = headInfo.meta;
    if (codexSubagentMarker(meta)) continue;

    const fallbackId = threadId.startsWith("file:") ? "" : threadId;
    const metaId = typeof meta?.id === "string" && meta.id ? meta.id : "";
    const sessionId = fallbackId || metaId;
    if (!sessionId) continue;

    let updatedAt = 0;
    for (const page of pages) {
      try {
        const stat = fs.statSync(page.filePath);
        if (stat.mtimeMs > updatedAt) updatedAt = stat.mtimeMs;
      } catch {
        // 忽略单个文件 stat 失败
      }
    }

    const indexedTitle = titles.get(sessionId);
    const previewTitle = indexedTitle ?? headInfo.firstUserPrompt;
    summaries.push({
      id: sessionId,
      sourcePath: head.filePath,
      pages,
      ...(typeof meta?.cwd === "string" && meta.cwd ? { cwd: meta.cwd } : {}),
      ...(toTimeMs(meta?.timestamp) !== undefined ? { createdAt: toTimeMs(meta?.timestamp) } : {}),
      updatedAt,
      ...(previewTitle ? { previewTitle } : {}),
    });
  }
  return summaries.sort((a, b) => b.updatedAt - a.updatedAt);
}

// ─── 读取与解析 ───

function readPageText(filePath: string): string {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

function mapCodexUsage(info: Record<string, any> | undefined): TokenUsage | undefined {
  const last = info?.last_token_usage as Record<string, any> | undefined;
  if (!last || typeof last !== "object") return undefined;
  const input = typeof last.input_tokens === "number" ? last.input_tokens : 0;
  const cacheRead = typeof last.cached_input_tokens === "number" ? last.cached_input_tokens : 0;
  const cacheWrite = typeof last.cache_write_input_tokens === "number" ? last.cache_write_input_tokens : 0;
  const output = typeof last.output_tokens === "number" ? last.output_tokens : 0;
  // Codex 的 input_tokens 是未缓存部分；完整 prompt = 未缓存 + 缓存读 + 缓存写
  const promptTokens = input + cacheRead + cacheWrite;
  const usage: TokenUsage = {
    promptTokens,
    completionTokens: output,
    totalTokens:
      typeof last.total_tokens === "number" ? last.total_tokens : promptTokens + output,
  };
  if (cacheRead > 0 || cacheWrite > 0) {
    usage.cachedTokens = {
      ...(cacheRead > 0 ? { read: cacheRead } : {}),
      ...(cacheWrite > 0 ? { written: cacheWrite } : {}),
    };
  }
  if (typeof last.reasoning_output_tokens === "number" && last.reasoning_output_tokens > 0) {
    usage.reasoningTokens = last.reasoning_output_tokens;
  }
  return usage;
}

/** tool output 三种形态（纯文本 / JSON 字符串信封 / 块数组）→ 文本 */
function flattenCodexToolOutput(output: unknown): string {
  const blocksToText = (blocks: unknown[]): string => {
    const pieces: string[] = [];
    for (const block of blocks) {
      if (typeof block === "string") {
        pieces.push(block);
        continue;
      }
      if (block && typeof block === "object") {
        const b = block as Record<string, any>;
        if ((b.type === "input_text" || b.type === "output_text") && typeof b.text === "string") {
          pieces.push(b.text);
        }
      }
    }
    return pieces.join("\n");
  };

  if (typeof output === "string") {
    let parsed: any = null;
    try {
      parsed = JSON.parse(output);
    } catch {
      return output;
    }
    if (parsed && typeof parsed === "object") {
      if (Array.isArray(parsed.output)) return blocksToText(parsed.output);
      if (typeof parsed.output === "string") return parsed.output;
    }
    return output;
  }
  if (Array.isArray(output)) return blocksToText(output);
  if (output && typeof output === "object") {
    const o = output as Record<string, any>;
    if (Array.isArray(o.output)) return blocksToText(o.output);
    if (typeof o.output === "string") return o.output;
  }
  return typeof output === "string" ? output : JSON.stringify(output ?? "");
}

function makeMessageId(prefix = "cimp"): string {
  return `${prefix}-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

/** 拼接分页并解析（页间必须补换行） */
export function readCodexSession(pages: CodexRolloutPage[]): ParsedCodexSession {
  const sorted = pages.length > 1 ? sortPages(pages) : pages;
  const text = sorted.map((page) => readPageText(page.filePath)).join("\n");

  const turns: Turn[] = [];
  const compactions: ParsedCodexCompaction[] = [];
  let importedMessageCount = 0;
  let model: string | undefined;
  let contextWindow: number | undefined;
  let subagent: string | null = null;
  let firstUserPrompt: string | undefined;
  let createdAt: number | undefined;
  let updatedAt: number | undefined;

  /** 当前 assistant 消息（text/reasoning/tool-call 累计；tool 结果或新回合到来时落盘） */
  let pendingAssistant: Message | null = null;
  let currentTurn: Turn | null = null;

  const touch = (ms?: number) => {
    if (ms === undefined || !Number.isFinite(ms) || ms <= 0) return;
    if (createdAt === undefined || ms < createdAt) createdAt = ms;
    if (updatedAt === undefined || ms > updatedAt) updatedAt = ms;
  };

  const ensureTurn = (time?: number): Turn => {
    if (currentTurn) return currentTurn;
    const turn: Turn = {
      id: makeMessageId("cturn"),
      kind: "turn",
      metadata: {},
      messages: [],
      visible: true,
      ...(time !== undefined ? { createdAt: time } : {}),
    };
    turns.push(turn);
    currentTurn = turn;
    return turn;
  };

  const ensureAssistant = (time?: number): Message => {
    if (pendingAssistant) return pendingAssistant;
    pendingAssistant = {
      id: makeMessageId(),
      role: "assistant",
      kind: "model",
      source: { kind: "model", provider: "codex-import", model: model ?? "unknown" },
      metadata: {},
      content: [],
      ...(time !== undefined ? { createdAt: time } : {}),
    };
    return pendingAssistant;
  };

  const flushAssistant = () => {
    if (!pendingAssistant) return;
    const message = pendingAssistant;
    pendingAssistant = null;
    if (message.content.length === 0) return;
    ensureTurn(message.createdAt).messages.push(message);
    importedMessageCount += 1;
  };

  /** 最近一条 assistant 消息（pending 优先，否则当前回合最后一条） */
  const lastAssistantMessage = (): Message | null => {
    if (pendingAssistant) return pendingAssistant;
    const turn = currentTurn;
    if (!turn) return null;
    for (let i = turn.messages.length - 1; i >= 0; i--) {
      if (turn.messages[i].role === "assistant") return turn.messages[i];
    }
    return null;
  };

  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let record: CodexRecord;
    try {
      record = JSON.parse(trimmed) as CodexRecord;
    } catch {
      continue; // 半行/坏行跳过
    }
    if (!record || typeof record !== "object") continue;
    const type = record.type;
    const payload = (record.payload ?? {}) as Record<string, any>;
    const recTime = toTimeMs(record.timestamp);
    touch(recTime);

    if (type === "session_meta") {
      if (createdAt === undefined) createdAt = toTimeMs(payload.timestamp) ?? recTime;
      if (!subagent) subagent = codexSubagentMarker(payload);
      continue;
    }
    if (type === "turn_context") {
      if (typeof payload.model === "string" && payload.model) model = payload.model;
      continue;
    }
    if (type === "compacted") {
      // 压缩边界：摘要正文在 payload.message；全量记录仍保留在日志里。
      // 同位置可能有多条（压缩重试/多次落盘）——保留最新一条，避免重复压缩卡片。
      const summary = typeof payload.message === "string" ? payload.message.trim() : "";
      if (summary) {
        flushAssistant();
        const point: ParsedCodexCompaction = {
          beforeTurnIndex: turns.length,
          summary,
          rawBeforeMessages: importedMessageCount,
          ...(recTime !== undefined ? { time: recTime } : {}),
        };
        const last = compactions[compactions.length - 1];
        if (last && last.rawBeforeMessages === point.rawBeforeMessages) {
          compactions[compactions.length - 1] = point;
        } else {
          compactions.push(point);
        }
        currentTurn = null; // 边界之后的内容开新回合
      }
      continue;
    }
    if (type === "event_msg") {
      if (payload.type === "token_count") {
        const info = payload.info as Record<string, any> | undefined;
        if (typeof info?.model_context_window === "number" && info.model_context_window > 0) {
          contextWindow = info.model_context_window;
        }
        const usage = mapCodexUsage(info);
        const target = lastAssistantMessage();
        if (usage && target) {
          target.metadata = { ...target.metadata, usage };
          if (target.source.kind === "model" && model) {
            target.source = { ...target.source, model };
          }
        }
      }
      // user_message/agent_message 是 response_item 的重复；task_started/turn_aborted 等忽略
      continue;
    }
    if (type === "world_state") continue;
    if (type !== "response_item") continue;

    if (payload.type === "message") {
      const role = payload.role;
      const content = payload.content;
      if (role === "user") {
        const prompt = codexUserPrompt(content);
        const hasImages =
          Array.isArray(content) &&
          content.some(
            (b: any) =>
              b &&
              typeof b === "object" &&
              (b.type === "input_image" || b.type === "image_url" || b.type === "image"),
          );
        if (!prompt && !hasImages) continue; // 纯注入消息不开轮
        if (firstUserPrompt === undefined && prompt) firstUserPrompt = prompt;
        flushAssistant();
        const blocks: ContentBlock[] = [];
        if (prompt) blocks.push({ type: "text", text: prompt } as ContentBlock);
        if (hasImages) blocks.push({ type: "text", text: "[attachment]" } as ContentBlock);
        currentTurn = null;
        const turn = ensureTurn(recTime);
        turn.messages.push({
          id: makeMessageId(),
          role: "user",
          kind: "user",
          source: { kind: "user" },
          metadata: {},
          content: blocks,
          ...(recTime !== undefined ? { createdAt: recTime } : {}),
        });
        importedMessageCount += 1;
        continue;
      }
      if (role === "assistant") {
        if (!currentTurn) continue;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (!block || typeof block !== "object") continue;
            const b = block as Record<string, any>;
            if (b.type === "output_text" && typeof b.text === "string" && b.text.trim()) {
              ensureAssistant(recTime).content.push({ type: "text", text: b.text } as ContentBlock);
            } else if (
              b.type === "input_image" ||
              b.type === "output_image" ||
              b.type === "image_url" ||
              b.type === "image"
            ) {
              ensureAssistant(recTime).content.push({ type: "text", text: "[attachment]" } as ContentBlock);
            }
          }
        }
        continue;
      }
      // developer（系统提示）/ system：不导入
      continue;
    }

    if (payload.type === "reasoning") {
      if (!currentTurn) continue;
      const pieces: string[] = [];
      if (Array.isArray(payload.summary)) {
        for (const block of payload.summary) {
          if (block && typeof block === "object" && typeof (block as any).text === "string") {
            const t = (block as any).text.trim();
            if (t) pieces.push(t);
          }
        }
      }
      if (pieces.length > 0) {
        ensureAssistant(recTime).content.push({ type: "reasoning", summary: pieces.join("\n") } as ContentBlock);
      }
      continue;
    }

    if (payload.type === "function_call" || payload.type === "custom_tool_call") {
      if (!currentTurn) continue;
      const callId = typeof payload.call_id === "string" ? payload.call_id : "";
      if (!callId) continue;
      let args: string;
      if (payload.type === "function_call") {
        args = typeof payload.arguments === "string" ? payload.arguments : JSON.stringify(payload.arguments ?? {});
      } else {
        // custom_tool_call 的 input 可能是自由文本或 JS 代码形态；MVP 原样保留
        const input = payload.input;
        args = typeof input === "string" ? input : JSON.stringify(input ?? {});
      }
      ensureAssistant(recTime).content.push({
        type: "tool-call",
        toolCallId: callId,
        name: typeof payload.name === "string" ? payload.name : "unknown",
        arguments: args,
      } as ContentBlock);
      continue;
    }

    if (payload.type === "function_call_output" || payload.type === "custom_tool_call_output") {
      if (!currentTurn) continue;
      const callId = typeof payload.call_id === "string" ? payload.call_id : "";
      if (!callId) continue;
      flushAssistant(); // assistant（含 tool-call）先落盘，tool 结果随后
      const content = flattenCodexToolOutput(payload.output);
      currentTurn.messages.push({
        id: makeMessageId(),
        role: "tool",
        kind: "model",
        source: { kind: "tool", toolCallId: callId },
        metadata: {},
        content: [
          { type: "tool-result", toolCallId: callId, name: callId, content } as ContentBlock,
        ],
        ...(recTime !== undefined ? { createdAt: recTime } : {}),
      });
      importedMessageCount += 1;
      continue;
    }
  }

  // 收尾：未落盘的 assistant
  flushAssistant();

  if (subagent) {
    return { turns: [], compactions: [], meta: { turnCount: 0 } };
  }

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
      ...(firstUserPrompt ? { title: firstUserPrompt.replace(/\s+/g, " ").slice(0, 50) } : {}),
      ...(model ? { model } : {}),
      ...(contextWindow !== undefined ? { contextWindow } : {}),
      ...(createdAt !== undefined ? { createdAt } : {}),
      ...(updatedAt !== undefined ? { updatedAt } : {}),
      turnCount: turns.length,
    },
  };
}
