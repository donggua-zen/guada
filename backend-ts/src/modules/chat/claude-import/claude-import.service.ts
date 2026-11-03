/**
 * Claude Code 历史会话导入服务（扫描 + 导入 + 幂等）。
 *
 * 扫描：~/.claude/projects 递归收集 {sessionId}.jsonl（目录名是项目路径的转义形式，
 * 不解读它——真实 cwd 从记录内容读）；每个文件 stat + 只读头部 16 行取标题/cwd/时间，
 * 大文件扫描成本 O(1)。sidechain（subagent 日志）、worktree 会话不作为候选。
 *
 * 导入：逐会话「确定性导入 id 幂等检查 → 解析全文件 → createSession → importTurns」。
 * 幂等锚点是 importedSessionId(sourcePath, sessionId)（sha256 前 20 位，同源同 id），
 * 重复导入时查到既有会话即 skip already_imported，不会产生重复内容。
 */
import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import * as crypto from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { Inject } from "@nestjs/common";
import {
  IMessageStore,
  MESSAGE_STORE_TOKEN,
} from "../../../common/persistence/message-store.interface";
import { SessionService } from "../session.service";
import {
  SESSION_STORE_TOKEN,
  type SessionStoreFacade,
} from "../session-store.facade";
import { AgentFileStore } from "../../agents/agent-file.store";
import { ProviderFileStore } from "../../llm-core/provider-file.store";
import {
  parseClaudeHeadInfo,
  parseClaudeJsonlRecords,
  type ClaudeJsonlRecord,
} from "./claude-jsonl.parser";
import {
  listZcodeSessions,
  readZcodeSession,
  zcodeDbPaths,
  type ParsedZcodeCompaction,
  type ZcodeSessionSummary,
} from "./zcode-sqlite.reader";
import {
  dshSessionsRoot,
  readDshSession,
  scanDshSessions as scanDshSessionSummaries,
  type ParsedDshCompaction,
  type DshSessionSummary,
} from "./dsh-session.reader";
import {
  codexSessionRoots,
  readCodexSession,
  scanCodexSessions as scanCodexSessionSummaries,
  type CodexSessionSummary,
} from "./codex-session.reader";
import type { ImportCompactionPoint } from "../../../common/persistence/types";
import type { Turn } from "../../../common/types/conversation.types";
import { resolveContextWindowBudget } from "../compaction/window-budget";

// ─── 类型 ───

/** 候选列表的展示附加字段（两来源共用，缺省即 UI 不渲染该项） */
interface ImportCandidateExtras {
  /** 源 jsonl 字节数（claudeCode 专用：zcode 的库体积对每条候选都一样，无意义） */
  sizeBytes?: number;
  /** 源会话消息行数（zcode 专用：claudeCode 扫描只读头部，不算全量） */
  messageCount?: number;
  /** 本机是否已有同源导入会话；UI 标「已导入」，仍可再选（幂等会 skip） */
  imported?: boolean;
  /** imported 为真时给出本地会话 id，UI 的「打开」直接跳过去 */
  importedSessionId?: string;
}

export interface ClaudeImportCandidate extends ImportCandidateExtras {
  provider: "claudeCode";
  sessionId: string;
  sourcePath: string;
  workspacePath?: string;
  previewTitle?: string;
  createdAt?: number;
  updatedAt: number;
}

export interface ClaudeImportResult {
  imported: Array<{ sessionId: string; importedSessionId: string; title?: string }>;
  skipped: Array<{ sessionId: string; reason: string }>;
  failed: Array<{ sessionId: string; reason: string }>;
}

/** 导入来源：claudeCode（~/.claude/projects jsonl）| zcode（~/.zcode/cli/db/db.sqlite）| dsh（~/.dsh/sessions）| codex（~/.codex/sessions） */
export type ImportSource = "claudeCode" | "zcode" | "dsh" | "codex";

export interface ZcodeImportCandidate extends ImportCandidateExtras {
  provider: "zcode";
  sessionId: string;
  sourcePath: string;
  workspacePath?: string;
  previewTitle?: string;
  createdAt?: number;
  updatedAt: number;
}

export interface DshImportCandidate extends ImportCandidateExtras {
  provider: "dsh";
  sessionId: string;
  sourcePath: string;
  workspacePath?: string;
  previewTitle?: string;
  createdAt?: number;
  updatedAt: number;
}

export interface CodexImportCandidate extends ImportCandidateExtras {
  provider: "codex";
  sessionId: string;
  sourcePath: string;
  workspacePath?: string;
  previewTitle?: string;
  createdAt?: number;
  updatedAt: number;
}

// ─── 常量 ───

/** 扫描预览只读头部行数（拿标题/cwd/时间足够，避免解析几百 MB 的 jsonl） */
const HEAD_LINES = 16;
/** 目录名黑名单：subagent / worktree 的会话不导入 */
const SKIPPED_DIR_NAMES = new Set(["subagents", "worktree", "worktrees"]);
/** 扫描返回上限（保护 UI；用户可调 modifiedSince/分批导入） */
const MAX_SCAN_RESULTS = 500;

// ─── 服务 ───

@Injectable()
export class ClaudeImportService {
  private readonly logger = new Logger(ClaudeImportService.name);

  constructor(
    private readonly sessionService: SessionService,
    private readonly agentStore: AgentFileStore,
    private readonly modelStore: ProviderFileStore,
    @Inject(MESSAGE_STORE_TOKEN) private readonly messageStore: IMessageStore,
    @Inject(SESSION_STORE_TOKEN) private readonly sessionStore: SessionStoreFacade,
  ) {}

  /**
   * 解析导入会话使用的 agentId。
   *
   * createSession 要求 agent（继承 settings/model/avatar）。设置页导入没有「当前助手」
   * 上下文，未显式传时回退到默认助手（listAgents 已把 DEFAULT_AGENT_ID 排在最前）；
   * 一个助手都没有时给出可操作错误，而不是裸的 "agentId is required"。
   */
  private async resolveAgentId(explicit?: string): Promise<string> {
    if (explicit) return explicit;
    const agents = await this.agentStore.listAgents();
    const first = agents[0];
    if (!first) {
      throw new BadRequestException(
        "没有可用的智能体：请先在「助手」页创建一个助手再导入会话",
      );
    }
    return first.id;
  }

  /**
   * 会话必须有可解析的模型（createSession 的硬约束）。刻意**不用来源端的模型名**
   * （如 glm-5.3-flash，本机多半不存在），而是：
   * 1. 助手默认模型仍可解析 → 用它（与正常建会话一致）；
   * 2. 否则取任一启用中的模型兜底；
   * 用户之后在对话框的模型选择器里改即可。一个模型都没有时返回 undefined，
   * 由 createSession 报「未指定模型」。
   */
  private async resolveModelId(agentId: string): Promise<string | undefined> {
    try {
      const agent = await this.agentStore.findById(agentId);
      if (agent?.modelId && this.modelStore.findModel(agent.modelId)) {
        return agent.modelId;
      }
    } catch {
      // 助手读取失败不阻断导入：继续走兜底
    }
    const models = this.modelStore.listModels();
    return models[0]?.id;
  }

  /**
   * 导入会话的上下文占用锚点：按本机解析出的模型窗口计算压缩有效窗口。
   *
   * 来源端的 turn 用量（prompt/output tokens）已随 message.usage 导入，
   * importTurns 会据此写 turn/finish.usedTokens；但前端显示占用还需要
   * effectiveContextWindow（缺失时整条锚点被忽略）。它不是来源数据，而是
   * 「当前会话模型的有效窗口」——用本机模型配置算，用户之后换模型会被新请求覆盖。
   */
  private resolveEffectiveContextWindow(modelId?: string): number | undefined {
    if (!modelId) return undefined;
    try {
      const model = this.modelStore.findModel(modelId);
      if (!model) return undefined;
      const budget = resolveContextWindowBudget({
        contextWindow: model.config?.contextWindow,
        maxOutputTokens: model.config?.maxOutputTokens,
      });
      return budget.effectiveContextWindow;
    } catch {
      return undefined;
    }
  }

  /** 提取可读错误：BadRequestException 的对象响应里取 message/error，避免只得到 "Bad Request Exception" */
  private describeImportError(err: any): string {
    const response = typeof err?.getResponse === "function" ? err.getResponse() : undefined;
    if (typeof response === "string") return response;
    if (response && typeof response === "object") {
      if (typeof response.message === "string") return response.message;
      if (typeof response.error === "string") return response.error;
    }
    return err?.message || String(err);
  }

  /**
   * 把来源压缩点换算成 importTurns 的 ImportCompactionPoint：
   * - beforeTurnIndex 夹到 [0, turns.length]（mid-turn 压缩吸附到回合边界）；
   * - shadowedCount 按折叠视图语义顺序计算：第一次 = 该点前消息条数；
   *   之后每次 = 1 + 距上次压缩点新增的消息条数（上次的摘要节点占头部一条）；
   * - 无内容可遮蔽（位置 0）的压缩点跳过。
   */
  private buildImportCompactions(
    turns: Turn[],
    points: Array<ParsedZcodeCompaction | ParsedDshCompaction>,
  ): ImportCompactionPoint[] {
    if (points.length === 0) return [];
    const sorted = [...points].sort((a, b) => a.beforeTurnIndex - b.beforeTurnIndex);
    const result: ImportCompactionPoint[] = [];
    let prevRawBefore = 0;
    let emitted = 0;

    for (const point of sorted) {
      const index = Math.max(0, Math.min(point.beforeTurnIndex, turns.length));
      // DSH 的 shadowedSeqs 能精确给出「压缩点之前已导入的消息条数」；
      // ZCode 只有回合边界，按已建回合的消息数求和
      let rawBefore =
        "rawBeforeMessages" in point && typeof point.rawBeforeMessages === "number"
          ? point.rawBeforeMessages
          : 0;
      if (rawBefore <= 0) {
        for (let i = 0; i < index; i++) rawBefore += turns[i].messages.length;
      }
      if (rawBefore <= 0) continue; // 压缩点之前没有导入内容

      const shadowedCount = emitted === 0 ? rawBefore : 1 + (rawBefore - prevRawBefore);
      if (shadowedCount <= 0) continue;

      // 遮蔽末位消息 id = 该位置之前最后一条消息（前端"已压缩"标记用）
      let shadowedEndId: string | undefined;
      let remaining = rawBefore;
      for (const turn of turns) {
        if (remaining <= turn.messages.length) {
          shadowedEndId = remaining > 0 ? turn.messages[remaining - 1]?.id : undefined;
          break;
        }
        remaining -= turn.messages.length;
      }

      result.push({
        beforeTurnIndex: index,
        summary: point.summary,
        shadowedCount,
        ...(shadowedEndId ? { shadowedEndId } : {}),
        ...(point.time !== undefined ? { time: point.time } : {}),
      });
      prevRawBefore = rawBefore;
      emitted += 1;
    }
    return result;
  }

  // ─── 幂等锚点 ───

  /** 确定性导入会话 id：同源（源文件路径 + 源 sessionId）恒同 id，重复导入自然查重 */
  static importedSessionId(sourcePath: string, sessionId: string, source: ImportSource = "claudeCode"): string {
    const normalized = sourcePath.replace(/\\/g, "/").toLowerCase();
    const hash = crypto
      .createHash("sha256")
      .update(`${source}:${normalized}:${sessionId}`)
      .digest("hex");
    const prefix =
      source === "zcode" ? "zcode" : source === "dsh" ? "dsh" : source === "codex" ? "codex" : "claude";
    return `${prefix}-${hash.slice(0, 20)}`;
  }

  /**
   * 给返回页补「本机已导入」标记：拿幂等锚点反查会话表，与 importSingle 的查重同源，
   * 所以标了「已导入」的点导入必然得到 skipped already_imported，不会两套口径。
   * 只查最终页（≤MAX_SCAN_RESULTS 次主键点查），失败时整体不标注——宁缺勿假。
   */
  private async annotateImported(
    page: Array<{
      sourcePath: string;
      sessionId: string;
      imported?: boolean;
      importedSessionId?: string;
    }>,
    source: ImportSource,
  ): Promise<void> {
    if (page.length === 0) return;
    const expectedIds = page.map((c) =>
      ClaudeImportService.importedSessionId(c.sourcePath, c.sessionId, source),
    );
    let existing: Set<string>;
    try {
      const rows = await this.sessionStore.getManyByIds(expectedIds);
      existing = new Set(rows.map((row) => row.id));
    } catch (err: any) {
      this.logger.warn(`导入标记查询失败，本轮不标注: ${err?.message ?? err}`);
      return;
    }
    for (let i = 0; i < page.length; i++) {
      const hit = existing.has(expectedIds[i]);
      page[i].imported = hit;
      if (hit) page[i].importedSessionId = expectedIds[i];
    }
  }

  // ─── 扫描 ───

  /** 多候选根：覆盖 HOME 被重定向/数据目录分离的场景 */
  private claudeProjectsRoots(): string[] {
    const roots = new Set<string>();
    const home = os.homedir();
    if (home) roots.add(path.join(home, ".claude", "projects"));
    const envHome = process.env.HOME;
    if (envHome) roots.add(path.join(envHome, ".claude", "projects"));
    const userdata = process.env.USERDATA_DIR;
    if (userdata) roots.add(path.join(userdata, ".claude", "projects"));
    return Array.from(roots);
  }

  private collectJsonlFiles(dir: string, out: string[], depth = 0): void {
    if (depth > 8) return; // 目录深度兜底，防循环链接
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIPPED_DIR_NAMES.has(entry.name.toLowerCase())) continue;
        this.collectJsonlFiles(full, out, depth + 1);
      } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        out.push(full);
      }
    }
  }

  private readJsonLinesHead(filePath: string, maxLines: number): ClaudeJsonlRecord[] {
    let content: string;
    try {
      const fd = fs.openSync(filePath, "r");
      try {
        const buffer = Buffer.alloc(256 * 1024);
        const bytes = fs.readSync(fd, buffer, 0, buffer.length, 0);
        content = buffer.subarray(0, bytes).toString("utf8");
      } finally {
        fs.closeSync(fd);
      }
    } catch {
      return [];
    }
    const lines = content.split("\n").slice(0, maxLines);
    const records: ClaudeJsonlRecord[] = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed === "object") records.push(parsed as ClaudeJsonlRecord);
      } catch {
        // 容忍截断的尾行（256KB 窗口可能切在 JSON 中间）：预览容错
      }
    }
    return records;
  }

  private readJsonLinesFile(filePath: string): { records: ClaudeJsonlRecord[]; error?: string } {
    let content: string;
    try {
      content = fs.readFileSync(filePath, "utf8");
    } catch (err: any) {
      return { records: [], error: err?.message || String(err) };
    }
    const records: ClaudeJsonlRecord[] = [];
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed === "object") records.push(parsed as ClaudeJsonlRecord);
      } catch {
        // 单行坏不整体失败：记录后跳过（对齐 zcode 的宽容读取）
        this.logger.debug(`跳过坏行 ${filePath}:${i + 1}`);
      }
    }
    return { records };
  }

  async scanClaudeSessions(
    opts: { modifiedSince?: number; limit?: number; withImported?: boolean } = {},
  ): Promise<{ candidates: ClaudeImportCandidate[]; roots: string[] }> {
    const roots = this.claudeProjectsRoots();
    const limit = Math.min(Math.max(opts.limit ?? MAX_SCAN_RESULTS, 1), MAX_SCAN_RESULTS);
    const candidates: ClaudeImportCandidate[] = [];

    for (const root of roots) {
      if (!fs.existsSync(root)) continue;
      const files: string[] = [];
      this.collectJsonlFiles(root, files);
      for (const filePath of files) {
        if (candidates.length >= limit) break;
        const sessionId = path.basename(filePath, ".jsonl");
        if (!sessionId) continue;
        let stat: fs.Stats;
        try {
          stat = fs.statSync(filePath);
        } catch {
          continue;
        }
        if (opts.modifiedSince !== undefined && stat.mtimeMs < opts.modifiedSince) continue;

        const head = parseClaudeHeadInfo(this.readJsonLinesHead(filePath, HEAD_LINES));
        if (head.isSidechain) continue;

        candidates.push({
          provider: "claudeCode",
          sessionId,
          sourcePath: filePath,
          ...(head.cwd ? { workspacePath: head.cwd } : {}),
          ...(head.previewTitle ? { previewTitle: head.previewTitle } : {}),
          ...(head.createdAt !== undefined ? { createdAt: head.createdAt } : {}),
          updatedAt: head.updatedAt ?? Math.round(stat.mtimeMs),
          sizeBytes: stat.size,
        });
      }
      if (candidates.length >= limit) break;
    }

    candidates.sort((a, b) => b.updatedAt - a.updatedAt);
    const page = candidates.slice(0, limit);
    if (opts.withImported !== false) {
      await this.annotateImported(page, "claudeCode");
    }
    return { candidates: page, roots };
  }

  // ─── 导入 ───

  async importClaudeSessions(params: {
    sessionIds: string[];
    agentId?: string;
    groupId?: string;
  }): Promise<ClaudeImportResult> {
    const result: ClaudeImportResult = { imported: [], skipped: [], failed: [] };
    const sessionIds = Array.from(new Set(params.sessionIds.map((id) => id.trim()).filter(Boolean)));
    if (sessionIds.length === 0) return result;

    // 未传 agentId（设置页导入的常态）时回退默认助手；一个都没有则整请求拒绝
    const agentId = await this.resolveAgentId(params.agentId);
    // 模型不取来源端：助手默认（可解析时）→ 任一启用模型兜底，用户之后自己改
    const modelId = await this.resolveModelId(agentId);
    // 上下文占用锚点的有效窗口按本机模型算（turn/finish 需要它才会被前端采纳）
    const effectiveContextWindow = this.resolveEffectiveContextWindow(modelId);

    // 定位源文件：扫一遍建 sessionId → path 映射（同 sessionId 多根时取 mtime 新者）
    // withImported:false —— importSingle 自己会查重，这里不再点查一遍会话表
    const { candidates } = await this.scanClaudeSessions({
      limit: MAX_SCAN_RESULTS,
      withImported: false,
    });
    const byId = new Map<string, ClaudeImportCandidate>();
    for (const candidate of candidates) {
      const existing = byId.get(candidate.sessionId);
      if (!existing || candidate.updatedAt > existing.updatedAt) byId.set(candidate.sessionId, candidate);
    }

    for (const sessionId of sessionIds) {
      try {
        const candidate = byId.get(sessionId);
        if (!candidate) {
          result.skipped.push({ sessionId, reason: "session_not_found" });
          continue;
        }
        await this.importSingle(
          candidate,
          { ...params, agentId, modelId, effectiveContextWindow },
          result,
        );
      } catch (err: any) {
        this.logger.warn(
          `导入 Claude 会话失败 ${sessionId}: ${this.describeImportError(err)}`,
        );
        result.failed.push({ sessionId, reason: this.describeImportError(err) });
      }
    }
    return result;
  }

  private async importSingle(
    candidate: ClaudeImportCandidate,
    params: {
      agentId?: string;
      modelId?: string;
      groupId?: string;
      effectiveContextWindow?: number;
    },
    result: ClaudeImportResult,
  ): Promise<void> {
    const importedId = ClaudeImportService.importedSessionId(
      candidate.sourcePath,
      candidate.sessionId,
    );

    // 幂等：同源已导入过 → skip（不产生重复内容）
    const existing = await this.sessionService.getSessionById(importedId).catch(() => null);
    if (existing) {
      result.skipped.push({ sessionId: candidate.sessionId, reason: "already_imported" });
      return;
    }

    const { records, error } = this.readJsonLinesFile(candidate.sourcePath);
    if (error) {
      result.failed.push({ sessionId: candidate.sessionId, reason: `read_failed: ${error}` });
      return;
    }
    const parsed = parseClaudeJsonlRecords(records);
    if (parsed.turns.length === 0) {
      result.skipped.push({ sessionId: candidate.sessionId, reason: "no_visible_turns" });
      return;
    }

    // workspace：源 cwd 目录仍存在才带过去，否则走默认新建（校验失败会被 createSession 拒绝）
    const cwd = parsed.meta.cwd ?? candidate.workspacePath;
    let workspacePath: string | undefined;
    if (cwd && fs.existsSync(cwd) && fs.statSync(cwd).isDirectory()) {
      workspacePath = cwd;
    }

    const title =
      parsed.meta.previewTitle ||
      candidate.previewTitle ||
      `Imported Claude session ${candidate.sessionId.slice(0, 8)}`;

    const session = await this.sessionService.createSession({
      // 用导入 id 占位创建后改写为目标 id 不可行（store 主键策略未知），
      // 这里以 title/metadata 标记来源，幂等靠 importedId 前查
      agentId: params.agentId,
      // 模型不取来源端（本机未必存在）：用解析出的本机可用模型，用户之后在对话框里改
      ...(params.modelId ? { modelId: params.modelId } : {}),
      title,
      ...(workspacePath ? { workspacePath } : {}),
      ...(params.groupId ? { groupId: params.groupId } : {}),
      data: {
        migrationSource: "claudeCode",
        importedSessionId: importedId,
        importedFrom: candidate.sourcePath,
        importedSessionKey: candidate.sessionId,
        ...(parsed.meta.model ? { sourceModel: parsed.meta.model } : {}),
      },
    });

    try {
      await this.messageStore.importTurns(
        session.id,
        parsed.turns,
        params.effectiveContextWindow !== undefined
          ? { effectiveContextWindow: params.effectiveContextWindow }
          : undefined,
      );
    } catch (err: any) {
      // 导入消息失败：回滚半成品会话（对齐 branchSession 的回滚语义）
      this.logger.error(
        `导入消息失败，回滚会话 ${session.id}: ${err?.message ?? err}`,
      );
      await this.sessionService.deleteSession(session.id).catch(() => {});
      throw err;
    }

    this.logger.log(
      `已导入 Claude 会话 ${candidate.sessionId} → ${session.id}（${parsed.turns.length} 轮）`,
    );
    result.imported.push({
      sessionId: candidate.sessionId,
      importedSessionId: session.id,
      title,
    });
  }

  // ══════════════ ZCode 来源（~/.zcode/cli/db/db.sqlite） ══════════════

  /** 扫描 ZCode 会话库；库不存在返回空候选（不报错，UI 显示空态） */
  async scanZcodeSessions(
    opts: { modifiedSince?: number; limit?: number; withImported?: boolean } = {},
  ): Promise<{ candidates: ZcodeImportCandidate[]; roots: string[] }> {
    const roots = zcodeDbPaths();
    if (roots.length === 0) return { candidates: [], roots: [] };
    const limit = Math.min(Math.max(opts.limit ?? MAX_SCAN_RESULTS, 1), MAX_SCAN_RESULTS);
    const candidates: ZcodeImportCandidate[] = [];

    for (const dbPath of roots) {
      try {
        const summaries = listZcodeSessions(dbPath);
        for (const summary of summaries) {
          if (candidates.length >= limit) break;
          if (opts.modifiedSince !== undefined && summary.timeUpdated < opts.modifiedSince) continue;
          candidates.push({
            provider: "zcode",
            sessionId: summary.id,
            sourcePath: dbPath,
            ...(summary.directory ? { workspacePath: summary.directory } : {}),
            ...(summary.title ? { previewTitle: summary.title } : {}),
            ...(summary.timeCreated > 0 ? { createdAt: summary.timeCreated } : {}),
            updatedAt: summary.timeUpdated || summary.timeCreated,
            ...(summary.messageCount !== undefined ? { messageCount: summary.messageCount } : {}),
          });
        }
      } catch (err: any) {
        // 单库打开失败（损坏/版本不识别）不影响其他候选根
        this.logger.warn(`读取 ZCode 会话库失败 ${dbPath}: ${err?.message ?? err}`);
      }
      if (candidates.length >= limit) break;
    }

    candidates.sort((a, b) => b.updatedAt - a.updatedAt);
    const page = candidates.slice(0, limit);
    if (opts.withImported !== false) {
      await this.annotateImported(page, "zcode");
    }
    return { candidates: page, roots };
  }

  async importZcodeSessions(params: {
    sessionIds: string[];
    agentId?: string;
    groupId?: string;
  }): Promise<ClaudeImportResult> {
    const result: ClaudeImportResult = { imported: [], skipped: [], failed: [] };
    const sessionIds = Array.from(new Set(params.sessionIds.map((id) => id.trim()).filter(Boolean)));
    if (sessionIds.length === 0) return result;

    // 未传 agentId 时回退默认助手（同 Claude 源）
    const agentId = await this.resolveAgentId(params.agentId);
    // 模型不取来源端：助手默认（可解析时）→ 任一启用模型兜底
    const modelId = await this.resolveModelId(agentId);
    // 上下文占用锚点的有效窗口按本机模型算
    const effectiveContextWindow = this.resolveEffectiveContextWindow(modelId);

    const roots = zcodeDbPaths();
    if (roots.length === 0) {
      for (const sessionId of sessionIds) {
        result.skipped.push({ sessionId, reason: "db_not_found" });
      }
      return result;
    }

    // sessionId → dbPath（多根时取 time_updated 新者）
    const byId = new Map<string, { dbPath: string; summary: ZcodeSessionSummary }>();
    for (const dbPath of roots) {
      try {
        for (const summary of listZcodeSessions(dbPath)) {
          const existing = byId.get(summary.id);
          if (!existing || summary.timeUpdated > existing.summary.timeUpdated) {
            byId.set(summary.id, { dbPath, summary });
          }
        }
      } catch (err: any) {
        this.logger.warn(`读取 ZCode 会话库失败 ${dbPath}: ${err?.message ?? err}`);
      }
    }

    for (const sessionId of sessionIds) {
      try {
        const found = byId.get(sessionId);
        if (!found) {
          result.skipped.push({ sessionId, reason: "session_not_found" });
          continue;
        }
        await this.importZcodeSingle(
          found.dbPath,
          found.summary,
          { ...params, agentId, modelId, effectiveContextWindow },
          result,
        );
      } catch (err: any) {
        this.logger.warn(`导入 ZCode 会话失败 ${sessionId}: ${this.describeImportError(err)}`);
        result.failed.push({ sessionId, reason: this.describeImportError(err) });
      }
    }
    return result;
  }

  private async importZcodeSingle(
    dbPath: string,
    summary: ZcodeSessionSummary,
    params: {
      agentId?: string;
      modelId?: string;
      groupId?: string;
      effectiveContextWindow?: number;
    },
    result: ClaudeImportResult,
  ): Promise<void> {
    const importedId = ClaudeImportService.importedSessionId(dbPath, summary.id, "zcode");

    const existing = await this.sessionService.getSessionById(importedId).catch(() => null);
    if (existing) {
      result.skipped.push({ sessionId: summary.id, reason: "already_imported" });
      return;
    }

    const parsed = readZcodeSession(dbPath, summary.id);
    if (parsed.turns.length === 0) {
      result.skipped.push({ sessionId: summary.id, reason: "no_visible_turns" });
      return;
    }

    // workspace：源 directory 仍存在才复用（对齐 Claude 导入的校验策略）
    const dir = summary.directory;
    let workspacePath: string | undefined;
    if (dir && fs.existsSync(dir) && fs.statSync(dir).isDirectory()) {
      workspacePath = dir;
    }

    const title =
      parsed.meta.title ||
      summary.title ||
      `Imported ZCode session ${summary.id.slice(0, 8)}`;

    const session = await this.sessionService.createSession({
      agentId: params.agentId,
      // 模型不取来源端：用解析出的本机可用模型，用户之后在对话框里改
      ...(params.modelId ? { modelId: params.modelId } : {}),
      title,
      ...(workspacePath ? { workspacePath } : {}),
      ...(params.groupId ? { groupId: params.groupId } : {}),
      data: {
        migrationSource: "zcode",
        importedSessionId: importedId,
        importedFrom: dbPath,
        importedSessionKey: summary.id,
        ...(parsed.meta.model ? { sourceModel: parsed.meta.model } : {}),
      },
    });

    try {
      // 压缩过虑：把源压缩点合成为我们自己的 compaction 三事件——
      // 界面全量可见（带压缩卡片），模型侧折叠为「摘要 + 压缩后尾巴」
      const compactions = this.buildImportCompactions(parsed.turns, parsed.compactions);
      const importOpts = {
        ...(compactions.length > 0 ? { compactions } : {}),
        ...(params.effectiveContextWindow !== undefined
          ? { effectiveContextWindow: params.effectiveContextWindow }
          : {}),
      };
      await this.messageStore.importTurns(
        session.id,
        parsed.turns,
        Object.keys(importOpts).length > 0 ? importOpts : undefined,
      );
    } catch (err: any) {
      this.logger.error(
        `导入消息失败，回滚会话 ${session.id}: ${err?.message ?? err}`,
      );
      await this.sessionService.deleteSession(session.id).catch(() => {});
      throw err;
    }

    this.logger.log(
      `已导入 ZCode 会话 ${summary.id} → ${session.id}（${parsed.turns.length} 轮）`,
    );
    result.imported.push({
      sessionId: summary.id,
      importedSessionId: session.id,
      title,
    });
  }

  // ══════════════ DSH 来源（~/.dsh/sessions/*.jsonl[.zstd]） ══════════════

  /** 扫描 DSH 会话日志；目录不存在返回空候选（UI 显示空态） */
  async scanDshSessions(
    opts: { modifiedSince?: number; limit?: number; withImported?: boolean } = {},
  ): Promise<{ candidates: DshImportCandidate[]; roots: string[] }> {
    const root = dshSessionsRoot();
    if (!root || !fs.existsSync(root)) return { candidates: [], roots: [] };
    const limit = Math.min(Math.max(opts.limit ?? MAX_SCAN_RESULTS, 1), MAX_SCAN_RESULTS);

    const candidates: DshImportCandidate[] = [];
    let summaries: DshSessionSummary[] = [];
    try {
      summaries = scanDshSessionSummaries(root);
    } catch (err: any) {
      this.logger.warn(`扫描 DSH 会话失败 ${root}: ${err?.message ?? err}`);
      return { candidates: [], roots: [root] };
    }

    for (const summary of summaries) {
      if (candidates.length >= limit) break;
      if (opts.modifiedSince !== undefined && summary.updatedAt < opts.modifiedSince) continue;
      let sizeBytes: number | undefined;
      try {
        sizeBytes = fs.statSync(summary.sourcePath).size;
      } catch {
        // 文件刚被移除：忽略体积
      }
      candidates.push({
        provider: "dsh",
        sessionId: summary.id,
        sourcePath: summary.sourcePath,
        ...(summary.cwd ? { workspacePath: summary.cwd } : {}),
        ...(summary.previewTitle ? { previewTitle: summary.previewTitle } : {}),
        ...(summary.createdAt !== undefined ? { createdAt: summary.createdAt } : {}),
        updatedAt: summary.updatedAt,
        ...(sizeBytes !== undefined ? { sizeBytes } : {}),
      });
    }

    candidates.sort((a, b) => b.updatedAt - a.updatedAt);
    const page = candidates.slice(0, limit);
    if (opts.withImported !== false) {
      await this.annotateImported(page, "dsh");
    }
    return { candidates: page, roots: [root] };
  }

  async importDshSessions(params: {
    sessionIds: string[];
    agentId?: string;
    groupId?: string;
  }): Promise<ClaudeImportResult> {
    const result: ClaudeImportResult = { imported: [], skipped: [], failed: [] };
    const sessionIds = Array.from(new Set(params.sessionIds.map((id) => id.trim()).filter(Boolean)));
    if (sessionIds.length === 0) return result;

    const agentId = await this.resolveAgentId(params.agentId);
    const modelId = await this.resolveModelId(agentId);
    const effectiveContextWindow = this.resolveEffectiveContextWindow(modelId);

    const root = dshSessionsRoot();
    if (!root || !fs.existsSync(root)) {
      for (const sessionId of sessionIds) {
        result.skipped.push({ sessionId, reason: "db_not_found" });
      }
      return result;
    }

    // sessionId → 会话摘要（多根不会出现：DSH 只有一个 sessions 根）
    const byId = new Map<string, DshSessionSummary>();
    try {
      for (const summary of scanDshSessionSummaries(root)) {
        const existing = byId.get(summary.id);
        if (!existing || summary.updatedAt > existing.updatedAt) byId.set(summary.id, summary);
      }
    } catch (err: any) {
      this.logger.warn(`扫描 DSH 会话失败 ${root}: ${err?.message ?? err}`);
    }

    for (const sessionId of sessionIds) {
      try {
        const found = byId.get(sessionId);
        if (!found) {
          result.skipped.push({ sessionId, reason: "session_not_found" });
          continue;
        }
        await this.importDshSingle(found, { ...params, agentId, modelId, effectiveContextWindow }, result);
      } catch (err: any) {
        this.logger.warn(`导入 DSH 会话失败 ${sessionId}: ${this.describeImportError(err)}`);
        result.failed.push({ sessionId, reason: this.describeImportError(err) });
      }
    }
    return result;
  }

  private async importDshSingle(
    summary: DshSessionSummary,
    params: {
      agentId?: string;
      modelId?: string;
      groupId?: string;
      effectiveContextWindow?: number;
    },
    result: ClaudeImportResult,
  ): Promise<void> {
    const importedId = ClaudeImportService.importedSessionId(summary.sourcePath, summary.id, "dsh");

    const existing = await this.sessionService.getSessionById(importedId).catch(() => null);
    if (existing) {
      result.skipped.push({ sessionId: summary.id, reason: "already_imported" });
      return;
    }

    const parsed = readDshSession(summary.sourcePath);
    if (parsed.turns.length === 0) {
      result.skipped.push({ sessionId: summary.id, reason: "no_visible_turns" });
      return;
    }

    // workspace：源 cwd 仍存在才复用
    const dir = summary.cwd;
    let workspacePath: string | undefined;
    if (dir && fs.existsSync(dir) && fs.statSync(dir).isDirectory()) {
      workspacePath = dir;
    }

    const title =
      parsed.meta.title ||
      summary.previewTitle ||
      `Imported DSH session ${summary.id.slice(0, 8)}`;

    const session = await this.sessionService.createSession({
      agentId: params.agentId,
      ...(params.modelId ? { modelId: params.modelId } : {}),
      title,
      ...(workspacePath ? { workspacePath } : {}),
      ...(params.groupId ? { groupId: params.groupId } : {}),
      data: {
        migrationSource: "dsh",
        importedSessionId: importedId,
        importedFrom: summary.sourcePath,
        importedSessionKey: summary.id,
        ...(parsed.meta.model ? { sourceModel: parsed.meta.model } : {}),
      },
    });

    try {
      // 压缩点合成为我们的 compaction 三事件（与 ZCode/Claude 导入同一套语义）
      const compactions = this.buildImportCompactions(parsed.turns, parsed.compactions);
      const importOpts = {
        ...(compactions.length > 0 ? { compactions } : {}),
        ...(params.effectiveContextWindow !== undefined
          ? { effectiveContextWindow: params.effectiveContextWindow }
          : {}),
      };
      await this.messageStore.importTurns(
        session.id,
        parsed.turns,
        Object.keys(importOpts).length > 0 ? importOpts : undefined,
      );
    } catch (err: any) {
      this.logger.error(
        `导入消息失败，回滚会话 ${session.id}: ${err?.message ?? err}`,
      );
      await this.sessionService.deleteSession(session.id).catch(() => {});
      throw err;
    }

    this.logger.log(
      `已导入 DSH 会话 ${summary.id} → ${session.id}（${parsed.turns.length} 轮）`,
    );
    result.imported.push({
      sessionId: summary.id,
      importedSessionId: session.id,
      title,
    });
  }

  // ══════════════ Codex 来源（~/.codex/sessions 的 rollout 分页） ══════════════

  /** 扫描 Codex rollout（按 thread 聚合分页）；目录不存在返回空候选 */
  async scanCodexSessions(
    opts: { modifiedSince?: number; limit?: number; withImported?: boolean } = {},
  ): Promise<{ candidates: CodexImportCandidate[]; roots: string[] }> {
    const roots = codexSessionRoots();
    if (roots.length === 0) return { candidates: [], roots: [] };
    const limit = Math.min(Math.max(opts.limit ?? MAX_SCAN_RESULTS, 1), MAX_SCAN_RESULTS);

    let summaries: CodexSessionSummary[] = [];
    try {
      summaries = scanCodexSessionSummaries(roots);
    } catch (err: any) {
      this.logger.warn(`扫描 Codex 会话失败: ${err?.message ?? err}`);
      return { candidates: [], roots };
    }

    const candidates: CodexImportCandidate[] = [];
    for (const summary of summaries) {
      if (candidates.length >= limit) break;
      if (opts.modifiedSince !== undefined && summary.updatedAt < opts.modifiedSince) continue;
      let sizeBytes = 0;
      for (const page of summary.pages) {
        try {
          sizeBytes += fs.statSync(page.filePath).size;
        } catch {
          // 单页消失：忽略其体积
        }
      }
      candidates.push({
        provider: "codex",
        sessionId: summary.id,
        sourcePath: summary.sourcePath,
        ...(summary.cwd ? { workspacePath: summary.cwd } : {}),
        ...(summary.previewTitle ? { previewTitle: summary.previewTitle } : {}),
        ...(summary.createdAt !== undefined ? { createdAt: summary.createdAt } : {}),
        updatedAt: summary.updatedAt,
        ...(sizeBytes > 0 ? { sizeBytes } : {}),
      });
    }

    candidates.sort((a, b) => b.updatedAt - a.updatedAt);
    const page = candidates.slice(0, limit);
    if (opts.withImported !== false) {
      await this.annotateImported(page, "codex");
    }
    return { candidates: page, roots };
  }

  async importCodexSessions(params: {
    sessionIds: string[];
    agentId?: string;
    groupId?: string;
  }): Promise<ClaudeImportResult> {
    const result: ClaudeImportResult = { imported: [], skipped: [], failed: [] };
    const sessionIds = Array.from(new Set(params.sessionIds.map((id) => id.trim()).filter(Boolean)));
    if (sessionIds.length === 0) return result;

    const agentId = await this.resolveAgentId(params.agentId);
    const modelId = await this.resolveModelId(agentId);
    const effectiveContextWindow = this.resolveEffectiveContextWindow(modelId);

    const roots = codexSessionRoots();
    if (roots.length === 0) {
      for (const sessionId of sessionIds) {
        result.skipped.push({ sessionId, reason: "db_not_found" });
      }
      return result;
    }

    const byId = new Map<string, CodexSessionSummary>();
    try {
      for (const summary of scanCodexSessionSummaries(roots)) {
        const existing = byId.get(summary.id);
        if (!existing || summary.updatedAt > existing.updatedAt) byId.set(summary.id, summary);
      }
    } catch (err: any) {
      this.logger.warn(`扫描 Codex 会话失败: ${err?.message ?? err}`);
    }

    for (const sessionId of sessionIds) {
      try {
        const found = byId.get(sessionId);
        if (!found) {
          result.skipped.push({ sessionId, reason: "session_not_found" });
          continue;
        }
        await this.importCodexSingle(
          found,
          { ...params, agentId, modelId, effectiveContextWindow },
          result,
        );
      } catch (err: any) {
        this.logger.warn(`导入 Codex 会话失败 ${sessionId}: ${this.describeImportError(err)}`);
        result.failed.push({ sessionId, reason: this.describeImportError(err) });
      }
    }
    return result;
  }

  private async importCodexSingle(
    summary: CodexSessionSummary,
    params: {
      agentId?: string;
      modelId?: string;
      groupId?: string;
      effectiveContextWindow?: number;
    },
    result: ClaudeImportResult,
  ): Promise<void> {
    // 幂等锚点用链首页路径：新页追加不改变首页，重复导入仍会命中
    const importedId = ClaudeImportService.importedSessionId(summary.sourcePath, summary.id, "codex");

    const existing = await this.sessionService.getSessionById(importedId).catch(() => null);
    if (existing) {
      result.skipped.push({ sessionId: summary.id, reason: "already_imported" });
      return;
    }

    const parsed = readCodexSession(summary.pages);
    if (parsed.turns.length === 0) {
      result.skipped.push({ sessionId: summary.id, reason: "no_visible_turns" });
      return;
    }

    const dir = summary.cwd;
    let workspacePath: string | undefined;
    if (dir && fs.existsSync(dir) && fs.statSync(dir).isDirectory()) {
      workspacePath = dir;
    }

    const title =
      summary.previewTitle ||
      parsed.meta.title ||
      `Imported Codex session ${summary.id.slice(0, 8)}`;

    const session = await this.sessionService.createSession({
      agentId: params.agentId,
      ...(params.modelId ? { modelId: params.modelId } : {}),
      title,
      ...(workspacePath ? { workspacePath } : {}),
      ...(params.groupId ? { groupId: params.groupId } : {}),
      data: {
        migrationSource: "codex",
        importedSessionId: importedId,
        importedFrom: summary.sourcePath,
        importedSessionKey: summary.id,
        ...(parsed.meta.model ? { sourceModel: parsed.meta.model } : {}),
        ...(parsed.meta.contextWindow !== undefined
          ? { sourceContextWindow: parsed.meta.contextWindow }
          : {}),
      },
    });

    try {
      const compactions = this.buildImportCompactions(parsed.turns, parsed.compactions);
      const importOpts = {
        ...(compactions.length > 0 ? { compactions } : {}),
        ...(params.effectiveContextWindow !== undefined
          ? { effectiveContextWindow: params.effectiveContextWindow }
          : {}),
      };
      await this.messageStore.importTurns(
        session.id,
        parsed.turns,
        Object.keys(importOpts).length > 0 ? importOpts : undefined,
      );
    } catch (err: any) {
      this.logger.error(
        `导入消息失败，回滚会话 ${session.id}: ${err?.message ?? err}`,
      );
      await this.sessionService.deleteSession(session.id).catch(() => {});
      throw err;
    }

    this.logger.log(
      `已导入 Codex 会话 ${summary.id} → ${session.id}（${parsed.turns.length} 轮）`,
    );
    result.imported.push({
      sessionId: summary.id,
      importedSessionId: session.id,
      title,
    });
  }
}
