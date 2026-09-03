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
 *   <system_reminder>（origin=system）；hidden 注入消息（kind=model）不污染 prevMode
 */
import { JsonlSessionContext } from '../../src/modules/chat/jsonl-session-context';
import type { Message } from '../../src/common/types/conversation.types';

/// <reference types="jest" />

function makeSession(overrides: any = {}): any {
  return {
    id: 's1',
    userId: 'u1',
    sessionType: 'web',
    parentId: null,
    characterId: null,
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
    { getSettingValue: jest.fn(async () => true) } as any, // summaryMode → enabled
    { findById: jest.fn() } as any,
    { resolvePlugins: jest.fn(async () => []) } as any,
    {
      collectPrompts: jest.fn(async () => []),
      collectUserPrompts: jest.fn(async () => []),
    } as any,
    { resolveSessionWorkspaceDir: jest.fn(async () => '') } as any,
    tokenMeter as any,
    streamManager as any,
    {
      // KnowledgeBaseService：默认空明细（按需在用例内覆盖 findByIds）
      findByIds: jest.fn(async () => []),
      ...(overrides.knowledgeBaseService || {}),
    } as any,
  );
  return { ctx, messageStore, tokenMeter, streamManager };
}

describe('JsonlSessionContext 读取层直通', () => {
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
          config: { contextWindow: 8000, features: ['tools', 'thinking'], inputCapabilities: [] },
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
});
