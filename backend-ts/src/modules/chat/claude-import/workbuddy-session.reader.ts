/**
 * WorkBuddy（腾讯 AI 编程应用）会话 JSONL 只读 reader。
 *
 * 数据位置（双根，Desktop 5.9.x 起数据根改名为 .workbuddy-ai，.workbuddy 只剩 logs）：
 *   ~/.workbuddy/projects/<project-hash>/<session-uuid>.jsonl
 *   ~/.workbuddy-ai/projects/<project-hash>/<session-uuid>.jsonl
 * 明文 JSONL，无压缩。每行 {id, parentId?, timestamp(ms), type, ...}。
 *
 * 事件词汇（与 CodeBuddy Code 同源，真实数据验证）：
 * - `message`：role=user|assistant，content 为块数组（input_text/output_text）；
 *   user 消息里真实提问包在 <user_query>…</user_query>，其余是 <system-reminder> 注入
 *   （user_context / identity / task-notification）；扩展字段 sessionId / cwd / providerData。
 * - `reasoning`：推理正文，独立于 assistant 消息先到；可读文本在 rawContent[].type='reasoning_text'。
 * - `function_call`：{callId, name, arguments, providerData:{model, usage, rawUsage}}；
 *   isPartialAborted / discard 标记的草稿调用不落盘。
 * - `function_call_result`：{callId, name, status, output}；可能乱序到达，按 callId 配对；
 *   status 非 completed 不落盘。
 * - `ai-title`：显式标题 {aiTitle, sessionId}。
 * - `resend-fork-notice`：编辑重发标记 {editedUserItemId}——被编辑的旧版 user 消息仍在
 *   文件里（append-only），按该 id 过滤掉，避免编辑前后两版提问同时出现。
 * - `file-history-snapshot` 等运行期条目：跳过。
 *
 * 用量：providerData.usage（camelCase，inputTokens 为完整 prompt 含缓存）与
 * providerData.rawUsage（snake_case OpenAI 形态）两种形态，缓存读 / reasoning 分别取
 * inputTokensDetails / outputTokensDetails 与 completion_tokens_details。
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { ContentBlock, Message, TokenUsage, Turn } from "../../../common/types/conversation.types";

// ─── 类型 ───

export interface WorkbuddySessionSummary {
  id: string;
  sourcePath: string;
  cwd?: string;
  createdAt?: number;
  updatedAt: number;
  previewTitle?: string;
}

export interface ParsedWorkbuddySession {
  turns: Turn[];
  meta: {
    title?: string;
    model?: string;
    createdAt?: number;
    updatedAt?: number;
    turnCount: number;
  };
}

interface WorkbuddyRecord {
  id?: string;
  parentId?: string;
  timestamp?: number;
  type?: string;
  role?: string;
  status?: string;
  content?: unknown;
  rawContent?: unknown;
  callId?: string;
  name?: string;
  arguments?: unknown;
  output?: unknown;
  sessionId?: string;
  cwd?: string;
  aiTitle?: string;
  editedUserItemId?: string;
  providerData?: Record<string, any>;
  [key: string]: unknown;
}

// ─── 路径与扫描 ───

export function workbuddyProjectRoots(): string[] {
  // $WORKBUDDY_HOME 覆盖（测试/自定义数据根）；缺省用真实 home 的双根
  const envHome = process.env.WORKBUDDY_HOME?.trim();
  const homes: string[] = [];
  if (envHome) {
    homes.push(envHome);
  } else {
    const home = os.homedir();
    if (home) {
      homes.push(path.join(home, ".workbuddy"), path.join(home, ".workbuddy-ai"));
    }
  }
  return homes
    .map((home) => path.join(home, "projects"))
    .filter((root) => {
      try {
        return fs.existsSync(root);
      } catch {
        return false;
      }
    });
}

function collectJsonlFiles(dir: string, out: string[], depth = 0): void {
  if (depth > 6) return;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectJsonlFiles(full, out, depth + 1);
    else if (entry.isFile() && entry.name.toLowerCase().endsWith(".jsonl")) out.push(full);
  }
}

/** 扫描双根下的全部 WorkBuddy 会话（mtime 降序） */
export function scanWorkbuddySessions(rootsOverride?: string[]): WorkbuddySessionSummary[] {
  const roots = rootsOverride ?? workbuddyProjectRoots();
  const summaries: WorkbuddySessionSummary[] = [];
  for (const root of roots) {
    const files: string[] = [];
    collectJsonlFiles(root, files);
    for (const filePath of files) {
      try {
        const stat = fs.statSync(filePath);
        const head = readWorkbuddyHead(filePath);
        summaries.push({
          id: head.sessionId || path.basename(filePath, ".jsonl"),
          sourcePath: filePath,
          ...(head.cwd ? { cwd: head.cwd } : {}),
          ...(head.createdAt !== undefined ? { createdAt: head.createdAt } : {}),
          updatedAt: Math.round(stat.mtimeMs),
          ...(head.firstUserQuery ? { previewTitle: head.firstUserQuery } : {}),
        });
      } catch {
        // 单文件读失败：跳过
      }
    }
  }
  return summaries.sort((a, b) => b.updatedAt - a.updatedAt);
}

interface WorkbuddyHead {
  sessionId?: string;
  cwd?: string;
  createdAt?: number;
  firstUserQuery?: string;
}

/** 读文件头（256KB）：sessionId/cwd/时间 + 首条真实提问（扫描预览用） */
function readWorkbuddyHead(filePath: string): WorkbuddyHead {
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
    return {};
  }

  const result: WorkbuddyHead = {};
  for (const line of head.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let record: WorkbuddyRecord;
    try {
      record = JSON.parse(trimmed) as WorkbuddyRecord;
    } catch {
      break; // 截断的尾行：停止
    }
    if (!record || typeof record !== "object") continue;
    if (!result.sessionId && typeof record.sessionId === "string" && record.sessionId) {
      result.sessionId = record.sessionId;
    }
    if (!result.cwd && typeof record.cwd === "string" && record.cwd) {
      result.cwd = record.cwd;
    }
    if (result.createdAt === undefined && typeof record.timestamp === "number") {
      result.createdAt = record.timestamp;
    }
    if (result.firstUserQuery === undefined && record.type === "message" && record.role === "user") {
      const query = extractWorkbuddyUserQuery(record.content);
      if (query) result.firstUserQuery = query.replace(/\s+/g, " ").slice(0, 50);
    }
  }
  return result;
}

// ─── 提取与映射 ───

const USER_QUERY_RE = /<user_query>([\s\S]*?)<\/user_query>/;
const SYSTEM_REMINDER_RE = /<system-reminder>[\s\S]*?<\/system-reminder>/g;
const TASK_NOTIFICATION_RE = /<task-notification>[\s\S]*?<\/task-notification>/g;

/**
 * user content 块数组 → 人类真实提问（对齐 dsh-chat-import 的口径）：
 * 1) 权威：<user_query> 包住的正文；
 * 2) 回退：剥掉 <system-reminder> / <task-notification> 整块后去标签取纯文本。
 * 始终去首尾空白；非数组 content 得 ''。
 */
export function extractWorkbuddyUserQuery(content: unknown): string {
  if (!Array.isArray(content)) return "";
  const pieces: string[] = [];
  for (const block of content) {
    if (block && typeof block === "object") {
      const b = block as Record<string, any>;
      if (typeof b.text === "string") pieces.push(b.text);
    } else if (typeof block === "string") {
      pieces.push(block);
    }
  }
  const joined = pieces.join("\n");
  const match = USER_QUERY_RE.exec(joined);
  if (match && match[1] && match[1].trim()) return match[1].trim();
  return joined
    .replace(SYSTEM_REMINDER_RE, " ")
    .replace(TASK_NOTIFICATION_RE, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** WorkBuddy content 块 → 我们的文本/附件占位块（image_blob_ref 等引用不迁移） */
function mapTextBlocks(content: unknown): ContentBlock[] {
  if (!Array.isArray(content)) {
    if (typeof content === "string" && content) {
      return [{ type: "text", text: content } as ContentBlock];
    }
    return [];
  }
  const blocks: ContentBlock[] = [];
  for (const item of content) {
    if (!item || typeof item !== "object") continue;
    const b = item as Record<string, any>;
    if (
      (b.type === "output_text" || b.type === "input_text" || b.type === "text") &&
      typeof b.text === "string" &&
      b.text
    ) {
      blocks.push({ type: "text", text: b.text } as ContentBlock);
    } else if (b.type === "image_blob_ref" || b.type === "input_image" || b.type === "image") {
      blocks.push({ type: "text", text: "[attachment]" } as ContentBlock);
    }
    // 其余块类型（diff/code/list/todo 等渲染形态）：不导入
  }
  return blocks;
}

/** reasoning 记录 → 正文（rawContent[].type='reasoning_text'） */
function reasoningTextOf(record: WorkbuddyRecord): string | null {
  const texts: string[] = [];
  if (Array.isArray(record.rawContent)) {
    for (const block of record.rawContent) {
      if (block && typeof block === "object") {
        const b = block as Record<string, any>;
        if (b.type === "reasoning_text" && typeof b.text === "string" && b.text) texts.push(b.text);
      }
    }
  }
  return texts.length > 0 ? texts.join("\n") : null;
}

/** 结果正文：output / providerData.toolResult，字符串或 {text|content|output}；取不到 null */
function resultTextOf(record: WorkbuddyRecord): string | null {
  const pdTool = record.providerData?.toolResult as Record<string, any> | undefined;
  const candidates: unknown[] = [record.output, pdTool];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate) return candidate;
    if (candidate && typeof candidate === "object") {
      const c = candidate as Record<string, any>;
      if (typeof c.text === "string" && c.text) return c.text;
      if (typeof c.content === "string" && c.content) return c.content;
      if (typeof c.output === "string" && c.output) return c.output;
    }
  }
  return null;
}

/** usage 两种形态 → TokenUsage（WorkBuddy 的 inputTokens 已是完整 prompt 含缓存） */
function mapWorkbuddyUsage(record: WorkbuddyRecord): TokenUsage | undefined {
  const usage = (record.providerData?.usage ?? record.providerData?.rawUsage) as Record<string, any> | undefined;
  if (!usage || typeof usage !== "object") return undefined;

  let promptTokens: number;
  let completionTokens: number;
  let totalTokens: number;
  let cacheRead = 0;
  let reasoning = 0;

  if (typeof usage.inputTokens === "number") {
    // camelCase 形态：inputTokens 已含缓存；缓存读在 inputTokensDetails[0].cached_tokens
    promptTokens = usage.inputTokens;
    completionTokens = typeof usage.outputTokens === "number" ? usage.outputTokens : 0;
    totalTokens = typeof usage.totalTokens === "number" ? usage.totalTokens : promptTokens + completionTokens;
    const details = Array.isArray(usage.inputTokensDetails) ? usage.inputTokensDetails : [];
    cacheRead = typeof details[0]?.cached_tokens === "number" ? details[0].cached_tokens : 0;
    const outDetails = Array.isArray(usage.outputTokensDetails) ? usage.outputTokensDetails : [];
    reasoning = typeof outDetails[0]?.reasoning_tokens === "number" ? outDetails[0].reasoning_tokens : 0;
  } else if (typeof usage.prompt_tokens === "number") {
    // snake_case（OpenAI rawUsage）：prompt_tokens 已含缓存；缓存在 completion_tokens_details.cached_tokens
    promptTokens = usage.prompt_tokens;
    completionTokens = typeof usage.completion_tokens === "number" ? usage.completion_tokens : 0;
    totalTokens = typeof usage.total_tokens === "number" ? usage.total_tokens : promptTokens + completionTokens;
    const completionDetails = usage.completion_tokens_details as Record<string, any> | undefined;
    reasoning = typeof completionDetails?.reasoning_tokens === "number" ? completionDetails.reasoning_tokens : 0;
  } else {
    return undefined;
  }

  const result: TokenUsage = { promptTokens, completionTokens, totalTokens };
  if (cacheRead > 0) result.cachedTokens = { read: cacheRead };
  if (reasoning > 0) result.reasoningTokens = reasoning;
  return result;
}

function makeMessageId(prefix = "wimp"): string {
  return `${prefix}-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

function argumentsText(value: unknown): string {
  if (typeof value === "string" && value) return value;
  if (value === undefined || value === null) return "{}";
  try {
    return JSON.stringify(value);
  } catch {
    return "{}";
  }
}

// ─── 解析 ───

/**
 * 读取并解析一个 WorkBuddy 会话。
 * 轮次聚合：真实 user 提问开新 Turn；assistant/function_call 挂最近回合；
 * reasoning 先到，缓存后前插到下一条 assistant 内容头部。
 */
export function readWorkbuddySession(filePath: string): ParsedWorkbuddySession {
  let text: string;
  try {
    text = fs.readFileSync(filePath, "utf8");
  } catch (err: any) {
    throw new Error(`read_failed: ${err?.message || err}`);
  }

  const records: WorkbuddyRecord[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as WorkbuddyRecord;
      if (parsed && typeof parsed === "object") records.push(parsed);
    } catch {
      // 半行/坏行跳过
    }
  }

  // 编辑重发：resend-fork-notice.editedUserItemId 指向被替换的旧版 user 消息 id，
  // 收集后过滤，避免编辑前后两版提问同时出现
  const editedUserItemIds = new Set<string>();
  for (const record of records) {
    if (record.type === "resend-fork-notice" && typeof record.editedUserItemId === "string") {
      editedUserItemIds.add(record.editedUserItemId);
    }
  }

  const turns: Turn[] = [];
  let currentTurn: Turn | null = null;
  let model: string | undefined;
  let title: string | undefined;
  let createdAt: number | undefined;
  let updatedAt: number | undefined;

  // callId → 承载该调用的 assistant 消息（function_call_result 乱序配对）
  const callOwners = new Map<string, Message>();
  // reasoning 事件先于其 assistant 消息到达（两者共享 providerData.messageId）：
  // 缓存后前插到下一条 assistant 内容头部（只前插一次；新开用户回合时清空）
  let pendingReasoning: { text: string; model?: string } | null = null;
  // 编辑重发跳过模式：从被编辑的旧版 user 消息开始，跳过其旧回答，直到下一条真实提问
  let skipUntilNextUserQuery = false;

  const touch = (ms?: number) => {
    if (typeof ms !== "number" || !Number.isFinite(ms) || ms <= 0) return;
    if (createdAt === undefined || ms < createdAt) createdAt = ms;
    if (updatedAt === undefined || ms > updatedAt) updatedAt = ms;
  };

  const ensureTurn = (time?: number): Turn => {
    if (currentTurn) return currentTurn;
    const turn: Turn = {
      id: makeMessageId("wturn"),
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

  for (const record of records) {
    const type = record.type;
    if (!type) continue;
    touch(record.timestamp);

    if (type === "ai-title") {
      if (typeof record.aiTitle === "string" && record.aiTitle.trim()) title = record.aiTitle.trim();
      continue;
    }

    if (type === "message") {
      if (record.role === "user") {
        // 编辑重发跳过模式：遇到真实提问即结束跳过（它就是编辑后的重发）
        if (skipUntilNextUserQuery) {
          const prompt = extractWorkbuddyUserQuery(record.content);
          if (prompt) {
            skipUntilNextUserQuery = false;
          } else {
            continue; // 注入消息 / 被编辑消息本体：继续跳过
          }
        }
        // 被编辑重发替换的旧版提问：进入跳过模式（其旧回答一并过滤）
        if (record.id && editedUserItemIds.has(record.id)) {
          skipUntilNextUserQuery = true;
          continue;
        }
        const prompt = extractWorkbuddyUserQuery(record.content);
        if (!prompt) continue; // 纯注入（system-reminder / task-notification）
        pendingReasoning = null;
        currentTurn = null; // 真实提问总是开新回合
        const turn = ensureTurn(record.timestamp);
        turn.messages.push({
          id: makeMessageId(),
          role: "user",
          kind: "user",
          source: { kind: "user" },
          metadata: {},
          content: [{ type: "text", text: prompt } as ContentBlock],
          ...(record.timestamp !== undefined ? { createdAt: record.timestamp } : {}),
        });
        continue;
      }
      if (record.role === "assistant") {
        if (skipUntilNextUserQuery) continue;
        const blocks = mapTextBlocks(record.content);
        const msgModel =
          typeof record.providerData?.model === "string" && record.providerData.model
            ? record.providerData.model
            : undefined;
        if (!model && msgModel) model = msgModel;
        if (blocks.length === 0) continue;
        const turn = ensureTurn(record.timestamp);
        const usage = mapWorkbuddyUsage(record);
        const message: Message = {
          id: makeMessageId(),
          role: "assistant",
          kind: "model",
          source: {
            kind: "model",
            provider: "workbuddy-import",
            model: msgModel ?? "unknown",
          },
          metadata: usage ? { usage } : {},
          content: blocks,
          ...(record.timestamp !== undefined ? { createdAt: record.timestamp } : {}),
        };
        // 先到的 reasoning 前插到内容头部
        if (pendingReasoning) {
          message.content.unshift({ type: "reasoning", summary: pendingReasoning.text } as ContentBlock);
          pendingReasoning = null;
        }
        turn.messages.push(message);
        continue;
      }
      // system / developer 等其它角色：不导入
      continue;
    }

    if (type === "reasoning") {
      if (skipUntilNextUserQuery) continue;
      const text = reasoningTextOf(record);
      if (!text) continue;
      const msgModel =
        typeof record.providerData?.model === "string" && record.providerData.model
          ? record.providerData.model
          : undefined;
      if (!model && msgModel) model = msgModel;
      pendingReasoning = { text, ...(msgModel ? { model: msgModel } : {}) };
      continue;
    }

    if (type === "function_call") {
      if (skipUntilNextUserQuery) continue;
      // 被打断 / 丢弃的草稿调用：不落盘
      if (record.providerData?.isPartialAborted === true || record.providerData?.discard === true) continue;
      const callId = typeof record.callId === "string" && record.callId ? record.callId : "";
      if (!callId) continue;
      const turn = ensureTurn(record.timestamp);
      const msgModel =
        typeof record.providerData?.model === "string" && record.providerData.model
          ? record.providerData.model
          : undefined;
      if (!model && msgModel) model = msgModel;
      // 调用可能没有前置 assistant 步：新建一条承载 tool-call（并带上先到的 reasoning）
      const last = turn.messages[turn.messages.length - 1];
      const target =
        last && last.role === "assistant"
          ? last
          : (() => {
              const usage = mapWorkbuddyUsage(record);
              const message: Message = {
                id: makeMessageId(),
                role: "assistant",
                kind: "model",
                source: {
                  kind: "model",
                  provider: "workbuddy-import",
                  model: msgModel ?? "unknown",
                },
                metadata: usage ? { usage } : {},
                content: [],
                ...(record.timestamp !== undefined ? { createdAt: record.timestamp } : {}),
              };
              if (pendingReasoning) {
                message.content.unshift({ type: "reasoning", summary: pendingReasoning.text } as ContentBlock);
                pendingReasoning = null;
              }
              turn.messages.push(message);
              return message;
            })();
      target.content.push({
        type: "tool-call",
        toolCallId: callId,
        name: typeof record.name === "string" ? record.name : "unknown",
        arguments: argumentsText(record.arguments),
      } as ContentBlock);
      callOwners.set(callId, target);
      continue;
    }

    if (type === "function_call_result") {
      if (skipUntilNextUserQuery) continue;
      // 非完成状态（incomplete/error 等）不落盘
      if (record.status && record.status !== "completed") continue;
      const callId = typeof record.callId === "string" && record.callId ? record.callId : "";
      // 只按 callId 配对：孤儿结果丢弃（挂最近步会投影出无调用的孤儿 tool 消息）
      const owner = callOwners.get(callId);
      if (!owner) continue;
      const resultText = resultTextOf(record);
      if (resultText === null || resultText === undefined) continue;
      const turn = ensureTurn(record.timestamp);
      turn.messages.push({
        id: makeMessageId(),
        role: "tool",
        kind: "model",
        source: { kind: "tool", toolCallId: callId },
        metadata: {},
        content: [
          { type: "tool-result", toolCallId: callId, name: callId, content: resultText } as ContentBlock,
        ],
        ...(record.timestamp !== undefined ? { createdAt: record.timestamp } : {}),
      });
      continue;
    }

    // file-history-snapshot / resend-fork-notice 等运行期条目：跳过
  }

  // 收尾：残留的 reasoning 落到最近回合的末条 assistant（无则新建），避免可读内容被丢
  if (pendingReasoning && currentTurn) {
    const last = currentTurn.messages[currentTurn.messages.length - 1];
    if (last && last.role === "assistant") {
      last.content.unshift({ type: "reasoning", summary: pendingReasoning.text } as ContentBlock);
    } else {
      currentTurn.messages.push({
        id: makeMessageId(),
        role: "assistant",
        kind: "model",
        source: {
          kind: "model",
          provider: "workbuddy-import",
          model: pendingReasoning.model ?? model ?? "unknown",
        },
        metadata: {},
        content: [{ type: "reasoning", summary: pendingReasoning.text } as ContentBlock],
      });
    }
    pendingReasoning = null;
  }

  // 悬空调用清理：function_call_result 乱序/缺失（incomplete / 孤儿）时，把没有结果的
  // tool-call 从 assistant 内容中移除；移除后变空的 assistant 消息整条删除——
  // 否则模型 API 会看到未闭合的 tool-call（被 tool-pairing 兜底注入空结果），
  // UI 也会显示一张没有结果的工具卡。
  for (const turn of turns) {
    const answered = new Set<string>();
    for (const message of turn.messages) {
      if (message.role === "tool" && message.source.kind === "tool") {
        answered.add(message.source.toolCallId);
      }
    }
    const hasOrphan = turn.messages.some(
      (m) =>
        m.role === "assistant" &&
        m.content.some((b) => b.type === "tool-call" && !answered.has(b.toolCallId)),
    );
    if (!hasOrphan) continue;
    for (let i = turn.messages.length - 1; i >= 0; i--) {
      const message = turn.messages[i];
      if (message.role !== "assistant") continue;
      const before = message.content.length;
      message.content = message.content.filter(
        (b) => b.type !== "tool-call" || answered.has(b.toolCallId),
      );
      if (message.content.length === 0 && before > 0) {
        turn.messages.splice(i, 1);
      }
    }
  }

  // turn/finish 的 modelName 用该轮最后一条 assistant 的 model
  for (const turn of turns) {
    const lastAssistant = [...turn.messages].reverse().find((m) => m.role === "assistant");
    const usedModel =
      lastAssistant?.source.kind === "model" ? lastAssistant.source.model : undefined;
    if (usedModel && usedModel !== "unknown") turn.metadata.modelName = usedModel;
  }

  return {
    turns,
    meta: {
      ...(title ? { title } : {}),
      ...(model ? { model } : {}),
      ...(createdAt !== undefined ? { createdAt } : {}),
      ...(updatedAt !== undefined ? { updatedAt } : {}),
      turnCount: turns.length,
    },
  };
}
