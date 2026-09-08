/**
 * StreamProjector:模块级流式事件投影器(接收链路独立的核心)
 *
 * 接收链路:全局 SSE → streamEventHub.route → streamReceiver.subscribeAll(常驻)
 *   → projectChunk(本模块):按 sessionId 路由
 *       - 有缓存会话 → 定位写 store(事件到达即改缓存)
 *       - 无缓存会话 → 暂存 finish 后事件(打开会话时应用)
 *
 * 独立于发送链路(handleSendMessage → apiService.chat),常驻接收(应用启动即建立)。
 *
 * 折叠模型:turn → messages(MessageBundle) → blocks 三层(对齐后端 Turn → Message → ContentBlock)。
 * 事件按消息束折叠:assistant 块事件按 (messageId, index) 寻址为 bundle.blocks 内独立块;
 * user_message 折叠为一个 user 消息束;compaction 占位为 role='event' 消息束。
 * 渲染直接消费 turn.messages(消息级字段单点挂载),按需引用收集块。
 *
 * 两种事件输入形态（折叠器同时支持）：
 * - WireStreamEvent：live SSE 块级增量协议（block_start/text_delta/block_end...）
 * - DomainEvent：事件页返回的 JSONL 领域事件（assistant/message 一条 = 全部块，终态）
 */

import { reactive } from "vue";
import { messageToTurnContent, extFromMediaType } from "@/services/modules/message.api";
import { updateTokenStatsFromSSE } from "@/composables/useSessionTokenStats";
import type { WireStreamEvent } from "@/types/stream";
import type { DomainEvent } from "@/types/stream/domain-event.types";
import type { ContentBlock } from "@/types/stream/content-block.types";
import type { Turn, TurnContent, MessageBundle } from "@/types/message";

/**
 * 投影器处理的事件类型 = live 块级事件 ∪ 领域事件（事件页）。
 */
export type ProjectorChunk = WireStreamEvent | DomainEvent;

/** 领域事件判别（type 含 '/'，如 turn/start；live 事件为 turn_start 等无斜杠） */
function isDomainEvent(chunk: ProjectorChunk): chunk is DomainEvent {
  return typeof (chunk as any).type === "string" && (chunk as any).type.includes("/");
}

/**
 * 有序 id 格式（m_/c_ + 26 字符 ULID；c_ < m_ → 检查点恒排序在所有消息之前）。
 * 字符串比较 = 时间序比较（ULID 首 10 字符为毫秒时间戳）。
 */
const ORDERED_ID_RE = /^[mc]_[0-9A-Z]{26}$/;

/**
 * 判定 messageId 是否 ≤ 分界点 id（有序 ULID 比较）。
 * 遮蔽区 = 头部连续前缀，分界点即末位；messageId <= 分界点 → 已压缩。
 * 仅对有序格式 id 生效；旧格式/占位 id（非 m_/c_<26字符>）一律视为未压缩（防御）。
 */
function isAtOrBeforeBoundary(messageId: string, boundaryId: string): boolean {
  if (!ORDERED_ID_RE.test(messageId) || !ORDERED_ID_RE.test(boundaryId)) {
    return false;
  }
  return messageId <= boundaryId;
}

/** 模块级暂存:无缓存会话的 finish 后事件(跨 handler/常驻接收共享) */
const stashBySession = new Map<string, ProjectorChunk[]>();

/**
 * 折叠期当前回合游标（sessionId → 当前回合 id）。
 * turn_start 设置、turn_end/turn_delete 清除；compaction_summary 据此判定 in-turn（回合内占位）
 * vs out-of-turn（独立 event 回合）——与后端 replayer 的 currentTurnId 语义一致。
 */
const currentTurnBySession = new Map<string, string | undefined>();

function setCurrentTurn(sessionId: string, turnId: string | undefined): void {
  currentTurnBySession.set(sessionId, turnId);
}

function getCurrentTurn(sessionId: string): string | undefined {
  return currentTurnBySession.get(sessionId);
}

/**
 * 按 toolCallId 定位包含该调用的 tool-call 块（跨回合扫描）。
 * 关联键是 provider 发出的 callId（一次调用唯一），不依赖 messageId——工具结果是独立消息。
 * 对齐 DSH 展示折叠：结果按 callId 挂回调用块，而非按消息 id。
 */
function findBlockByToolCallId(turns: any[], toolCallId: string): any {
  for (const t of turns) {
    if (!Array.isArray(t.messages)) continue;
    for (const m of t.messages) {
      if (!Array.isArray(m.blocks)) continue;
      for (const b of m.blocks) {
        if ((b.metadata?.toolCalls || []).some((tc: any) => tc.id === toolCallId)) {
          return b;
        }
      }
    }
  }
  return undefined;
}

/**
 * 暂存事件:finish/turn_end 表示该轮已落盘(后端快照包含),清空旧暂存;
 * 其余事件追加(打开会话时应用)。
 */
export function stashEvent(sessionId: string, chunk: ProjectorChunk): void {
  if (chunk.type === "finish" || chunk.type === "turn_end") {
    stashBySession.delete(sessionId);
    return;
  }
  const list = stashBySession.get(sessionId) ?? [];
  list.push(chunk);
  stashBySession.set(sessionId, list);
}

/** 打开无缓存会话时取出暂存(应用后清空) */
export function takeStash(sessionId: string): ProjectorChunk[] {
  const list = stashBySession.get(sessionId) ?? [];
  stashBySession.delete(sessionId);
  return list;
}

/**
 * 回合内定位/创建消息束（MessageBundle）：按 messageId 寻址（协议块级事件带 messageId；
 * 无宿主消息的孤儿块场景也会创建 bundle 承接）。消息级字段（role/metadata）在此单点挂载，
 * 块在 bundle.blocks 内按 index 寻址（对齐后端三层模型：Turn → Message → ContentBlock）。
 */
function ensureBundle(
  turn: Turn,
  messageId: string,
  role: TurnContent["role"],
): MessageBundle {
  if (!Array.isArray(turn.messages)) turn.messages = [];
  let bundle = turn.messages.find((m) => m.messageId === messageId);
  if (!bundle) {
    bundle = reactive<MessageBundle>({
      messageId,
      role,
      metadata: {},
      blocks: [],
    });
    turn.messages.push(bundle);
  }
  if (!Array.isArray(bundle.blocks)) bundle.blocks = [];
  return bundle;
}

/**
 * bundle 内定位/创建块：按 blockIndex 寻址（无 index → 该消息最后一块）。
 * block.id 为块级 contentId（block_end 回填）；messageId/role 为创建时一次性写入的
 * 不可变戳记（引用收集/展示过滤用，不参与流式更新；消息级可变元数据一律读 bundle）。
 */
function ensureBlockInBundle(
  bundle: MessageBundle,
  index?: number,
): TurnContent {
  const seq = bundle.blocks;
  if (index !== undefined) {
    const found = seq.find((b) => b.blockIndex === index);
    if (found) return found;
  } else if (seq.length > 0) {
    return seq[seq.length - 1];
  }
  const block = reactive<TurnContent>({
    id:
      index !== undefined
        ? `__blk_${bundle.messageId}_${index}`
        : `__blk_${bundle.messageId}_${Date.now()}`,
    role: bundle.role,
    messageId: bundle.messageId,
    ...(index !== undefined ? { blockIndex: index } : {}),
    content: null,
    reasoningContent: null,
    additionalKwargs: [],
    metadata: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    thinkingStartedAt: null,
    thinkingDurationMs: null,
    state: { isStreaming: true, isThinking: false },
  });
  bundle.blocks.push(block);
  return block;
}

/**
 * 完整 ContentBlock → TurnContent（live block_end 与领域事件 assistant/message 共用同一转换）。
 * 块 id 由流式占位（__blk_<messageId>_<index>）或 messageToTurnContent（messageId-index）承担，
 * 不再依赖块级 contentId。
 */
function applyCompleteBlock(content: TurnContent, block: ContentBlock): void {
  if (block.type === "text" && typeof block.text === "string") {
    content.content = block.text;
    // 块级注入标记透传（'system' = 系统注入，渲染层跳过不重建）
    if (block.origin) content.origin = block.origin;
  } else if (block.type === "kb-ref") {
    // KB 引用块：结构化明细挂载（chips 渲染数据源；正文不渲染序列化文本）
    content.kbRefs = block.kbRefs;
  } else if (block.type === "reasoning" && typeof block.summary === "string") {
    content.reasoningContent = block.summary;
    content.state.isThinking = false;
    // 思考时长由块级 timing 派生（后端权威打点）；多段思考累加
    if (block.timing?.startedAt != null) {
      const segmentMs =
        block.timing.finishedAt != null
          ? block.timing.finishedAt - block.timing.startedAt
          : 0;
      content.thinkingDurationMs =
        (content.thinkingDurationMs ?? 0) + Math.max(0, segmentMs);
    }
  } else if (block.type === "tool-call") {
    // 完整 tool-call 块 → toolCalls 条目
    if (!content.metadata) content.metadata = {};
    if (!Array.isArray(content.metadata.toolCalls)) content.metadata.toolCalls = [];
    const list = content.metadata.toolCalls;
    let entry = block.toolCallId
      ? list.find((tc: any) => tc.id === block.toolCallId)
      : undefined;
    if (!entry && list.length > 0 && !block.toolCallId) entry = list[list.length - 1];
    if (!entry) {
      entry = { id: block.toolCallId || "", index: list.length, type: "function", name: "", arguments: "", metadata: {} };
      list.push(entry);
    }
    if (block.name) entry.name = block.name;
    if (typeof block.arguments === "string" && block.arguments) entry.arguments = block.arguments;
  } else if (block.type === "image" || block.type === "file") {
    // 图片/文件块 → files（对齐 blockToContent）
    const att = (block as any).attachment;
    content.files = [
      {
        id: att?.attachmentId || att?.url || att?.name || "",
        name: att?.name || "附件",
        url: att?.url,
        type: att?.mediaType,
        ext: att?.fileExtension || extFromMediaType(att?.mediaType),
        size: att?.bytes,
        previewUrl: att?.previewUrl,
      },
    ];
  } else if (block.type === "tool-result") {
    content.metadata = {
      ...(content.metadata || {}),
      toolCallId: block.toolCallId,
      name: block.name,
    };
  }
}

/**
 * 从"后端三层 Message 形态"组装 MessageBundle（user 消息入口：live user_message 与
 * domain user/message 共用）。消息级字段（role/kind/source/metadata）单点挂载于 bundle，
 * 块由 messageToTurnContent 产出（role/messageId 不可变戳记随块写入）。
 */
function messageToBundle(
  msg: {
    id: string;
    role?: string;
    kind?: string;
    source?: { kind: string; [k: string]: any };
    metadata?: Record<string, any>;
    content?: any[];
    createdAt?: number;
  },
): MessageBundle {
  const blocks = messageToTurnContent(msg as any);
  return {
    messageId: msg.id,
    role: (msg.role as TurnContent["role"]) || "user",
    ...(msg.kind ? { kind: msg.kind as "user" | "model" } : {}),
    ...(msg.source ? { source: msg.source } : {}),
    metadata: msg.metadata ?? {},
    blocks,
  };
}

/**
 * 领域事件折叠（事件页：JSONL 领域事件原样到达，前端自行折叠——零后端转码）。
 * - turn/start|resume、turn/finish、turn/delete、compaction/summary → 复用对应 live 语义
 * - user/message → 构造 user 消息束（text + 附件块，消息级字段挂 bundle）
 * - assistant/message → 一条 = 一个 assistant 消息束（content 数组逐块转为 bundle.blocks，终态）
 * - tool/result → 挂 toolCallsResponse 到对应 tool-call 块
 * - command/*、message/prune、message/meta、approval/*、compaction/start|end、session/*、envelope → 暂不处理（忽略）
 */
function applyDomainEvent(
  sessionStore: any,
  sessionId: string,
  ev: DomainEvent,
): void {
  const data: any = ev.data;
  switch (ev.type) {
    case "turn/start":
    case "turn/resume":
      // 开括号：建回合（幂等）+ 游标；modelName 由 turn/finish 随后写入
      applyChunkToStore(sessionStore, sessionId, {
        type: "turn_start",
        turnId: data.turnId,
      } as any);
      return;
    case "turn/finish":
      // 回合收尾：finishReason/modelName/error/usage/整轮耗时 直接来自事件数据（后端零预扫）
      applyChunkToStore(sessionStore, sessionId, {
        type: "turn_end",
        turnId: data.turnId,
        modelName: data.modelName,
        finishReason: data.finishReason,
        error: data.errorDetail,
        totalDurationMs: data.totalDurationMs,
        usage:
          data.promptTokens != null
            ? {
                promptTokens: data.promptTokens ?? 0,
                completionTokens: data.completionTokens ?? 0,
                totalTokens: data.totalTokens ?? 0,
                ...(data.cachedTokens != null ? { cachedTokens: data.cachedTokens } : {}),
              }
            : undefined,
      } as any);
      return;
    case "turn/delete":
      applyChunkToStore(sessionStore, sessionId, {
        type: "turn_delete",
        turnId: data.turnId,
      } as any);
      return;
    case "compaction/summary":
      applyChunkToStore(sessionStore, sessionId, {
        type: "compaction_summary",
        shadowedEndId: data.shadowedEndId,
        shadowedCount: data.shadowedCount,
        shadowedMessageIds: data.shadowedMessageIds,
        summary: data.summary ?? "",
        messageId: data.summaryMessageId,
      } as any);
      return;
    case "user/message": {
      // 构造 user 消息束（复用 messageToBundle：text 块 + 附件块；消息级字段挂 bundle）
      const turns = sessionStore.getTurns(sessionId) || [];
      let turn = turns.find((t: any) => t.id === getCurrentTurn(sessionId));
      if (!turn) {
        turn = { id: data.messageId, kind: "turn", metadata: {}, visible: true, messages: [] };
        turns.push(turn);
      }
      if (!Array.isArray(turn.messages)) turn.messages = [];
      if (turn.messages.some((m: any) => m.messageId === data.messageId)) return; // 幂等
      const bundle = messageToBundle({
        id: data.messageId,
        role: "user",
        // 来源透传：后端 user_message 事件携带完整 userMessage（含 source），
        // source.kind 是"是否人类输入"的单一真相（事件顶层无 metadata 字段）
        source: (data as any).userMessage?.source ?? (data as any).source,
        kind: data.kind ?? "user",
        metadata: (data as any).userMessage?.metadata ?? data.metadata ?? {},
        content: [
          // P6：事件格式统一为 blocks（后端已废弃 content/files 平铺；旧事件经 rebuild 重建）
          ...(data.blocks ?? []),
        ],
      });
      turn.messages.push(bundle);
      return;
    }
    case "assistant/message": {
      // 一条 = 一个 assistant 消息束（终态，流式态复位；usage/finishReason 归 bundle.metadata）
      const turns = sessionStore.getTurns(sessionId) || [];
      const turn = turns.find((t: any) => t.id === getCurrentTurn(sessionId));
      if (!turn) return;
      if (!Array.isArray(turn.messages)) turn.messages = [];
      const msgId = data.messageId;
      if (turn.messages.some((m: any) => m.messageId === msgId)) return; // 幂等
      const bundle = ensureBundle(turn, msgId, "assistant");
      // 消息级元数据（usage/finishReason 等）归 bundle；块不再挂消息级字段
      bundle.metadata = { ...(data.metadata ?? {}) };
      (data.content ?? []).forEach((block: ContentBlock, index: number) => {
        const content = ensureBlockInBundle(bundle, index);
        applyCompleteBlock(content, block);
        content.state.isStreaming = false;
        content.state.isThinking = false;
      });
      return;
    }
    case "tool/result": {
      // 工具结果 → 挂 toolCallsResponse 到对应 tool-call 块。
      // 关联键是 toolCallId（provider 发出、唯一标识一次调用；对齐 DSH：结果按 callId 聚类）。
      // 工具结果是独立消息（独立 messageId），messageId 语义是"消息唯一 id"，不做关联键——
      // 回放/重建数据的 tool/result.messageId ≠ 含调用的 assistant 消息 id，按 messageId 必然丢结果。
      const turns = sessionStore.getTurns(sessionId) || [];
      const target = findBlockByToolCallId(turns, data.toolCallId);
      if (!target) return;
      // 同一 assistant 消息可含多个调用，结果逐个到达 → 累加（勿覆盖；按 toolCallId 去重）
      const existing: any[] = Array.isArray(target.metadata?.toolCallsResponse)
        ? target.metadata.toolCallsResponse
        : [];
      if (!existing.some((r: any) => r.toolCallId === data.toolCallId)) {
        target.metadata = {
          ...(target.metadata || {}),
          toolCallsResponse: [
            ...existing,
            {
              name: data.name ?? "",
              content: data.content ?? "",
              toolCallId: data.toolCallId,
              outcome: data.isError ? "error" : "success",
              // UI 渲染元数据（终端卡片等），随事件透传
              ...(data.meta ? { meta: data.meta } : {}),
            },
          ],
        };
      }
      const tc = (target.metadata.toolCalls || []).find(
        (c: any) => c.id === data.toolCallId,
      );
      if (tc) tc.outcome = data.isError ? "error" : "success";
      return;
    }
    case "workflow/event":
      // Workflow 编排进度已迁移至概览面板（方案 B，不落 JSONL）——回放流中忽略历史事件
      return;
    default:
      // command/*、message/prune、message/meta、approval/*、compaction/start|end、session/*、envelope → 暂不处理
      return;
  }
}

/**
 * 移除压缩占位（"压缩中"占位与"已压缩"结果卡共用 eventType='compaction'）。
 * mode 'compressing' 仅移除"压缩中"占位；'all' 额外移除"已压缩"结果卡。
 * 独立 kind:'event' 回合外壳整体移除（避免空壳残留）；回合内束逐条摘除，真实消息块保留仅标记。
 */
function removeCompactionPlaceholders(
  sessionStore: any,
  sessionId: string,
  mode: "compressing" | "all",
): void {
  const turns = sessionStore.getTurns(sessionId) || [];
  for (let ti = turns.length - 1; ti >= 0; ti--) {
    const t = turns[ti];
    if (t.kind === "event" && t.metadata?.eventType === "compaction") {
      if (mode === "all" || t.metadata?.compressing || t.messages?.[0]?.metadata?.compressing) {
        turns.splice(ti, 1);
      }
      continue;
    }
    if (!Array.isArray(t.messages)) continue;
    for (let i = t.messages.length - 1; i >= 0; i--) {
      const m = t.messages[i];
      if (m.role !== "event" || m.metadata?.eventType !== "compaction") continue;
      if (mode === "compressing" && !m.metadata?.compressing) continue;
      t.messages.splice(i, 1);
    }
  }
}

/**
 * 插入"压缩中"占位卡（幂等：已存在则跳过，防重复事件/重连重放重复插入）。
 * 落位规则与结果卡一致：有宿主回合（in-turn，自动压缩）→ 嵌入宿主回合；
 * 否则（手动压缩维护流）→ 列表末尾独立事件回合。
 */
function upsertCompressingPlaceholder(sessionStore: any, sessionId: string): void {
  const turns = sessionStore.getTurns(sessionId) || [];
  const isCompressingBundle = (m: any) =>
    m.role === "event" && m.metadata?.eventType === "compaction" && m.metadata?.compressing;
  for (const t of turns) {
    if (t.kind === "event" && t.metadata?.eventType === "compaction" && t.metadata?.compressing) return;
    if (Array.isArray(t.messages) && t.messages.some(isCompressingBundle)) return;
  }
  const now = new Date().toISOString();
  const messageId = `__compressing_${Date.now()}`;
  const metadata = { eventType: "compaction", compressing: true };
  const eventBundle: MessageBundle = {
    messageId,
    role: "event",
    metadata,
    blocks: [
      {
        id: messageId,
        role: "event",
        messageId,
        content: "",
        reasoningContent: null,
        additionalKwargs: [],
        metadata,
        createdAt: now,
        updatedAt: now,
        thinkingStartedAt: null,
        thinkingDurationMs: null,
        state: { isStreaming: false, isThinking: false },
      },
    ],
  };
  const currentTurnId = getCurrentTurn(sessionId);
  const hostTurn = currentTurnId ? turns.find((t: any) => t.id === currentTurnId) : undefined;
  if (hostTurn) {
    if (!Array.isArray(hostTurn.messages)) hostTurn.messages = [];
    hostTurn.messages.push(eventBundle);
  } else {
    turns.push({
      id: eventBundle.messageId,
      kind: "event",
      metadata,
      visible: true,
      messages: [eventBundle],
    });
  }
}


/** 按事件类型定位更新 store(无闭包,直接改响应式 store) */
export function applyChunkToStore(
  sessionStore: any,
  sessionId: string,
  chunk: ProjectorChunk,
): void {
  // 领域事件（事件页：assistant/message 一条 = 全部块等）→ 独立折叠分支
  if (isDomainEvent(chunk)) {
    applyDomainEvent(sessionStore, sessionId, chunk);
    return;
  }
  // 引擎级附属（上下文压缩）
  if (chunk.type === "compression_start") {
    // 压缩开始（auto 回合内 / manual 维护流）：置位 + "压缩中"占位卡（幂等）
    sessionStore.setSessionIsCompressing(sessionId, true);
    upsertCompressingPlaceholder(sessionStore, sessionId);
    return;
  }
  if (chunk.type === "compression_error") {
    sessionStore.setSessionIsCompressing(sessionId, false);
    removeCompactionPlaceholders(sessionStore, sessionId, "compressing");
    return;
  }
  if (chunk.type === "compression_end") {
    // 压缩运行结束（compacted 与纯裁剪都发）：复位 + 移除"压缩中"占位（纯裁剪的终态；
    // 摘要路径随后 compaction_summary 原位放结果卡）+ 压缩后占用 → 环形指示器即时更新
    sessionStore.setSessionIsCompressing(sessionId, false);
    if ((chunk as any).contextStats) {
      updateTokenStatsFromSSE((chunk as any).contextStats);
    }
    removeCompactionPlaceholders(sessionStore, sessionId, "compressing");
    return;
  }
  if (chunk.type === "compaction_summary") {
    // 压缩完成（live 或事件页）：标记"已压缩"消息 + 生成压缩占位（原位渲染，不移除消息块）。
    // in-turn（折叠期有宿主回合）→ 当前回合内一条 event 块；out-of-turn → 独立 kind:'event' 回合。
    sessionStore.setSessionIsCompressing(sessionId, false);
    // 压缩事件自身携带压缩后占用 → 环形指示器即时更新（无需 REST）
    if ((chunk as any).contextStats) {
      updateTokenStatsFromSSE((chunk as any).contextStats);
    }
    const turns = sessionStore.getTurns(sessionId) || [];

    // 1. 移除旧压缩占位（"压缩中"占位与旧结果卡一并清掉，随新摘要原位替换；真实消息块保留仅标记）
    removeCompactionPlaceholders(sessionStore, sessionId, "all");

    // 2. 标记被遮蔽消息为已压缩（不物理移除）：新格式按分界点 id（messageId <= shadowedEndId，
    //    有序 ULID 比较，c_ 检查点前缀恒 ≤ m_ 消息）；旧格式按 shadowedMessageIds 清单（防御回退）。
    const boundaryId = chunk.shadowedEndId;
    const legacyIds =
      chunk.shadowedMessageIds && chunk.shadowedMessageIds.length > 0
        ? new Set(chunk.shadowedMessageIds)
        : null;
    for (const t of turns) {
      if (!Array.isArray(t.messages)) continue;
      for (const m of t.messages) {
        const mid = m.messageId;
        const shadowed = legacyIds
          ? legacyIds.has(mid)
          : boundaryId
            ? isAtOrBeforeBoundary(mid, boundaryId)
            : false;
        if (shadowed) m.metadata = { ...(m.metadata || {}), compacted: true };
      }
    }

    // 3. 生成占位事件消息束（role='event'；EventCard 从 bundle.metadata 读取）
    const now = new Date().toISOString();
    const compactInfo = {
      shadowedEndId: chunk.shadowedEndId,
      shadowedCount: chunk.shadowedCount,
      shadowedMessageIds: chunk.shadowedMessageIds,
      summary: chunk.summary ?? "",
    };
    const eventBundle: MessageBundle = {
      messageId: chunk.messageId || `__compact_${Date.now()}`,
      role: "event",
      metadata: {
        eventType: "compaction",
        compactInfo,
      },
      blocks: [
        {
          id: chunk.messageId || `__compact_${Date.now()}`,
          role: "event",
          messageId: chunk.messageId || `__compact_${Date.now()}`,
          content: chunk.summary ?? "",
          reasoningContent: null,
          additionalKwargs: [],
          metadata: {
            eventType: "compaction",
            compactInfo,
          },
          createdAt: now,
          updatedAt: now,
          thinkingStartedAt: null,
          thinkingDurationMs: null,
          state: { isStreaming: false, isThinking: false },
        },
      ],
    };
    const hostTurn = getCurrentTurn(sessionId)
      ? turns.find((t: any) => t.id === getCurrentTurn(sessionId))
      : undefined;
    if (hostTurn) {
      if (!Array.isArray(hostTurn.messages)) hostTurn.messages = [];
      hostTurn.messages.push(eventBundle);
    } else {
      turns.push({
        id: eventBundle.messageId,
        kind: "event",
        metadata: {
          eventType: "compaction",
          compactInfo,
        },
        visible: true,
        messages: [eventBundle],
      });
    }
    return;
  }
  // 其余任何事件到达 → 压缩已结束（压缩为同步阻塞，其后首个流事件即完成信号）
  if (sessionStore.sessionIsCompressing(sessionId)) {
    sessionStore.setSessionIsCompressing(sessionId, false);
  }

  // workflow_event 流块已迁移至概览面板消费（方案 B）——投影器不再处理

  // 回合级
  if (chunk.type === "turn_start") {
    const turns = sessionStore.getTurns(sessionId) || [];
    let turn = turns.find((t: any) => t.id === chunk.turnId);
    if (!turn) {
      turn = {
        id: chunk.turnId,
        kind: "turn",
        metadata: {},
        visible: true,
        messages: [],
      };
      turns.push(turn);
    }
    // 回合级工作态：turn_start 开括号 → 进入"工作中"（纯前端瞬态，不落库）
    if (!turn.state) turn.state = {};
    turn.state.isWorking = true;
    // 工作时长秒表锚点（前端瞬态，与 isWorking 同层）：流式期间由该锚点跳动显示已耗时；
    // 回合结束以服务端 totalDurationMs 为准覆盖（本地时钟仅用于期间的实时展示）。
    if (turn.state.startedAt == null) turn.state.startedAt = Date.now();
    // 回合级 modelName（与历史 turn/finish 合并的 modelName 同字段，assistantMetadata 统一读 turn.metadata）
    if (chunk.modelName) {
      if (!turn.metadata) turn.metadata = {};
      turn.metadata.modelName = chunk.modelName;
    }
    setCurrentTurn(sessionId, chunk.turnId);
    return;
  }
  if (chunk.type === "turn_delete") {
    if (chunk.turnId) sessionStore.deleteTurnById(sessionId, chunk.turnId);
    if (getCurrentTurn(sessionId) === chunk.turnId) setCurrentTurn(sessionId, undefined);
    return;
  }
  if (chunk.type === "turn_end") {
    // 回合收尾：按 turnId 复位工作态 + 写回合级收尾元数据；同时清除会话级交互卡
    sessionStore.setSessionPendingAsk(sessionId, undefined);
    const turns = sessionStore.getTurns(sessionId) || [];
    const turn = turns.find((t: any) => t.id === chunk.turnId);
    if (turn) {
      if (!turn.state) turn.state = {};
      turn.state.isWorking = false;
      delete turn.state.retry;
      // 业务错误归拢回合级：finishReason/errorDetail/usage/耗时 只写 turn.metadata + 最后一条 assistant 块 usage
      turn.metadata = {
        ...(turn.metadata || {}),
        // 领域事件 turn/finish 自带 modelName（live turn_end 无此字段 → undefined 不写）
        ...((chunk as any).modelName ? { modelName: (chunk as any).modelName } : {}),
        ...(chunk.finishReason ? { finishReason: chunk.finishReason } : {}),
        ...(chunk.error ? { errorDetail: chunk.error } : {}),
        ...(chunk.usage ? { usage: chunk.usage } : {}),
        // 整轮耗时：SSE 与历史事件页同源（服务端落库真值），刷新后仍可展示
        ...(chunk.totalDurationMs != null
          ? { totalDurationMs: chunk.totalDurationMs }
          : {}),
      };
      if (!Array.isArray(turn.messages)) turn.messages = [];
      const lastAssistantBundle = [...turn.messages]
        .reverse()
        .find((m: any) => m.role === "assistant");
      if (lastAssistantBundle && chunk.usage) {
        lastAssistantBundle.metadata = {
          ...(lastAssistantBundle.metadata || {}),
          usage: chunk.usage,
        };
      }
    }
    setCurrentTurn(sessionId, undefined);
    // 上下文统计 → 环形指示器（合并自 useStreamResponse.handleTurnEnd）
    if (chunk.contextStats) {
      updateTokenStatsFromSSE(chunk.contextStats);
    }
    return;
  }
  if (chunk.type === "retry") {
    // LLM 流重试瞬态（回合级）：挂 turn.state.retry（与 isWorking 同层，不落库、不进块 metadata）。
    // 重试成功后消息级 chunk 到达 / turn_end 时清除。
    const turns = sessionStore.getTurns(sessionId) || [];
    const turn = turns.find((t: any) => t.id === chunk.turnId);
    if (turn) {
      if (!turn.state) turn.state = {};
      turn.state.isWorking = true;
      turn.state.retry = {
        retryReason: chunk.retryReason,
        retryAttempt: chunk.retryAttempt,
        retryMaxAttempts: chunk.retryMaxAttempts,
        retryDelayMs: chunk.retryDelayMs,
        message: chunk.message,
      };
    }
    return;
  }
  if (chunk.type === "user_message") {
    const userMsg = chunk.userMessage;
    if (userMsg) {
      const turns = sessionStore.getTurns(sessionId) || [];
      let turn = turns.find((t: any) => t.id === chunk.turnId);
      if (!turn) {
        turn = {
          id: chunk.turnId || userMsg.id,
          kind: "turn",
          metadata: {},
          visible: true,
          messages: [],
        };
        turns.push(turn);
      }
      if (!Array.isArray(turn.messages)) turn.messages = [];
      // 幂等：同 messageId 已折叠则跳过（防御重复广播/重放）
      if (!turn.messages.some((m: any) => m.messageId === userMsg.id)) {
        turn.messages.push(messageToBundle(userMsg));
      }
    }
    return;
  }
  if (chunk.type === "ask_requested") {
    // 统一交互请求（审批/询问/迭代暂停继续共用）：执行内原地阻塞（无 turn_end、流保持 running）。
    // 会话级交互卡（对齐 DSH：sessionId 唯一锚点，不挂回合），输入区上方全局展示。
    sessionStore.setSessionPendingAsk(sessionId, {
      requestId: chunk.requestId,
      kind: chunk.kind,
      title: chunk.title,
      toolCallId: chunk.toolCallId,
      toolName: chunk.toolName,
      questions: chunk.questions || [],
    });
    return;
  }
  if (chunk.type === "ask_resolved") {
    // 交互终结（answered/cancelled）：清会话级交互卡（多窗口同步收卡由此保证）。
    sessionStore.setSessionPendingAsk(sessionId, undefined);
    return;
  }
  if (chunk.type === "tool_calls_response") {
    // 工具执行结果下发 → 交互已消费，关闭会话级卡（与 ask_resolved 幂等双保险）
    sessionStore.setSessionPendingAsk(sessionId, undefined);
    // 把执行结果挂到对应 tool-call 块：主键 toolCallId（对齐回放 tool/result 的聚类语义；
    // 工具结果是独立消息，其 messageId 与含调用的 assistant 消息 id 无关，故不依赖 messageId）。
    const turns = sessionStore.getTurns(sessionId) || [];
    const responseIds = new Set(
      (chunk.toolCallsResponse || []).map((r: any) => r.toolCallId),
    );
    let target = responseIds.size > 0
      ? findBlockByToolCallId(turns, [...responseIds][0])
      : undefined;
    if (target) {
      target.metadata = {
        ...(target.metadata || {}),
        toolCallsResponse: chunk.toolCallsResponse || [],
      };
      for (const r of chunk.toolCallsResponse || []) {
        const tc = (target.metadata.toolCalls || []).find(
          (c: any) => c.id === r.toolCallId,
        );
        if (tc) tc.outcome = r.outcome;
      }
    }
    return;
  }

  // 消息级块事件（MessageChunkEvent：messageId 必带、turnId 可选）
  // 按 turnId 定位回合处理块（turnId 可选，缺失时仅跳过块处理）
  const turnId = "turnId" in chunk ? chunk.turnId : undefined;
  const messageId = "messageId" in chunk ? chunk.messageId : undefined;
  if (!turnId || !messageId) return;
  const turns = sessionStore.getTurns(sessionId) || [];
  const turn = turns.find((t: any) => t.id === turnId);
  if (!turn) return;
  const bundle = ensureBundle(turn, messageId, "assistant");
  // 清除回合级重试瞬态（重试成功输出）
  if (turn.state) {
    delete turn.state.retry;
  }
  const index = "index" in chunk ? (chunk as any).index : undefined;
  const content = ensureBlockInBundle(bundle, index);
  if (!content) return;

  switch (chunk.type) {
    case "block_start":
      if (chunk.blockType === "reasoning") {
        content.state.isThinking = true;
        content.thinkingStartedAt = Date.now();
      }
      break;
    case "reasoning_delta":
      content.reasoningContent =
        (content.reasoningContent || "") + (chunk.text || "");
      break;
    case "text_delta":
      content.state.isThinking = false;
      content.content = (content.content || "") + (chunk.text || "");
      break;
    case "tool_call_delta": {
      if (!content.metadata) content.metadata = {};
      if (!Array.isArray(content.metadata.toolCalls)) content.metadata.toolCalls = [];
      const list = content.metadata.toolCalls;
      let entry: any;
      if (chunk.toolCallId) entry = list.find((tc: any) => tc.id === chunk.toolCallId);
      else if (list.length > 0) entry = list[list.length - 1];
      if (!entry) {
        entry = {
          id: chunk.toolCallId || "",
          index: list.length,
          type: "function",
          name: chunk.name || "",
          arguments: "",
          metadata: {},
        };
        list.push(entry);
      }
      if (chunk.name && !entry.name) entry.name = chunk.name;
      if (chunk.argumentsDelta) entry.arguments += chunk.argumentsDelta;
      break;
    }
    case "block_end":
      // 完整块应用（与领域事件 assistant/message 的整包块共用同一转换）
      if (chunk.block) {
        applyCompleteBlock(content, chunk.block);
      }
      break;
    case "usage":
      // usage 为消息级：挂 bundle.metadata（tokenUsage 按消息束求和，不落块、不重复计数）
      bundle.metadata = { ...(bundle.metadata || {}), usage: chunk.usage };
      break;
    case "finish":
      // (usage 为协议独立事件，由 case "usage" 承载，finish 不带 usage)
      bundle.metadata = {
        ...bundle.metadata,
        ...(chunk.finishReason ? { finishReason: chunk.finishReason } : {}),
      };
      content.state.isStreaming = false;
      content.state.isThinking = false;
      // 同一消息束的其余块也复位流式态（块级 isStreaming 仅展示瞬态）
      for (const b of bundle.blocks) {
        b.state.isStreaming = false;
        b.state.isThinking = false;
      }
      break;
    default:
      break;
  }
}

/** 终态事件（事件数组记录）；delta 类瞬态不记录（block_end 携带完整块可重建） */
function isTerminalEvent(type: string): boolean {
  return !(
    type === "block_start" ||
    type === "text_delta" ||
    type === "reasoning_delta" ||
    type === "tool_call_delta"
  );
}

/**
 * live 事件应用（记录终态事件到事件数组后定位写 store）。
 * 供常驻接收与"暂存消费"共用，保证事件数组与树一致（load-more re-fold 不丢 live 尾部）。
 */
export function applyLiveChunk(
  sessionStore: any,
  sessionId: string,
  chunk: ProjectorChunk,
): void {
  const sessionState = sessionStore.getSessionState(sessionId);
  // 事件数组：live 终态事件追加（delta 由 block_end 重建，不记录）
  if (isTerminalEvent(chunk.type)) {
    if (!sessionState.eventLog) sessionState.eventLog = [];
    sessionState.eventLog.push(chunk);
  }
  applyChunkToStore(sessionStore, sessionId, chunk);
}

/**
 * 事件到达投影(接收链路常驻入口):有缓存 → applyLiveChunk;无缓存 → 暂存 finish 后事件。
 */
export function projectChunk(
  sessionStore: any,
  sessionId: string,
  chunk: ProjectorChunk,
): void {
  const sessionState = sessionStore.getSessionState(sessionId);
  const hasCache =
    sessionState.loaded === true || (sessionState.turns?.length ?? 0) > 0;
  if (!hasCache) {
    stashEvent(sessionId, chunk);
    return;
  }
  applyLiveChunk(sessionStore, sessionId, chunk);
}

/**
 * 事件数组折叠（加载/load-more 路径）：清空会话树后，把一批事件按序应用——全量重建。
 * 与实时路径共用同一折叠器（applyChunkToStore），保证 replay 页 + live 增量收敛到同一棵树。
 * 调用方需把"已加载事件页 + live 追加事件"合并传入（live 事件已在数组里，re-fold 天然保留）。
 */
export function foldEvents(
  sessionStore: any,
  sessionId: string,
  chunks: ProjectorChunk[],
): void {
  currentTurnBySession.set(sessionId, undefined);
  sessionStore.setTurns(sessionId, []);
  for (const chunk of chunks) {
    applyChunkToStore(sessionStore, sessionId, chunk);
  }
}
