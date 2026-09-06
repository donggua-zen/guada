/**
 * JSONL 持久化 — 消息服务（JSONL 版，回合制三事件模型）
 *
 * 实现 IMessageStore，底层由 PersistenceBackend（JsonlBackend）+ Replayer 驱动。
 * 回放产出扁平消息 surface（MessageNode IS-A Message，即可视消息序列）：
 * - LLM 链路（缓存折叠）：applyCompressionPrune 默认 true（压缩裁剪就地应用省 token）；
 *   压缩前缀范围直接移除（LLM 用不到被压缩内容）
 * - 展示链路（事件页）：读盘独立折叠（applyCompressionPrune=false，压缩裁剪不应用）
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  foldEvents,
  createInitialState,
} from './replayer';
import {
  PERSISTENCE_BACKEND_TOKEN,
  PersistenceBackend,
  BaseEvent,
  ReplayState,
  SessionMeta,
  SEGMENT_MAX_BYTES,
  AskAskedData,
  AskAnsweredData,
} from './types';
import { generateOrderedMessageId } from '../utils/ordered-id.util';
import { CorruptSessionLogError } from './errors';
import type {
  Turn,
  Message,
  ContentBlock,
  FileRef,
  MessageSource,
} from '../types/conversation.types';
import {
  IMessageStore,
  ContextLoadParams,
  TurnFinish,
  TurnUpdate,
  TokenBreakdown,
} from './message-store.interface';

/** LLM 链路折叠：默认选项即 applyCompressionPrune=true（压缩裁剪就地应用） */

@Injectable()
export class JsonlMessageService implements IMessageStore {
  private readonly logger = new Logger(JsonlMessageService.name);
  /**
   * 会话回放状态缓存：TTL 超时机制（无 LRU 上限）。
   * - 访问（getState）与写入（增量 fold）即续期 lastActiveAt
   * - 超过 CACHE_TTL_MS 未活动 → 惰性过期（cacheGet 命中检查）+ 周期清扫逐出
   * - 逐出后磁盘快照每轮最新，冷加载 = 快照 + 跨卷增量，重载便宜
   * 设计取舍：活跃会话数量少（≤10），峰值重建为短暂占用，故不加数量上限（此前固定 8 的
   * LRU 会与真实活跃度脱节——冷的占坑挤掉热的导致抖动）。
   */
  private stateCache = new Map<string, { state: ReplayState; lastActiveAt: number }>();
  /** 缓存 TTL：30 分钟未活动即逐出（写入即续期，进行中的长对话不会误逐） */
  private static CACHE_TTL_MS = 30 * 60 * 1000;
  /** 周期清扫间隔（远小于 TTL，及时释放停更会话内存） */
  private static readonly CACHE_SWEEP_INTERVAL_MS = 60 * 1000;
  private cacheSweepTimer?: ReturnType<typeof setInterval>;
  /** ensureSession 串行化队列：同一会话的并发 ensure 排队执行，消除"检查-创建"之间的 TOCTOU 窗口 */
  private ensureChains = new Map<string, Promise<void>>();

  constructor(
    @Inject(PERSISTENCE_BACKEND_TOKEN) private readonly backend: PersistenceBackend,
  ) {
    // 周期清扫过期缓存（unref：不阻止进程退出，jest/脚本可正常结束）
    this.cacheSweepTimer = setInterval(() => this.sweepExpiredCache(), JsonlMessageService.CACHE_SWEEP_INTERVAL_MS);
    this.cacheSweepTimer.unref();
  }

  /** 模块销毁时停止清扫定时器 */
  async onModuleDestroy(): Promise<void> {
    if (this.cacheSweepTimer) {
      clearInterval(this.cacheSweepTimer);
      this.cacheSweepTimer = undefined;
    }
  }

  // ─── 内部工具 ───

  /**
   * 读缓存：命中且未过期 → 续期 lastActiveAt 并返回折叠态；
   * 过期 → 删除并视为未命中（下次冷加载重建）。
   */
  private cacheGet(sessionId: string): ReplayState | undefined {
    const entry = this.stateCache.get(sessionId);
    if (entry === undefined) return undefined;
    const now = Date.now();
    if (now - entry.lastActiveAt > JsonlMessageService.CACHE_TTL_MS) {
      // 惰性过期：访问时发现超时即逐出
      this.stateCache.delete(sessionId);
      return undefined;
    }
    entry.lastActiveAt = now; // 访问续期
    return entry.state;
  }

  /**
   * 写缓存（无数量上限；TTL 由 cacheGet 惰性与周期清扫兜底）。
   */
  private cacheSet(sessionId: string, state: ReplayState): void {
    this.stateCache.set(sessionId, { state, lastActiveAt: Date.now() });
  }

  /** 周期清扫：逐出超过 TTL 未活动的会话（释放停更会话内存） */
  private sweepExpiredCache(): void {
    const ttl = JsonlMessageService.CACHE_TTL_MS;
    const now = Date.now();
    for (const [sessionId, entry] of this.stateCache) {
      if (now - entry.lastActiveAt > ttl) {
        this.stateCache.delete(sessionId);
      }
    }
  }

  /**
   * 写后增量应用:若该会话已有缓存,直接在缓存上 fold 新事件(与全量重建折叠逻辑一致),
   * 不删缓存;若当前无缓存,直接落盘即可(不建缓存,等下次读时重建)。
   * 外部修改日志文件不允许,缓存状态 = 磁盘已 fold 状态,无需对齐校验。
   */
  private applyToCache(sessionId: string, events: BaseEvent[]): void {
    const cached = this.cacheGet(sessionId);
    if (cached === undefined) return;
    foldEvents(events, cached);
  }

  private async getState(sessionId: string, force = false): Promise<ReplayState> {
    if (!force) {
      const cached = this.cacheGet(sessionId);
      if (cached !== undefined) return cached;
    }
    const state = await this.rebuildState(sessionId);
    this.cacheSet(sessionId, state);
    return state;
  }

  /**
   * 恢复路径：有快照 → 快照 + 跨卷增量（snapshotSeq+1 起）；无快照/衔接不符 → 全量重放。
   * 快照每轮结束（turn/finish 落盘后）写入，与分卷解耦：
   * - 增量可能跨多个分卷（快照 seq 落后于分卷边界时按 manifest 段范围跨卷定位）
   * - 空增量 = 快照即最新（无后续事件，直接采用快照态）
   * - 衔接校验（首条 === snapshotSeq+1）失败 → 全量回退（快照丢失/日志截断/段文件缺失兜底）
   * - 快照形状守卫：旧格式（turns 形状/非扁平面）快照 → 全量重放（数据重新转换导入，不做兼容迁移）
   * 冷加载先修复活跃段 torn 尾（坏行截断 + 合成 interrupted），保证后续增量读取 seq 连续。
   */
  private async rebuildState(sessionId: string): Promise<ReplayState> {
    // 先修复活跃段 torn 尾（seq 缺口 → 抛 CorruptSessionLogError，fail-fast）
    await this.repairActiveSegmentIfNeeded(sessionId);

    const snapshot = await this.backend.readSnapshot(sessionId);
    if (!snapshot) {
      const events = await this.backend.getAllEvents(sessionId);
      return foldEvents(events, createInitialState());
    }
    // 形状守卫：旧 version 快照（turns 形状）→ 回退全量重放
    const snapshotState = snapshot.state as Partial<ReplayState> | null;
    if (!snapshotState || !Array.isArray(snapshotState.messages)) {
      this.logger.warn(
        `[jsonl] snapshot shape mismatch for ${sessionId} (legacy turns format), fallback full replay`,
      );
      const events = await this.backend.getAllEvents(sessionId);
      return foldEvents(events, createInitialState());
    }
    // 快照 + 跨卷增量（首条 session/rotate 由 replayer no-op 忽略）
    const tail = await this.backend.readEventsFrom(sessionId, snapshot.snapshotSeq + 1);
    if (tail.length === 0) {
      // 快照即最新：无后续事件，直接采用快照折叠态
      return snapshotState as ReplayState;
    }
    const first = tail[0];
    if (first.seq !== snapshot.snapshotSeq + 1) {
      // 衔接校验失败（快照过期/日志被清理/段缺失）：回退全量重放
      this.logger.warn(
        `[jsonl] snapshot seq mismatch for ${sessionId} (expected ${snapshot.snapshotSeq + 1}, got ${first.seq}), fallback full replay`,
      );
      const events = await this.backend.getAllEvents(sessionId);
      return foldEvents(events, createInitialState());
    }
    return foldEvents(tail, snapshotState as ReplayState);
  }

  /**
   * 冷加载前修复活跃段 torn 尾。
   *
   * 判定（整消息粒度语义）：
   * - 坏行（JSON.parse 失败）→ 可修复：坏行前 seq 连续即无损（顺序写入），
   *   截断到最后一个完整行 + 若有未闭合回合合成 turn/finish(interrupted)
   * - seq 缺口（parse 成功但跳号）→ 抛 CorruptSessionLogError：整消息粒度下
   *   缺口 = 中间事件物理丢失，无法安全修复，拒绝加载（fail-fast）
   * 仅冷加载（无活跃写）路径调用；修复后文件干净、幂等。
   */
  private async repairActiveSegmentIfNeeded(sessionId: string): Promise<void> {
    const { events, truncateTo, gap } = await this.backend.scanActiveSegment(sessionId);
    if (gap) {
      throw new CorruptSessionLogError(
        `会话 ${sessionId} 日志损坏：活跃段存在 seq 缺口（期望 ${gap.expected}，实际 ${gap.got}）。` +
          `整消息粒度下缺口=数据丢失，拒绝加载。`,
        { sessionId, expectedSeq: gap.expected, gotSeq: gap.got },
      );
    }
    if (truncateTo == null) return; // 无 torn 尾

    this.logger.warn(
      `[jsonl] torn tail detected for ${sessionId}: truncating to ${truncateTo} bytes (${events.length} intact events)`,
    );

    // 1. 物理截断活跃段（同步内存 endSeq/bytes）
    const lastSeq = events.length > 0 ? events[events.length - 1].seq : -1;
    await this.backend.truncateActiveSegment(sessionId, truncateTo, lastSeq, truncateTo);

    // 2. 未闭合回合 → 合成 tool 错误结果 + turn/finish(interrupted)（append 走正常写路径：落盘 + 增量 fold 缓存）
    const state = foldEvents(events, createInitialState());
    if (state.currentTurnId) {
      // 对齐 DSH interruptedTurnClosers：为未配对的 tool-call 合成显式错误结果，
      // 使恢复后的 transcript 平衡（模型看到"被中断的工具 = 错误结果"，决定是否只读/幂等重试）
      const currentTurnMessages = state.messages.filter(
        (n) => n.turnId === state.currentTurnId,
      );
      if (currentTurnMessages.length > 0) {
        const paired = new Set<string>();
        for (const m of currentTurnMessages) {
          if (m.role !== 'tool') continue;
          for (const b of m.content) {
            if (b.type === 'tool-result') paired.add(b.toolCallId);
          }
        }
        for (const m of currentTurnMessages) {
          if (m.role !== 'assistant') continue;
          for (const b of m.content) {
            if (b.type !== 'tool-call' || paired.has(b.toolCallId)) continue;
            await this.append(sessionId, {
              type: 'tool/result',
              seq: await this.getNextSeq(sessionId),
              time: Date.now(),
              data: {
                messageId: generateOrderedMessageId('m'),
                toolCallId: b.toolCallId,
                name: b.name,
                content:
                  'Error: tool call interrupted before dispatch. Retry only read-only/idempotent operations.',
                isError: true,
                metadata: {},
              },
            });
            this.logger.warn(
              `[jsonl] synthesized interrupted tool/result for ${sessionId} call=${b.toolCallId}`,
            );
          }
        }
      }
      await this.append(sessionId, {
        type: 'turn/finish',
        seq: await this.getNextSeq(sessionId),
        time: Date.now(),
        data: {
          turnId: state.currentTurnId,
          finishReason: 'interrupted',
        },
      });
      this.logger.warn(
        `[jsonl] synthesized interrupted turn/finish for ${sessionId} turn=${state.currentTurnId}`,
      );
    }
  }

  /**
   * 分卷判断（由 ISessionContext.persist 调用）：
   * 活跃段 bytes 超阈值 → 分卷写新文件。与快照解耦——快照由每轮结束（finalizeTurn）独立写入。
   */
  async maybeSplit(sessionId: string): Promise<void> {
    const info = await this.backend.getActiveSegmentInfo(sessionId);
    if (!info) return;
    if (info.bytes < SEGMENT_MAX_BYTES) return;
    await this.backend.splitSegment(sessionId);
  }

  /**
   * 每轮结束写快照：当前 LLM 折叠态 + 最新 seq（= turn/finish 落盘后的 lastProcessedSeq）。
   * 写失败仅告警（保留旧快照；manifest.snapshot 不更新），下次轮末自愈。
   */
  private async maybeSnapshot(sessionId: string): Promise<void> {
    try {
      const state = await this.getState(sessionId);
      await this.backend.writeSnapshot(sessionId, state.lastProcessedSeq, state);
    } catch (e: any) {
      this.logger.warn(
        `[jsonl] snapshot write failed for ${sessionId}: ${e?.message ?? e}`,
      );
    }
  }

  /**
   * 懒创建语义：会话目录不存在则创建（新会话/断点恢复前调用）。
   * 与 DB 会话元数据解耦：存储层只关心事件日志是否就绪。
   * 并发安全：同一会话的并发 ensure 排队串行执行，拿到队列后二次 hasSession 检查。
   * 否则新会话首屏并行请求会在 manifest 落盘前同时通过检查，写出两条 session/init(seq=0)，
   * 重复 seq 会被连续性校验判为缺口，会话永久无法加载。
   */
  async ensureSession(sessionId: string, meta?: Partial<SessionMeta>): Promise<void> {
    const prev = this.ensureChains.get(sessionId) ?? Promise.resolve();
    // 前序结果就地吞掉（成功/失败都不阻断本任务）；错误仍会抛给各自的调用方
    const task = prev.catch(() => {}).then(async () => {
      // 排队拿到"锁"后二次检查：前一个排队者可能刚刚创建完成
      if (await this.backend.hasSession(sessionId)) return;
      await this.backend.createSession(sessionId, meta);
    });
    const tail = task.catch(() => {});
    this.ensureChains.set(sessionId, tail);
    try {
      await task;
    } finally {
      // 仍是链尾（无新排队者）时清理条目，避免 Map 无限增长
      void tail.then(() => {
        if (this.ensureChains.get(sessionId) === tail) {
          this.ensureChains.delete(sessionId);
        }
      });
    }
  }

  /** 该会话最后一条已落盘事件的 seq（广播/增量同步去重游标） */
  async getLastProcessedSeq(sessionId: string): Promise<number> {
    const state = await this.getState(sessionId);
    return state.lastProcessedSeq;
  }

  private async append(sessionId: string, event: BaseEvent): Promise<void> {
    await this.backend.appendEvent(sessionId, event);
    this.applyToCache(sessionId, [event]);
  }

  private async getNextSeq(sessionId: string): Promise<number> {
    const state = await this.getState(sessionId);
    return state.lastProcessedSeq + 1;
  }

  private genId(prefix: string): string {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  // ─── 读取 ───

  /**
   * 加载 LLM 上下文（Message[]，adapter 输入）。
   * 折叠态即可视消息序列（MessageNode IS-A Message，S0 起无投影过滤）。
   */
  async loadContext(params: ContextLoadParams): Promise<Message[]> {
    const { sessionId } = params;
    const state = await this.getState(sessionId);

    const messages = state.messages;

    if (params.maxMessages && messages.length > params.maxMessages) {
      return messages.slice(-params.maxMessages);
    }
    return messages;
  }

  // ─── 写入 ───

  /**
   * 开回合:写 turn/start(先于 user/message,对齐 DSH 回合定界)。
   * 整轮次重答(replaceTurnId):先 turn/delete 遮蔽旧轮次,再开新回合。
   * 事件实时落盘(append)。
   * @returns 回合 turnId + 写入后版本号（写入时确定，见接口版本号契约）
   */
  async beginTurn(
    sessionId: string,
    options?: {
      replaceTurnId?: string;
      preGenTurnId?: string;
    },
  ): Promise<{ turnId: string; revision: number }> {
    const seq = await this.getNextSeq(sessionId);
    const turnId = this.genId('msg');

    const events: BaseEvent[] = [];
    // 整轮次重答：先删除旧轮次（按回合 id 遮蔽），再开新回合
    // 【seq 连续】turn/start 必须使用 getNextSeq 返回的空闲 seq（此前无 replaceTurnId 时
    // 误用 seq+1 导致每个回合开头永久空缺一格 seq，破坏事件流的 seq 连续性）
    let nextSeq = seq;
    if (options?.replaceTurnId) {
      events.push({
        type: 'turn/delete',
        seq: nextSeq,
        time: Date.now(),
        data: { turnId: options.replaceTurnId },
      });
      nextSeq++;
    }
    events.push({
      type: 'turn/start',
      seq: nextSeq,
      time: Date.now(),
      data: {
        turnId,
        kind: 'turn',
      },
    });

    await this.backend.appendEvents(sessionId, events);
    this.applyToCache(sessionId, events);
    return { turnId, revision: events[events.length - 1].seq };
  }

  /**
   * 追加用户消息:写 user/message(后于 turn/start,归属由当前回合括号界定)。
   * 事件实时落盘,返回用户消息(三层 Message,供广播 user_message 事件与内存历史)。
   *
   * P6：事件格式统一为 blocks——content/files 参数在写入层转换为 ContentBlock[]，
   * 事件 data 只落 blocks（旧 content/files 格式彻底废弃，读取端 fail-fast）。
   */
  async addUserMessage(
    sessionId: string,
    content: string,
    files: FileRef[] = [],
    options?: {
      metadata?: Record<string, any>;
      /** 原生内容块（结构化入站消息；存在时直接采用，否则由 content/files 合成） */
      blocks?: import('../types/conversation.types').ContentBlock[];
      /** 注入块（system 提示 / KB 引用等消息伴随信息）：追加在统一 blocks 尾部，
       *  落库为同一条消息——LLM 按块文本处理，前端按块标记特殊渲染/跳过 */
      injectedBlocks?: import('../types/conversation.types').ContentBlock[];
      /** 显式消息来源（队列投递写入；缺省折叠时按 kind 推导） */
      source?: import('../types/conversation.types').MessageSource;
    },
  ): Promise<{ messageId: string; userMessage: Message; revision: number }> {
    const seq = await this.getNextSeq(sessionId);
    const messageId = generateOrderedMessageId('m');
    // 统一 blocks：显式 blocks 优先，否则 content（→text 块）+ files（→image/file 块）合成；
    // 注入块一律追加在尾部（novel 区，KV 前缀零损失）
    const blocks: import('../types/conversation.types').ContentBlock[] = options?.blocks
      ? [...options.blocks]
      : (() => {
          const out: import('../types/conversation.types').ContentBlock[] = [];
          if (content) {
            out.push({ type: 'text', text: content });
          }
          for (const f of files) {
            const ref: FileRef = {
              mediaType: f.mediaType,
              bytes: f.bytes,
              name: f.name,
              url: f.url,
              previewUrl: f.previewUrl,
            };
            out.push({
              type: f.mediaType?.toLowerCase().startsWith('image/') ? 'image' : 'file',
              attachment: ref,
            });
          }
          return out;
        })();
    if (options?.injectedBlocks?.length) {
      blocks.push(...options.injectedBlocks);
    }
    const events: BaseEvent[] = [
      {
        type: 'user/message',
        seq,
        time: Date.now(),
        data: {
          messageId,
          blocks,
          ...(options?.source ? { source: options.source } : {}),
          kind: 'user',
          metadata: { ...options?.metadata },
        },
      },
    ];
    await this.backend.appendEvents(sessionId, events);
    this.applyToCache(sessionId, events);

    // 返回三层 user 消息(供广播 user_message 事件)与写入后版本号
    const state = await this.getState(sessionId);
    const userMessage =
      state.messages.find((n) => n.id === messageId) ??
      ({
        id: messageId,
        role: 'user',
        kind: 'user',
        source: { kind: 'user' },
        metadata: options?.metadata ?? {},
        content: blocks,
      } as unknown as Message);
    return { messageId, userMessage, revision: events[events.length - 1].seq };
  }


  /**
   * 追加一次 LLM 调用/注入（Message[]，三层模型）。
   * 每个 Message（一次调用/注入）按 role/kind 分派为三个新事件：
   *   - source.tool            → tool/result（工具结果）
   *   - role='assistant'       → assistant/message（助手回答）
   *   - role='user' kind=user  → user/message（真实用户）
   *   - role='user' kind=model → user/message（注入，metadata.hidden）
   * 返回本次实际折叠出的权威节点（fold 后对象：contentId 等块级字段已归一，file 块已追加，
   * createdAt 为事件时间），供会话层 O(k) 增量更新快照——不可使用入参 Message（与折叠结果不等价）。
   */
  async appendMessages(
    sessionId: string,
    messages: Message[],
  ): Promise<{ added: Message[]; revision: number }> {
    if (!messages || messages.length === 0) {
      return { added: [], revision: await this.getLastProcessedSeq(sessionId) };
    }
    let seq = await this.getNextSeq(sessionId);
    const startSeq = seq;
    const events: BaseEvent[] = [];

    for (const message of messages) {
      const messageId = message.id || generateOrderedMessageId('m');
      const isTool = message.source.kind === 'tool';
      const tr = message.content.find(
        (b): b is Extract<ContentBlock, { type: 'tool-result' }> => b.type === 'tool-result',
      );
      // 附件元数据内嵌于 content 块（self-contained），不再平铺 files 字段重复存储

      // 工具结果 → tool/result（归属由当前回合括号界定，不带 turnId）
      if (isTool) {
        events.push({
          type: 'tool/result',
          seq: seq++,
          time: Date.now(),
          data: {
            messageId,
            toolCallId: (message.source as Extract<MessageSource, { kind: 'tool' }>).toolCallId,
            name: tr?.name,
            content: tr?.content ?? messageToEventContent(message.content),
            isError: tr?.isError,
            metadata: message.metadata,
          },
        });
        continue;
      }

      // 助手消息 → assistant/message（归属由当前回合括号界定，不带 turnId）
      // content 原生存储 ContentBlock[]，与内存结构一致零转换
      if (message.role === 'assistant') {
        events.push({
          type: 'assistant/message',
          seq: seq++,
          time: Date.now(),
          data: {
            messageId,
            content: message.content,
            metadata: message.metadata,
          },
        });
        continue;
      }

      // 用户消息（真实用户 kind=user / 注入 kind=model）→ user/message（归属由当前回合括号界定，不带 turnId）
      // P6：content 原生存 ContentBlock[]（与 assistant/message 一致），不再平铺 content/files
      events.push({
        type: 'user/message',
        seq: seq++,
        time: Date.now(),
        data: {
          messageId,
          kind: message.kind,
          blocks: message.content,
          metadata: message.metadata,
        },
      });
    }

    if (events.length > 0) {
      await this.backend.appendEvents(sessionId, events);
      this.applyToCache(sessionId, events);
    }

    // S1'：返回本次实际折叠出的节点（seq >= startSeq 从尾部回扫，O(k)）。
    // 用 seq 判定而非按条数取尾部：可容忍 fold 时跳过的事件（如回合未开的 user/message）。
    // revision 由写入时确定（本批次最后事件的 seq），不做事后查询（版本号契约）。
    const state = await this.getState(sessionId);
    const out: Message[] = [];
    for (let i = state.messages.length - 1; i >= 0; i--) {
      if (state.messages[i].seq < startSeq) break;
      out.unshift(state.messages[i]);
    }
    return { added: out, revision: events[events.length - 1].seq };
  }

  /**
   * 最终化轮次：追加 turn/finish 事件落盘（usage / finishReason / 耗时）。
   * 重放时由 replayer 合并进 Turn 外壳 metadata，重启不丢失。
   */
  async finalizeTurn(
    sessionId: string,
    turnId: string,
    durationMs: number,
    finish: TurnFinish,
  ): Promise<number> {
    const usage = (finish.usage || {}) as Record<string, any>;
    const cached = usage.cachedTokens;
    const seq = await this.getNextSeq(sessionId);
    await this.append(sessionId, {
      type: 'turn/finish',
      seq,
      time: Date.now(),
      data: {
        turnId,
        promptTokens: usage.promptTokens ?? 0,
        completionTokens: usage.completionTokens ?? 0,
        cachedTokens: cached?.read ?? 0,
        totalTokens: usage.totalTokens ?? 0,
        finishReason: finish.finishReason,
        totalDurationMs: durationMs,
        ...(finish.errorDetail !== undefined ? { errorDetail: finish.errorDetail } : {}),
        ...(finish.modelName !== undefined ? { modelName: finish.modelName } : {}),
        // 上下文占用锚点（回合后完整请求 token + 消息数 + 细分；前端逆向扫描取最后一个）
        ...(finish.usedTokens !== undefined ? { usedTokens: finish.usedTokens } : {}),
        ...(finish.effectiveContextWindow !== undefined
          ? { effectiveContextWindow: finish.effectiveContextWindow }
          : {}),
        ...(finish.messageCount !== undefined ? { messageCount: finish.messageCount } : {}),
        ...(finish.breakdown !== undefined ? { breakdown: finish.breakdown } : {}),
      },
    });

    // 每轮结束立即写快照（与分卷解耦）：冷加载 = 快照 + seq 增量。
    // 必须位于 turn/finish 落盘之后——快照永不超前于日志。
    await this.maybeSnapshot(sessionId);
    return seq;
  }

  /**
   * 编辑轮次（带 sessionId）。
   * 支持：content → 内容编辑（追加 message/prune 记录新内容，简化处理）
   *
   * 目标消息在扁平 surface（读盘 display 折叠）中定位（含被压缩消息，编辑须对完整事件流进行）。
   */
  async updateTurn(
    sessionId: string,
    turnId: string,
    data: TurnUpdate,
  ): Promise<{ success: boolean }> {
    const events = await this.backend.getAllEvents(sessionId);
    const state = foldEvents(events, undefined, { applyCompressionPrune: false });

    // 内容编辑（简化：追加 message/prune 记录新内容）
    if (data?.content !== undefined) {
      const textMsg = state.messages
        .filter((n) => n.turnId === turnId)
        .find((m) => m.content.some((b) => b.type === 'text'));
      if (textMsg) {
        await this.appendPrune(sessionId, {
          messageId: textMsg.id,
          newContent: String(data.content),
          strategy: 'user_edit',
        });
        return { success: true };
      }
    }
    return { success: false };
  }

  /**
   * 删除本轮对话（带 sessionId）：按回合 id 遮蔽整个轮次（用户 + 助手一并隐藏）。
   * append-only：追加 turn/delete 事件，重放时遮蔽。
   */
  async deleteTurn(sessionId: string, turnId: string): Promise<void> {
    const seq = await this.getNextSeq(sessionId);
    await this.append(sessionId, {
      type: 'turn/delete',
      seq,
      time: Date.now(),
      data: { turnId },
    });
    this.logger.log(`[jsonl] deleted turn ${turnId} in session ${sessionId}`);
  }

  /**
   * 清空会话全部轮次：直接删除整个会话目录（事件溯源下无 delete 事件可重放）。
   * 下次 getState 时若目录不存在会得到空状态。
   */
  async clearSessionTurns(sessionId: string): Promise<void> {
    this.stateCache.delete(sessionId);
    await this.backend.deleteSession(sessionId);
    this.logger.log(`[jsonl] cleared session turns by removing dir: ${sessionId}`);
  }

  /**
   * 批量导入回合（Turn[] → 事件写入：turn/start 首回合 + 按 role/kind 分派三事件）。
   * @param opts.effectiveContextWindow 会话模型的有效上下文窗口——传入时 turn/finish 携带
   *   上下文占用锚点（重建/导入路径无 tokenMeter，usedTokens 取回合 usage 的 provider 报告值
   *   = 该请求完整 prompt + 本轮输出，与运行时 getTokenCount 口径一致）
   */
  async importTurns(
    sessionId: string,
    turns: Turn[],
    opts?: { effectiveContextWindow?: number },
  ): Promise<{ imported: number }> {
    let count = 0;
    // 累计 surface 启发式（字符/4，与 TokenMeter 文本估算同口径）——无 provider usage 时的回退锚点
    let surfaceTokens = 0;
    // 建壳查重走完整事件流（读盘）：收集全部 turn/start 的 turnId（含空回合）
    const events = await this.backend.getAllEvents(sessionId);
    const existingTurnIds = new Set<string>();
    for (const e of events) {
      if (e.type === 'turn/start') existingTurnIds.add((e.data as { turnId: string }).turnId);
    }

    for (const turn of turns) {
      const turnId = turn.id || this.genId('msg');
      // 建首回合外壳（若无）
      if (!existingTurnIds.has(turnId)) {
        await this.append(sessionId, {
          type: 'turn/start',
          seq: await this.getNextSeq(sessionId),
          time: Date.now(),
          data: {
            turnId,
            kind: 'turn',
            metadata: turn.metadata,
          },
        });
      }
      // 写消息（一次调用/注入，按 role/kind 分派三事件；消息挂到本回合）
      for (const message of turn.messages) {
        surfaceTokens += estimateMessageTokens(message);
        const isTool = message.source.kind === 'tool';
        const tr = message.content.find(
          (b): b is Extract<ContentBlock, { type: 'tool-result' }> => b.type === 'tool-result',
        );
        if (isTool) {
          await this.append(sessionId, {
            type: 'tool/result',
            seq: await this.getNextSeq(sessionId),
            time: Date.now(),
            data: {
              messageId: message.id || generateOrderedMessageId('m'),
              toolCallId: (message.source as Extract<MessageSource, { kind: 'tool' }>).toolCallId,
              name: tr?.name,
              content: tr?.content ?? messageToEventContent(message.content),
              isError: tr?.isError,
              metadata: message.metadata ?? {},
            },
          });
        } else if (message.role === 'assistant') {
          await this.append(sessionId, {
            type: 'assistant/message',
            seq: await this.getNextSeq(sessionId),
            time: Date.now(),
            data: {
              messageId: message.id || generateOrderedMessageId('m'),
              content: message.content,
              metadata: message.metadata ?? {},
            },
          });
        } else {
          await this.append(sessionId, {
            type: 'user/message',
            seq: await this.getNextSeq(sessionId),
            time: Date.now(),
            data: {
              messageId: message.id || generateOrderedMessageId('m'),
              kind: message.kind,
              // P6：重建/导入路径同样输出原生 blocks（统一格式）
              blocks: message.content,
              metadata: message.metadata ?? {},
            },
          });
        }
        count++;
      }
      // 完成信息（usage/耗时/finishReason）——每回合必写（对齐运行时 finalizeTurn）
      // usage 来源：回合最后一条 assistant 消息的 metadata.usage（运行时落库位置），
      // 回退 turn.metadata.usage（导入方可直接放回合级）
      const usage = (
        [...turn.messages].reverse().find((m) => m.role === 'assistant')?.metadata
          ?.usage ?? turn.metadata?.usage
      ) as
        | { promptTokens?: number; completionTokens?: number; totalTokens?: number }
        | undefined;
      // 上下文占用锚点（重建/导入路径）：provider 报告的该请求完整 prompt + 本轮输出
      // （含 envelope，权威）优先；缺省回退累计 surface 启发式（缺 prelude，近似值）
      const usedTokens = usage &&
        (usage.promptTokens || usage.completionTokens || usage.totalTokens)
        ? Math.max(
            0,
            usage.totalTokens ??
              (usage.promptTokens ?? 0) + (usage.completionTokens ?? 0),
          )
        : surfaceTokens;
      await this.append(sessionId, {
        type: 'turn/finish',
        seq: await this.getNextSeq(sessionId),
        time: Date.now(),
        data: {
          turnId,
          promptTokens: usage?.promptTokens ?? 0,
          completionTokens: usage?.completionTokens ?? 0,
          totalTokens: usage?.totalTokens ?? 0,
          finishReason: turn.metadata?.finishReason as string | undefined,
          totalDurationMs: turn.metadata?.totalDurationMs as number | undefined,
          modelName: turn.metadata?.modelName as string | undefined,
          usedTokens,
          ...(opts?.effectiveContextWindow !== undefined
            ? { effectiveContextWindow: opts.effectiveContextWindow }
            : {}),
        },
      });
    }
    return { imported: count };
  }

  // ─── 压缩占位（后续接入 compression-engine）───

  /** 追加一级压缩（裁剪）事件：只裁剪 tool 内容，不改可见性。@returns 写入后版本号（revision） */
  async appendPrune(sessionId: string, data: {
    messageId: string;
    newContent: string;
    prunedBytes?: number;
    strategy?: string;
    prunedTokens?: number;
  }): Promise<number> {
    const seq = await this.getNextSeq(sessionId);
    await this.append(sessionId, {
      type: 'message/prune',
      seq,
      time: Date.now(),
      data: {
        messageId: data.messageId,
        newContent: data.newContent,
        prunedBytes: data.prunedBytes ?? 0,
        strategy: data.strategy ?? 'head_tail_500',
        ...data.prunedTokens === undefined ? {} : { prunedTokens: data.prunedTokens },
      },
    });
    return seq;
  }

  /** 追加命令执行括号事件(command/run + command/done,事件类消息)。
   *  当前项目尚无命令来源,此方法为预留写入点;有来源后调用即可落库。 */
  async appendCommand(sessionId: string, data: {
    commandId: string;
    name: string;
    args?: unknown;
    result?: { kind: 'success' | 'error' | 'rejected'; text?: string };
  }): Promise<void> {
    const seq = await this.getNextSeq(sessionId);
    const base = { commandId: data.commandId, name: data.name };
    const events: BaseEvent[] = [
      {
        type: 'command/run',
        seq,
        time: Date.now(),
        data: {
          ...base,
          ...data.args === undefined ? {} : { args: data.args },
        },
      },
    ];
    if (data.result !== undefined) {
      events.push({
        type: 'command/done',
        seq: seq + 1,
        time: Date.now(),
        data: {
          ...base,
          kind: data.result.kind,
          ...data.result.text === undefined ? {} : { text: data.result.text },
        },
      });
    }
    await this.backend.appendEvents(sessionId, events);
    this.applyToCache(sessionId, events);
  }

  /** 追加交互请求事件（ask/asked，统一 Ask 审计；无超时语义） */
  async appendAskAsked(sessionId: string, data: AskAskedData): Promise<void> {
    const seq = await this.getNextSeq(sessionId);
    await this.append(sessionId, {
      type: 'ask/asked',
      seq,
      time: Date.now(),
      data: {
        requestId: data.requestId,
        kind: data.kind,
        ...data.title === undefined ? {} : { title: data.title },
        questions: data.questions,
      },
    });
  }

  /** 追加交互应答事件（ask/answered；每次 asked 必有 answered，取消时标 cancelled） */
  async appendAskAnswered(sessionId: string, data: AskAnsweredData): Promise<void> {
    const seq = await this.getNextSeq(sessionId);
    await this.append(sessionId, {
      type: 'ask/answered',
      seq,
      time: Date.now(),
      data: {
        requestId: data.requestId,
        ...data.answers === undefined ? {} : { answers: data.answers },
        ...data.cancelled === undefined ? {} : { cancelled: data.cancelled },
      },
    });
  }

  /**
   * 追加 workflow 编排进度事件（workflow/event，载荷原样落库）。
   * 调用方（WorkflowRun.emit）已按 run 串行化追加，此处不做额外排队。
   */
  async appendWorkflowEvent(
    sessionId: string,
    data: import('../../modules/workflow/workflow.types').WorkflowEventData,
  ): Promise<number> {
    const seq = await this.getNextSeq(sessionId);
    await this.append(sessionId, {
      type: 'workflow/event',
      seq,
      time: Date.now(),
      data: data as unknown as Record<string, unknown>,
    });
    return seq;
  }

  /** 追加二级压缩（摘要）括号事件 + 分卷（遮蔽为头部连续前缀，按分界点消息 id + 条数记录）。
   *  @returns 摘要消息 id + 写入后版本号 + 折叠后的摘要节点（S1' 模式，供会话层快照播种） */
  async appendCompact(sessionId: string, data: {
    /** 遮蔽末位（分界点）消息 id——前端标记"已压缩"的唯一依据 */
    shadowedEndId: string;
    shadowedCount: number;
    summary: string;
    summaryMessageId?: string;
    mode?: string;
    usage?: import('../types/stream-chunk.types').StreamUsage;
    /** 压缩后完整请求 token（会话层结算；compaction/end 携带，前端上下文占用锚点） */
    usedTokens?: number;
    /** 有效上下文窗口（与 usedTokens 配套） */
    effectiveContextWindow?: number;
    /** 可见视图消息数（与 usedTokens 配套） */
    messageCount?: number;
    /** 细分 token（与 usedTokens 配套） */
    breakdown?: TokenBreakdown;
    /** 压缩前实测占用（压缩历史 before/after 对比） */
    beforeTokens?: number;
  }): Promise<{ summaryMessageId: string; endSeq: number; summaryNode: Message | null }> {
    const seq = await this.getNextSeq(sessionId);
    const summaryMessageId =
      data.summaryMessageId ?? generateOrderedMessageId('c');
    const events: BaseEvent[] = [
      {
        type: 'compaction/start',
        seq,
        time: Date.now(),
        data: { sourceCommandId: data.mode },
      },
      {
        type: 'compaction/summary',
        seq: seq + 1,
        time: Date.now(),
        data: {
          shadowedEndId: data.shadowedEndId,
          shadowedCount: data.shadowedCount,
          summary: data.summary,
          summaryMessageId,
          ...data.usage === undefined ? {} : { usage: data.usage },
        },
      },
      {
        type: 'compaction/end',
        seq: seq + 2,
        time: Date.now(),
        data: {
          sourceCommandId: data.mode,
          ...data.usedTokens === undefined ? {} : { usedTokens: data.usedTokens },
          ...data.effectiveContextWindow === undefined
            ? {}
            : { effectiveContextWindow: data.effectiveContextWindow },
          ...data.messageCount === undefined ? {} : { messageCount: data.messageCount },
          ...data.breakdown === undefined ? {} : { breakdown: data.breakdown },
          ...data.beforeTokens === undefined ? {} : { beforeTokens: data.beforeTokens },
        },
      },
    ];
    await this.backend.appendEvents(sessionId, events);
    this.applyToCache(sessionId, events);
    await this.backend.recordCompaction(sessionId);
    // 返回折叠后的摘要节点（与 appendMessages 返回权威节点一致），供会话层快照播种
    const state = await this.getState(sessionId);
    const summaryNode = state.messages.find((n) => n.id === summaryMessageId) ?? null;
    return { summaryMessageId, endSeq: seq + 2, summaryNode };
  }

  /** 纯裁剪（无括号）压缩路径的上下文占用锚点：写一条独立 compaction/end（无 start/summary）。
   *  replayer 对无 start 的 end 无害（仅清 openCompactionSeq）；前端忽略 compaction/end。
   *  @returns 写入后版本号 */
  async recordContextAnchor(
    sessionId: string,
    data: {
      usedTokens: number;
      effectiveContextWindow: number;
      messageCount?: number;
      breakdown?: TokenBreakdown;
      beforeTokens?: number;
    },
  ): Promise<number> {
    const seq = await this.getNextSeq(sessionId);
    await this.append(sessionId, {
      type: 'compaction/end',
      seq,
      time: Date.now(),
      data: {
        usedTokens: data.usedTokens,
        effectiveContextWindow: data.effectiveContextWindow,
        ...data.messageCount === undefined ? {} : { messageCount: data.messageCount },
        ...data.breakdown === undefined ? {} : { breakdown: data.breakdown },
        ...data.beforeTokens === undefined ? {} : { beforeTokens: data.beforeTokens },
      },
    });
    return seq;
  }
}

// ─── 工具函数 ───

/**
 * 消息 token 启发式估算（字符/4，与 TokenMeter 文本估算同口径）。
 * importTurns 用于累计 surface 锚点（无 provider usage 时的回退）。
 */
function estimateMessageTokens(message: Message): number {
  let total = 0;
  for (const b of message.content) {
    if (b.type === 'text') total += Math.ceil(b.text.length / 4);
    if (b.type === 'tool-result') total += Math.ceil(b.content.length / 4);
    if (b.type === 'tool-call') total += Math.ceil(b.arguments.length / 4);
    if (b.type === 'reasoning') total += Math.ceil(b.summary.length / 4);
  }
  return total;
}

/**
 * 将 ContentBlock[] 序列化为事件存储的 content 字符串。
 * 事件格式保持兼容（content 为字符串），块的细节在回放时由 replayer 重建为三层。
 */
function messageToEventContent(content: ContentBlock[]): string {
  const text = content
    .filter((b): b is Extract<ContentBlock, { type: 'text' }> => b.type === 'text')
    .map(b => b.text)
    .join('');
  if (text) return text;
  // 无 text 块（纯 tool-result / image / file）→ 输出 JSON 占位，回放按 role/source 恢复
  const toolResult = content.find(
    (b): b is Extract<ContentBlock, { type: 'tool-result' }> => b.type === 'tool-result',
  );
  if (toolResult) return toolResult.content;
  const image = content.find(
    (b): b is Extract<ContentBlock, { type: 'image' }> => b.type === 'image',
  );
  if (image) return image.attachment.url ?? '';
  const file = content.find(
    (b): b is Extract<ContentBlock, { type: 'file' }> => b.type === 'file',
  );
  if (file) return file.attachment.url ?? '';
  return '';
}
