/**
 * JsonlSessionContext 读取层直通测试
 *
 * 覆盖（读取层瘦身：getMessages/getHistory 直通 messageStore.loadContext，无会话层历史缓存）：
 * - getMessages 每次直通 store.loadContext，返回最新折叠视图（写即更新）
 * - provider 变换（KIMI 空 content / reasoning）在副本上执行，不污染 store 缓存对象
 * - getHistory 不含 prelude
 * - appendMessages 只写 store，后续读取直通新视图
 * - getTokenCount 用 provider 锚点 + 启发式增量（全量口径）
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
    appendMessages: jest.fn(async () => {}),
    beginTurn: jest.fn(async () => 't1'),
    finalizeTurn: jest.fn(async () => {}),
    addUserMessage: jest.fn(async () => ({ messageId: 'u1', userMessage: {} })),
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
    estimateTextTokens: jest.fn(async () => 0),
    invalidate: jest.fn(),
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

  it('getMessages 每次直通 store.loadContext，返回最新折叠视图（无会话层缓存）', async () => {
    const { ctx, messageStore } = createContext();
    await ctx.initialize();

    messageStore.loadContext.mockResolvedValueOnce([
      makeMsg('u1', 'user'),
      makeMsg('a1', 'assistant'),
    ]);
    const first = await ctx.getMessages();
    // prelude system 在前 + 视图消息
    expect(first.map((m) => m.id)).toEqual(['system', 'u1', 'a1']);

    // 模拟 store 状态变化（如 appendCompact 后视图变化）：第二次读到新视图
    messageStore.loadContext.mockResolvedValueOnce([
      makeMsg('summary', 'user'),
      makeMsg('a2', 'assistant'),
    ]);
    const second = await ctx.getMessages();
    expect(second.map((m) => m.id)).toEqual(['system', 'summary', 'a2']);
    // 每次都直通，无会话层缓存
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
    const got = await ctx.getMessages();
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

  it('appendMessages 只写 store，后续 getMessages 直通新视图', async () => {
    const { ctx, messageStore } = createContext();
    await ctx.initialize();

    messageStore.loadContext.mockResolvedValueOnce([]);
    expect(await ctx.getHistory()).toHaveLength(0);

    // append 落库后视图变化（store applyToCache 增量折叠）
    messageStore.loadContext.mockResolvedValueOnce([makeMsg('a1', 'assistant')]);
    await ctx.appendMessages([makeMsg('a1', 'assistant')]);
    expect(messageStore.appendMessages).toHaveBeenCalledTimes(1);
    expect((await ctx.getHistory()).map((m) => m.id)).toEqual(['a1']);
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
