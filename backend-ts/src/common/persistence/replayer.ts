/**
 * JSONL 持久化 — 回放引擎
 * 对齐 DSH 语义的扁平消息 surface 模型：
 *   turn/start + turn/finish（回合：一次输入 = 用户 + 助手，一对一轮回——仅簿记，不建外壳）
 *   user/message + assistant/message + tool/result（消息级三事件，对齐 DSH）
 *   turn/delete（删除本轮对话：按回合 id 移除该回合全部消息节点）
 *   message/prune（内容裁剪）、compaction/*（压缩括号：前缀范围删除 + 头部摘要，消息级）
 * 回放产出**扁平消息 surface**（节点带 seq/turnId），零 turn 树；
 * 消费方经投影派生：
 *   deriveMessages → LLM 消息视图（turn 无关）
 *   deriveTurns → 展示三层 Turn[]（前端契约）
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
  CommandRunData,
  CommandDoneData,
  MessageFile,
} from './types';
import type {
  Turn as ThreeTierTurn,
  Message as ThreeTierMessage,
  ContentBlock,
  MessageSource,
  FileRef,
} from '../types/conversation.types';

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
  };
}

/**
 * 回放折叠规则。
 *
 * 语义边界：同一份持久事件流可被不同消费链路折叠（各自独立视图），
 * 折叠产物同为扁平 surface，仅内容规则不同。
 * - LLM 链路（缓存）：压缩裁剪就地应用省 token；压缩前缀范围直接移除
 * - 前端展示链路（applyCompressionPrune=false）：压缩裁剪不应用（tool-result 保持完整原文）；
 *   用户编辑（strategy='user_edit'）无论哪条链路都应用（所见即所得，必须回显）
 * 压缩（compaction/summary）两链路一致：前缀范围删除 + 摘要置消息头（不再保留遮蔽消息）。
 */
export interface FoldOptions {
  /** 压缩自动裁剪（head_tail_500 等）是否就地改块；默认 true（LLM 链路）。false 时保留原文 */
  applyCompressionPrune?: boolean;
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
        seq: event.seq,
        turnId: state.currentTurnId,
        message: userMessageFromData(data, event.time),
      });
      break;
    }

    // assistant/message：助手消息（一次 LLM 调用产出）
    case 'assistant/message': {
      const data = (event.data as unknown) as AssistantMessageData;
      if (!state.currentTurnId) break; // 回合未开（异常），忽略
      state.messages.push({
        seq: event.seq,
        turnId: state.currentTurnId,
        message: assistantMessageFromData(data, event.time),
      });
      break;
    }

    // tool/result：工具结果
    case 'tool/result': {
      const data = (event.data as unknown) as ToolResultData;
      if (!state.currentTurnId) break; // 回合未开（异常），忽略
      state.messages.push({
        seq: event.seq,
        turnId: state.currentTurnId,
        message: toolResultFromData(data, event.time),
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

    // ─── 内容裁剪（一级压缩）───
    case 'message/prune': {
      const data = (event.data as unknown) as MessagePruneData;
      const applyCompressionPrune = opts?.applyCompressionPrune !== false;
      // 用户编辑（strategy='user_edit'）：两视图一致，就地改 text 块（编辑所见即所得）；
      // 压缩自动裁剪（head_tail_500 等）：仅 LLM 链路应用，展示链路保留完整原文
      if (data.strategy !== 'user_edit' && !applyCompressionPrune) break;
      const node = state.messages.find((n) => n.message.id === data.messageId);
      if (!node) break;
      const m = node.message;
      if (data.strategy === 'user_edit') {
        const tb = m.content.find(
          (b): b is Extract<ContentBlock, { type: 'text' }> => b.type === 'text',
        );
        if (tb) tb.text = data.newContent;
      } else {
        // 一级压缩目标：tool-result 块（回退到 text 块）
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
      // 开括号：记录未闭合 seq（锁语义审计；原子批量写入下正常必有 end 收口）
      state.openCompactionSeq = event.seq;
      break;

    case 'compaction/summary': {
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

      // 压缩范围 = 视图头部开始的连续前缀（压缩引擎 shadowedMessages = messages.slice(0, boundary)），
      // shadowedMessageIds 即该前缀的 id 清单。定位结束位置 = 最后一个匹配 id 的下标。
      const shadowSet = new Set(data.shadowedMessageIds ?? []);
      let endIdx = -1;
      for (let i = 0; i < state.messages.length; i++) {
        if (shadowSet.has(state.messages[i].message.id)) endIdx = i;
      }
      if (endIdx === -1) {
        // 不可达（引擎 id 来自同一折叠视图）；防御告警跳过，不落任何回退分支
        console.warn(
          `[replayer] compaction/summary at seq=${event.seq}: no shadowed message located, skipping`,
        );
        break;
      }

      // 幂等：同一 compaction/summary 被再次折叠（防御性重放）→ 摘要已置头部，
      // 仍执行范围删除（移除重放的遮蔽节点），但不重复插入摘要
      if (state.messages.some((n) => n.message.id === summaryMsgId)) {
        state.messages.splice(1, endIdx);
        break;
      }

      // 摘要消息（role='event' kind='model'，与普通消息靠 role/kind 区分：
      // 二次压缩时旧摘要位于消息头、必然落在新删除范围内 → 自然被替换，不会重复）
      const summaryMsg = eventMessageFromData({
        messageId: summaryMsgId,
        eventType: 'compaction',
        compactInfo: {
          shadowedMessageIds: data.shadowedMessageIds,
          summary: data.summary,
        },
      });
      // 摘要置于消息头，归属继承删除前首节点的归属标签（surface 归属字段，非 turnId 查找/修改）
      const headTurnId = state.messages[0].turnId;
      // 范围删除 [0..endIdx] + 摘要置头部，一步完成
      state.messages.splice(0, endIdx + 1, {
        seq: event.seq,
        turnId: headTurnId,
        message: summaryMsg,
      } satisfies MessageNode);
      break;
    }

    case 'compaction/end':
      // 闭括号：清除未闭合 seq（正常批量写入下 start→end 配对）
      state.openCompactionSeq = null;
      break;

    // ─── 统一交互事件（ask/asked|answered 事件溯源；审批/询问/迭代暂停共用）───
    // 无状态透传（纯审计源；交互为执行内瞬态，不承载恢复状态）
    case 'ask/asked':
    case 'ask/answered':
      break;

    // ─── 事件类消息：command/run + command/done（对齐 DSH CommandNode）───
    // 折叠为 role='event' 节点；命令发生在回合内 → turnId 归属当前回合；
    // 用户主动触发（无回合）→ turnId=null（展示投影包裹独立事件外壳）。
    case 'command/run': {
      const data = (event.data as unknown) as CommandRunData;
      const shellId = `__cmd_${event.seq}`;
      state.messages.push({
        seq: event.seq,
        turnId: state.currentTurnId,
        message: eventMessageFromData({
          messageId: `${shellId}_e`,
          eventType: 'command',
          commandId: data.commandId,
          commandName: data.name,
          commandArgs: data.args ?? null,
        }),
      });
      break;
    }

    case 'command/done': {
      const data = (event.data as unknown) as CommandDoneData;
      const outcome = {
        kind: data.kind,
        ...(data.text === undefined ? {} : { text: data.text }),
      };
      // 更新目标命令事件节点（可能在回合内，也可能在独立外壳中）
      const target = state.messages.find(
        (n) =>
          n.message.role === 'event'
          && n.message.metadata?.eventType === 'command'
          && n.message.metadata?.commandId === data.commandId,
      );
      if (target) {
        target.message.metadata = { ...target.message.metadata, commandOutcome: outcome };
      } else {
        // 事件消息缺失（如 done 先于 run 到达）：兜底独立节点
        state.messages.push({
          seq: event.seq,
          turnId: null,
          message: eventMessageFromData({
            messageId: `__cmd_${event.seq}_e`,
            eventType: 'command',
            commandId: data.commandId,
            commandOutcome: outcome,
          }),
        });
      }
      break;
    }

    default:
      break;
  }
  state.lastProcessedSeq = Math.max(state.lastProcessedSeq, event.seq);
  return state;
}

/**
 * 回放全部事件。
 * @param opts.applyCompressionPrune 默认 true（LLM 链路）；false（前端展示链路）时压缩裁剪不应用
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

/** MessageFile → FileRef（引用为主，前端仅需 url；base64 由 adapter 边界现转） */
function toFileRef(f: MessageFile): FileRef {
  return {
    attachmentId: f.fileId,
    mediaType: f.fileType,
    bytes: f.fileSize,
    name: f.displayName ?? f.fileName,
    url: f.url ?? f.previewUrl,
  };
}

/** 平铺 files → image/file 块 */
function appendFileBlocks(blocks: ContentBlock[], cid: string, files?: MessageFile[]): void {
  for (const f of files ?? []) {
    const ref = toFileRef(f);
    if (f.fileType?.toLowerCase().startsWith('image/')) {
      blocks.push({ type: 'image', contentId: cid, attachment: ref });
    } else {
      blocks.push({ type: 'file', contentId: cid, attachment: ref });
    }
  }
}

/**
 * user/message → 三层 Message。
 * kind='user' → source.user（真实用户）；kind='model' → source.plugin（注入的系统提示/图片，metadata.hidden）。
 * 归属由节点 turnId 承载，Message 本身不再带 turnId。
 */
function userMessageFromData(data: UserMessageData, time: number): ThreeTierMessage {
  const blocks: ContentBlock[] = [];
  const cid = data.messageId;
  const meta = data.metadata ?? {};
  if (data.content) {
    blocks.push({ type: 'text', contentId: cid, text: data.content });
  }
  appendFileBlocks(blocks, cid, data.files);
  const injected = data.kind === 'model';
  return {
    id: cid,
    role: 'user',
    kind: data.kind,
    source: injected
      ? { kind: 'plugin', plugin: String(meta.plugin ?? 'unknown') }
      : { kind: 'user' },
    metadata: { ...meta },
    content: blocks,
    createdAt: time,
  };
}

/**
 * assistant/message → 三层 Message（role='assistant'，kind='model'）。
 * content 原生为 ContentBlock[]（与内存结构同构，直接采用，仅回填消息级 contentId）。
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

  const blocks: ContentBlock[] = data.content.map((b) =>
    b.contentId ? b : { ...b, contentId: cid },
  );
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
        contentId: cid,
        toolCallId: data.toolCallId,
        name: data.name ?? '',
        content: data.content,
        isError: data.isError ?? false,
      },
    ],
    createdAt: time,
  };
}

/**
 * 事件类消息 → 三层 Message（role='event'，kind='model'，source.plugin）。
 * ContentBlock 即事件内容（命令文本 / 压缩摘要）。
 * LLM 视图（deriveMessages）只放行 compaction 类事件消息；命令事件由投影过滤。
 */
function eventMessageFromData(data: {
  messageId: string;
  eventType: string;
  commandId?: string;
  commandName?: string;
  commandArgs?: unknown;
  commandOutcome?: { kind: string; text?: string } | null;
  compactInfo?: { shadowedMessageIds: string[]; summary: string };
}): ThreeTierMessage {
  const cid = data.messageId;
  const text =
    data.eventType === 'command'
      ? `/${data.commandName ?? ''}`
      : data.compactInfo?.summary ?? '';
  return {
    id: cid,
    role: 'event',
    kind: 'model',
    source: {
      kind: 'plugin',
      plugin: data.eventType === 'command' ? 'command' : 'compact',
    },
    metadata: {
      eventType: data.eventType,
      ...(data.commandId === undefined ? {} : { commandId: data.commandId }),
      ...(data.commandName === undefined ? {} : { commandName: data.commandName }),
      ...(data.commandArgs === undefined ? {} : { commandArgs: data.commandArgs }),
      ...(data.commandOutcome === undefined ? {} : { commandOutcome: data.commandOutcome }),
      ...(data.compactInfo === undefined ? {} : { compactInfo: data.compactInfo }),
    },
    content: text
      ? [{ type: 'text', contentId: cid, text }]
      : [],
  };
}

// ─── LLM 消息视图投影（纯消息级，turn 无关）───

/**
 * LLM 消息视图投影：纯消息级过滤。
 * - 事件类消息：仅 compaction 摘要进入 LLM 上下文（对齐 DSH 摘要节点）
 * - shadowed 防御（LLM 折叠已做范围移除，遮蔽消息不应存在）
 */
export function deriveMessages(state: ReplayState): ThreeTierMessage[] {
  const out: ThreeTierMessage[] = [];
  for (const node of state.messages) {
    const m = node.message;
    if (m.role === 'event') {
      if (m.metadata?.eventType !== 'compaction') continue;
    }
    if (m.metadata?.shadowed === true) continue;
    out.push(m);
  }
  return out;
}