/**
 * CompressionEngine 单元测试
 *
 * 覆盖（对齐 deepseek-harness compaction 语义，消息级遮蔽）：
 * - 触发判断（triggerRatio）与 force 强制路径
 * - 一级裁剪（prune）只裁剪超长 tool-result、保护最近 N 条（就地改写消息）
 * - 二级摘要（compact）：messages 前缀 token 预算保留 + tool-pairing 平衡 + 收敛校验
 * - onBeforeCompaction 仅在确认需二级压缩后触发（不因一级裁剪空跑）
 * - DISABLED 模式：不生成摘要，仅遮蔽
 * - v1.4：遮蔽写为分界点 id（shadowedEndId + shadowedCount），不再离散 id 清单；
 *   写经 dataSource 窄接口（引擎不读 store）
 * - 4a：一级裁剪后二级摘要输入中被裁剪消息还原原文（前缀缓存命中）
 */
import { CompressionEngine, SummaryMode } from '../../src/modules/chat/compaction/compression-engine';
import { toolPairingBalancedBefore } from '../../src/modules/chat/compaction/tool-pairing';
import type { Turn, Message, ContentBlock } from '../../src/common/types/conversation.types';

/// <reference types="jest" />

/** 构造一个回合（user + assistant + 可选 tool-result）——仅用于 TokenMeter.estimateTurns 测试 */
function makeTurn(
  id: string,
  opts: { toolResultLen?: number; unpairedToolCall?: boolean } = {},
): Turn {
  const messages: Message[] = [
    {
      id: `${id}_u`,
      role: 'user',
      kind: 'user',
      source: { kind: 'user' },
      metadata: {},
      content: [{ type: 'text', contentId: `${id}_u_c`, text: `user ${id}` }],
    },
    {
      id: `${id}_a`,
      role: 'assistant',
      kind: 'model',
      source: { kind: 'model', provider: 'test', model: 'm' },
      metadata: {},
      content: [{ type: 'text', contentId: `${id}_a_c`, text: `answer ${id}` }],
    },
  ];
  if (opts.toolResultLen) {
    messages.push({
      id: `${id}_t`,
      role: 'tool',
      kind: 'model',
      source: { kind: 'tool', toolCallId: `call_${id}` },
      metadata: {},
      content: [
        {
          type: 'tool-result',
          contentId: `${id}_t_c`,
          toolCallId: `call_${id}`,
          name: 'shell',
          content: 'x'.repeat(opts.toolResultLen),
        },
      ],
    });
  }
  if (opts.unpairedToolCall) {
    messages.push({
      id: `${id}_a2`,
      role: 'assistant',
      kind: 'model',
      source: { kind: 'model', provider: 'test', model: 'm' },
      metadata: {},
      content: [
        {
          type: 'tool-call',
          contentId: `${id}_a2_c`,
          toolCallId: `call_${id}_x`,
          name: 'shell',
          arguments: '{}',
        },
      ],
    });
  }
  return { id, kind: 'turn', metadata: {}, messages, visible: true };
}

/** 构造扁平请求消息（user / assistant 交替，与 context.history 同构） */
function makeMessages(count: number): Message[] {
  const out: Message[] = [];
  for (let i = 0; i < count; i++) {
    const role = i % 2 === 0 ? 'user' : 'assistant';
    out.push({
      id: `m${i}`,
      role,
      kind: role === 'user' ? 'user' : 'model',
      source:
        role === 'user'
          ? { kind: 'user' }
          : { kind: 'model', provider: 'test', model: 'm' },
      metadata: {},
      content: [
        { type: 'text', contentId: `c${i}`, text: `${role} ${i}` },
      ],
    });
  }
  return out;
}

/** 确定性 token 估算：每消息按 text 长度 / 4 */
function estimateTokensFor(messages: Message[]): number {
  let total = 0;
  for (const m of messages) {
    for (const b of m.content) {
      if (b.type === 'text') total += Math.ceil(b.text.length / 4);
      if (b.type === 'tool-result') total += Math.ceil(b.content.length / 4);
      if (b.type === 'tool-call') total += Math.ceil(b.arguments.length / 4);
    }
  }
  return total;
}

/** 构建引擎（注入 mock tokenMeter；引擎全数据输入，不读 store） */
function createEngine() {
  const tokenMeter = {
    estimateMessages: async (_sid: string, _model: string, messages: Message[]) =>
      estimateTokensFor(messages),
    estimateTextTokens: async (_model: string, text: string) =>
      Math.ceil(text.length / 4),
  } as any;
  return new CompressionEngine(tokenMeter);
}

/** 构建压缩写数据源 mock（appendPrune/appendCompact 捕获载荷；引擎写只经此） */
function createDataSource(overrides: { compacted?: any[]; pruned?: any[] } = {}) {
  const compacted = overrides.compacted ?? [];
  const pruned = overrides.pruned ?? [];
  const ds = {
    appendPrune: jest.fn(async (data: any) => {
      pruned.push(data);
    }),
    appendCompact: jest.fn(async (data: any) => {
      compacted.push(data);
      return { summaryMessageId: `m_sum_${compacted.length}`, endSeq: 0, summaryNode: null };
    }),
  };
  return { ds, compacted, pruned };
}

describe('CompressionEngine', () => {
  const messages = makeMessages(4);

  describe('触发判断', () => {
    it('未达 triggerRatio 时不压缩', async () => {
      const { ds } = createDataSource();
      const engine = createEngine();
      const result = await engine.execute('s1', {
        messages,
        contextWindow: 100000,
        dataSource: ds as any,
      });
      expect(result.compacted).toBe(false);
      expect(result.pruneEvents).toBe(0);
      expect(result.shadowedCount).toBe(0);
    });

    it('requestTokens 全量口径：历史低于阈值但完整请求超阈值时仍触发压缩', async () => {
      const { ds, compacted } = createDataSource();
      const engine = createEngine();
      const provider = { generate: jest.fn(async () => ({ summary: 's' })) };
      // 40 条消息 ≈ 100 tokens；window=200，纯历史 100/200=0.5 < 0.8（无 requestTokens 会跳过）
      // requestTokens=170 → envelopeDelta=70 → 全量 170/200=0.85 >= 0.8 → 触发压缩
      const history = makeMessages(40);
      const historyTokens = estimateTokensFor(history);
      expect(historyTokens / 200).toBeLessThan(0.8);
      const result = await engine.execute('s1', {
        messages: history,
        requestTokens: 170,
        contextWindow: 200,
        summaryProvider: provider as any,
        dataSource: ds as any,
      });
      expect(result.compacted).toBe(true);
      expect(provider.generate).toHaveBeenCalled();
      expect(ds.appendCompact).toHaveBeenCalled();
      expect(compacted.length).toBe(1);
    });

    it('force=true 时跳过 triggerRatio 阈值判断', async () => {
      const { ds, compacted } = createDataSource();
      const engine = createEngine();
      const provider = { generate: jest.fn(async () => ({ summary: 'summary' })) };
      // 20 条消息 ≈ 50 tokens，window=80 → ratio≈0.63 < 0.8（正常路径跳过）；
      // force 绕过阈值 → 保留预算 = 0.2×80=16 → 遮蔽头部消息并生成摘要
      const big = makeMessages(20);
      const bigTokens = estimateTokensFor(big);
      expect(bigTokens / 80).toBeLessThan(0.8);
      const result = await engine.execute('s1', {
        messages: big,
        contextWindow: 80,
        force: true,
        summaryProvider: provider,
        dataSource: ds as any,
      });
      expect(result.compacted).toBe(true);
      expect(provider.generate).toHaveBeenCalled();
      expect(compacted.length).toBe(1);
      // v1.4：遮蔽写为区间 + 条数（不再离散 id 清单）
      expect(compacted[0].shadowedCount).toBeGreaterThan(0);
      expect(compacted[0].shadowedEndId).toBeDefined();
    });

    it('force=true 时 retain 仍按配置比例保留尾（不归零压到保护区地板）', async () => {
      const { ds, compacted } = createDataSource();
      const engine = createEngine();
      const provider = { generate: jest.fn(async () => ({ summary: 'summary' })) };
      // 20 条消息 ≈ 50 tokens，window=80 → retain=0.2×80=16 tokens → 保留尾 ~6 条、遮蔽 ~14 条，
      // 远大于 MIN_RETAINED_MESSAGES=3 地板（旧 force 行为会把整个会话压到只剩 3~4 条）
      const big = makeMessages(20);
      const result = await engine.execute('s1', {
        messages: big,
        contextWindow: 80,
        force: true,
        summaryProvider: provider,
        dataSource: ds as any,
      });
      expect(result.compacted).toBe(true);
      const retained = big.length - (result.shadowedCount ?? 0);
      expect(retained).toBeGreaterThan(3);
      expect(compacted[0].shadowedCount).toBe(result.shadowedCount);
    });
  });

  describe('一级裁剪（prune）', () => {
    it('只裁剪超长 tool-result，保护最近 3 条，不改写原消息', async () => {
      // 4 条 tool 消息（5000 字符超长），保护最近 3 条 → 只裁剪最早 1 条
      const longMessages = Array.from({ length: 4 }, (_, i) => ({
        id: `t${i + 1}_t`,
        role: 'tool' as const,
        kind: 'model' as const,
        source: { kind: 'tool' as const, toolCallId: `call_${i + 1}` },
        metadata: {},
        content: [{
          type: 'tool-result' as const,
          contentId: `tr${i + 1}`,
          toolCallId: `call_${i + 1}`,
          name: 'shell',
          content: 'x'.repeat(5000),
        }],
      }));
      const { ds, pruned } = createDataSource();
      const engine = createEngine();
      const result = await engine.execute('s1', {
        messages: longMessages,
        contextWindow: 10,
        summaryMode: SummaryMode.FAST,
        dataSource: ds as any,
      });
      expect(result.pruneEvents).toBe(1);
      expect(pruned.length).toBe(1);
      expect(pruned[0].messageId).toBe('t1_t');
      expect(pruned[0].newContent).toContain('[omitted');
      expect(pruned[0].prunedTokens).toBeGreaterThan(0);
      // 不修改原消息：输入数组保持原文（无就地改写）
      const firstTr = longMessages[0].content[0] as Extract<ContentBlock, { type: 'tool-result' }>;
      expect(firstTr.content).not.toContain('[omitted');
      expect(firstTr.content.length).toBe(5000);
    });
  });

  describe('二级摘要（compact）', () => {
    it('调用 summaryProvider 并写入 appendCompact（含实际 summaryMode + 区间）', async () => {
      const { ds, compacted } = createDataSource();
      const engine = createEngine();
      const provider = { generate: jest.fn(async () => ({ summary: '检查点摘要内容' })) };
      // window=8 → targetTokens=4 → 保留预算仅覆盖 1 条尾部消息，其余遮蔽
      const result = await engine.execute('s1', {
        messages,
        contextWindow: 8,
        summaryProvider: provider,
        summaryMode: SummaryMode.MEMORY_SYNC,
        dataSource: ds as any,
      });
      expect(result.compacted).toBe(true);
      expect(result.shadowedCount).toBeGreaterThan(0);
      expect(result.shadowedEndId).toBeDefined();
      expect(provider.generate).toHaveBeenCalled();
      expect(compacted.length).toBe(1);
      expect(compacted[0].mode).toBe('memory_sync');
      expect(compacted[0].summary).toBe('检查点摘要内容');
      // v1.4：遮蔽写为区间 + 条数（不再离散 id 清单）
      expect(compacted[0].shadowedCount).toBeGreaterThan(0);

      // SummaryInput：遮蔽区（shadowed）传给 provider；区间由引擎持有（写 appendCompact 用）
      const genInput = (provider.generate as jest.Mock).mock.calls[0][0];
      expect(genInput.shadowed[0].id).toBe('m0');
    });

    it('onBeforeCompaction 仅在确认需二级压缩后触发', async () => {
      const { ds } = createDataSource();
      const engine = createEngine();
      const onBefore = jest.fn(async () => {});
      await engine.execute('s1', {
        messages,
        contextWindow: 8,
        summaryProvider: { generate: async () => ({ summary: 'sum' }) },
        summaryMode: SummaryMode.MEMORY_SYNC,
        onBeforeCompaction: onBefore,
        dataSource: ds as any,
      });
      expect(onBefore).toHaveBeenCalledTimes(1);
    });

    it('无 summaryProvider 且非 DISABLED 时不触发 onBeforeCompaction（一级裁剪空跑保护）', async () => {
      const { ds } = createDataSource();
      const engine = createEngine();
      const onBefore = jest.fn(async () => {});
      const result = await engine.execute('s1', {
        messages,
        contextWindow: 10,
        summaryMode: SummaryMode.FAST, // 无 provider → 不生成摘要
        onBeforeCompaction: onBefore,
        dataSource: ds as any,
      });
      expect(result.compacted).toBe(false);
      expect(onBefore).not.toHaveBeenCalled();
    });

    it('DISABLED 模式：不生成摘要，直接遮蔽并写空摘要 compaction', async () => {
      const { ds, compacted } = createDataSource();
      const engine = createEngine();
      const result = await engine.execute('s1', {
        messages,
        contextWindow: 8,
        summaryMode: SummaryMode.DISABLED,
        dataSource: ds as any,
      });
      expect(result.compacted).toBe(true);
      expect(result.shadowedCount).toBeGreaterThan(0);
      expect(compacted.length).toBe(1);
      expect(compacted[0].summary).toBe('');
      expect(compacted[0].mode).toBe('disabled');
    });

    it('收敛校验：摘要不小于被遮蔽内容时重试', async () => {
      const { ds } = createDataSource();
      const engine = createEngine();
      // 第一次返回超长摘要（> 被遮蔽内容），第二次返回短摘要
      const provider = {
        generate: jest
          .fn()
          .mockResolvedValueOnce({ summary: 'y'.repeat(5000) })
          .mockResolvedValueOnce({ summary: '短摘要' }),
      };
      await engine.execute('s1', {
        messages,
        contextWindow: 8,
        summaryProvider: provider,
        compactionRetries: 2,
        dataSource: ds as any,
      });
      expect(provider.generate).toHaveBeenCalledTimes(2);
    });

    it('压缩路径：遮蔽区不裁剪，摘要输入为原消息（前缀命中）', async () => {
      // 4 条头部超长 tool（5000 字符 > 1000）+ 4 条普通消息；window=4000 → 压缩触发，
      // 遮蔽区 = [0, boundary)。超长 t0 落在遮蔽区 → 压缩路径不裁剪它（prune 只作用于保留尾）。
      const toolMsgs: Message[] = Array.from({ length: 4 }, (_, i) => ({
        id: `t${i}_t`,
        role: 'tool' as const,
        kind: 'model' as const,
        source: { kind: 'tool' as const, toolCallId: `call_${i}` },
        metadata: {},
        content: [{
          type: 'tool-result' as const,
          contentId: `tr${i}`,
          toolCallId: `call_${i}`,
          name: 'shell',
          content: 'x'.repeat(5000),
        }],
      }));
      const msgs = [...toolMsgs, ...makeMessages(4)];
      const { ds, pruned, compacted } = createDataSource();
      const engine = createEngine();
      const provider = { generate: jest.fn(async () => ({ summary: 's' })) };
      await engine.execute('s1', {
        messages: msgs,
        contextWindow: 4000,
        summaryProvider: provider,
        dataSource: ds as any,
      });
      expect(provider.generate).toHaveBeenCalled(); // 二级触发
      expect(compacted.length).toBe(1);
      // 遮蔽区（含超长 t0）不裁剪：prune 只作用于保留尾 [boundary..n)，t0 在遮蔽区 → 无 prune 写入
      expect(pruned.length).toBe(0);
      // 摘要输入 = 原消息（t0 为 5000 字符原文，未写入任何 prune）→ 与上次主请求一致 → 前缀命中
      const genInput = (provider.generate as jest.Mock).mock.calls[0][0];
      const toolInSummary = genInput.shadowed.find((m: any) => m.id === 't0_t');
      expect(toolInSummary).toBeDefined();
      const tr = toolInSummary.content.find((b: any) => b.type === 'tool-result');
      expect(tr.content.length).toBe(5000);
      expect(tr.content).not.toContain('[omitted');
    });
  });
});


describe('toolPairingBalancedBefore（消息级）', () => {
  function assistantWithToolCall(id: string): Message {
    return {
      id,
      role: 'assistant',
      kind: 'model',
      source: { kind: 'model', provider: 'test', model: 'm' },
      metadata: {},
      content: [
        {
          type: 'tool-call',
          contentId: `${id}_c`,
          toolCallId: `call_${id}`,
          name: 'shell',
          arguments: '{}',
        },
      ],
    };
  }
  function toolResult(id: string, callId: string): Message {
    return {
      id,
      role: 'tool',
      kind: 'model',
      source: { kind: 'tool', toolCallId: callId },
      metadata: {},
      content: [
        {
          type: 'tool-result',
          contentId: `${id}_c`,
          toolCallId: callId,
          name: 'shell',
          content: 'result',
        },
      ],
    };
  }

  it('未配对的 tool-call 消息不被单独遮蔽（切点前移，配对整体保留）', () => {
    // [tool-call(未配对), user, user]：边界 1 只遮蔽 tool-call → 前移到 0
    const msgs = [
      assistantWithToolCall('call'),
      makeMessages(1)[0],
      makeMessages(1)[0],
    ];
    expect(toolPairingBalancedBefore(msgs, 1)).toBe(0);
  });

  it('tool-call + tool-result 配对完整（都在遮蔽区）时不前移', () => {
    // [call, result, user]：边界 3 遮蔽 call+result（配对完整）→ 保持 3
    const msgs = [
      assistantWithToolCall('call'),
      toolResult('result', 'call_call'),
      makeMessages(1)[0],
    ];
    expect(toolPairingBalancedBefore(msgs, 3)).toBe(3);
  });

  it('切点前是普通消息不影响边界', () => {
    const msgs = makeMessages(3);
    expect(toolPairingBalancedBefore(msgs, 1)).toBe(1);
  });
});

describe('LLMSummaryProvider', () => {
  /** 构造流式 mock：text_delta + finish（对齐 BlockAssembler 输入） */
  function streamMock(text: string): AsyncGenerator<any> {
    return (async function* () {
      yield { type: 'block_start', blockType: 'text', contentId: 'b1' };
      yield { type: 'text_delta', contentId: 'b1', text };
      yield { type: 'block_end', blockType: 'text', contentId: 'b1', block: { type: 'text', contentId: 'b1', text } };
      yield { type: 'usage', usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 } };
      yield { type: 'finish', finishReason: 'stop' };
    })();
  }

  it('回退模式（无 prefix）：提取旧检查点 + 单条指令消息', async () => {
    const { LLMSummaryProvider } = await import('../../src/modules/chat/compaction/llm-summary.provider');
    const llmService = {
      completions: jest.fn(async () => streamMock('new checkpoint')),
    } as any;
    const provider = new LLMSummaryProvider(llmService, {
      modelName: 'gpt-4o',
      provider: { provider: 'openai' },
    });
    const oldCheckpoint: Message = {
      id: 'evt_1',
      role: 'user',
      kind: 'model',
      source: { kind: 'plugin', plugin: 'compact' },
      metadata: { compactInfo: { summary: '旧检查点' } },
      content: [],
    };
    const msg = makeMessages(1)[0];
    const result = await provider.generate({
      allMessages: [oldCheckpoint],
      shadowed: [msg],
    });
    expect(result.summary).toBe('new checkpoint');
    expect(result.usage?.totalTokens).toBe(15);
    const call = llmService.completions.mock.calls[0][0];
    expect(call.stream).toBe(true);
    const prompt = call.messages[0].content[0].text as string;
    expect(prompt).toContain('旧检查点');
    expect(prompt).toContain('<compacted-summary>');
    expect(prompt).toContain('待压缩对话');
  });

  it('KV 前缀模式：system 走 envelope 独立字段 + 遮蔽区（引擎传入的请求消息）+ 指令，携带 tools', async () => {
    const { LLMSummaryProvider } = await import('../../src/modules/chat/compaction/llm-summary.provider');
    const llmService = {
      completions: jest.fn(async () => streamMock('summary')),
    } as any;
    const shadowedMsg: Message = {
      id: 'm0',
      role: 'user',
      kind: 'user',
      source: { kind: 'user' },
      metadata: {},
      content: [{ type: 'text', contentId: 'm0_c', text: 'history user msg' }],
    };
    const provider = new LLMSummaryProvider(llmService, {
      modelName: 'gpt-4o',
      provider: { provider: 'openai' },
    }, {
      prefix: { system: 'system prompt', tools: [{ name: 'shell', description: 'run', parameters: {} }] as any },
    });
    await provider.generate({
      allMessages: [],
      shadowed: [shadowedMsg],
    });
    const call = llmService.completions.mock.calls[0][0];
    // system 走 envelope 独立字段（对齐 DSH SummarizationInput），消息序列 = 遮蔽区 + 指令
    expect(call.system).toBe('system prompt');
    expect(call.messages.length).toBe(2);
    expect(call.messages[0].id).toBe('m0');
    expect(call.messages[1].role).toBe('user');
    expect(call.messages[1].content[0].text).toContain('Compression checkpoint:');
    expect(call.messages[1].content[0].text).toContain('<system_reminder>');
    expect(call.messages[1].content[0].text).toContain('Do NOT call any tool');
    // tools 与主请求一致
    expect(call.tools).toHaveLength(1);
    expect(call.tools[0].name).toBe('shell');
  });

  it('空区域占位：遮蔽区为空时使用占位消息', async () => {
    const { LLMSummaryProvider } = await import('../../src/modules/chat/compaction/llm-summary.provider');
    const llmService = { completions: jest.fn(async () => streamMock('x')) } as any;
    const provider = new LLMSummaryProvider(llmService, {
      modelName: 'gpt-4o',
    provider: { provider: 'openai' },
  }, {
    prefix: { system: 'sys' },
  });
  await provider.generate({ allMessages: [], shadowed: [] });
  const call = llmService.completions.mock.calls[0][0];
  expect(call.messages.length).toBe(2); // 占位 + 指令
  expect(call.system).toBe('sys'); // envelope：system 独立字段
  expect(call.messages[0].content[0].text).toContain('empty');
});

it('buildParams 复用：摘要请求参数与主请求同源，system/tools/maxTokens 被 override', async () => {
  const { LLMSummaryProvider } = await import('../../src/modules/chat/compaction/llm-summary.provider');
  const llmService = { completions: jest.fn(async () => streamMock('x')) } as any;
  const buildParams = jest.fn((messages: any[]) => ({
    model: 'main-model',
    system: 'ORIGINAL-SYSTEM', // 将被 prefix.system 覆盖
    messages,
    tools: [{ name: 'orig' }] as any,
    thinkingEffort: 'high', // 与主请求一致的思考模式（前缀缓存关键）
    temperature: 0.7,
    stream: true,
    purpose: 'compaction',
  }));
  const shadowedMsg: Message = {
    id: 'm0',
    role: 'user',
    kind: 'user',
    source: { kind: 'user' },
    metadata: {},
    content: [{ type: 'text', contentId: 'm0_c', text: 'history' }],
  };
  const provider = new LLMSummaryProvider(llmService, {
    modelName: 'gpt-4o',
    provider: { provider: 'openai' },
  }, {
    prefix: { system: 'sys', tools: [{ name: 'shell', description: 'run', parameters: {} }] as any },
    buildParams,
  });
  await provider.generate({ allMessages: [], shadowed: [shadowedMsg] });
  const call = llmService.completions.mock.calls[0][0];
  expect(buildParams).toHaveBeenCalledTimes(1);
  // 主请求同源参数保留（thinkingEffort 等——前缀缓存一致性的关键）
  expect(call.thinkingEffort).toBe('high');
  expect(call.temperature).toBe(0.7);
  expect(call.model).toBe('main-model');
  // 前缀一致 override：system/tools 用主请求值；maxTokens 摘要上限
  expect(call.system).toBe('sys');
  expect(call.tools).toHaveLength(1);
  expect(call.tools[0].name).toBe('shell');
  expect(call.maxTokens).toBe(2000);
});
});

describe('TokenMeterService', () => {
  it('无缓存：同一内容重复估算每次都重新计数', async () => {
    const { TokenMeterService } = await import('../../src/modules/chat/token-meter.service');
    let countCalls = 0;
    const tokenizer = {
      countTextTokens: jest.fn(async () => {
        countCalls++;
        return 5;
      }),
    } as any;
    const meter = new TokenMeterService(tokenizer);
    const msg: Message = {
      id: 'm1',
      role: 'user',
      kind: 'user',
      source: { kind: 'user' },
      metadata: {},
      content: [{ type: 'text', contentId: 'c1', text: 'hello world' }],
    };
    const first = await meter.estimateMessages('s1', 'gpt-4o', [msg]);
    const second = await meter.estimateMessages('s1', 'gpt-4o', [msg]);
    expect(first).toBe(5);
    expect(second).toBe(5);
    // 无缓存契约：估算结果一致，但底层各计数一次（不缓存即不必失效）
    expect(countCalls).toBe(2);
  });

  it('就地改写块内容后重算立即反映新值（contentId 不变也不返回旧值）', async () => {
    const { TokenMeterService } = await import('../../src/modules/chat/token-meter.service');
    // 回归：按 contentId 缓存时期，改写内容而 contentId 不变会返回过期估算，
    // 曾导致一级裁剪后的重测读到裁剪前的 token 数，进而级联触发本不必要的二级摘要。
    const tokenizer = {
      countTextTokens: jest.fn(async (_model: string, text: string) =>
        Math.ceil(text.length / 4)),
    } as any;
    const meter = new TokenMeterService(tokenizer);
    const msg: Message = {
      id: 'm1',
      role: 'tool',
      kind: 'model',
      source: { kind: 'tool', toolCallId: 'tc1' },
      metadata: {},
      content: [{ type: 'tool-result', contentId: 'm1', toolCallId: 'tc1', name: 'shell', content: 'x'.repeat(400) }],
    };
    const before = await meter.estimateMessages('s1', 'gpt-4o', [msg]);
    // 模拟一级裁剪：就地改写内容，contentId 保持 m1 不变
    (msg.content[0] as any).content = 'x'.repeat(100);
    const after = await meter.estimateMessages('s1', 'gpt-4o', [msg]);
    expect(before).toBe(100);
    expect(after).toBe(25);
  });

  it('estimateTurns 过滤不可见/隐藏回合', async () => {
    const { TokenMeterService } = await import('../../src/modules/chat/token-meter.service');
    const tokenizer = {
      countTextTokens: jest.fn(async () => 4),
    } as any;
    const meter = new TokenMeterService(tokenizer);
    const visible = makeTurn('t1');
    const hidden = { ...makeTurn('t2'), visible: false };
    const metaHidden = { ...makeTurn('t3'), metadata: { hidden: true } };
    const total = await meter.estimateTurns('s1', 'gpt-4o', [visible, hidden, metaHidden]);
    // 每个回合有 2 条消息（user+assistant），各 4 tokens → 可见回合 8
    expect(total).toBe(8);
  });
});
