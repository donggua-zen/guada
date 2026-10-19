/**
 * JsonlSessionContext 读取层直通测试
 *
 * 覆盖（读取层瘦身：getMessages/getHistory 直通 messageStore.loadContext，无会话层历史缓存）：
 * - getMessages 每次直通 store.loadContext，返回最新折叠视图（写即更新）
 * - provider 变换（KIMI 空 content / reasoning）在副本上执行，不污染 store 缓存对象
 * - getHistory 不含 prelude
 * - appendMessages 只写 store，后续读取直通新视图
 * - getTokenCount 用 provider 锚点 + 启发式增量（全量口径）
 * - addUserMessage 写侧注入块（消息伴随信息）：kb-ref 结构化引用 / sandbox 切换
 *   <system_reminder>（origin=system）/ 远程绑定变更（基准取上一条消息 metadata.sshBindings，
 *   随消息删除消失 → 重答后自动重新注入）；hidden 注入消息（kind=model）不污染基准检测
 */
import { JsonlSessionContext } from '../../src/modules/chat/jsonl-session-context';
import { turnApprovalMemory } from '../../src/common/services/turn-approval-memory';
import type { Message } from '../../src/common/types/conversation.types';

/// <reference types="jest" />

function makeSession(overrides: any = {}): any {
  return {
    id: 's1',
    sessionType: 'web',
    parentId: null,
    agentId: null,
    model: {
      modelName: 'test-model',
      name: 'Test',
      provider: { id: 'p1', provider: 'test', protocol: 'openai' },
      config: { contextWindow: 8000, features: ['tools'], inputCapabilities: [] },
    },
    settings: { systemPrompt: 'sys' },
    ...overrides,
  };
}

function makeMsg(id: string, role: 'user' | 'assistant' | 'tool' = 'user', extra: any = {}): Message {
  return {
    id,
    role,
    kind: role === 'assistant' ? 'model' : role === 'tool' ? 'model' : 'user',
    source:
      role === 'assistant'
        ? { kind: 'model', provider: 'test', model: 'test-model' }
        : role === 'tool'
          ? { kind: 'tool', toolCallId: `call_${id}` }
          : { kind: 'user' },
    metadata: {},
    content: [{ type: 'text', contentId: `${id}_c`, text: 'x' }],
    ...extra,
  };
}

function createContext(overrides: any = {}) {
  const messageStore = {
    loadContext: jest.fn(async () => [] as Message[]),
    appendMessages: jest.fn(async () => ({ added: [] as Message[], revision: 0 })),
    beginTurn: jest.fn(async () => ({ turnId: 't1', revision: 1 })),
    finalizeTurn: jest.fn(async () => 1),
    addUserMessage: jest.fn(async () => ({ messageId: 'u1', userMessage: {}, revision: 1 })),
    deleteTurn: jest.fn(async () => {}),
    appendCompact: jest.fn(async () => {}),
    getLastProcessedSeq: jest.fn(async () => 0),
    ...(overrides.messageStore || {}),
  };
  // 确定性 token 估算：每消息按 metadata._t 累加（0 缺省）
  const tokenMeter = {
    estimateMessages: jest.fn(async (_sid: string, _model: string, msgs: Message[]) =>
      (msgs as any[]).reduce((s, m) => s + (m.metadata?._t ?? 0), 0),
    ),
    estimatePerMessage: jest.fn(async (_sid: string, _model: string, msgs: Message[]) =>
      (msgs as any[]).map((m) => ({ id: m.id, tokens: m.metadata?._t ?? 0 })),
    ),
    estimateTextTokens: jest.fn(async () => 0),
    ...(overrides.tokenMeter || {}),
  };
  const streamManager = {
    publish: jest.fn(),
    ...(overrides.streamManager || {}),
  };
  const ctx = new JsonlSessionContext(
    makeSession(overrides.session),
    messageStore as any,
    { getSettingValue: jest.fn(async () => true) } as any, // 模型解析兜底（SK_MOD_CHAT）
    { findById: jest.fn() } as any,
    { resolvePlugins: jest.fn(async () => []) } as any,
    {
      collectPrompts: jest.fn(async () => []),
    } as any,
    { resolveSessionWorkspaceDir: jest.fn(async () => '') } as any,
    tokenMeter as any,
    streamManager as any,
    {
      // KnowledgeBaseService：默认空明细（按需在用例内覆盖 findByIds）
      findByIds: jest.fn(async () => []),
      ...(overrides.knowledgeBaseService || {}),
    } as any,
    {
      // RemoteBindingStateService：默认"快照 == live、无变更"（不注入 reminder）；
      // 用例按需覆盖 getSnapshotIds / buildChangeReminder 模拟状态机行为
      getSnapshotIds: jest.fn(async (_sid: string, live: string[]) => live),
      buildChangeReminder: jest.fn(async () => null),
      ...(overrides.bindingState || {}),
    } as any,
    // sessionMetaStore（可选）：这些用例不落库会话设置
    undefined,
    // answerSurfaceProbe（可选）：命令策略层"有人能应答审批"的探针
    overrides.answerSurfaceProbe,
  );
  return { ctx, messageStore, tokenMeter, streamManager };
}

describe('hasAnswerSurface（命令策略层 fail-closed 判据）', () => {
  it('web 会话 + 前端 SSE 在线 → true', () => {
    const { ctx } = createContext({ answerSurfaceProbe: () => true });
    expect(ctx.hasAnswerSurface()).toBe(true);
  });

  it('web 会话 + 前端离线且无进程内消费者 → false', () => {
    const { ctx } = createContext({ answerSurfaceProbe: () => false });
    expect(ctx.hasAnswerSurface()).toBe(false);
  });

  it('前端离线但进程内有订阅者（后台续跑）→ true', () => {
    const { ctx } = createContext({
      answerSurfaceProbe: () => false,
      streamManager: {
        getStreamStatus: () => ({
          isRunning: true,
          subscriberCount: 1,
          bufferedEventCount: 0,
        }),
      },
    });
    expect(ctx.hasAnswerSurface()).toBe(true);
  });

  it('bot / 子代理会话一律 false（即便前端在线）', () => {
    const bot = createContext({
      session: { sessionType: 'bot' },
      answerSurfaceProbe: () => true,
    });
    expect(bot.ctx.hasAnswerSurface()).toBe(false);

    const sub = createContext({
      session: { sessionType: 'sub_agent' },
      answerSurfaceProbe: () => true,
    });
    expect(sub.ctx.hasAnswerSurface()).toBe(false);
  });

  it('缺探针（旧构造路径）时退回进程内订阅者判定，不抛错', () => {
    const { ctx } = createContext({});
    expect(ctx.hasAnswerSurface()).toBe(false);
  });
});

describe('JsonlSessionContext 读取层直通', () => {
  it('beginTurn 清空该会话的"本轮内自动放行"状态（新回合恢复逐次询问）', async () => {
    const { ctx } = createContext();
    turnApprovalMemory.allowForTurn('s1');
    expect(turnApprovalMemory.isAllowed('s1')).toBe(true);

    await ctx.beginTurn();

    expect(turnApprovalMemory.isAllowed('s1')).toBe(false);
    turnApprovalMemory.clear();
  });

  it('publishStream 组装 prevSeq 续传游标并透传 streamManager.publish（唯一发布面）', async () => {
    const { ctx, streamManager } = createContext({
      messageStore: { getLastProcessedSeq: jest.fn(async () => 42) },
    });
    await ctx.initialize();

    await ctx.publishStream({
      type: 'text_delta',
      index: 0,
      text: 'hi',
      messageId: 'm1',
    } as any);

    expect(streamManager.publish).toHaveBeenCalledTimes(1);
    const [sessionId, event] = streamManager.publish.mock.calls[0];
    expect(sessionId).toBe('s1');
    // prevSeq 由发布点组装（"先入库后发事件"契约），引擎/深层模块无需感知游标
    expect(event).toMatchObject({ type: 'text_delta', messageId: 'm1', prevSeq: 42 });
  });

  it('快照缓存：revision 未变时复用视图（loadContext 只调一次）；写入后重建', async () => {
    const { ctx, messageStore } = createContext();
    await ctx.initialize();

    let seq = 0;
    (messageStore.getLastProcessedSeq as jest.Mock).mockImplementation(async () => seq);

    messageStore.loadContext.mockResolvedValue([
      makeMsg('u1', 'user'),
      makeMsg('a1', 'assistant'),
    ]);
    const first = await ctx.getHistory();
    // surface：纯历史（system 走 getSystemText，envelope 与历史分离）
    expect(first.map((m) => m.id)).toEqual(['u1', 'a1']);
    // envelope：system 文本独立可取
    expect(ctx.getSystemText()).toContain('sys');

    // 同一 revision：第二次读取命中快照，不重复 loadContext
    const second = await ctx.getHistory();
    expect(second.map((m) => m.id)).toEqual(['u1', 'a1']);
    expect(messageStore.loadContext).toHaveBeenCalledTimes(1);

    // revision 变化（外部写入，如 appendCompact）→ 快照失效重建，读到新视图
    seq = 5;
    messageStore.loadContext.mockResolvedValue([
      makeMsg('summary', 'user'),
      makeMsg('a2', 'assistant'),
    ]);
    const third = await ctx.getHistory();
    expect(third.map((m) => m.id)).toEqual(['summary', 'a2']);
    expect(messageStore.loadContext).toHaveBeenCalledTimes(2);
  });

  it('provider 变换（KIMI 空 content）在副本上执行，不污染 store 缓存对象', async () => {
    const { ctx, messageStore } = createContext();
    await ctx.initialize();

    const storeMsg: any = {
      id: 'a1',
      role: 'assistant',
      kind: 'model',
      source: { kind: 'model', provider: 'test', model: 'test-model' },
      metadata: {},
      content: [], // 空 content → KIMI 兼容
    };
    messageStore.loadContext.mockResolvedValueOnce([storeMsg]);
    const got = await ctx.getHistory();
    const assistant = got.find((m) => m.id === 'a1')!;
    expect(assistant.content.length).toBe(1);
    expect((assistant.content[0] as any).text).toBe('\n');
    // store 缓存对象未被污染
    expect(storeMsg.content.length).toBe(0);
  });

  it('getHistory 不含 prelude，与主请求历史一致', async () => {
    const { ctx, messageStore } = createContext();
    await ctx.initialize();

    messageStore.loadContext.mockResolvedValue([
      makeMsg('u1', 'user'),
      makeMsg('a1', 'assistant'),
    ]);
    const h = await ctx.getHistory();
    expect(h.map((m) => m.id)).toEqual(['u1', 'a1']);
  });

  it('appendMessages 增量更新快照：store 返回折叠节点，getHistory 即时反映', async () => {
    const { ctx, messageStore } = createContext();
    await ctx.initialize();

    messageStore.loadContext.mockResolvedValueOnce([]);
    expect(await ctx.getHistory()).toHaveLength(0);

    // store 返回 fold 后的权威节点 + 写入后版本号（S1' 契约）；版本号随写入推进
    let seq = 0;
    (messageStore.getLastProcessedSeq as jest.Mock).mockImplementation(async () => seq);
    const added = [makeMsg('a1', 'assistant')];
    (messageStore.appendMessages as jest.Mock).mockImplementationOnce(async () => {
      seq = 1;
      return { added, revision: seq };
    });
    await ctx.appendMessages(added);
    expect(messageStore.appendMessages).toHaveBeenCalledTimes(1);
    // 增量生效：不重读 store，直接反映新消息
    expect((await ctx.getHistory()).map((m) => m.id)).toEqual(['a1']);
    expect(messageStore.loadContext).toHaveBeenCalledTimes(1);
  });

  it('transformKey 变化（思考模式切换）→ 快照强制重建', async () => {
    const { ctx, messageStore } = createContext(); // 默认 features=['tools'] → 非思考
    await ctx.initialize();

    messageStore.loadContext.mockResolvedValue([makeMsg('a1', 'assistant')]);
    await ctx.getHistory();
    expect(messageStore.loadContext).toHaveBeenCalledTimes(1);

    // 切到思考模式：transformKey（nothink→think）变化，revision 未变也强制重建
    (ctx as any).thinkingEffortValue = 'medium';
    messageStore.loadContext.mockResolvedValue([makeMsg('a2', 'assistant')]);
    await ctx.getHistory();
    expect(messageStore.loadContext).toHaveBeenCalledTimes(2);
  });

  it('写侧原样保存 reasoning；非思考模式读取时剥离（不污染存储）', async () => {
    const { ctx, messageStore } = createContext(); // 默认 features=['tools'] → 非思考
    await ctx.initialize();

    const assistant = makeMsg('a1', 'assistant', {
      content: [
        { type: 'reasoning', contentId: 'r1', summary: '思考过程' },
        { type: 'text', contentId: 't1', text: '回答' },
      ],
    });
    // appendMessages 原样写入：store 收到含 reasoning 的完整消息
    await ctx.appendMessages([assistant]);
    const written = (messageStore.appendMessages.mock.calls[0] as any)[1] as any[];
    expect(written[0].content.some((b: any) => b.type === 'reasoning')).toBe(true);

    // 读取侧（非思考模式）剥离 reasoning
    messageStore.loadContext.mockResolvedValue([assistant]);
    const h = await ctx.getHistory();
    const got = h.find((m) => m.id === 'a1')!;
    expect(got.content.some((b) => b.type === 'reasoning')).toBe(false);
    expect(got.content.map((b) => b.type)).toEqual(['text']);
    // 存储对象未被污染（切换思考模式后数据仍完整）
    expect(assistant.content.some((b) => b.type === 'reasoning')).toBe(true);
  });

  it('思考模式读取时保留 reasoning 并补占位；切换模式不丢数据', async () => {
    const { ctx, messageStore } = createContext({
      session: {
        model: {
          ...makeSession().model,
          // 能力 = 档位菜单（非空即能思考），不再用 features 标记
          thinkingEfforts: ['none', 'low', 'medium', 'high'],
          config: { contextWindow: 8000, features: ['tools'], inputCapabilities: [] },
        },
        settings: { systemPrompt: 'sys', thinkingEffort: 'medium' },
      },
    });
    await ctx.initialize();

    const withReasoning = makeMsg('a1', 'assistant', {
      content: [
        { type: 'reasoning', contentId: 'r1', summary: '思考过程' },
        { type: 'text', contentId: 't1', text: '回答' },
      ],
    });
    const noReasoning = makeMsg('a2', 'assistant', {
      content: [{ type: 'text', contentId: 't2', text: '无思考' }],
    });
    messageStore.loadContext.mockResolvedValue([withReasoning, noReasoning]);
    const h = await ctx.getHistory();
    const a1 = h.find((m) => m.id === 'a1')!;
    const a2 = h.find((m) => m.id === 'a2')!;
    // 思考模式：保留真实 reasoning + 无 reasoning 的补占位
    expect(a1.content.some((b) => b.type === 'reasoning')).toBe(true);
    expect(a2.content.some((b) => b.type === 'reasoning')).toBe(true);
    // 存储对象未被污染（a2 原 content 仍只有 text）
    expect(noReasoning.content.some((b) => b.type === 'reasoning')).toBe(false);
  });

  it('getTokenCount 用 provider 锚点 + 启发式增量（全量口径）', async () => {
    const { ctx, messageStore } = createContext();
    await ctx.initialize();

    // 锚点消息：usage.promptTokens=1000（provider 真值），归属模型与当前一致
    const anchor = makeMsg('a1', 'assistant', {
      metadata: { _t: 200, usage: { promptTokens: 1000 }, modelName: 'test-model' },
    });
    messageStore.loadContext.mockResolvedValue([
      makeMsg('u1', 'user', { metadata: { _t: 100 } }),
      anchor,
      makeMsg('u2', 'user', { metadata: { _t: 100 } }),
    ]);
    // heuristicNow = prelude(0) + (100+200+100) = 400
    // heuristicAtAnchor = prelude(0) + (100+200) = 300
    // getTokenCount = 1000 + (400 - 300) = 1100
    expect(await ctx.getTokenCount()).toBe(1100);
  });

  it('无 provider 锚点时 getTokenCount 退化为纯启发式（当前视图全量）', async () => {
    const { ctx, messageStore } = createContext();
    await ctx.initialize();

    messageStore.loadContext.mockResolvedValue([
      makeMsg('u1', 'user', { metadata: { _t: 100 } }),
      makeMsg('u2', 'user', { metadata: { _t: 100 } }),
    ]);
    // 无 usage 锚点 → heuristicNow = prelude(0) + 200 = 200
    expect(await ctx.getTokenCount()).toBe(200);
  });
});

describe('JsonlSessionContext 上下文占用锚点', () => {
  it('finalizeTurn 注入回合后占用（usedTokens/effectiveContextWindow）', async () => {
    const { ctx, messageStore } = createContext();
    await ctx.initialize();
    await ctx.finalizeTurn('t1', 100, {
      usage: { promptTokens: 5, completionTokens: 3, totalTokens: 8 },
      finishReason: 'stop',
    } as any);
    const passed = (messageStore.finalizeTurn as jest.Mock).mock.calls[0][3];
    expect(typeof passed.usedTokens).toBe('number');
    expect(passed.effectiveContextWindow).toBe(8000);
  });

  it('appendCompact：快照就绪时写前模拟压缩后占用并透传 store（compaction/end 锚点）', async () => {
    const { ctx, messageStore } = createContext();
    messageStore.appendCompact.mockResolvedValue({
      summaryMessageId: 'c1',
      endSeq: 1,
      summaryNode: null,
    });
    await ctx.initialize();
    await ctx.getHistory(); // 触发快照构建
    await ctx.appendCompact({
      shadowedEndId: 'm1',
      shadowedCount: 1,
      summary: '检查点',
      summaryMessageId: 'c1',
      mode: 'memory_sync',
    } as any);
    const passed = (messageStore.appendCompact as jest.Mock).mock.calls[0][1];
    expect(passed).toMatchObject({ effectiveContextWindow: 8000 });
    expect(typeof passed.usedTokens).toBe('number');
  });

  it('recordContextAnchor：写独立 compaction/end 携带当前占用', async () => {
    const { ctx, messageStore } = createContext();
    messageStore.recordContextAnchor = jest.fn(async () => 5);
    await ctx.initialize();
    await ctx.recordContextAnchor();
    const [sid, data] = (messageStore.recordContextAnchor as jest.Mock).mock.calls[0];
    expect(sid).toBe('s1');
    expect(typeof data.usedTokens).toBe('number');
    expect(data.effectiveContextWindow).toBe(8000);
  });

  it('压缩锚点优先：compaction/end 的纠正值取代被抵消的 provider 增量', async () => {
    // 回归：裁剪/遮蔽改写了锚点**之前**的内容，usage 增量口径下两个启发式项同额下降 →
    // 压缩后占用恒定不变（实测会话真实裁掉 ~83K token 后 usedTokens 仍是 413162）。
    const { ctx, messageStore } = createContext({
      messageStore: {
        getOccupancyAnchor: jest.fn(async () => ({
          kind: 'compaction',
          usedTokens: 500,
          heuristicTokens: 300,
        })),
      },
    });
    await ctx.initialize();
    messageStore.loadContext.mockResolvedValue([
      makeMsg('u1', 'user', { metadata: { _t: 100 } }),
      makeMsg('a1', 'assistant', {
        metadata: { _t: 200, usage: { promptTokens: 1000 }, modelName: 'test-model' },
      }),
      makeMsg('u2', 'user', { metadata: { _t: 100 } }),
    ]);
    // heuristicNow = 400；压缩锚点 = 500 + (400 - 300) = 600（若走 usage 锚点会是 1100）
    expect(await ctx.getTokenCount()).toBe(600);
  });

  it('recordContextAnchor：扣减被 provider 锚点抵消的裁剪节省（锚点之后的节省不重复扣）', async () => {
    const { ctx, messageStore } = createContext();
    messageStore.recordContextAnchor = jest.fn(async () => 5);
    await ctx.initialize();
    messageStore.loadContext.mockResolvedValue([
      makeMsg('u1', 'user', { metadata: { _t: 100 } }),
      makeMsg('a1', 'assistant', {
        metadata: { _t: 200, usage: { promptTokens: 1000 }, modelName: 'test-model' },
      }),
      makeMsg('u2', 'user', { metadata: { _t: 100 } }),
    ]);
    // 当前口径 = 1000 + (400-300) = 1100；锚点 index=1 → 仅 index<=1 的节省被抵消
    await ctx.recordContextAnchor({
      beforeTokens: 1100,
      savings: [
        { index: 0, tokens: 50 }, // 锚点之前 → 显式扣减
        { index: 2, tokens: 70 }, // 锚点之后 → 增量已吸收，不再扣
      ],
    });
    const data = (messageStore.recordContextAnchor as jest.Mock).mock.calls[0][1];
    expect(data.usedTokens).toBe(1050);
    expect(data.heuristicTokens).toBe(400); // prelude(0) + 视图前缀和(400)
    expect(data.beforeTokens).toBe(1100);
  });

  it('新回合写入 usage 锚点后，压缩锚点自动让位（回到 provider 增量口径）', async () => {
    const getOccupancyAnchor = jest.fn(async () => ({
      kind: 'compaction',
      usedTokens: 500,
      heuristicTokens: 300,
    }));
    // 版本号随写入推进（revision 契约）：快照命中增量路径，锚点在 appendToSnapshot 内切换
    let seq = 0;
    const { ctx, messageStore } = createContext({
      messageStore: {
        getOccupancyAnchor,
        getLastProcessedSeq: jest.fn(async () => seq),
      },
    });
    await ctx.initialize();
    messageStore.loadContext.mockResolvedValue([
      makeMsg('u1', 'user', { metadata: { _t: 100 } }),
    ]);
    await ctx.getHistory(); // 建快照（当前为压缩锚点：500 + (100-300) = 300）
    expect(await ctx.getTokenCount()).toBe(300);

    // 增量追加带 usage 的助手消息 → 锚点切回 usage（该请求实测 promptTokens=700）
    const added = makeMsg('a2', 'assistant', {
      metadata: { _t: 50, usage: { promptTokens: 700 }, modelName: 'test-model' },
    });
    seq = 2;
    messageStore.appendMessages.mockResolvedValue({ added: [added], revision: 2 });
    await ctx.appendMessages([added]);
    // heuristicNow = 150，锚点即该消息本身 → heuristicAtAnchor = 150 → 700
    expect(await ctx.getTokenCount()).toBe(700);
  });
});

describe('JsonlSessionContext 压缩配置档位', () => {
  // 注意：压缩配置只取角色 settings.memory（buildEffectiveSettings 不合并会话级 memory）
  function sessionWithMemory(memory: any) {
    return { session: { agent: { settings: { memory } } } };
  }

  it('compressionTier 合法 → 折算为档位预设（enabled/trigger/retain/summaryMode）', async () => {
    const { ctx } = createContext(sessionWithMemory({ compressionTier: 'aggressive' }));
    await ctx.initialize();
    expect(ctx.getCompressionConfig()).toEqual({
      enabled: true,
      compressionTriggerRatio: 0.9,
      compressionRetainRatio: 0.2,
      summaryMode: 'fast',
    });
  });

  it('旧 summaryMode=disabled → OFF 档（enabled=false）；无配置 → 默认档（保守）', async () => {
    const legacy = createContext(sessionWithMemory({ summaryMode: 'disabled' }));
    await legacy.ctx.initialize();
    expect(legacy.ctx.getCompressionConfig()).toMatchObject({
      enabled: false,
      summaryMode: 'disabled',
    });

    const fallback = createContext();
    await fallback.ctx.initialize();
    expect(fallback.ctx.getCompressionConfig()).toMatchObject({
      enabled: true,
      compressionTriggerRatio: 0.9,
      compressionRetainRatio: 0.4,
      summaryMode: 'fast',
    });
  });
});

describe('JsonlSessionContext 写侧注入块（消息伴随信息）', () => {
  /** store mock 默认返回空 userMessage（无 content），快照增量管线需要合法消息体 */
  function makeStoreReturnValidUserMessage(messageStore: any) {
    messageStore.addUserMessage.mockImplementation(async () => ({
      messageId: 'u_new',
      userMessage: makeMsg('u_new', 'user'),
      revision: 1,
    }));
  }

  function storeOptions(messageStore: any): any {
    return (messageStore.addUserMessage as jest.Mock).mock.calls[0][3];
  }

  /**
   * 模拟 RemoteBindingStateService 的契约（文案/差异渲染由该服务自身的 spec 覆盖）：
   * 快照固定为 snapshotIds；before 与 after 不同才产出 reminder 块。
   */
  function fakeBindingState(snapshotIds: string[] = []) {
    return {
      getSnapshotIds: jest.fn(async (_sid: string, _live: string[]) => snapshotIds),
      buildChangeReminder: jest.fn(
        async (_sid: string, before: string[], after: string[]) => {
          const key = (ids: string[]) => [...ids].sort().join(',');
          if (key(before) === key(after)) return null;
          return {
            type: 'text',
            text: `<system_reminder>\n# Remote Workspace Bindings Changed\n- ${after.join(', ')}\n</system_reminder>`,
            origin: 'system',
          };
        },
      ),
    };
  }

  /** 会话带远程绑定（attachments['ssh-connection'] 即 live 绑定） */
  function sessionWithBindings(ids: string[]) {
    return {
      session: {
        settings: {
          systemPrompt: 'sys',
          attachments: { 'ssh-connection': ids },
        },
      },
    };
  }

  it('普通消息：无注入块，metadata 落 sandboxMode 基准', async () => {
    const { ctx, messageStore } = createContext();
    makeStoreReturnValidUserMessage(messageStore);
    await ctx.initialize();
    await ctx.addUserMessage('hi');

    const opts = storeOptions(messageStore);
    expect(opts.injectedBlocks).toBeUndefined();
    expect(opts.metadata.sandboxMode).toBe('workspace-write');
  });

  it('knowledgeBaseIds → 结构化 kb-ref 注入块（明细展开，缺失 id 静默跳过）', async () => {
    const { ctx, messageStore } = createContext({
      knowledgeBaseService: {
        findByIds: jest.fn(async (ids: string[]) =>
          ids
            .filter((id) => id !== 'missing')
            .map((id) => ({ id, name: `KB-${id}`, description: 'desc' })),
        ),
      },
    });
    makeStoreReturnValidUserMessage(messageStore);
    await ctx.initialize();
    await ctx.addUserMessage('查资料', [], {
      knowledgeBaseIds: ['kb1', 'missing', 'kb2'],
    });

    const opts = storeOptions(messageStore);
    expect(opts.injectedBlocks).toHaveLength(1);
    expect(opts.injectedBlocks[0]).toMatchObject({
      type: 'kb-ref',
      kbRefs: [
        { id: 'kb1', name: 'KB-kb1', description: 'desc' },
        { id: 'kb2', name: 'KB-kb2', description: 'desc' },
      ],
    });
  });

  it('sandbox 模式切换 → <system_reminder> 文本注入块（origin=system）+ 基准刷新', async () => {
    const { ctx, messageStore } = createContext();
    makeStoreReturnValidUserMessage(messageStore);
    await ctx.initialize();
    // 视图最后一条真实 user 消息为 read-only，当前 sandboxMode=workspace-write（默认）→ 退出叙事
    messageStore.loadContext.mockResolvedValue([
      makeMsg('u1', 'user', { metadata: { sandboxMode: 'read-only' } }),
    ]);
    await ctx.addUserMessage('继续');

    const opts = storeOptions(messageStore);
    expect(opts.injectedBlocks).toHaveLength(1);
    const block = opts.injectedBlocks[0];
    expect(block.type).toBe('text');
    expect(block.origin).toBe('system');
    expect(block.text).toContain('<system_reminder>');
    expect(block.text).toContain('read-only');
    // 基准刷新：本条消息落库为当前模式，下次检测以它为 prevMode
    expect(opts.metadata.sandboxMode).toBe('workspace-write');
  });

  it('hidden 注入消息（kind=model）不污染 prevMode 检测', async () => {
    const { ctx, messageStore } = createContext();
    makeStoreReturnValidUserMessage(messageStore);
    await ctx.initialize();
    // 真实 user 为 read-only，其后是图片注入等 hidden user 消息（kind=model、无 sandboxMode）
    messageStore.loadContext.mockResolvedValue([
      makeMsg('u1', 'user', { metadata: { sandboxMode: 'read-only' } }),
      makeMsg('inject1', 'user', { kind: 'model', metadata: {} }),
    ]);
    // 当前模式同为 read-only：若无 kind!=='model' 过滤，hidden 消息的空 sandboxMode
    // 会把 prevMode 回退为 workspace-write → 误触发"退出 read-only"叙事
    (ctx as any).sandboxMode = 'read-only';
    await ctx.addUserMessage('继续');

    const opts = storeOptions(messageStore);
    expect(opts.injectedBlocks).toBeUndefined();
    expect(opts.metadata.sandboxMode).toBe('read-only');
  });

  it('远程绑定变更 → <system_reminder> 注入块，metadata 落 sshBindings 基准', async () => {
    const bindingState = fakeBindingState([]); // 系统提示词快照为空
    const { ctx, messageStore } = createContext({
      bindingState,
      ...sessionWithBindings(['c1']),
    });
    makeStoreReturnValidUserMessage(messageStore);
    await ctx.initialize();
    // 上一条消息未记录绑定（旧会话/升级后首轮）→ 基准回退快照 []，与 live [c1] 不同 → 注入
    messageStore.loadContext.mockResolvedValue([makeMsg('u1', 'user')]);
    await ctx.addUserMessage('连上 nas');

    const opts = storeOptions(messageStore);
    expect(opts.injectedBlocks).toHaveLength(1);
    expect(opts.injectedBlocks[0].origin).toBe('system');
    expect(opts.injectedBlocks[0].text).toContain('Remote Workspace Bindings Changed');
    // 基准随消息落库：下一条消息据此比对
    expect(opts.metadata.sshBindings).toEqual(['c1']);
  });

  it('绑定未变化（上一条消息已记录同一组 id）→ 不注入', async () => {
    const bindingState = fakeBindingState([]);
    const { ctx, messageStore } = createContext({
      bindingState,
      ...sessionWithBindings(['c1']),
    });
    makeStoreReturnValidUserMessage(messageStore);
    await ctx.initialize();
    messageStore.loadContext.mockResolvedValue([
      makeMsg('u1', 'user', { metadata: { sshBindings: ['c1'] } }),
    ]);
    await ctx.addUserMessage('继续');

    const opts = storeOptions(messageStore);
    expect(opts.injectedBlocks).toBeUndefined();
    expect(opts.metadata.sshBindings).toEqual(['c1']);
  });

  it('重答等价：携带基准的消息被删除 → 基准回退到更早消息并重新注入', async () => {
    const bindingState = fakeBindingState([]);
    const { ctx, messageStore } = createContext({
      bindingState,
      ...sessionWithBindings(['c1', 'c2']),
    });
    makeStoreReturnValidUserMessage(messageStore);
    await ctx.initialize();
    // 记录 [c1,c2] 的那条消息所属回合已被 turn/delete 抹掉，只剩记录 [c1] 的更早消息
    messageStore.loadContext.mockResolvedValue([
      makeMsg('u1', 'user', { metadata: { sshBindings: ['c1'] } }),
    ]);
    await ctx.addUserMessage('重答');

    const opts = storeOptions(messageStore);
    expect(opts.injectedBlocks).toHaveLength(1);
    expect(opts.injectedBlocks[0].text).toContain('Remote Workspace Bindings Changed');
    expect(opts.metadata.sshBindings).toEqual(['c1', 'c2']);
  });

  it('hidden 注入消息（kind=model）不污染绑定基准检测', async () => {
    const bindingState = fakeBindingState([]);
    const { ctx, messageStore } = createContext({
      bindingState,
      ...sessionWithBindings(['c1']),
    });
    makeStoreReturnValidUserMessage(messageStore);
    await ctx.initialize();
    // 真实 user 已记录 [c1]（无变化），其后是图片注入等 hidden 消息（无 sshBindings）
    messageStore.loadContext.mockResolvedValue([
      makeMsg('u1', 'user', { metadata: { sshBindings: ['c1'] } }),
      makeMsg('inject1', 'user', { kind: 'model', metadata: {} }),
    ]);
    await ctx.addUserMessage('继续');

    const opts = storeOptions(messageStore);
    expect(opts.injectedBlocks).toBeUndefined();
  });

  it('外部命令注入块（TagParserPipeline 产物）追加在内部注入块之后（background first, material last）', async () => {
    const { ctx, messageStore } = createContext({
      knowledgeBaseService: {
        findByIds: jest.fn(async (ids: string[]) =>
          ids.map((id) => ({ id, name: `KB-${id}` })),
        ),
      },
    });
    makeStoreReturnValidUserMessage(messageStore);
    await ctx.initialize();
    // 模拟 sandbox 切换叙事 + kb-ref + 外部命令注入块同时存在
    messageStore.loadContext.mockResolvedValue([
      makeMsg('u1', 'user', { metadata: { sandboxMode: 'read-only' } }),
    ]);
    await ctx.addUserMessage('用技能查资料', [], {
      knowledgeBaseIds: ['kb1'],
      injectedBlocks: [
        { type: 'text', text: '<skill_content name="coder">…</skill_content>', origin: 'system' },
      ],
    });

    const opts = storeOptions(messageStore);
    expect(opts.injectedBlocks).toHaveLength(3);
    // 顺序：modeNarration（背景）→ kb-ref（背景）→ 命令注入块（材料，最贴近作答位置）
    expect(opts.injectedBlocks[0].text).toContain('<system_reminder>');
    expect(opts.injectedBlocks[1]).toMatchObject({ type: 'kb-ref' });
    expect(opts.injectedBlocks[2]).toMatchObject({
      type: 'text',
      origin: 'system',
      text: '<skill_content name="coder">…</skill_content>',
    });
  });
});

describe('计划模式周期与退出标记', () => {
  function makeStoreReturnValidUserMessage(messageStore: any) {
    messageStore.addUserMessage.mockImplementation(async () => ({
      messageId: 'u_new',
      userMessage: makeMsg('u_new', 'user'),
      revision: 1,
    }));
  }

  it('initialize：planEnabled 且缺 epoch 时生成周期标识', async () => {
    const { ctx } = createContext({
      session: { settings: { systemPrompt: 'sys', planEnabled: true } },
    });
    await ctx.initialize();
    expect(ctx.getPlanEnabled()).toBe(true);
    expect(ctx.getPlanModeEpoch()).toMatch(/^plan-/);
  });

  it('setPlanEnabled(true) 生成新 epoch；false 保留该 epoch 供退出说明使用', async () => {
    const { ctx } = createContext({
      session: { settings: { systemPrompt: 'sys', planEnabled: false } },
    });
    await ctx.initialize();
    expect(ctx.getPlanModeEpoch()).toBeNull();

    await ctx.setPlanEnabled(true);
    const epoch = ctx.getPlanModeEpoch();
    expect(epoch).toMatch(/^plan-/);

    await ctx.setPlanEnabled(false);
    expect(ctx.getPlanModeEpoch()).toBe(epoch);
  });

  it('退出后的下一条用户消息：持久化 exit 标记 + 覆盖旧指令的叙事', async () => {
    const prevUser = makeMsg('u-prev', 'user', {
      metadata: {
        planEnabled: true,
        sandboxMode: 'workspace-write',
        sshBindings: [],
      },
    });
    const { ctx, messageStore } = createContext({
      session: { settings: { systemPrompt: 'sys', planEnabled: true } },
      messageStore: { loadContext: jest.fn(async () => [prevUser]) },
    });
    makeStoreReturnValidUserMessage(messageStore);
    await ctx.initialize();
    const epoch = ctx.getPlanModeEpoch();

    await ctx.setPlanEnabled(false);
    await ctx.addUserMessage('继续');

    const opts = (messageStore.addUserMessage as jest.Mock).mock.calls[0][3];
    expect(opts.metadata.planEnabled).toBe(false);
    expect(opts.metadata.planModeReminder).toBe('exit');
    expect(opts.metadata.planModeEpoch).toBe(epoch);
    expect(opts.injectedBlocks?.[0]?.text).toContain('disabled plan mode');
    expect(opts.injectedBlocks?.[0]?.text).toContain('no longer apply');
  });
});
