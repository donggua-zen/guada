/// <reference types="jest" />

/**
 * MicrocompactService 单元测试（一级编排）
 *
 * 覆盖：
 * - 档位 off 门控（自动两级全关）
 * - 触发阈值（min(0.9×LLM, LLM−2000)）与中止信号
 * - 最小收益门槛：不达标完全静默（无写入/无锚点/无流事件）
 * - 生效路径：start → appendPrune（工具裁剪 + 思考剥离）→ recordContextAnchor → end(tier=micro)
 * - 失败 fail-open：发 compression_error、不抛出
 */
import { MicrocompactService } from '../../src/modules/chat/compaction/microcompact.service';
import type { MicrocompactMessage } from '../../src/modules/chat/compaction/microcompact';

const HOUR_MS = 60 * 60 * 1000;

function makeMessage(
  overrides: Partial<MicrocompactMessage> & { id: string },
): MicrocompactMessage {
  return {
    role: 'user',
    kind: 'user',
    source: { kind: 'user' },
    metadata: {},
    content: [],
    ...overrides,
  } as MicrocompactMessage;
}

/** 可产出微压缩计划的视图：老轮次超长工具结果 + 老轮次思考，最新真实用户轮次保护 */
function makePrunableHistory(now: number): MicrocompactMessage[] {
  return [
    { ...makeMessage({ id: 'u1', role: 'user', content: [{ type: 'text', text: 'q1' }] }), turnId: 't1', createdAt: now - 3 * HOUR_MS },
    {
      ...makeMessage({
        id: 't1_t',
        role: 'tool',
        kind: 'model',
        source: { kind: 'tool', toolCallId: 'call_1' },
        content: [{ type: 'tool-result', toolCallId: 'call_1', name: 'shell', content: 'x'.repeat(5000) }],
      }),
      turnId: 't1',
      createdAt: now - 3 * HOUR_MS,
    },
    {
      ...makeMessage({
        id: 'a1',
        role: 'assistant',
        kind: 'model',
        source: { kind: 'model', provider: 'test', model: 'deepseek-v4' },
        content: [{ type: 'reasoning', summary: 'r'.repeat(400) }],
      }),
      turnId: 't1',
      createdAt: now - 3 * HOUR_MS,
    },
    { ...makeMessage({ id: 'u2', role: 'user', content: [{ type: 'text', text: 'q2' }] }), turnId: 't2', createdAt: now },
  ];
}

function createHarness(overrides: any = {}) {
  const published: any[] = [];
  const history = overrides.history ?? makePrunableHistory(Date.now());
  const ds = {
    sessionId: 's1',
    getCompressionConfig: jest.fn(() => ({
      enabled: true,
      compressionTriggerRatio: 0.9,
      compressionRetainRatio: 0.4,
    })),
    getEffectiveContextWindow: jest.fn(() => 100000),
    // 85000 >= min(0.9×90000, 90000−2000)=81000 → 达标
    getTokenCount: jest.fn(async () => 85000),
    getHistory: jest.fn(async () => history),
    getPerMessageTokens: jest.fn(async () => []),
    getModelConfig: jest.fn(() => ({ modelName: 'deepseek-v4' })),
    appendPrune: jest.fn(async () => {}),
    recordContextAnchor: jest.fn(async () => {}),
    getContextStats: jest.fn(async () => ({
      usedTokens: 50000,
      effectiveContextWindow: 100000,
      messageCount: history.length,
      breakdown: { systemPrompt: 10, history: 49980, tools: 10 },
    })),
    publishStream: jest.fn(async (event: any) => {
      published.push(event);
    }),
    ...overrides,
  };
  const tokenMeter = {
    estimateTextTokens: jest.fn(async (_model: string, text: string) => Math.ceil(text.length / 4)),
  };
  const service = new MicrocompactService(tokenMeter as any);
  return { service, ds, published, tokenMeter };
}

describe('MicrocompactService', () => {
  it('档位 off：完全旁路（无写入、无流事件）', async () => {
    const { service, ds, published } = createHarness({
      getCompressionConfig: jest.fn(() => ({ enabled: false })),
    });
    const outcome = await service.maybeMicrocompact(ds as any);
    expect(outcome.applied).toBe(false);
    expect(outcome.reason).toBe('tier-disabled');
    expect(ds.appendPrune).not.toHaveBeenCalled();
    expect(published).toHaveLength(0);
  });

  it('低于微压缩阈值：静默跳过', async () => {
    const { service, ds, published } = createHarness({
      getTokenCount: jest.fn(async () => 50000), // < 81000
    });
    const outcome = await service.maybeMicrocompact(ds as any);
    expect(outcome.reason).toBe('below-threshold');
    expect(ds.appendPrune).not.toHaveBeenCalled();
    expect(published).toHaveLength(0);
  });

  it('中止信号：不动作', async () => {
    const controller = new AbortController();
    controller.abort();
    const { service, ds, published } = createHarness();
    const outcome = await service.maybeMicrocompact(ds as any, { abortSignal: controller.signal });
    expect(outcome.reason).toBe('cancelled');
    expect(ds.appendPrune).not.toHaveBeenCalled();
    expect(published).toHaveLength(0);
  });

  it('无可裁内容：静默跳过', async () => {
    const { service, ds, published } = createHarness({
      history: [
        { ...makeMessage({ id: 'u1', content: [{ type: 'text', text: 'q1' }] }), turnId: 't1' },
        { ...makeMessage({ id: 'u2', content: [{ type: 'text', text: 'q2' }] }), turnId: 't2' },
      ],
    });
    const outcome = await service.maybeMicrocompact(ds as any);
    expect(outcome.reason).toBe('nothing-to-do');
    expect(published).toHaveLength(0);
  });

  it('收益低于最小门槛：整批放弃（无写入/无锚点/无流事件）', async () => {
    const now = Date.now();
    const { service, ds, published } = createHarness({
      history: [
        { ...makeMessage({ id: 'u1', content: [{ type: 'text', text: 'q1' }] }), turnId: 't1', createdAt: now - 3 * HOUR_MS },
        {
          ...makeMessage({
            id: 'a1',
            role: 'assistant',
            kind: 'model',
            source: { kind: 'model', provider: 'test', model: 'deepseek-v4' },
            content: [{ type: 'reasoning', summary: 'r'.repeat(200) }], // 50 token < 256
          }),
          turnId: 't1',
          createdAt: now - 3 * HOUR_MS,
        },
        { ...makeMessage({ id: 'u2', content: [{ type: 'text', text: 'q2' }] }), turnId: 't2', createdAt: now },
      ],
    });
    const outcome = await service.maybeMicrocompact(ds as any);
    expect(outcome.reason).toBe('below-min-savings');
    expect(ds.appendPrune).not.toHaveBeenCalled();
    expect(ds.recordContextAnchor).not.toHaveBeenCalled();
    expect(published).toHaveLength(0);
  });

  it('生效：start → appendPrune（工具裁剪 + 思考剥离）→ 锚点 → end(tier=micro)', async () => {
    const { service, ds, published } = createHarness();
    const outcome = await service.maybeMicrocompact(ds as any);

    expect(outcome.applied).toBe(true);
    expect(outcome.toolPruneCount).toBe(1);
    expect(outcome.thinkingStripCount).toBe(1);
    expect(outcome.totalTokenSavings).toBeGreaterThanOrEqual(256);

    // 写入：工具裁剪 + 思考剥离各一条
    const writes = ds.appendPrune.mock.calls.map((c: any[]) => c[0]);
    expect(writes).toHaveLength(2);
    const toolWrite = writes.find((w: any) => w.strategy === 'head_tail_prune');
    const thinkingWrite = writes.find((w: any) => w.strategy === 'thinking_strip');
    expect(toolWrite.messageId).toBe('t1_t');
    expect(toolWrite.newContent).toContain('[omitted');
    expect(thinkingWrite.messageId).toBe('a1');
    expect(thinkingWrite.newContent).toBe('');

    // 锚点：beforeTokens = 触发时占用；savings 按视图 index 归属
    expect(ds.recordContextAnchor).toHaveBeenCalledWith({
      beforeTokens: 85000,
      savings: [
        { index: 1, tokens: expect.any(Number) },
        { index: 2, tokens: expect.any(Number) },
      ],
    });

    // 事件：与 LLM 压缩一致（start + end），带 tier 与计数
    expect(published.map((e) => e.type)).toEqual(['compression_start', 'compression_end']);
    expect(published[0]).toMatchObject({ type: 'compression_start', reason: 'auto', tier: 'micro' });
    expect(published[1]).toMatchObject({
      type: 'compression_end',
      reason: 'auto',
      tier: 'micro',
      pruneEvents: 1,
      thinkingStrippedCount: 1,
      compacted: false,
    });
    expect(published[1].contextStats).toBeDefined();
  });

  it('写入失败 fail-open：发 compression_error、不抛出', async () => {
    const { service, ds, published } = createHarness({
      appendPrune: jest.fn(async () => {
        throw new Error('disk full');
      }),
    });
    const outcome = await service.maybeMicrocompact(ds as any);
    expect(outcome.applied).toBe(false);
    expect(outcome.reason).toBe('failed');
    expect(published.map((e) => e.type)).toEqual(['compression_start', 'compression_error']);
    expect(published[1]).toMatchObject({ type: 'compression_error', error: 'disk full' });
  });
});
