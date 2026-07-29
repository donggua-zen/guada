/**
 * 会话压缩管线重放脚本
 *
 * 加载已导出的会话 JSON，逐条"插入"消息模拟对话增长，
 * 触发压缩判定后执行真实两级压缩管线（Pruning + LLM Compaction），
 * 压缩状态写入本地文件而非数据库。
 *
 * 用法:
 *   npx ts-node scripts/compress-replay.ts scripts/data/session-<id>.json
 *
 * 示例:
 *   npx ts-node scripts/compress-replay.ts scripts/data/session-cmqsvvzdk0004q0kzrtdhxps4.json
 */

import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as readline from "readline";

// ── NestJS 测试上下文 ────────────────────────────────────────
import { Test } from "@nestjs/testing";
import { ConfigModule } from "@nestjs/config";
import { EventEmitterModule } from "@nestjs/event-emitter";
import { SharedModule } from "../src/common/services/shared.module";
import { LlmCoreModule } from "../src/modules/llm-core/providers.module";
import {
  CompressionEngine,
  SummaryMode,
} from "../src/modules/chat/compression-engine";
import {
  SessionContextStateRepository,
  CompressionState,
  CompressionStats,
} from "../src/common/database/session-context-state.repository";
import { TokenizerService } from "../src/common/utils/tokenizer.service";
import { CompressionConfig } from "../src/modules/chat/interfaces";
import { MessageRecord } from "../src/modules/llm-core/types/llm.types";
import { LLMService } from "../src/modules/llm-core/llm.service";

// ── 颜色输出 ─────────────────────────────────────────────────

const C = {
  reset: "\x1b[0m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
};

function info(msg: string) {
  console.log(`${C.blue}ℹ️  ${msg}${C.reset}`);
}
function success(msg: string) {
  console.log(`${C.green}${msg}${C.reset}`);
}
function warn(msg: string) {
  console.log(`${C.yellow}⚠️  ${msg}${C.reset}`);
}
function error(msg: string) {
  console.log(`${C.red}❌ ${msg}${C.reset}`);
}
function divider(title?: string) {
  const line = "─".repeat(60);
  if (title) {
    console.log(`\n${C.cyan}${line}${C.reset}`);
    console.log(`${C.bold}${C.cyan}  ${title}${C.reset}`);
    console.log(`${C.cyan}${line}${C.reset}\n`);
  } else {
    console.log(`${C.dim}${line}${C.reset}`);
  }
}

// ── 用户交互 ─────────────────────────────────────────────────

const AUTO_MODE = process.argv.includes("--auto");
const rl = AUTO_MODE
  ? null
  : readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

function ask(question: string): Promise<string> {
  return rl
    ? new Promise((resolve) => rl.question(question, resolve))
    : Promise.resolve("");
}

async function confirm(
  msg: string,
  defaultYes: boolean = true,
): Promise<boolean> {
  if (AUTO_MODE) {
    console.log(
      `  ${C.dim}[自动模式] ${msg} → ${defaultYes ? "Y（继续）" : "N（跳过）"}${C.reset}`,
    );
    return defaultYes;
  }
  const hint = defaultYes ? "Y/n" : "y/N";
  const answer = await ask(`${msg} ${C.cyan}[${hint}]${C.reset} `);
  if (answer.toLowerCase() === "y") return true;
  if (answer.toLowerCase() === "n") return false;
  return defaultYes;
}

// ── 本地压缩状态仓库 ─────────────────────────────────────────
// 实现 SessionContextStateRepository 相同接口，数据存本地 JSON 文件

interface StoredState {
  sessionId: string;
  records: Array<CompressionState & { createdAt: string }>;
}

class LocalStateRepo {
  private _filePath: string;
  private data: StoredState;
  private dirty: boolean = false;

  constructor(sessionId: string, tmpDir: string) {
    fs.mkdirSync(tmpDir, { recursive: true });
    this._filePath = path.join(tmpDir, `compress-state-${sessionId}.json`);
    this.data = this.load();
  }

  private load(): StoredState {
    try {
      if (fs.existsSync(this._filePath)) {
        return JSON.parse(fs.readFileSync(this._filePath, "utf-8"));
      }
    } catch {
      warn(`无法读取 ${this._filePath}，将重新创建`);
    }
    return { sessionId: "", records: [] };
  }

  private save(): void {
    if (!this.dirty) return;
    fs.writeFileSync(
      this._filePath,
      JSON.stringify(this.data, null, 2),
      "utf-8",
    );
    this.dirty = false;
  }

  get filePath(): string {
    return this._filePath;
  }

  async findBySessionId(sessionId: string): Promise<CompressionState | null> {
    this.data = this.load(); // reload to pick up external changes
    const records = this.data.records;
    if (records.length === 0) return null;
    return records[records.length - 1]; // latest
  }

  async create(sessionId: string, state: CompressionState): Promise<void> {
    this.data = this.load();
    this.data.sessionId = sessionId;
    this.data.records.push({
      ...state,
      createdAt: new Date().toISOString(),
    });
    this.dirty = true;
    this.save();
  }

  async update(id: string, _data: Partial<CompressionState>): Promise<void> {
    // 简化：不实现按 id 更新，测试中 create 已足够
    this.dirty = true;
    this.save();
  }
}

// ── 导出数据格式 ─────────────────────────────────────────────

interface ExportedContent {
  id: string;
  role: string | null;
  content: string;
  reasoningContent: string | null;
  additionalKwargs: any;
  metadata: any;
}

interface ExportedMessage {
  id: string;
  role: string;
  parentId: string | null;
  currentTurnsId: string | null;
  metadata: any;
  createdAt: string;
  contents: ExportedContent[];
}

interface ExportedSessionData {
  exportedAt: string;
  sessionId: string;
  session: {
    id: string;
    title: string | null;
    userId: string;
    settings: any;
    model: {
      id: string;
      name: string;
      modelName: string;
      modelType: string;
      config: any;
      provider: {
        id: string;
        provider: string;
        protocol: string;
        apiUrl: string | null;
        apiKey?: string;
        headers?: any;
        config: any;
      } | null;
    } | null;
  };
  messages: ExportedMessage[];
  compressionState: {
    summaryContent: string | null;
    lastCompactedMessageId: string | null;
    lastCompactedContentId: string | null;
    lastPrunedContentId: string | null;
    cleaningStrategy: string | null;
    pruningMetadata: any;
    compressionStats: any;
  } | null;
}

// ── 工具函数 ─────────────────────────────────────────────────

/**
 * 将导出的 Message（含 contents 数组）转为 MessageRecord[]
 * 模仿 MessageStoreService.transformContentStructure 的逻辑
 */
function toMessageRecords(
  exportedMessages: ExportedMessage[],
): MessageRecord[] {
  const records: MessageRecord[] = [];

  for (const msg of exportedMessages) {
    for (const content of msg.contents) {
      const record: MessageRecord = {
        role: (content.role || msg.role) as MessageRecord["role"],
        messageId: msg.id,
        contentId: content.id,
        content: content.content,
        turnsId: msg.currentTurnsId || msg.id,
      };

      // 工具调用信息存在 metadata 中（与 MessageStoreService.transformContentStructure 一致）
      const meta = content.metadata || {};
      if (meta.toolCalls) {
        record.toolCalls = meta.toolCalls;
      }

      if (content.reasoningContent) {
        record.reasoningContent = content.reasoningContent;
      }

      if (msg.metadata?.modelName) {
        record.metadata = { modelName: msg.metadata.modelName };
      }

      // 尝试从 metadata 中提取 tool_call_id
      if (content.metadata?.toolCallId) {
        record.toolCallId = content.metadata.toolCallId;
      }
      if (content.metadata?.name) {
        record.name = content.metadata.name;
      }
      // 某些工具调用可能将 name 放在 content 字段中
      // 对于 tool role，如果没有 name 尝试从 msg 的 metadata 中找
      if (msg.role === "tool" && content.metadata?.toolName) {
        record.name = content.metadata.toolName;
      }

      records.push(record);
    }
  }

  // 如果某个 message 没有 contents 但本身有 role（可能是空消息），添加一个占位
  for (const msg of exportedMessages) {
    if (msg.contents.length === 0) {
      records.push({
        role: msg.role as MessageRecord["role"],
        messageId: msg.id,
        contentId: msg.id + "_empty",
        content: "",
        turnsId: msg.currentTurnsId || msg.id,
      });
    }
  }

  return records;
}

// ── 格式化 Token 数 ──────────────────────────────────────────

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function fmtPercent(num: number, denom: number): string {
  if (denom === 0) return "-";
  const pct = ((num / denom) * 100).toFixed(1);
  return `${pct}%`;
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

// ── 记忆工具操作（影子轮次用） ──────────────────────────────
// 在临时目录中模拟 memory 插件的文件操作

interface MemoryIndex {
  factual?: string;
  memos: Array<{ title: string; content: string; mtimeMs: number }>;
  lastUpdated: Date;
}

function memoryDir(workspace: string): string {
  return path.join(workspace, ".guada", "memory");
}
function memosDir(workspace: string): string {
  return path.join(workspace, ".guada", "memos");
}
function memoryIndexPath(workspace: string): string {
  return path.join(memoryDir(workspace), "memory.json");
}

function loadMemoryIndex(workspace: string): MemoryIndex {
  const p = memoryIndexPath(workspace);
  if (fs.existsSync(p)) {
    try {
      return JSON.parse(fs.readFileSync(p, "utf-8"));
    } catch {
      /* fall through */
    }
  }
  return { memos: [], lastUpdated: new Date() };
}

function saveMemoryIndex(workspace: string, idx: MemoryIndex): void {
  fs.mkdirSync(memoryDir(workspace), { recursive: true });
  fs.writeFileSync(
    memoryIndexPath(workspace),
    JSON.stringify(idx, null, 2),
    "utf-8",
  );
}

function memoryCapacity(workspace: string): {
  percent: number;
  used: number;
  limit: number;
  overLimit: boolean;
} {
  const limit = 3000;
  const idx = loadMemoryIndex(workspace);
  const used = (idx.factual || "").length;
  const percent = Math.round((used / limit) * 100);
  return { percent, used, limit, overLimit: used > limit };
}

/**
 * 执行 memory 工具操作（与 MemoryPlugin.handleMemoryEdit 逻辑一致）
 */
async function executeMemoryTool(
  args: Record<string, any>,
  workspace: string,
): Promise<any> {
  const { action, target, content, old_text, memo_title, pattern } = args;
  const idx = loadMemoryIndex(workspace);

  // 确保目录存在
  fs.mkdirSync(memoryDir(workspace), { recursive: true });
  fs.mkdirSync(memosDir(workspace), { recursive: true });

  switch (action) {
    case "append": {
      if (target === "factual") {
        idx.factual = idx.factual
          ? `${idx.factual}\n${content || ""}`
          : content || "";
      } else if (target === "memo") {
        const title = memo_title || `memo-${Date.now()}`;
        const memoPath = path.join(memosDir(workspace), `${title}.md`);
        fs.writeFileSync(memoPath, content || "", "utf-8");
        // 检查是否已存在，存在则更新 mtime
        const existing = idx.memos.find((m) => m.title === title);
        if (existing) {
          existing.content = content || "";
          existing.mtimeMs = Date.now();
        } else {
          idx.memos.push({
            title,
            content: content || "",
            mtimeMs: Date.now(),
          });
        }
      }
      idx.lastUpdated = new Date();
      saveMemoryIndex(workspace, idx);
      const cap = memoryCapacity(workspace);
      let result: any = { success: true, action: "append", target };
      if (target === "factual") {
        result.memory_capacity = `${cap.percent}% — ${cap.used}/${cap.limit} chars`;
        if (cap.overLimit) {
          result.warning = `Memory full (${cap.percent}%), write succeeded but cannot display. Use 'memory replace' to compress old entries.`;
        }
      }
      return result;
    }
    case "replace": {
      if (target === "factual" && idx.factual && old_text) {
        const newContent =
          content !== undefined && content !== null
            ? idx.factual.replace(old_text, content)
            : idx.factual.replace(old_text, "");
        if (newContent === idx.factual) {
          return {
            success: false,
            message: `未找到匹配的旧文本: "${old_text}"`,
          };
        }
        idx.factual = newContent;
      } else if (target === "memo") {
        const memoPath = path.join(
          memosDir(workspace),
          `${memo_title || "unknown"}.md`,
        );
        if (!fs.existsSync(memoPath)) {
          return { success: false, message: `备忘录 "${memo_title}" 不存在` };
        }
        fs.writeFileSync(memoPath, content || "", "utf-8");
        const existing = idx.memos.find(
          (m) => m.title === (memo_title || "unknown"),
        );
        if (existing) {
          existing.content = content || "";
          existing.mtimeMs = Date.now();
        }
      }
      idx.lastUpdated = new Date();
      saveMemoryIndex(workspace, idx);
      const cap = memoryCapacity(workspace);
      let result: any = { success: true, action: "replace", target };
      if (target === "factual") {
        result.memory_capacity = `${cap.percent}% — ${cap.used}/${cap.limit} chars`;
      }
      return result;
    }
    case "search": {
      if (target !== "memo") {
        return { success: false, message: "search 仅支持 memos 目标" };
      }
      const results = idx.memos
        .filter(
          (m) =>
            !pattern ||
            m.title.includes(pattern) ||
            m.content.includes(pattern),
        )
        .map((m) => ({ title: m.title, content: m.content }));
      return { success: true, results };
    }
    default:
      return { success: false, message: `unknown action: ${action}` };
  }
}

// ── 影子轮次：记忆保存 ──────────────────────────────────────
// 模拟 AgentEngine.runMemorySaveShadowTurn

const SHADOW_SYSTEM_PROMPT = `<system-reminder>
[BEGIN SILENT SYSTEM PROCESS - MEMORY MAINTENANCE]
⚠️ CRITICAL MODE SWITCH: You are currently executing a background system routine.
You are NOT in a conversation with the user. Do not attempt to answer the user's previous prompt in this specific turn.
Your output will be parsed by the system, not read by the user.

【OBJECTIVE】
The context is too long and will be compressed. The conversation history may be trimmed or discarded.
Scan the conversation history to see if there is any content that needs long-term memory. If there is, use the memory tool to save it.

【EVALUATION LOGIC】
Scan history. ONLY trigger an update if:
- New explicit long-term preferences/habits found.
- Critical factual corrections provided.
- Existing memory conflicts or is outdated.
(Note: If <factual-memory/> is already accurate, do nothing.)

【EXECUTION PROTOCOL】
1. IF NO update needed:
   - Output EXACTLY: DONE
   - STOP immediately.

2. IF update IS needed:
   - Use memory tool ('memory') to update memory.
   - Max 5 tool calls.
   - After tools finish, Output EXACTLY: DONE
   - STOP immediately.

【STRICT OUTPUT FORMAT】
- The ONLY valid output string is "DONE".
- Any other text (including explanations, apologies, or reasoning) will cause a system error.
- Do not worry about the user's pending questions; the system will return to normal mode after receiving "DONE".
[END SILENT SYSTEM PROCESS]
</system-reminder>`;

async function runShadowTurn(
  llmService: LLMService,
  modelConfig: any,
  history: MessageRecord[],
  workspacePath: string,
  sessionId: string,
  tmpDir: string,
): Promise<void> {
  // 清洗：去掉末尾不完整的 tool 调用轮次
  // 末尾的 assistant(tool_calls) 没有后续 tool 响应则删除，反复直到末尾完整
  const cleanHistory = [...history];
  while (cleanHistory.length > 0) {
    const last = cleanHistory[cleanHistory.length - 1];
    if (last.role === "assistant" && last.toolCalls?.length) {
      cleanHistory.pop(); // 末尾 assistant 有 toolCalls 但后面没东西 → 删除
    } else {
      break;
    }
  }

  const shadowMsgs: MessageRecord[] = [
    {
      role: "user",
      messageId: "shadow-0",
      contentId: "shadow-0",
      content: SHADOW_SYSTEM_PROMPT,
    },
  ];

  // 日志：打印历史末尾 5 条消息结构，用于诊断 tool_calls 孤立问题
  const lastN = 5;
  const tail = cleanHistory.slice(-lastN);
  console.log(
    `    ${C.dim}[DEBUG] history 共 ${cleanHistory.length} 条, 末尾 ${lastN} 条:${C.reset}`,
  );
  for (const m of tail) {
    const hasTc = m.toolCalls?.length ? `toolCalls[${m.toolCalls.length}]` : "";
    const hasTid = m.toolCallId ? `toolCallId=${m.toolCallId}` : "";
    const contentRaw =
      typeof m.content === "string"
        ? m.content
        : Array.isArray(m.content)
          ? JSON.stringify(m.content)
          : "";
    const contentPreview = contentRaw.slice(0, 60).replace(/\n/g, "\\n");
    console.log(
      `      ${C.dim}  ${m.role.padEnd(10)} ${hasTc} ${hasTid} "${contentPreview}"${C.reset}`,
    );
  }

  const MAX_ROUNDS = 5;
  for (let round = 1; round <= MAX_ROUNDS; round++) {
    console.log(
      `    ${C.cyan}[影子轮次 Round ${round}/${MAX_ROUNDS}]${C.reset}`,
    );
    try {
      const response = await llmService.completions({
        model: modelConfig?.modelName || "deepseek-v4-flash",
        messages: cleanHistory.concat(shadowMsgs),
        temperature: 0.4,
        maxTokens: 2000,
        thinkingEffort: "high",
        stream: false,
        providerConfig: modelConfig?.provider,
      });
      const content = (response as any).content?.trim() || "";
      const toolCalls = (response as any).toolCalls;
      const reasoning = (response as any).reasoningContent?.trim() || "";

      // 打印 AI 的思考过程与输出（完整输出，不截断）
      if (reasoning) {
        console.log(
          `      ${C.dim}💭 思考:\n          ${reasoning.replace(/\n/g, "\n          ")}${C.reset}`,
        );
      }
      if (content) {
        console.log(
          `      ${C.cyan}📝 输出:\n          ${content.replace(/\n/g, "\n          ")}${C.reset}`,
        );
      }
      if (toolCalls?.length) {
        console.log(`      ${C.yellow}AI 工具调用:${C.reset}`);
        for (const tc of toolCalls) {
          console.log(
            `        ${C.bold}${tc.name}${C.reset}(${JSON.stringify(tc.arguments)})`,
          );
        }
      }

      shadowMsgs.push({
        role: "assistant",
        messageId: `shadow-${round}`,
        contentId: `shadow-${round}-resp`,
        content: content || null,
        toolCalls: toolCalls,
      });

      // 输出 "DONE" 即结束
      if (content === "DONE") {
        console.log(`    ${C.green}✓ 影子轮次完成（DONE）${C.reset}`);
        break;
      }

      // 执行工具调用
      if (toolCalls?.length) {
        for (const tc of toolCalls) {
          let args: any = {};
          try {
            args =
              typeof tc.arguments === "string"
                ? JSON.parse(tc.arguments)
                : tc.arguments;
          } catch {
            args = {};
          }
          const result = await executeMemoryTool(args, workspacePath);
          const resultStr =
            typeof result === "string" ? result : JSON.stringify(result);
          console.log(
            `      ${C.green}工具结果: ${resultStr.slice(0, 200)}${C.reset}`,
          );
          shadowMsgs.push({
            role: "tool",
            toolCallId: tc.id,
            name: tc.name,
            content: resultStr,
            messageId: `shadow-${round}`,
            contentId: `shadow-${round}-tool-${tc.id}`,
          });
        }
      } else {
        // 没有 tool_calls 且没有输出 DONE → 视为完成
        console.log(`    ${C.dim}✗ 无工具调用，结束${C.reset}`);
        break;
      }
    } catch (err: any) {
      console.log(
        `    ${C.red}[影子轮次 Round ${round} 失败: ${err.message}]${C.reset}`,
      );
      break;
    }
  }

  // 写交互日志
  try {
    const logDir = path.join(tmpDir, "shadow-logs");
    fs.mkdirSync(logDir, { recursive: true });
    fs.writeFileSync(
      path.join(logDir, `shadow-${sessionId}.jsonl`),
      JSON.stringify({
        time: new Date().toISOString(),
        sessionId,
        historyLen: history.length,
        shadowRounds: shadowMsgs.length - 1,
        records: shadowMsgs,
      }) + "\n",
      "utf-8",
    );
  } catch {
    /* non-critical */
  }
}

// ── 记忆容量信息显示（注入到压缩摘要日志中） ────────────────

function formatMemoryInfo(workspace: string): string {
  try {
    const idx = loadMemoryIndex(workspace);
    const cap = memoryCapacity(workspace);
    return [
      `事实记忆: ${(idx.factual || "").length} chars (${cap.percent}%)`,
      `备忘: ${idx.memos.length} 条`,
    ].join(" | ");
  } catch {
    return "无";
  }
}

// ── 主逻辑 ───────────────────────────────────────────────────

async function main() {
  divider("压缩管线重放工具");

  const jsonPath = process.argv[2];
  if (!jsonPath) {
    error("用法: npx ts-node scripts/compress-replay.ts <json-path>");
    error(
      "示例: npx ts-node scripts/compress-replay.ts scripts/data/session-xxx.json",
    );
    process.exit(1);
  }

  if (!fs.existsSync(jsonPath)) {
    error(`文件不存在: ${jsonPath}`);
    process.exit(1);
  }

  // 1. 加载导出数据
  info(`加载导出数据: ${jsonPath}`);
  const raw = fs.readFileSync(jsonPath, "utf-8");
  const data: ExportedSessionData = JSON.parse(raw);
  const sessionId = data.sessionId;

  info(`会话: ${sessionId}`);
  info(`会话标题: ${data.session.title || "(无标题)"}`);
  info(
    `模型: ${data.session.model?.name || "N/A"} (${data.session.model?.modelName || "N/A"})`,
  );

  // 2. 提取压缩配置（从会话 settings 或模型 config）
  const settings = data.session.settings || {};
  const memoryConfig = settings.memory || {};
  const modelConfig = data.session.model?.config || {};
  const model = data.session.model;
  const provider = model?.provider || null;

  // 构造 MemoryConfig
  const triggerRatio = memoryConfig.compressionTriggerRatio ?? 0.8;
  const targetRatio = memoryConfig.compressionTargetRatio ?? 0.5;
  const summaryModeStr: string = memoryConfig.summaryMode || "memory_sync";
  const contextWindow = modelConfig.contextWindow || 128_000;
  const chatModelName = data.session.model?.modelName || "gpt4";

  info(
    `压缩配置: triggerRatio=${triggerRatio}, targetRatio=${targetRatio}, ` +
      `contextWindow=${fmtTokens(contextWindow)}, summaryMode=${summaryModeStr}`,
  );

  if (!provider) {
    warn("会话没有关联的模型供应商，压缩摘要阶段将无法调用 LLM！");
    warn("将使用 DISABLED 模式直接丢弃压缩内容（仅测试 Pruning 逻辑）");
  }

  // 3. 组装 MessageRecord[]
  const allMessages = toMessageRecords(data.messages);
  info(`总消息记录数: ${allMessages.length}`);
  info(`总会话消息(原始DB): ${data.messages.length}`);

  // 4. 检查已有压缩状态
  const existingState = data.compressionState;
  if (existingState) {
    info(
      `已有压缩状态: strategy=${existingState.cleaningStrategy || "N/A"}, ` +
        `summary=${existingState.summaryContent?.length || 0}chars`,
    );
  } else {
    info("无历史压缩状态，将从头开始模拟");
  }

  // 5. 启动 NestJS 上下文
  divider("初始化依赖");

  const tmpDir = path.resolve(__dirname, "tmp");

  // 每次启动自动清除旧压缩状态文件，避免旧数据干扰
  const stateFilePath = path.join(tmpDir, `compress-state-${sessionId}.json`);
  if (fs.existsSync(stateFilePath)) {
    fs.unlinkSync(stateFilePath);
    info(`已清除旧压缩状态: ${stateFilePath}`);
  }

  const localStateRepo = new LocalStateRepo(sessionId, tmpDir);

  const moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true }),
      EventEmitterModule.forRoot(),
      SharedModule,
      LlmCoreModule,
    ],
    providers: [
      CompressionEngine,
      {
        provide: SessionContextStateRepository,
        useValue: localStateRepo,
      },
    ],
  }).compile();

  // 显式触发 NestJS 生命周期钩子（包括 LlmCoreModule.onModuleInit 注册供应商）
  await moduleRef.init();

  const engine = moduleRef.get(CompressionEngine);

  // 注意：不从 JSON 恢复历史压缩状态，确保每次运行从零开始

  success("NestJS 上下文初始化完成");
  info(`压缩状态本地仓库: ${localStateRepo.filePath}`);

  // 确定 summaryMode
  let summaryMode: SummaryMode;
  switch (summaryModeStr) {
    case "disabled":
      summaryMode = SummaryMode.DISABLED;
      break;
    case "fast":
      summaryMode = SummaryMode.FAST;
      break;
    case "memory_sync":
    default:
      summaryMode = SummaryMode.MEMORY_SYNC;
      break;
  }

  // ── 5b. 从数据库读取真实 API Key ───────────────────────────
  // 支持 --db <path> 参数，从 SQLite 读取 deepseek 供应商的 API Key

  const dbIndex = process.argv.indexOf("--db");
  const dbPathArg = dbIndex !== -1 ? process.argv[dbIndex + 1] : null;
  let resolvedDbPath: string | null = null;

  if (dbPathArg) {
    const rawPath = dbPathArg.startsWith("~")
      ? path.resolve(os.homedir(), dbPathArg.slice(1).replace(/^[/\\]+/, ""))
      : path.resolve(dbPathArg);
    resolvedDbPath = path.resolve(rawPath);
    if (!fs.existsSync(resolvedDbPath)) {
      warn(`数据库文件不存在: ${resolvedDbPath}`);
      resolvedDbPath = null;
    }
  }

  // 从 JSON 导出的 model 信息作为后备结构
  let effectiveModelName = model?.modelName || "deepseek-v4-flash";
  let effectiveModelConfig: any = null;
  let effectiveProviderConfig: any = undefined;

  if (resolvedDbPath) {
    console.log(`  ${C.cyan}[DB诊断] 数据库路径: ${resolvedDbPath}${C.reset}`);
    console.log(
      `  ${C.cyan}[DB诊断] 文件存在: ${fs.existsSync(resolvedDbPath)}${C.reset}`,
    );

    try {
      const Database = require("better-sqlite3");
      const db = new Database(resolvedDbPath);

      // 检查表结构
      const tables = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('model_provider','model') ORDER BY name",
        )
        .all() as any[];
      console.log(
        `  ${C.cyan}[DB诊断] model_provider/model 表: ${tables.map((t) => t.name).join(", ")}${C.reset}`,
      );

      // 列出所有 provider
      const allProvs = db
        .prepare("SELECT id, provider, name, protocol FROM model_provider")
        .all() as any[];
      const provNames = allProvs.map((p: any) => p.provider).join(", ");
      console.log(`  ${C.cyan}[DB诊断] 所有供应商: ${provNames}${C.reset}`);

      // 1) 精确查找 deepseek 供应商
      const prov = db
        .prepare("SELECT * FROM model_provider WHERE provider = ?")
        .get("deepseek") as any;

      if (prov) {
        console.log(
          `  ${C.green}[DB诊断] 找到 deepseek: id=${prov.id}, api_key_length=${prov.api_key ? prov.api_key.length : 0}${C.reset}`,
        );

        // 列出该供应商下所有模型
        const allMdls = db
          .prepare("SELECT model_name FROM model WHERE provider_id = ?")
          .all(prov.id) as any[];
        const mdlNames = allMdls.map((m: any) => m.model_name).join(", ");
        console.log(
          `  ${C.cyan}[DB诊断] deepseek 下模型: ${mdlNames}${C.reset}`,
        );

        // 2) 精确查找 deepseek-v4-flash
        const mdl = db
          .prepare(
            "SELECT * FROM model WHERE model_name = ? AND provider_id = ?",
          )
          .get("deepseek-v4-flash", prov.id) as any;

        if (mdl) {
          effectiveModelName = mdl.model_name;
          effectiveProviderConfig = {
            id: "deepseek",
            provider: "deepseek",
            protocol: prov.protocol || "openai",
            apiUrl: prov.api_url,
            apiKey: prov.api_key,
            headers: safeJson(prov.headers),
            config: safeJson(prov.config),
          };
          effectiveModelConfig = safeJson(mdl.config);
          info(
            `✅ 从数据库读取 deepseek 供应商 API Key（${effectiveModelName}）`,
          );
        } else {
          warn("数据库中未找到 deepseek-v4-flash 模型");
        }
      } else {
        warn(`数据库中未找到 provider='deepseek' 的行`);
      }
      db.close();
    } catch (err: any) {
      warn(`读取数据库失败: ${err.message}`);
    }
  }

  if (!effectiveProviderConfig) {
    warn("⚠️ 未获取到 API Key，Stage 2（摘要）将失败，回退到仅裁剪模式");
    warn("   请通过 --db <path> 指定数据库文件路径");
  }

  // 构造 compressionModel 对象（必须始终存在，供 resolveThinkingEffort 等内部逻辑使用）
  // 即使没有 API Key，config:{} 保证不会在 config 读取处崩溃
  const compressionModel = {
    modelName: effectiveModelName,
    config: effectiveModelConfig || {},
    provider: effectiveProviderConfig, // 无 --db 时为 undefined，API 调用会失败，但 fallback 机制会处理
  };

  // ── 6. 逐条模拟 ──────────────────────────────────────────
  divider("开始逐条模拟");

  const history: MessageRecord[] = [];
  let compressionRound = 0;
  let totalPrunedTokens = 0;
  let totalSummaryTokens = 0;
  // checkpoint：记录每次压缩后的状态（摘要、游标等），逐轮传递实现增量压缩
  let currentCheckpoint: any = null;

  for (let i = 0; i < allMessages.length; i++) {
    const msg = allMessages[i];
    history.push(msg);

    // 每条消息都检查压缩
    const checkCompression = true;

    if (!checkCompression) continue;

    // 构建压缩配置
    const config: CompressionConfig = {
      contextWindow: 256000,
      triggerRatio,
      targetRatio,
      model: compressionModel,
      summaryMode,
      chatModelName,
    };

    // 检查是否触发压缩
    const shouldCompress = await engine.shouldCompress(history, config);

    // 获取当前 Token 数
    let currentTokens = 0;
    try {
      currentTokens = await moduleRef.get(TokenizerService).countTokens(
        chatModelName,
        history.filter((m) => m.role !== "system"),
      );
    } catch {
      /* ignore */
    }

    console.log(
      `[msg#${i + 1}/${allMessages.length}] ${msg.role.padEnd(10)} ` +
        `${C.dim}msgs=${history.length}, tokens=${fmtTokens(currentTokens)}${C.reset}, ` +
        `${shouldCompress ? C.yellow + "⚡ COMPRESS" : C.green + "✓ OK"}${C.reset}`,
    );

    if (!shouldCompress) continue;

    compressionRound++;

    // 执行压缩前保存当前状态快照
    const beforeLen = history.length;
    const beforeTokens = await moduleRef.get(TokenizerService).countTokens(
      chatModelName,
      history.filter((m) => m.role !== "system"),
    );

    // ── 执行压缩 ──
    divider(`压缩 [第 ${compressionRound} 轮] @ msg#${i + 1}`);

    console.log(`  ${C.bold}压缩前:${C.reset}`);
    console.log(`    消息数:     ${beforeLen}`);
    console.log(`    Token 数:   ${fmtTokens(beforeTokens)}`);

    // 影子轮次用临时工作目录（内存文件读写）
    const memWorkspace = path.resolve(tmpDir, "memory-workspace", sessionId);
    const llmService = moduleRef.get(LLMService);

    const onStage2 = async () => {
      info("📝 触发记忆保存影子轮次 (Shadow Turn)");
      try {
        await runShadowTurn(
          llmService,
          compressionModel,
          history,
          memWorkspace,
          sessionId,
          tmpDir,
        );
        const memInfo = formatMemoryInfo(memWorkspace);
        info(`📝 影子轮次完成 — ${memInfo}`);
      } catch (err: any) {
        warn(`影子轮次失败: ${err.message}`);
      }
    };

    // 细粒度 Token 统计
    // summary 必须传入真实 Token 数，否则引擎无法正确判断摘要是否需要精简
    let summaryTokens = 0;
    if (currentCheckpoint?.summaryContent) {
      try {
        summaryTokens = await moduleRef
          .get(TokenizerService)
          .countTokens(chatModelName, [
            { role: "user", content: currentCheckpoint.summaryContent },
          ]);
      } catch {
        /* ignore */
      }
    }
    const tokenBreakdown = {
      total: beforeTokens + summaryTokens,
      systemPrompt: 0,
      summary: summaryTokens,
      history: beforeTokens,
    };

    let result;
    try {
      result = await engine.execute(
        sessionId,
        history,
        config,
        tokenBreakdown,
        onStage2,
        currentCheckpoint, // 传入上一轮 checkpoint，首次为 null
      );
      // 保存返回的最新断点供后续轮次使用
      currentCheckpoint = result.checkpoint;
    } catch (err: any) {
      error(`压缩执行失败: ${err.message}`);
      console.error(err);
      // 询问是否继续
      const cont = await confirm("压缩失败，是否继续模拟剩余消息?");
      if (!cont) break;
      continue;
    }

    const afterLen = result.messages.length;
    const afterTokens = result.tokenCount ?? 0;

    console.log(`  ${C.bold}压缩后:${C.reset}`);
    console.log(
      `    消息数:     ${afterLen} (${beforeLen - afterLen} 条被压缩)`,
    );
    console.log(
      `    Token 数:   ${fmtTokens(afterTokens)} (${fmtTokens(beforeTokens - afterTokens)} 减少)`,
    );
    console.log(
      `    压缩率:     ${fmtPercent(beforeTokens - afterTokens, beforeTokens)}`,
    );

    const stats = result.compressionStats;
    if (stats) {
      console.log(`  ${C.bold}阶段统计:${C.reset}`);
      console.log(
        `    Stage 1 (裁剪):  ${fmtTokens(stats.beforeTokenCount ?? beforeTokens)} → ${fmtTokens(stats.afterTokenCount ?? afterTokens)}`,
      );
      if (result.strategy === "summarized") {
        console.log(`    Stage 2 (摘要):  ✓ 已执行`);
        const summaryFull = (result.summary || "").trim();
        const summaryChars = summaryFull.length;
        let summaryTokens = 0;
        try {
          summaryTokens = await moduleRef
            .get(TokenizerService)
            .countTokens(chatModelName, [
              { role: "user", content: summaryFull },
            ]);
        } catch {
          /* ignore */
        }
        console.log(`    ${C.bold}摘要信息:${C.reset}`);
        console.log(`      字符数:     ${summaryChars}`);
        console.log(`      Token 数:   ${summaryTokens}`);
        console.log(`    ${C.bold}摘要完整输出:${C.reset}`);
        console.log(
          `      ${C.dim}${summaryFull.replace(/\n/g, "\n      ")}${C.reset}`,
        );
        totalSummaryTokens += afterTokens;
      } else {
        console.log(`    Stage 2 (摘要):  ✗ 跳过（裁剪已达标）`);
      }
    }

    totalPrunedTokens += beforeTokens - afterTokens;

    console.log(`  ${C.bold}策略:${C.reset} ${result.strategy || "N/A"}`);
    console.log(
      `  ${C.bold}压缩状态文件:${C.reset} ${localStateRepo.filePath}`,
    );

    // 更新 history 为压缩后的消息
    history.length = 0;
    history.push(...result.messages);

    // ── 确认继续 ──
    divider();
    const cont = await confirm("是否继续模拟?");
    if (!cont) {
      info("用户终止模拟");
      break;
    }

    // 检查压缩后的 Token 是否仍然过多（可能需要多轮压缩）
    const effectiveWindow = contextWindow;
    const newRatio = afterTokens / effectiveWindow;
    if (newRatio >= triggerRatio) {
      warn(`压缩后 Token 比率仍为 ${(newRatio * 100).toFixed(1)}%，将继续压缩`);
    }
  }

  // ── 7. 总结输出 ──────────────────────────────────────────
  divider("最终总结");

  const finalTokens =
    history.length > 0
      ? await moduleRef.get(TokenizerService).countTokens(
          chatModelName,
          history.filter((m) => m.role !== "system"),
        )
      : 0;

  console.log(`  ${C.bold}压缩轮次:${C.reset}     ${compressionRound}`);
  console.log(`  ${C.bold}最终消息数:${C.reset}   ${history.length}`);
  console.log(`  ${C.bold}最终 Token:${C.reset}   ${fmtTokens(finalTokens)}`);
  if (compressionRound > 0) {
    console.log(
      `  ${C.bold}累计裁剪:${C.reset}     ${fmtTokens(totalPrunedTokens)} tokens`,
    );
  }

  // 显示最终摘要
  const finalCheckpoint = await engine.getCheckpoint(sessionId);
  if (finalCheckpoint?.summaryContent) {
    console.log(`\n  ${C.bold}最终摘要:${C.reset}`);
    console.log(
      `  ${C.dim}${finalCheckpoint.summaryContent.slice(0, 500).replace(/\n/g, "\n  ")}${C.reset}`,
    );
    if (finalCheckpoint.summaryContent.length > 500) {
      console.log(
        `  ${C.dim}... (共 ${finalCheckpoint.summaryContent.length} 字符, 已截断)${C.reset}`,
      );
    }
  }

  // 显示压缩状态文件路径
  console.log(`\n  ${C.bold}压缩状态文件:${C.reset}`);
  console.log(`    ${localStateRepo.filePath}`);

  // 清空 Distill 目录数据（不存数据库，无需清理）
  divider();

  success("✅ 重放完成");

  if (compressionRound > 0) {
    info("提示: 可以修改 prompt 后重新运行，对比不同版本的压缩效果");
    info(`     压缩状态已保存在: ${localStateRepo.filePath}`);
    info("     若要重置，删除该文件即可。");
  } else {
    info("未触发任何压缩。可能原因:");
    info("  - 会话历史 Token 数未达到 triggerRatio 阈值");
    info("  - contextWindow 设置过大");
    info("  可以调整 triggerRatio 或 contextWindow 后重试");
  }

  if (rl) rl.close();
  await moduleRef.close();
}

main().catch((err) => {
  error(`脚本异常: ${err.message}`);
  console.error(err);
  process.exit(1);
});
