/**
 * JSONL 持久化 — 回放引擎
 * 对齐 DSH 语义的扁平消息 surface 模型：
 *   turn/start + turn/finish（回合：一次输入 = 用户 + 助手，一对一轮回——仅簿记，不建外壳）
 *   user/message + assistant/message + tool/result（消息级三事件，对齐 DSH）
 *   turn/delete（删除本轮对话：按回合 id 移除该回合全部消息节点）
 *   message/prune（内容裁剪）、compaction/*（压缩括号：前缀范围删除 + 头部摘要，消息级）
 * 回放产出**扁平消息 surface**：`MessageNode[]`（IS-A Message，带 seq/turnId 归属标签），
 * 即可视消息序列本身——command 等事件不再入态，读取无需投影过滤（S0）。
 */

import {
  BaseEvent,
  ReplayState,
  TurnMeta,
  MessageNode,
  Envelope,
  TurnCreateData,
  TurnResumeData,
  TurnFinishData,
  UserMessageData,
  AssistantMessageData,
  ToolResultData,
  TurnDeleteData,
  MessagePruneData,
  CompactionSummaryData,
  MessageFile,
  PRUNE_STRATEGY_USER_EDIT,
  PRUNE_STRATEGY_THINKING_STRIP,
} from './types';
import type {
  Turn as ThreeTierTurn,
  Message as ThreeTierMessage,
  ContentBlock,
  MessageSource,
  FileRef,
} from '../types/conversation.types';
import { normalizeMediaType, isVisionImageMediaType } from '../utils/media-type.util';

/**
 * 创建初始回放状态（纯扁平消息 surface——LLM 折叠态，零 turn 结构）。
 */
export function createInitialState(): ReplayState {
  return {
    messages: [],
    currentTurnId: null,
    envelope: null,
    lastProcessedSeq: -1,
    openCompactionSeq: null,
    occupancyAnchor: null,
  };
}

/**
 * 回放折叠规则。
 *
 * 语义边界：同一份持久事件流可被后端不同消费链路折叠（各自独立视图），
 * 折叠产物同为扁平 surface，仅内容规则不同。
 * - LLM 链路（默认）：压缩裁剪就地应用省 token；compaction 遮蔽前缀删除 + 摘要置消息头
 * - applyCompressionPrune=false：压缩裁剪不应用（tool-result 保持完整原文）。
 *   当前后端消费者：updateTurn（编辑定位）、会话内容搜索（另加 ignoreCompaction）
 * - 用户编辑（strategy='user_edit'）无论哪条链路都应用（所见即所得，必须回显）
 * - ignoreCompaction=true：整段忽略 compaction/* 括号（不删前缀、不插摘要），
 *   被压缩消息保留参与内容检索；搜索链路用此对齐"界面全量显示"的语义
 *
 * 注意：前端展示不经过本 replayer。前端拉取原始事件页（GET sessions/:id/events）
 * 后用自身投影器（frontend streamProjector）折叠：compaction/summary 只标记
 * metadata.compacted + 生成事件卡，不物理移除消息。"界面全量显示、仅模型侧折叠"
 * 是设计意图，不是遗漏。
 */
export interface FoldOptions {
  /** 压缩自动裁剪（head_tail_500 等）是否就地改块；默认 true（LLM 链路）。false 时保留原文 */
  applyCompressionPrune?: boolean;
  /** 忽略 compaction/* 括号事件（不删除前缀、不插摘要）；搜索重建等全量内容消费用 */
  ignoreCompaction?: boolean;
}

/**
 * 单个事件 fold。
 */
export function foldEvent(
  state: ReplayState,
  event: BaseEvent,
  opts?: FoldOptions,
): ReplayState {
  switch (event.type) {
    case 'session/init':
      break;

    // 分卷标记事件:仅作新活跃段的首条 seq 基准(恢复时校验衔接用),
    // 不参与状态折叠(no-op),避免污染 ReplayState。
    case 'session/rotate':
      break;

    case 'envelope':
      state.envelope = (event.data as unknown) as Envelope;
      break;

    // ─── 回合级：turn/start（仅设当前回合游标，不建外壳、不携带任何回合元数据）───
    case 'turn/start': {
      const data = (event.data as unknown) as TurnCreateData;
      // 括号起点：归属游标指向该回合（重复 turn/start 幂等——仅复位游标）
      state.currentTurnId = data.turnId;
      break;
    }

    // 续传回合:断点恢复(resume)重开既有回合括号。
    // 仅把 currentTurnId 指回目标回合,使续传落库的 assistant/message、tool/result 正确归入。
    case 'turn/resume': {
      const data = (event.data as unknown) as TurnResumeData;
      state.currentTurnId = data.turnId;
      break;
    }

    // ─── 回合级：turn/finish（回合元数据不进入折叠态；仅作括号终点）───
    case 'turn/finish': {
      const data = (event.data as unknown) as TurnFinishData;
      // 仅当 turnId 匹配当前游标才清游标（P0-1 回归：不匹配的 finish（如旧 bug 产物 ''）
      // 被安全忽略，不清游标——否则后续消息会因游标被误清而丢失归属）
      if (data.turnId === state.currentTurnId) {
        state.currentTurnId = null;
      }
      break;
    }

    // ─── 消息级三事件（对齐 DSH；归入 currentTurnId 游标回合，节点带归属标签）───

    // user/message：用户消息（kind 区分真实用户/注入）
    case 'user/message': {
      const data = (event.data as unknown) as UserMessageData;
      if (!state.currentTurnId) break; // 回合未开（异常），忽略
      state.messages.push({
        ...userMessageFromData(data, event.time),
        seq: event.seq,
        turnId: state.currentTurnId,
      });
      break;
    }

    // assistant/message：助手消息（一次 LLM 调用产出）
    case 'assistant/message': {
      const data = (event.data as unknown) as AssistantMessageData;
      if (!state.currentTurnId) break; // 回合未开（异常），忽略
      state.messages.push({
        ...assistantMessageFromData(data, event.time),
        seq: event.seq,
        turnId: state.currentTurnId,
      });
      // 占用锚点：带 provider prompt usage 的助手消息即真值基准（后写者覆盖，
      // 新回合自然接管此前的压缩锚点；见 OccupancyAnchor）
      if (hasPromptUsage(data.metadata)) {
        state.occupancyAnchor = { kind: 'usage' };
      }
      break;
    }

    // tool/result：工具结果
    case 'tool/result': {
      const data = (event.data as unknown) as ToolResultData;
      if (!state.currentTurnId) break; // 回合未开（异常），忽略
      state.messages.push({
        ...toolResultFromData(data, event.time),
        seq: event.seq,
        turnId: state.currentTurnId,
      });
      break;
    }

    // ─── 删除本轮对话：按回合 id 移除该回合全部消息节点（整轮次重答 = turn/delete 旧轮次 + 正常回答流程）───
    // turnId 语义统一为回合外壳 id（turn/start 生成），前端重答也传回合 id，无需消息 id 兜底。
    case 'turn/delete': {
      const data = (event.data as unknown) as TurnDeleteData;
      state.messages = state.messages.filter((n) => n.turnId !== data.turnId);
      if (state.currentTurnId === data.turnId) {
        state.currentTurnId = null;
      }
      break;
    }

    // ─── 内容裁剪/思考剥离（微压缩，一级）───
    case 'message/prune': {
      const data = (event.data as unknown) as MessagePruneData;
      const applyCompressionPrune = opts?.applyCompressionPrune !== false;
      // 用户编辑（strategy='user_edit'）：两视图一致，就地改 text 块（编辑所见即所得）；
      // 微压缩自动改写（工具结果裁剪 / 思考剥离）：仅默认（LLM）链路应用，
      // applyCompressionPrune=false 保留完整原文
      if (data.strategy !== PRUNE_STRATEGY_USER_EDIT && !applyCompressionPrune) break;
      const node = state.messages.find((n) => n.id === data.messageId);
      if (!node) break;
      const m = node;
      if (data.strategy === PRUNE_STRATEGY_USER_EDIT) {
        const tb = m.content.find(
          (b): b is Extract<ContentBlock, { type: 'text' }> => b.type === 'text',
        );
        if (tb) tb.text = data.newContent;
      } else if (data.strategy === PRUNE_STRATEGY_THINKING_STRIP) {
        // 思考剥离：reasoning 块保留、summary 置空（不删块——读取管线按思考模式决定
        // 填充 ' ' 还是整块剥离，块缺失会破坏该策略的判定依据）
        for (const b of m.content) {
          if (b.type === 'reasoning') b.summary = data.newContent;
        }
      } else {
        // 工具结果裁剪：tool-result 块（回退到 text 块）
        const tr = m.content.find(
          (b): b is Extract<ContentBlock, { type: 'tool-result' }> => b.type === 'tool-result',
        );
        if (tr) {
          tr.content = data.newContent;
        } else {
          const tb = m.content.find(
            (b): b is Extract<ContentBlock, { type: 'text' }> => b.type === 'text',
          );
          if (tb) tb.text = data.newContent;
        }
      }
      m.metadata = { ...m.metadata, pruneInfo: { ...data } };
      break;
    }

    // ─── 压缩括号（对齐 DSH compaction/*）───
    case 'compaction/start':
      // 搜索等全量内容链路：整段忽略压缩括号（被压缩消息保留参与检索）
      if (opts?.ignoreCompaction) break;
      // 开括号：记录未闭合 seq（锁语义审计；原子批量写入下正常必有 end 收口）
      state.openCompactionSeq = event.seq;
      break;

    case 'compaction/summary': {
      if (opts?.ignoreCompaction) break;
      const data = (event.data as unknown) as CompactionSummaryData;
      // 孤儿括号审计（不阻断）：start 缺失/未闭合的 summary 只记警告，仍按已提交数据应用
      if (state.openCompactionSeq === null || state.openCompactionSeq === undefined) {
        console.warn(
          `[replayer] orphan compaction/summary at seq=${event.seq} (no open compaction/start), applying as committed`,
        );
      } else {
        state.openCompactionSeq = null;
      }

      const summaryMsgId = data.summaryMessageId || `__compact_${event.seq}`;

      // 压缩范围 = 视图头部开始的连续前缀（压缩引擎 shadowedMessages = messages.slice(0, boundary)）。
      // 新格式：shadowedCount 即遮蔽条数 → O(1) 头删除（不再 Set+全扫）；
      // 旧格式：shadowedMessageIds 离散清单 → 回退 Set+全扫定位末位（防御保留）。
      let endIdx = -1;
      if (data.shadowedCount !== undefined && Number.isFinite(data.shadowedCount)) {
        endIdx = Math.min(Math.max(0, data.shadowedCount), state.messages.length) - 1;
      } else if (Array.isArray(data.shadowedMessageIds)) {
        const shadowSet = new Set(data.shadowedMessageIds);
        for (let i = 0; i < state.messages.length; i++) {
          if (shadowSet.has(state.messages[i].id)) endIdx = i;
        }
      }
      if (endIdx < 0) {
        // 不可达（引擎 id 来自同一折叠视图）；防御告警跳过，不落任何回退分支
        console.warn(
          `[replayer] compaction/summary at seq=${event.seq}: no shadowed message located, skipping`,
        );
        break;
      }

      // 幂等：同一 compaction/summary 被再次折叠（防御性重放）→ 摘要已置头部，
      // 仍执行范围删除（移除重放的遮蔽节点），但不重复插入摘要
      if (state.messages.some((n) => n.id === summaryMsgId)) {
        state.messages.splice(1, endIdx);
        break;
      }

      // 检查点消息（role='user' + source.plugin='compact'，DSH 式可见检查点：
      // 二次压缩时旧检查点位于消息头、必然落在新删除范围内 → 自然被替换，不会重复）
      const summaryMsg = eventMessageFromData({
        messageId: summaryMsgId,
        eventType: 'compaction',
        compactInfo: {
          shadowedEndId: data.shadowedEndId,
          shadowedCount: data.shadowedCount,
          shadowedMessageIds: data.shadowedMessageIds,
          summary: data.summary,
        },
      });
      // 摘要置于消息头，归属继承删除前首节点的归属标签（surface 归属字段，非 turnId 查找/修改）
      const headTurnId = state.messages[0].turnId;
      // 范围删除 [0..endIdx] + 摘要置头部，一步完成
      state.messages.splice(0, endIdx + 1, {
        ...summaryMsg,
        seq: event.seq,
        turnId: headTurnId,
      } satisfies MessageNode);
      break;
    }

    case 'compaction/end':
      // 闭括号：清除未闭合 seq（正常批量写入下 start→end 配对）
      if (opts?.ignoreCompaction) break;
      state.openCompactionSeq = null;
      // 占用锚点：压缩纠正值（usedTokens + 配套启发式总量）取代被抵消的 provider 增量。
      // 旧事件无 heuristicTokens → 不设锚点（回退 usage 口径），避免用错口径的基准。
      {
        const data = (event.data as unknown) as {
          usedTokens?: unknown;
          heuristicTokens?: unknown;
        };
        if (isNonNegativeNumber(data?.usedTokens) && isNonNegativeNumber(data?.heuristicTokens)) {
          state.occupancyAnchor = {
            kind: 'compaction',
            usedTokens: data.usedTokens,
            heuristicTokens: data.heuristicTokens,
          };
        }
      }
      break;

    // ─── 统一交互事件（ask/asked|answered 事件溯源；审批/询问共用）───
    // 无状态透传（纯审计源；交互为执行内瞬态，不承载恢复状态）
    case 'ask/asked':
    case 'ask/answered':
      break;

    // ─── 会话模式变更（计划模式协作状态 + 安全档位快照）───
    // 无状态透传：事实源是 session.settings，本事件只作审计与切换历史。
    // 刻意不折叠进 ReplayState——若从这里恢复，会与 settings 形成第二个状态源。
    case 'session/mode_changed':
      break;

    // ─── command/run + command/done：不再折叠进 state.messages（S0 移除历史遗留）───
    // 命令事件服务于前端展示与审计，对 LLM 视图无意义；折叠态即可视消息序列，
    // command 节点此前被 fold 进来、又在投影时被过滤，属纯粹空转。
    // 完整事件流仍保留于日志，事件页展示走读盘独立折叠（applyCompressionPrune=false）。
    case 'command/run':
      break;

    case 'command/done':
      break;

    // ─── 小轮次上下文占用锚点：只供前端冷启动扫描，不参与消息 surface / 回合游标折叠 ───
    case 'context/stats':
      break;

    default:
      break;
  }
  state.lastProcessedSeq = Math.max(state.lastProcessedSeq, event.seq);
  return state;
}

/**
 * 回放全部事件。
 * @param opts.applyCompressionPrune 默认 true（LLM 链路）；false 时压缩裁剪不应用（编辑定位/搜索等读原文场景）
 */
export function foldEvents(
  events: BaseEvent[],
  state?: ReplayState,
  opts?: FoldOptions,
): ReplayState {
  const s = state ?? createInitialState();
  for (const event of events) {
    foldEvent(s, event, opts);
  }
  return s;
}

// ─── 消息事件 → 三层 Message（按三事件分派）───

/**
 * 消息元数据是否携带 provider prompt usage（占用真值锚点判据，与
 * JsonlSessionContext.findUsageAnchor 同式：有限且 >= 0 的 promptTokens）。
 */
function hasPromptUsage(metadata: unknown): boolean {
  const usage = (metadata as { usage?: { promptTokens?: unknown } } | null | undefined)?.usage;
  return isNonNegativeNumber(usage?.promptTokens);
}

function isNonNegativeNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0;
}

/**
 * MessageFile → FileRef（旧事件/迁移数据读取路径）。
 * 旧数据的 fileType 可能是非 MIME 语义值（'image'/'text'），经 normalizeMediaType
 * 归一为真 MIME，修复历史图片被误判为 file 块（文本投影）的问题。
 * 旧附件标识 fileId 仅作 url 缺失时的展示回退，不进入新写入。
 */
function toFileRef(f: MessageFile): FileRef {
  const url = f.url ?? f.previewUrl;
  return {
    mediaType: normalizeMediaType(f.fileType, f.fileExtension),
    bytes: f.fileSize,
    name: f.displayName ?? f.fileName,
    url,
    ...(f.fileExtension ? { fileExtension: f.fileExtension } : {}),
    ...(url ? {} : { attachmentId: f.fileId }),
  };
}

/** 平铺 files → image/file 块（块形态判定见 isVisionImageMediaType） */
function appendFileBlocks(blocks: ContentBlock[], cid: string, files?: MessageFile[]): void {
  for (const f of files ?? []) {
    const ref = toFileRef(f);
    if (isVisionImageMediaType(ref.mediaType)) {
      blocks.push({ type: 'image', attachment: ref });
    } else {
      blocks.push({ type: 'file', attachment: ref });
    }
  }
}

/**
 * user/message → 三层 Message。
 * kind='user' → source.user（真实用户）；kind='model' → source.plugin（注入的系统提示，metadata.hidden；
 * 历史数据中的旧版工具图片注入消息也走此形态）。
 * 归属由节点 turnId 承载，Message 本身不再带 turnId。
 */
function userMessageFromData(data: UserMessageData, time: number): ThreeTierMessage {
  const cid = data.messageId;
  const meta = data.metadata ?? {};
  // P6：事件格式统一为 blocks——旧 content/files 平铺格式 fail-fast
  // （对齐 assistantMessageFromData 的 legacy 检测；存量旧数据由运维侧重建，不对外暴露工具名）
  if (!Array.isArray(data.blocks)) {
    throw new Error(
      `[replayer] user/message ${cid}: legacy content/files format is no longer supported. ` +
        `Session data must be rebuilt by the maintainer.`,
    );
  }
  // P6c：contentId 已彻底删除（块定位由 messageId + 块序号承担）
  const blocks: ContentBlock[] = [...data.blocks];
  const injected = data.kind === 'model';
  // 显式 source 优先（队列投递的 sub_agent/scheduler/process_monitor 来源），
  // 缺省由 kind 推导（model → plugin）
  const source: ThreeTierMessage['source'] =
    data.source ??
    (injected
      ? { kind: 'plugin', plugin: String(meta.plugin ?? 'unknown') }
      : { kind: 'user' });
  return {
    id: cid,
    role: 'user',
    kind: data.kind,
    source,
    metadata: { ...meta },
    content: blocks,
    createdAt: time,
  };
}

/**
 * assistant/message → 三层 Message（role='assistant'，kind='model'）。
 * content 原生为 ContentBlock[]（与内存结构同构，直接采用，零转换）。
 * 旧平铺格式（content 字符串 + reasoningContent/toolCalls 并列）已废弃：
 * 检测到即 fail-fast 明确报错（旧数据可从 DB 重新导入）。
 * 归属由节点 turnId 承载，Message 本身不再带 turnId。
 */
function assistantMessageFromData(data: AssistantMessageData, time: number): ThreeTierMessage {
  const cid = data.messageId;
  const meta = data.metadata ?? {};

  if (!Array.isArray(data.content)) {
    throw new Error(
      `[replayer] assistant/message ${cid}: legacy flat format detected ` +
        `(expected ContentBlock[]). Old sessions must be re-imported.`,
    );
  }

  const blocks: ContentBlock[] = [...data.content];
  appendFileBlocks(blocks, cid, data.files);
  return {
    id: cid,
    role: 'assistant',
    kind: 'model',
    source: { kind: 'model', provider: String(meta.provider ?? ''), model: String(meta.modelName ?? '') },
    metadata: { ...meta },
    content: blocks,
    createdAt: time,
  };
}

/**
 * tool/result → 三层 Message（role='tool'，kind='model'，source.tool + tool-result 块）。
 * 归属由节点 turnId 承载，Message 本身不再带 turnId。
 */
function toolResultFromData(data: ToolResultData, time: number): ThreeTierMessage {
  const cid = data.messageId;
  const meta = data.metadata ?? {};
  return {
    id: cid,
    role: 'tool',
    kind: 'model',
    source: { kind: 'tool', toolCallId: data.toolCallId },
    metadata: { ...meta },
    content: [
      {
        type: 'tool-result',
        toolCallId: data.toolCallId,
        name: data.name ?? '',
        content: data.content,
        isError: data.isError ?? false,
        ...(data.images?.length ? { images: data.images } : {}),
        ...(data.meta ? { meta: data.meta } : {}),
      },
    ],
    createdAt: time,
  };
}

/**
 * compaction 摘要 → 三层 Message（role='user'，kind='model'，source.plugin='compact'）。
 * 对齐 DSH：LLM 消息角色只有 system/user/assistant，无 event——检查点是可见 user 消息
 * （source.plugin 标记来源；metadata.compactInfo 承载遮蔽范围/摘要）。
 */
function eventMessageFromData(data: {
  messageId: string;
  eventType: string;
  compactInfo?: {
    shadowedEndId?: string;
    shadowedCount?: number;
    shadowedMessageIds?: string[];
    summary: string;
  };
}): ThreeTierMessage {
  const cid = data.messageId;
  const text = data.compactInfo?.summary ?? '';
  return {
    id: cid,
    role: 'user',
    kind: 'model',
    source: { kind: 'plugin', plugin: 'compact' },
    metadata: {
      eventType: data.eventType,
      ...(data.compactInfo === undefined ? {} : { compactInfo: data.compactInfo }),
    },
    // 检查点永远产出有效文本块（DISABLED 空摘要 → 占位标记）：
    // 空 content 会被 LLM adapter 拒绝（400 missing messages.content），
    // 而 emptyContentCompatStep 只兜 assistant、不兜 user。
    content: [
      { type: 'text', text: text || '[compacted region]' },
    ],
  };
}