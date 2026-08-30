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
 * 折叠模型:turn → block 二级结构(跳过 Message 容器级)。
 * 事件天然是块级:assistant 块事件按 (messageId, index) 寻址为独立 TurnContent;
 * user_message 逐块映射;compaction 占位为 role='event' 块。渲染直接消费 turn.blocks,
 * 无需"组装进 Message → 再 flatMap 拆回块"。
 *
 * 两种事件输入形态（折叠器同时支持）：
 * - WireStreamEvent：live SSE 块级增量协议（block_start/text_delta/block_end...）
 * - DomainEvent：事件页返回的 JSONL 领域事件（assistant/message 一条 = 全部块，终态）
 */

import { reactive } from "vue";
import { messageToTurnContent } from "@/services/modules/message.api";
import { updateTokenStatsFromSSE } from "@/composables/useSessionTokenStats";
import type { WireStreamEvent } from "@/types/stream";
import type { DomainEvent } from "@/types/stream/domain-event.types";
import type { ContentBlock } from "@/types/stream/content-block.types";
import type { Turn, TurnContent } from "@/types/message";

/**
 * 投影器处理的事件类型 = live 块级事件 ∪ 领域事件（事件页）。
 */
export type ProjectorChunk = WireStreamEvent | DomainEvent;

/** 领域事件判别（type 含 '/'，如 turn/start；live 事件为 turn_start 等无斜杠） */
function isDomainEvent(chunk: ProjectorChunk): chunk is DomainEvent {
  return typeof (chunk as any).type === "string" && (chunk as any).type.includes("/");
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
 * 回合内定位/创建 assistant 块：按 (messageId, blockIndex) 寻址（协议块级事件带 index）；
 * 无 index（usage/finish 为消息级，不带块序号）→ 定位该 messageId 的最后一块。
 * block.id 为块级 contentId（block_end 回填）；messageId 保留供编辑/审批/继续执行 API 锚点。
 */
function ensureAssistantBlock(
  turn: Turn,
  messageId: string,
  index?: number,
): TurnContent {
  if (!Array.isArray(turn.blocks)) turn.blocks = [];
  const seq = turn.blocks.filter((b) => b.messageId === messageId);
  if (index !== undefined) {
    const found = seq.find((b) => b.blockIndex === index);
    if (found) return found;
  } else if (seq.length > 0) {
    return seq[seq.length - 1];
  }
  const block = reactive<TurnContent>({
    id:
      index !== undefined
        ? `__blk_${messageId}_${index}`
        : `__blk_${messageId}_${Date.now()}`,
    role: "assistant",
    messageId,
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
  turn.blocks.push(block);
  return block;
}

/**
 * 完整 ContentBlock → TurnContent（live block_end 与领域事件 assistant/message 共用同一转换）。
 * 块级 contentId 回填（领域事件自带稳定 id）。
 */
function applyCompleteBlock(content: TurnContent, block: ContentBlock): void {
  if (block.contentId) content.id = block.contentId;
  if (block.type === "text" && typeof block.text === "string") {
    content.content = block.text;
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
        id: att?.attachmentId,
        name: att?.name || "附件",
        url: att?.url,
        type: att?.mediaType,
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
 * 领域事件折叠（事件页：JSONL 领域事件原样到达，前端自行折叠——零后端转码）。
 * - turn/start|resume、turn/finish、turn/delete、compaction/summary → 复用对应 live 语义
 * - user/message → 构造 user 块（text + 附件）
 * - assistant/message → 一条 = 全部块（content 数组逐块转为独立 TurnContent，终态）
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
      // 回合收尾：finishReason/modelName/error/usage 直接来自事件数据（后端零预扫）
      applyChunkToStore(sessionStore, sessionId, {
        type: "turn_end",
        turnId: data.turnId,
        modelName: data.modelName,
        finishReason: data.finishReason,
        error: data.errorDetail,
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
        shadowedMessageIds: data.shadowedMessageIds ?? [],
        summary: data.summary ?? "",
        messageId: data.summaryMessageId,
      } as any);
      return;
    case "user/message": {
      // 构造 user 块（复用 messageToTurnContent：text 块 + 附件块）
      const turns = sessionStore.getTurns(sessionId) || [];
      let turn = turns.find((t: any) => t.id === getCurrentTurn(sessionId));
      if (!turn) {
        turn = { id: data.messageId, kind: "turn", metadata: {}, visible: true, blocks: [] };
        turns.push(turn);
      }
      if (!Array.isArray(turn.blocks)) turn.blocks = [];
      if (turn.blocks.some((b: any) => b.messageId === data.messageId)) return; // 幂等
      const msgLike: any = {
        id: data.messageId,
        role: "user",
        kind: data.kind ?? "user",
        metadata: data.metadata ?? {},
        content: [
          ...(data.content
            ? [{ type: "text" as const, contentId: data.messageId, text: data.content }]
            : []),
          ...(data.files ?? []).map((f: any) => ({
            type: (String(f.fileType ?? "").toLowerCase().startsWith("image/")
              ? "image"
              : "file") as "image" | "file",
            contentId: `${data.messageId}_f${f.fileId}`,
            attachment: {
              attachmentId: f.fileId,
              mediaType: f.fileType,
              name: f.displayName ?? f.fileName,
              url: f.url ?? f.previewUrl,
            },
          })),
        ],
      };
      turn.blocks.push(...messageToTurnContent(msgLike));
      return;
    }
    case "assistant/message": {
      // 一条 = 全部块：content 数组逐块转为独立 TurnContent（终态，流式态复位）
      const turns = sessionStore.getTurns(sessionId) || [];
      const turn = turns.find((t: any) => t.id === getCurrentTurn(sessionId));
      if (!turn) return;
      if (!Array.isArray(turn.blocks)) turn.blocks = [];
      const msgId = data.messageId;
      if (turn.blocks.some((b: any) => b.messageId === msgId)) return; // 幂等
      const blocks: TurnContent[] = (data.content ?? []).map(
        (block: ContentBlock, index: number) => {
          const content = ensureAssistantBlock(turn, msgId, index);
          applyCompleteBlock(content, block);
          content.state.isStreaming = false;
          content.state.isThinking = false;
          return content;
        },
      );
      const meta = data.metadata ?? {};
      const last = blocks[blocks.length - 1];
      if (last && meta.usage) {
        last.metadata = { ...(last.metadata || {}), usage: meta.usage };
      }
      if (last && meta.finishReason) {
        last.metadata = { ...(last.metadata || {}), finishReason: meta.finishReason };
      }
      return;
    }
    case "tool/result": {
      // 工具结果 → 挂 toolCallsResponse 到对应 tool-call 块（按 toolCallId 定位）
      const turns = sessionStore.getTurns(sessionId) || [];
      const turn = turns.find((t: any) => t.id === getCurrentTurn(sessionId));
      if (!turn || !Array.isArray(turn.blocks)) return;
      const seq = turn.blocks.filter((b: any) => b.messageId === data.messageId);
      const target =
        seq.find((b: any) =>
          (b.metadata?.toolCalls || []).some((tc: any) => tc.id === data.toolCallId),
        ) ?? seq[seq.length - 1];
      if (!target) return;
      target.metadata = {
        ...(target.metadata || {}),
        toolCallsResponse: [
          {
            name: data.name ?? "",
            content: data.content ?? "",
            toolCallId: data.toolCallId,
            outcome: data.isError ? "error" : "success",
          },
        ],
      };
      const tc = (target.metadata.toolCalls || []).find(
        (c: any) => c.id === data.toolCallId,
      );
      if (tc) tc.outcome = data.isError ? "error" : "success";
      return;
    }
    default:
      // command/*、message/prune、message/meta、approval/*、compaction/start|end、session/*、envelope → 暂不处理
      return;
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
    // 压缩是同步阻塞操作：期间展示"压缩中"
    sessionStore.setSessionIsCompressing(sessionId, true);
    return;
  }
  if (chunk.type === "compression_error") {
    sessionStore.setSessionIsCompressing(sessionId, false);
    return;
  }
  if (chunk.type === "compaction_summary") {
    // 压缩完成（live 或事件页）：移除被遮蔽消息 + 生成压缩占位。
    // in-turn（折叠期有宿主回合）→ 当前回合内一条 event 块；out-of-turn → 独立 kind:'event' 回合。
    // 与后端 replayer（遮蔽标记 + event 消息/外壳）对齐。
    sessionStore.setSessionIsCompressing(sessionId, false);
    const turns = sessionStore.getTurns(sessionId) || [];

    // 1. 移除被遮蔽消息的块（按 messageId，含 user/assistant 块；display 视图由占位概括）
    for (const tid of chunk.shadowedMessageIds || []) {
      for (const t of turns) {
        if (!Array.isArray(t.blocks)) continue;
        for (let i = t.blocks.length - 1; i >= 0; i--) {
          if (t.blocks[i].messageId === tid) t.blocks.splice(i, 1);
        }
      }
    }

    // 2. 生成占位块（role='event'；EventCard 从 metadata.compactInfo 读取）
    const now = new Date().toISOString();
    const placeholder: TurnContent = {
      id: chunk.messageId || `__compact_${Date.now()}`,
      role: "event",
      messageId: chunk.messageId || `__compact_${Date.now()}`,
      content: chunk.summary ?? "",
      reasoningContent: null,
      additionalKwargs: [],
      metadata: {
        eventType: "compaction",
        compactInfo: {
          shadowedMessageIds: chunk.shadowedMessageIds || [],
          summary: chunk.summary ?? "",
        },
      },
      createdAt: now,
      updatedAt: now,
      thinkingStartedAt: null,
      thinkingDurationMs: null,
      state: { isStreaming: false, isThinking: false },
    };
    const hostTurn = getCurrentTurn(sessionId)
      ? turns.find((t: any) => t.id === getCurrentTurn(sessionId))
      : undefined;
    if (hostTurn) {
      if (!Array.isArray(hostTurn.blocks)) hostTurn.blocks = [];
      hostTurn.blocks.push(placeholder);
    } else {
      turns.push({
        id: placeholder.id,
        kind: "event",
        metadata: {
          eventType: "compaction",
          compactInfo: {
            shadowedMessageIds: chunk.shadowedMessageIds || [],
            summary: chunk.summary ?? "",
          },
        },
        visible: true,
        blocks: [placeholder],
      });
    }
    return;
  }
  // 其余任何事件到达 → 压缩已结束（压缩为同步阻塞，其后首个流事件即完成信号）
  if (sessionStore.sessionIsCompressing(sessionId)) {
    sessionStore.setSessionIsCompressing(sessionId, false);
  }

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
        blocks: [],
      };
      turns.push(turn);
    }
    // 回合级工作态：turn_start 开括号 → 进入"工作中"（纯前端瞬态，不落库）
    if (!turn.state) turn.state = {};
    turn.state.isWorking = true;
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
      // 业务错误归拢回合级：finishReason/errorDetail/usage 只写 turn.metadata + 最后一条 assistant 块 usage
      turn.metadata = {
        ...(turn.metadata || {}),
        // 领域事件 turn/finish 自带 modelName（live turn_end 无此字段 → undefined 不写）
        ...((chunk as any).modelName ? { modelName: (chunk as any).modelName } : {}),
        ...(chunk.finishReason ? { finishReason: chunk.finishReason } : {}),
        ...(chunk.error ? { errorDetail: chunk.error } : {}),
        ...(chunk.usage ? { usage: chunk.usage } : {}),
      };
      if (!Array.isArray(turn.blocks)) turn.blocks = [];
      const lastAssistant = [...turn.blocks]
        .reverse()
        .find((b: any) => b.role === "assistant");
      if (lastAssistant && chunk.usage) {
        lastAssistant.metadata = {
          ...(lastAssistant.metadata || {}),
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
          blocks: [],
        };
        turns.push(turn);
      }
      if (!Array.isArray(turn.blocks)) turn.blocks = [];
      // 幂等：同 messageId 已折叠则跳过（防御重复广播/重放）
      if (!turn.blocks.some((b: any) => b.messageId === userMsg.id)) {
        turn.blocks.push(...messageToTurnContent(userMsg));
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
    // 把执行结果挂到对应 tool-call 块：按 (messageId, toolCallId) 定位（跨块搜 metadata.toolCalls）
    const turns = sessionStore.getTurns(sessionId) || [];
    const turn = turns.find((t: any) => t.id === chunk.turnId);
    const messageId = "messageId" in chunk ? chunk.messageId : undefined;
    if (messageId && turn && Array.isArray(turn.blocks)) {
      const seq = turn.blocks.filter((b: any) => b.messageId === messageId);
      const responseIds = new Set(
        (chunk.toolCallsResponse || []).map((r: any) => r.toolCallId),
      );
      let target = seq.find((b: any) =>
        (b.metadata?.toolCalls || []).some((tc: any) => responseIds.has(tc.id)),
      );
      if (!target && seq.length > 0) target = seq[seq.length - 1];
      if (!target) target = ensureAssistantBlock(turn, messageId);
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
  if (!Array.isArray(turn.blocks)) turn.blocks = [];
  // 清除回合级重试瞬态（重试成功输出）
  if (turn.state) {
    delete turn.state.retry;
  }
  const index = "index" in chunk ? (chunk as any).index : undefined;
  const content = ensureAssistantBlock(turn, messageId, index);
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
      // usage 为消息级：仅挂最后一块（tokenUsage 逐块求和，不能多块重复计数）
      content.metadata = { ...(content.metadata || {}), usage: chunk.usage };
      break;
    case "finish":
      // (usage 为协议独立事件，由 case "usage" 承载，finish 不带 usage)
      content.metadata = {
        ...content.metadata,
        ...(chunk.finishReason ? { finishReason: chunk.finishReason } : {}),
      };
      content.state.isStreaming = false;
      content.state.isThinking = false;
      // 同一消息的其余块也复位流式态（块级 isStreaming 仅展示瞬态）
      for (const b of turn.blocks) {
        if (b.messageId === messageId) {
          b.state.isStreaming = false;
          b.state.isThinking = false;
        }
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
