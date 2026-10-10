/// <reference types="jest" />

/**
 * 微压缩纯计划模块单元测试
 *
 * 覆盖：
 * - 触发阈值公式（min(0.9×LLM, LLM−2000)）
 * - 工具结果裁剪：候选条件/头尾保留/幂等；保护 = 最后真实用户轮次起
 * - 思考剥离：2 小时时间窗、最新轮次绝对保护、轮次原子、缺 turnId 保守保留、幂等
 * - 最小收益门槛的输入（totalTokenSavings）与真实用户判据（source.kind）
 */
import {
  buildMicrocompactPlan,
  buildMicrocompactThreshold,
  MICROCOMPACT_MIN_TOKEN_SAVINGS,
  type MicrocompactMessage,
} from '../../src/modules/chat/compaction/microcompact';

const HOUR_MS = 60 * 60 * 1000;
/** 确定性 token 估算：4 字符/token */
const estimate = async (text: string) => Math.ceil(text.length / 4);

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

function realUser(id: string, turnId: string, createdAt: number): MicrocompactMessage {
  return makeMessage({
    id,
    turnId,
    createdAt,
    role: 'user',
    content: [{ type: 'text', text: `user ${id}` }],
  });
}

/** 队列投递/注入的用户消息：kind='user' 但 source 非 user —— 不算真实用户轮次 */
function queuedUser(id: string, turnId: string, createdAt: number): MicrocompactMessage {
  return makeMessage({
    id,
    turnId,
    createdAt,
    role: 'user',
    kind: 'user',
    source: { kind: 'sub_agent', subSessionId: 'sub_1' },
    content: [{ type: 'text', text: `queued ${id}` }],
  });
}

function assistantWithReasoning(
  id: string,
  turnId: string,
  reasoning: string,
  createdAt: number,
): MicrocompactMessage {
  return makeMessage({
    id,
    turnId,
    createdAt,
    role: 'assistant',
    kind: 'model',
    source: { kind: 'model', provider: 'test', model: 'deepseek-v4' },
    content: [
      { type: 'reasoning', summary: reasoning },
      { type: 'text', text: `answer ${id}` },
    ],
  });
}

function toolResult(
  id: string,
  turnId: string,
  content: string,
  createdAt: number,
): MicrocompactMessage {
  return makeMessage({
    id,
    turnId,
    createdAt,
    role: 'tool',
    kind: 'model',
    source: { kind: 'tool', toolCallId: `call_${id}` },
    content: [
      { type: 'tool-result', toolCallId: `call_${id}`, name: 'shell', content },
    ],
  });
}

describe('buildMicrocompactThreshold', () => {
  it('取 min(0.9×LLM, LLM−2000)：大阈值下比例项占优', () => {
    // 128K 窗口 × 0.9 = 115200 → min(103680, 113200) = 103680
    expect(buildMicrocompactThreshold(115200)).toBe(103680);
  });

  it('小阈值下缓冲项占优且不为负', () => {
    expect(buildMicrocompactThreshold(3000)).toBe(1000); // min(2700, 1000)
    expect(buildMicrocompactThreshold(1000)).toBe(0); // min(900, -1000) → 0
  });
});

describe('微压缩计划：工具结果裁剪', () => {
  const NOW = 10_000_000_000;

  it('只裁保护线之前的超长 tool-result，头尾保留 + 省略标记', async () => {
    const messages = [
      realUser('u1', 't1', NOW - 3 * HOUR_MS),
      toolResult('t1_t', 't1', 'x'.repeat(5000), NOW - 3 * HOUR_MS),
      realUser('u2', 't2', NOW - 1000),
      toolResult('t2_t', 't2', 'y'.repeat(5000), NOW - 1000),
    ];
    const plan = await buildMicrocompactPlan({ messages, nowMs: NOW, estimateTextTokens: estimate });

    expect(plan.toolPruneCount).toBe(1);
    const entry = plan.entries[0]!;
    expect(entry.strategy).toBe('head_tail_prune');
    expect(entry.messageId).toBe('t1_t');
    expect(entry.index).toBe(1);
    expect(entry.newContent).toContain('[omitted 4000 chars]');
    expect(entry.newContent.length).toBeLessThan(5000);
    expect(entry.prunedTokens).toBeGreaterThan(0);
    // 保护线（最后真实用户消息 u2 起）之后的工具结果不裁
    expect(plan.entries.some((e) => e.messageId === 't2_t')).toBe(false);
  });

  it('队列投递的用户消息不算真实用户轮次，不构成保护线', async () => {
    const messages = [
      realUser('u1', 't1', NOW - 3 * HOUR_MS),
      toolResult('t1_t', 't1', 'x'.repeat(5000), NOW - 3 * HOUR_MS),
      queuedUser('q1', 't2', NOW - 1000),
      toolResult('t2_t', 't2', 'y'.repeat(5000), NOW - 1000),
    ];
    const plan = await buildMicrocompactPlan({ messages, nowMs: NOW, estimateTextTokens: estimate });
    // 保护线仍是 u1（index 0）→ 其后全部保护 → 无可裁项
    expect(plan.toolPruneCount).toBe(0);
    expect(plan.entries).toHaveLength(0);
  });

  it('幂等：已裁剪内容（收益不足门槛）不再入候选', async () => {
    const first = await buildMicrocompactPlan({
      messages: [
        realUser('u1', 't1', NOW - 3 * HOUR_MS),
        toolResult('t1_t', 't1', 'x'.repeat(5000), NOW - 3 * HOUR_MS),
        realUser('u2', 't2', NOW - 1000),
      ],
      nowMs: NOW,
      estimateTextTokens: estimate,
    });
    const pruned = first.entries[0]!.newContent;
    const second = await buildMicrocompactPlan({
      messages: [
        realUser('u1', 't1', NOW - 3 * HOUR_MS),
        toolResult('t1_t', 't1', pruned, NOW - 3 * HOUR_MS),
        realUser('u2', 't2', NOW - 1000),
      ],
      nowMs: NOW,
      estimateTextTokens: estimate,
    });
    expect(second.entries).toHaveLength(0);
  });

  it('无可裁内容时计划为空', async () => {
    const plan = await buildMicrocompactPlan({
      messages: [
        realUser('u1', 't1', NOW - 3 * HOUR_MS),
        toolResult('t1_t', 't1', 'short', NOW - 3 * HOUR_MS),
        realUser('u2', 't2', NOW - 1000),
      ],
      nowMs: NOW,
      estimateTextTokens: estimate,
    });
    expect(plan.entries).toHaveLength(0);
    expect(plan.totalTokenSavings).toBe(0);
  });
});

describe('微压缩计划：思考剥离', () => {
  const NOW = 10_000_000_000;

  it('过旧轮次（>2h 且非最新）的 reasoning 整块清空、块保留', async () => {
    const messages = [
      realUser('u1', 't1', NOW - 3 * HOUR_MS),
      assistantWithReasoning('a1', 't1', 'r'.repeat(400), NOW - 3 * HOUR_MS),
      realUser('u2', 't2', NOW - 1000),
      assistantWithReasoning('a2', 't2', 'current turn thinking', NOW - 1000),
    ];
    const plan = await buildMicrocompactPlan({ messages, nowMs: NOW, estimateTextTokens: estimate });

    expect(plan.thinkingStripCount).toBe(1);
    const entry = plan.entries[0]!;
    expect(entry.strategy).toBe('thinking_strip');
    expect(entry.messageId).toBe('a1');
    expect(entry.newContent).toBe('');
    expect(entry.prunedTokens).toBe(100); // 400 字符 / 4
  });

  it('2 小时窗内的思考不剥离（时间保护）', async () => {
    const messages = [
      realUser('u1', 't1', NOW - 3 * HOUR_MS),
      assistantWithReasoning('a1', 't1', 'recent thinking', NOW - 1 * HOUR_MS),
      realUser('u2', 't2', NOW - 1000),
      assistantWithReasoning('a2', 't2', 'current turn thinking', NOW - 1000),
    ];
    const plan = await buildMicrocompactPlan({ messages, nowMs: NOW, estimateTextTokens: estimate });
    expect(plan.thinkingStripCount).toBe(0);
  });

  it('createdAt 缺失时按轮次回退：非最新轮次可剥离', async () => {
    const messages = [
      realUser('u1', 't1', NOW - 3 * HOUR_MS),
      makeMessage({
        id: 'a1',
        turnId: 't1',
        role: 'assistant',
        kind: 'model',
        source: { kind: 'model', provider: 'test', model: 'deepseek-v4' },
        content: [{ type: 'reasoning', summary: 'old thinking without timestamp' }],
      }),
      realUser('u2', 't2', NOW - 1000),
      assistantWithReasoning('a2', 't2', 'current turn thinking', NOW - 1000),
    ];
    const plan = await buildMicrocompactPlan({ messages, nowMs: NOW, estimateTextTokens: estimate });
    expect(plan.thinkingStripCount).toBe(1);
    expect(plan.entries[0]!.messageId).toBe('a1');
  });

  it('轮次原子：轮内任一消息受保护 → 整轮不剥离', async () => {
    const messages = [
      realUser('u1', 't1', NOW - 3 * HOUR_MS),
      assistantWithReasoning('a1', 't1', 'old thinking in turn', NOW - 3 * HOUR_MS),
      // 同一轮次的后续消息在 2h 内 → 整轮保护
      assistantWithReasoning('a2', 't1', 'recent thinking in same turn', NOW - 1 * HOUR_MS),
      realUser('u2', 't2', NOW - 1000),
      assistantWithReasoning('a3', 't2', 'current turn thinking', NOW - 1000),
    ];
    const plan = await buildMicrocompactPlan({ messages, nowMs: NOW, estimateTextTokens: estimate });
    expect(plan.thinkingStripCount).toBe(0);
  });

  it('最新轮次绝对保护（无论时间）', async () => {
    const messages = [
      realUser('u1', 't1', NOW - 3 * HOUR_MS),
      assistantWithReasoning('a1', 't1', 'old thinking', NOW - 3 * HOUR_MS),
      realUser('u2', 't2', NOW - 3 * HOUR_MS),
      assistantWithReasoning('a2', 't2', 'latest turn thinking', NOW - 3 * HOUR_MS),
    ];
    const plan = await buildMicrocompactPlan({ messages, nowMs: NOW, estimateTextTokens: estimate });
    // t2 是最新轮次（最后一条消息归属）→ 保护；t1 无时间保护可剥离
    expect(plan.thinkingStripCount).toBe(1);
    expect(plan.entries[0]!.messageId).toBe('a1');
  });

  it('缺 turnId 的消息不参与思考剥离（无法判定轮次原子性）', async () => {
    const messages = [
      realUser('u1', 't1', NOW - 3 * HOUR_MS),
      makeMessage({
        id: 'a1',
        role: 'assistant',
        kind: 'model',
        source: { kind: 'model', provider: 'test', model: 'deepseek-v4' },
        createdAt: NOW - 3 * HOUR_MS,
        content: [{ type: 'reasoning', summary: 'thinking without turnId' }],
      }),
      realUser('u2', 't2', NOW - 1000),
    ];
    const plan = await buildMicrocompactPlan({ messages, nowMs: NOW, estimateTextTokens: estimate });
    expect(plan.thinkingStripCount).toBe(0);
  });

  it('幂等：已剥离（读取管线填充的空 summary）不再入候选', async () => {
    const messages = [
      realUser('u1', 't1', NOW - 3 * HOUR_MS),
      makeMessage({
        id: 'a1',
        turnId: 't1',
        role: 'assistant',
        kind: 'model',
        source: { kind: 'model', provider: 'test', model: 'deepseek-v4' },
        createdAt: NOW - 3 * HOUR_MS,
        content: [{ type: 'reasoning', summary: '' }],
      }),
      realUser('u2', 't2', NOW - 1000),
    ];
    const plan = await buildMicrocompactPlan({ messages, nowMs: NOW, estimateTextTokens: estimate });
    expect(plan.thinkingStripCount).toBe(0);
  });

  it('无真实用户消息时全部保护（不动作）', async () => {
    const messages = [
      queuedUser('q1', 't1', NOW - 3 * HOUR_MS),
      assistantWithReasoning('a1', 't1', 'r'.repeat(400), NOW - 3 * HOUR_MS),
      toolResult('t1_t', 't1', 'x'.repeat(5000), NOW - 3 * HOUR_MS),
    ];
    const plan = await buildMicrocompactPlan({ messages, nowMs: NOW, estimateTextTokens: estimate });
    expect(plan.entries).toHaveLength(0);
  });
});

describe('微压缩计划：最小收益门槛输入', () => {
  const NOW = 10_000_000_000;

  it('totalTokenSavings 汇总正收益，供服务层与 256 门槛比较', async () => {
    const messages = [
      realUser('u1', 't1', NOW - 3 * HOUR_MS),
      toolResult('t1_t', 't1', 'x'.repeat(5000), NOW - 3 * HOUR_MS),
      assistantWithReasoning('a1', 't1', 'r'.repeat(400), NOW - 3 * HOUR_MS),
      realUser('u2', 't2', NOW - 1000),
    ];
    const plan = await buildMicrocompactPlan({ messages, nowMs: NOW, estimateTextTokens: estimate });
    const expected = plan.entries.reduce((acc, e) => acc + Math.max(0, e.prunedTokens), 0);
    expect(plan.totalTokenSavings).toBe(expected);
    expect(plan.totalTokenSavings).toBeGreaterThanOrEqual(MICROCOMPACT_MIN_TOKEN_SAVINGS);
  });

  it('零收益（无可裁项）时 totalTokenSavings 为 0（低于门槛 → 服务层放弃整批）', async () => {
    const plan = await buildMicrocompactPlan({
      messages: [realUser('u1', 't1', NOW - 3 * HOUR_MS)],
      nowMs: NOW,
      estimateTextTokens: estimate,
    });
    expect(plan.totalTokenSavings).toBe(0);
    expect(plan.totalTokenSavings).toBeLessThan(MICROCOMPACT_MIN_TOKEN_SAVINGS);
  });
});
