/**
 * CompressionEngine 单元测试
 *
 * 覆盖（对齐 deepseek-harness compaction 语义，消息级遮蔽）：
 * - 触发判断（triggerRatio）与 force 强制路径
 * - 一级裁剪（prune）只裁剪超长 tool-result、保护最近 N 条（就地改写消息）
 * - 二级摘要（compact）：messages 前缀 token 预算保留 + tool-pairing 平衡 + 收敛校验
 * - onBeforeCompaction 仅在确认需二级压缩后触发（不因一级裁剪空跑）
 * - DISABLED 模式：不生成摘要，仅遮蔽
 * - 引擎全数据输入：不读 store（getTurns 不参与）
 */
import { CompressionEngine, SummaryMode } from '../../src/modules/chat/compression-engine';
import { toolPairingBalancedBefore } from '../../src/modules/chat/compaction/tool-pairing';
import type { IMessageStore } from '../../src/common/persistence/message-store.interface';
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

/** 构建引擎（注入 mock store + mock tokenMeter；引擎全数据输入，getTurns 不应被调用） */
function createEngine(store: Partial<IMessageStore>) {
  const tokenMeter = {
    estimateMessages: async (_sid: string, _model: string, messages: Message[]) =>
      estimateTokensFor(messages),
    estimateTextTokens: async (_model: string, text: string) =>
      Math.ceil(text.length / 4),
    invalidate: jest.fn(),
  } as any;
  return new CompressionEngine(store as IMessageStore, tokenMeter);
}

describe('CompressionEngine', () => {
  const messages = makeMessages(4);

  describe('触发判断', () => {
    it('未达 triggerRatio 时不压缩', async () => {
      const store: Partial<IMessageStore> = {};
      const engine = createEngine(store);
      const result = await engine.execute('s1', {
        messages,
        contextWindow: 100000,
      });
      expect(result.compacted).toBe(false);
      expect(result.pruneEvents).toBe(0);
    });

    it('requestTokens 全量口径：历史低于阈值但完整请求超阈值时仍触发压缩', async () => {
      const compacted: any[] = [];
      const store: Partial<IMessageStore> = {
        appendCompact: jest.fn(async (_sid: string, data: any) => {
          compacted.push(data);
        }),
      };
      const engine = createEngine(store);
      const provider = { generate: jest.fn(async () => ({ summary: 's' })) };
      // 4 条消息 ≈ 10 tokens；window=100，纯历史 ratio≈0.1 < 0.8（无 requestTokens 会跳过）
      // requestTokens=90 → envelopeDelta=80 → 全量 90/100=0.9 >= 0.8 → 触发二级压缩
      const historyTokens = estimateTokensFor(makeMessages(4));
      expect(historyTokens / 100).toBeLessThan(0.8);
      const result = await engine.execute('s1', {
        messages: makeMessages(4),
        requestTokens: 90,
        contextWindow: 100,
        summaryProvider: provider as any,
      });
      expect(result.compacted).toBe(true);
      expect(provider.generate).toHaveBeenCalled();
      expect(store.appendCompact).toHaveBeenCalled();
    });

    it('force=true 时跳过 triggerRatio 阈值判断', async () => {
      const compacted: any[] = [];
      const store: Partial<IMessageStore> = {
        appendCompact: jest.fn(async (_sid: string, data: any) => {
          compacted.push(data);
        }),
      };
      const engine = createEngine(store);
      const provider = { generate: jest.fn(async () => ({ summary: 'summary' })) };
      // 20 条消息 ≈ 50 tokens，window=80 → ratio≈0.63 < 0.8（正常路径跳过）；
      // force 绕过阈值 → 保留预算 = 40 → 遮蔽头部消息并生成摘要
      const big = makeMessages(20);
      const bigTokens = estimateTokensFor(big);
      expect(bigTokens / 80).toBeLessThan(0.8);
      const result = await engine.execute('s1', {
        messages: big,
        contextWindow: 80,
        force: true,
        summaryProvider: provider,
      });
      expect(result.compacted).toBe(true);
      expect(provider.generate).toHaveBeenCalled();
      expect(compacted.length).toBe(1);
      expect(compacted[0].shadowedMessageIds.length).toBeGreaterThan(0);
    });
  });

  describe('一级裁剪（prune）', () => {
    it('只裁剪超长 tool-result，保护最近 3 条，并就地改写消息内容', async () => {
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
      const pruned: any[] = [];
      const store: Partial<IMessageStore> = {
        appendPrune: jest.fn(async (_sid: string, data: any) => {
          pruned.push(data);
        }),
      };
      const engine = createEngine(store);
      const result = await engine.execute('s1', {
        messages: longMessages,
        contextWindow: 10,
        summaryMode: SummaryMode.FAST,
      });
      expect(result.pruneEvents).toBe(1);
      expect(pruned.length).toBe(1);
      expect(pruned[0].messageId).toBe('t1_t');
      expect(pruned[0].newContent).toContain('[omitted');
      expect(pruned[0].prunedTokens).toBeGreaterThan(0);
      // 就地改写：最早一条 tool-result 内容已替换为裁剪后内容
      const firstTr = longMessages[0].content[0] as Extract<ContentBlock, { type: 'tool-result' }>;
      expect(firstTr.content).toContain('[omitted');
    });
  });

  describe('二级摘要（compact）', () => {
    it('调用 summaryProvider 并写入 appendCompact（含实际 summaryMode）', async () => {
      const compacted: any[] = [];
      const store: Partial<IMessageStore> = {
        appendCompact: jest.fn(async (_sid: string, data: any) => {
          compacted.push(data);
        }),
      };
      const engine = createEngine(store);
      const provider = { generate: jest.fn(async () => ({ summary: '检查点摘要内容' })) };
      // window=8 → targetTokens=4 → 保留预算仅覆盖 1 条尾部消息，其余遮蔽
      const result = await engine.execute('s1', {
        messages,
        contextWindow: 8,
        summaryProvider: provider,
        summaryMode: SummaryMode.MEMORY_SYNC,
      });
      expect(result.compacted).toBe(true);
      expect(provider.generate).toHaveBeenCalled();
      expect(compacted.length).toBe(1);
      expect(compacted[0].mode).toBe('memory_sync');
      expect(compacted[0].summary).toBe('检查点摘要内容');
      expect(compacted[0].shadowedMessageIds.length).toBeGreaterThan(0);
      // 遮蔽 ID = 消息 id（消息级遮蔽，对齐 DSH surface 节点）
      const genInput = (provider.generate as jest.Mock).mock.calls[0][0];
      expect(genInput.shadowedMessageIds[0]).toBe('m0');
    });

    it('onBeforeCompaction 仅在确认需二级压缩后触发', async () => {
      const store: Partial<IMessageStore> = {
        appendPrune: jest.fn(async () => {}),
        appendCompact: jest.fn(async () => {}),
      };
      const engine = createEngine(store);
      const onBefore = jest.fn(async () => {});
      await engine.execute('s1', {
        messages,
        contextWindow: 8,
        summaryProvider: { generate: async () => ({ summary: 'sum' }) },
        summaryMode: SummaryMode.MEMORY_SYNC,
        onBeforeCompaction: onBefore,
      });
      expect(onBefore).toHaveBeenCalledTimes(1);
    });

    it('无 summaryProvider 且非 DISABLED 时不触发 onBeforeCompaction（一级裁剪空跑保护）', async () => {
      const store: Partial<IMessageStore> = {
        appendPrune: jest.fn(async () => {}),
        appendCompact: jest.fn(async () => {}),
      };
      const engine = createEngine(store);
      const onBefore = jest.fn(async () => {});
      const result = await engine.execute('s1', {
        messages,
        contextWindow: 10,
        summaryMode: SummaryMode.FAST, // 无 provider → 不生成摘要
        onBeforeCompaction: onBefore,
      });
      expect(result.compacted).toBe(false);
      expect(onBefore).not.toHaveBeenCalled();
    });

    it('DISABLED 模式：不生成摘要，直接遮蔽并写空摘要 compaction', async () => {
      const compacted: any[] = [];
      const store: Partial<IMessageStore> = {
        appendCompact: jest.fn(async (_sid: string, data: any) => {
          compacted.push(data);
        }),
      };
      const engine = createEngine(store);
      const result = await engine.execute('s1', {
        messages,
        contextWindow: 8,
        summaryMode: SummaryMode.DISABLED,
      });
      expect(result.compacted).toBe(true);
      expect(compacted.length).toBe(1);
      expect(compacted[0].summary).toBe('');
      expect(compacted[0].mode).toBe('disabled');
    });

    it('收敛校验：摘要不小于被遮蔽内容时重试', async () => {
      const store: Partial<IMessageStore> = {
        appendCompact: jest.fn(async () => {}),
      };
      const engine = createEngine(store);
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
      });
      expect(provider.generate).toHaveBeenCalledTimes(2);
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
    const { LLMSummaryProvider } = await import('../../src/modules/chat/llm-summary.provider');
    const llmService = {
      completions: jest.fn(async () => streamMock('new checkpoint')),
    } as any;
    const provider = new LLMSummaryProvider(llmService, {
      modelName: 'gpt-4o',
      provider: { provider: 'openai' },
    });
    const oldCheckpoint: Message = {
      id: 'evt_1',
      role: 'event',
      kind: 'user',
      source: { kind: 'user' },
      metadata: { compactInfo: { summary: '旧检查点' } },
      content: [],
    };
    const msg = makeMessages(1)[0];
    const result = await provider.generate({
      allMessages: [oldCheckpoint],
      shadowed: [msg],
      shadowedMessageIds: [msg.id],
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

  it('KV 前缀模式：请求 = prelude + 遮蔽区（引擎传入的请求消息）+ 指令，携带 tools', async () => {
    const { LLMSummaryProvider } = await import('../../src/modules/chat/llm-summary.provider');
    const llmService = {
      completions: jest.fn(async () => streamMock('summary')),
    } as any;
    const prelude: Message[] = [
      { id: 'system', role: 'system', kind: 'model', source: { kind: 'user' }, metadata: {}, content: [{ type: 'text', contentId: 'system', text: 'system prompt' }] },
    ];
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
      prefix: { prelude, tools: [{ name: 'shell', description: 'run', parameters: {} }] as any },
    });
    await provider.generate({
      allMessages: [],
      shadowed: [shadowedMsg],
      shadowedMessageIds: [shadowedMsg.id],
    });
    const call = llmService.completions.mock.calls[0][0];
    // 消息序列 = prelude + 遮蔽区（请求消息）+ 指令（最后一条 user）
    expect(call.messages.length).toBe(3);
    expect(call.messages[0].id).toBe('system');
    expect(call.messages[1].id).toBe('m0');
    expect(call.messages[2].role).toBe('user');
    expect(call.messages[2].content[0].text).toContain('压缩检查点');
    // tools 与主请求一致
    expect(call.tools).toHaveLength(1);
    expect(call.tools[0].name).toBe('shell');
  });

  it('空区域占位：遮蔽区为空时使用占位消息', async () => {
    const { LLMSummaryProvider } = await import('../../src/modules/chat/llm-summary.provider');
    const llmService = { completions: jest.fn(async () => streamMock('x')) } as any;
    const provider = new LLMSummaryProvider(llmService, {
      modelName: 'gpt-4o',
      provider: { provider: 'openai' },
    }, {
      prefix: { prelude: [] },
    });
    await provider.generate({ allMessages: [], shadowed: [], shadowedMessageIds: [] });
    const call = llmService.completions.mock.calls[0][0];
    expect(call.messages.length).toBe(2); // 占位 + 指令
    expect(call.messages[0].content[0].text).toContain('empty');
  });
});

describe('TokenMeterService', () => {
  it('会话级块缓存 + invalidate 生效', async () => {
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
    // 首次估算：底层计数 1 次
    const first = await meter.estimateMessages('s1', 'gpt-4o', [msg]);
    // 二次估算同块：命中会话缓存，底层不再计数
    const second = await meter.estimateMessages('s1', 'gpt-4o', [msg]);
    expect(first).toBe(5);
    expect(second).toBe(5);
    expect(countCalls).toBe(1);
    // invalidate 后重新计数
    meter.invalidate('s1');
    await meter.estimateMessages('s1', 'gpt-4o', [msg]);
    expect(countCalls).toBe(2);
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
