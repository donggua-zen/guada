/**
 * 会话内容搜索服务（JSONL 实时扫描，替代 FTS5 索引）
 *
 * 数据源切换背景：消息写入已 100% 迁移到 JSONL（PersistenceModule），FTS 同步
 * worker 仍以 SQLite message_content 为源已断供。本服务直接扫描 JSONL：
 * 每批会话 读盘 → 原文折叠（保留被压缩消息）→ 文本匹配 → 返回后即弃。
 *
 * 设计（低频搜索取舍，对齐 VSCode 全量扫描模式）：
 * - 零缓存：无任何跨请求状态，内存即用即弃；重复扫描靠 OS 页文件缓存加速
 * - 渐进：上层（SessionService.searchSessions）按批喂会话 id，前端连续拉批，
 *   结果边扫边出；单批内每会话 setImmediate 让出事件循环，不阻塞 SSE 流
 * - 折叠语义对齐前端重建方式（streamProjector 对被压缩消息"标记不物理移除"）：
 *   applyCompressionPrune=false（压缩自动裁剪不应用，原文可搜）+ ignoreCompaction=true
 *   （整段忽略 compaction/* 括号，被压缩消息保留参与检索；摘要文本不入索引）。
 *   turn/delete 仍应用（删除回合不可搜）；user_edit 生效（编辑所见即所得）。
 * - 匹配范围对齐旧 FTS：仅 user（真实输入）+ assistant 的 TextBlock 文本，
 *   不含 reasoning / tool 块 / 系统注入（kind='model'）
 */

import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  PERSISTENCE_BACKEND_TOKEN,
  PersistenceBackend,
} from "../persistence/types";
import { createInitialState, foldEvents } from "../persistence/replayer";
import type { MessageNode } from "../persistence/types";

/** 单批扫描结果：sessionId → 首个命中的高亮片段（【】标记，对齐旧 FTS snippet 契约） */
export interface SessionScanBatchResult {
  matches: Map<string, string>;
  /** 本批实际扫描的会话数（用于游标推进） */
  scanned: number;
}

@Injectable()
export class SessionContentSearchService {
  private readonly logger = new Logger(SessionContentSearchService.name);

  constructor(
    @Inject(PERSISTENCE_BACKEND_TOKEN) private readonly backend: PersistenceBackend,
  ) {}

  /**
   * 扫描一批会话，返回内容命中的会话及高亮片段。
   * 单会话损坏（CorruptSessionLogError 等）仅告警跳过，不阻断整批。
   *
   * @param sessionIds 完整扫描清单（调用方按 lastActiveAt DESC 排好序）
   * @param offset 本批起点
   * @param batchSize 本批会话数上限
   */
  async scanBatch(
    keyword: string,
    sessionIds: string[],
    offset: number,
    batchSize: number,
  ): Promise<SessionScanBatchResult> {
    const matches = new Map<string, string>();
    const terms = parseTerms(keyword);
    if (terms.length === 0) return { matches, scanned: 0 };

    const end = Math.min(sessionIds.length, Math.max(0, offset) + batchSize);
    let scanned = 0;
    for (let i = Math.max(0, offset); i < end; i++) {
      const sessionId = sessionIds[i];
      scanned++;
      // 每会话 getAllEvents 的 JSON.parse 可达几十 ms，让出事件循环避免卡住 SSE
      await new Promise<void>((resolve) => setImmediate(resolve));
      try {
        // DB 有行但 JSONL 未迁移的旧会话：跳过（标题搜索仍可命中）
        if (!(await this.backend.hasSession(sessionId))) continue;
        const events = await this.backend.getAllEvents(sessionId);
        if (events.length === 0) continue;
        const state = foldEvents(events, createInitialState(), {
          applyCompressionPrune: false,
          ignoreCompaction: true,
        });
        const snippet = matchMessages(state.messages, terms);
        if (snippet) matches.set(sessionId, snippet);
      } catch (e: any) {
        this.logger.warn(
          `[content-search] scan session ${sessionId} failed: ${e?.message ?? e}`,
        );
      }
    }
    return { matches, scanned };
  }
}

/** 关键词 → 小写词元（空白分隔多词 = AND，同一条消息内全含才算命中） */
function parseTerms(keyword: string): string[] {
  return keyword
    .trim()
    .split(/\s+/)
    .map((t) => t.toLowerCase())
    .filter(Boolean);
}

/** 会话内消息匹配：任一条可搜索消息包含全部词元 → 返回首个命中片段 */
function matchMessages(messages: MessageNode[], terms: string[]): string | null {
  for (const node of messages) {
    if (!isSearchable(node)) continue;
    const text = extractText(node);
    if (!text) continue;
    const lower = text.toLowerCase();
    if (!terms.every((t) => lower.includes(t))) continue;
    return buildSnippet(text, lower, terms);
  }
  return null;
}

/** 与旧 FTS 对齐的可搜索范围：assistant 全部 + 真实用户输入（排除模型注入） */
function isSearchable(node: MessageNode): boolean {
  return node.role === "assistant" || (node.role === "user" && node.kind === "user");
}

/** 提取消息纯文本：仅 TextBlock（跳过系统注入块），不含 reasoning/tool 块 */
function extractText(node: MessageNode): string {
  const parts: string[] = [];
  for (const block of node.content) {
    if (block.type === "text" && block.origin !== "system") {
      parts.push(block.text);
    }
  }
  return parts.join("\n");
}

/**
 * 生成高亮片段：首个命中位置前 ~20 字后 ~40 字，命中词【】包裹，
 * 截断处加省略号；空白折叠为单空格（对齐旧 FTS5 snippet 输出形状，
 * 前端 formatSnippet 依赖【】标记渲染 <mark>）。
 */
const SNIPPET_BEFORE = 20;
const SNIPPET_AFTER = 40;

function buildSnippet(text: string, lower: string, terms: string[]): string {
  // 最早命中的词元（决定片段锚点与长度；不一定是 terms[0]）
  let firstIdx = Number.MAX_SAFE_INTEGER;
  let firstLen = 0;
  for (const t of terms) {
    const idx = lower.indexOf(t);
    if (idx !== -1 && idx < firstIdx) {
      firstIdx = idx;
      firstLen = t.length;
    }
  }
  const start = Math.max(0, firstIdx - SNIPPET_BEFORE);
  const end = Math.min(text.length, firstIdx + firstLen + SNIPPET_AFTER);
  const prefix = start > 0 ? "..." : "";
  const suffix = end < text.length ? "..." : "";

  // 空白折叠后再做标记（折叠改变下标，统一在折叠文本上定位）
  const slice = text.slice(start, end).replace(/\s+/g, " ").trim();
  const sliceLower = slice.toLowerCase();

  let marked = "";
  let pos = 0;
  while (pos < slice.length) {
    let hit = -1;
    let hitLen = 0;
    for (const t of terms) {
      const idx = sliceLower.indexOf(t, pos);
      if (idx !== -1 && (hit === -1 || idx < hit)) {
        hit = idx;
        hitLen = t.length;
      }
    }
    if (hit === -1) {
      marked += slice.slice(pos);
      break;
    }
    marked += slice.slice(pos, hit);
    marked += `【${slice.slice(hit, hit + hitLen)}】`;
    pos = hit + hitLen;
  }
  return prefix + marked + suffix;
}
