/// <reference types="jest" />

/**
 * 轨迹 step 括号记录器单测
 *
 * 覆盖（step/start~step/end 收口纪律）：
 * - 正常路径：envelope（可选）→ step/start → step/end 配对，durationMs/attemptIndex 语义
 * - noteAttempt：流式重试信号透出 → end 的 attemptIndex 取最大值
 * - 防御收口：上一括号未闭合就 begin 新括号 → 先补 StepUnclosed end 再开新括号（seq 有序）
 * - start append 失败：哑句柄（startSeq=null），end 不再写（括号不存在）
 * - end 幂等：重复调用只写一次
 * - withStepBracket：成功路径收口携带调用方增量；异常路径以 error 收口后原样上抛
 * - transient/fullInput 空数组省略（事件体最小化）
 */
import { beginStep, withStepBracket } from '../../src/modules/chat/step-recorder';
import type { StepBracketWriter } from '../../src/modules/chat/step-recorder';
import type { StepEndData, StepStartData } from '../../src/common/persistence/types';

function makeWriter(overrides: Partial<StepBracketWriter> = {}) {
  const calls: Array<{ kind: 'envelope' | 'start' | 'end'; data: any }> = [];
  const writer: StepBracketWriter = {
    sessionId: 's1',
    appendStepStart: jest.fn(async (data: StepStartData) => {
      calls.push({ kind: 'start', data });
      return calls.filter((c) => c.kind === 'start').length; // seq 模拟：递增
    }),
    appendStepEnd: jest.fn(async (data: StepEndData) => {
      calls.push({ kind: 'end', data });
      return calls.length;
    }),
    ...overrides,
  };
  return { writer, calls };
}

const META = {
  turnId: 't1' as const,
  step: 1,
  source: 'main_turn' as const,
  model: 'm1',
  requestId: 'r1',
};

describe('step-recorder 正常路径', () => {
  it('start→end 配对：durationMs ≥ 0，requestId 贯穿，attemptIndex 缺省 0', async () => {
    const { writer, calls } = makeWriter();
    const handle = await beginStep(writer, META);
    expect(handle.startSeq).not.toBeNull();
    await handle.end({ usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 } });

    expect(calls.map((c) => c.kind)).toEqual(['start', 'end']);
    const start = calls[0]!.data as StepStartData;
    const end = calls[1]!.data as StepEndData;
    expect(start).toMatchObject({ turnId: 't1', step: 1, source: 'main_turn', model: 'm1', requestId: 'r1' });
    expect(end.requestId).toBe('r1');
    expect(end.attemptIndex).toBe(0);
    expect(end.durationMs).toBeGreaterThanOrEqual(0);
    expect(end.usage).toEqual({ promptTokens: 1, completionTokens: 2, totalTokens: 3 });
  });

  it('envelope 可选：写入面缺省时不调用', async () => {
    const { writer } = makeWriter();
    await beginStep(writer, META);
    // writer 没有 appendEnvelopeIfNeeded → 不抛错、不调用
    expect(writer.appendEnvelopeIfNeeded).toBeUndefined();
  });

  it('envelope 存在时在 step/start 之前调用', async () => {
    const calls: string[] = [];
    const { writer } = makeWriter({
      appendEnvelopeIfNeeded: jest.fn(async () => {
        calls.push('envelope');
      }),
    });
    (writer.appendStepStart as jest.Mock).mockImplementation(async () => {
      calls.push('start');
      return 1;
    });
    (writer.appendStepEnd as jest.Mock).mockImplementation(async () => {
      calls.push('end');
      return 2;
    });
    const handle = await beginStep(writer, META);
    await handle.end();
    expect(calls).toEqual(['envelope', 'start', 'end']);
  });

  it('transient / fullInput 空数组时省略（事件体最小化）', async () => {
    const { writer, calls } = makeWriter();
    const handle = await beginStep(writer, { ...META, transient: [], fullInput: [] });
    await handle.end();
    expect(calls[0]!.data.transient).toBeUndefined();
    expect(calls[0]!.data.fullInput).toBeUndefined();
  });

  it('noteAttempt：重试信号透出 → attemptIndex 取最大值', async () => {
    const { writer, calls } = makeWriter();
    const handle = await beginStep(writer, META);
    handle.noteAttempt(1);
    handle.noteAttempt(2);
    handle.noteAttempt(2); // 重复信号不回退
    await handle.end();
    expect((calls[1]!.data as StepEndData).attemptIndex).toBe(2);
  });

  it('end 幂等：重复调用只写一次', async () => {
    const { writer, calls } = makeWriter();
    const handle = await beginStep(writer, META);
    await handle.end({ finishReason: 'stop' });
    await handle.end({ finishReason: 'stop' });
    expect(calls.filter((c) => c.kind === 'end')).toHaveLength(1);
  });
});

describe('step-recorder 防御收口（finally 纪律）', () => {
  it('未闭合括号 + 新 begin → 先补 StepUnclosed end 再开新括号', async () => {
    const { writer, calls } = makeWriter();
    await beginStep(writer, META);
    await beginStep(writer, { ...META, step: 2, requestId: 'r2' });

    const kinds = calls.map((c) => c.kind);
    expect(kinds).toEqual(['start', 'end', 'start']);
    const unclosed = calls[1]!.data as StepEndData;
    expect(unclosed.error?.name).toBe('StepUnclosed');
    expect(unclosed.requestId).toBe('r1');
    // 新括号在兜底收口之后开启（seq 有序保持）
    expect((calls[2]!.data as StepStartData).requestId).toBe('r2');
  });
});

describe('step-recorder 失败路径', () => {
  it('start append 失败 → 哑句柄（startSeq=null），end 不再写', async () => {
    const { writer, calls } = makeWriter({
      appendStepStart: jest.fn(async () => {
        throw new Error('disk full');
      }),
    });
    const handle = await beginStep(writer, META);
    expect(handle.startSeq).toBeNull();
    await handle.end({ usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } });
    expect(calls.filter((c) => c.kind === 'end')).toHaveLength(0);
  });

  it('start append 失败后的新 begin 不触发防御收口（哑句柄未登记）', async () => {
    const { writer, calls } = makeWriter();
    let n = 0;
    (writer.appendStepStart as jest.Mock).mockImplementation(async () => {
      n += 1;
      if (n === 1) throw new Error('disk full');
      calls.push({ kind: 'start', data: { requestId: 'r1' } });
      return 9;
    });
    await beginStep(writer, META);
    const h2 = await beginStep(writer, META);
    expect(h2.startSeq).toBe(9);
    // 关键断言：哑句柄未登记 → 第二次 begin 不触发防御 StepUnclosed 收口
    expect(calls.filter((c) => c.kind === 'end')).toHaveLength(0);
  });
});

describe('withStepBracket（辅助调用统一入口）', () => {
  it('成功路径：收口携带调用方增量，value 原样返回', async () => {
    const { writer, calls } = makeWriter();
    const value = await withStepBracket(writer, { turnId: null, step: 1, source: 'session_title', requestId: 'r9' }, async () => ({
      value: 'TITLE',
      end: {
        usage: { promptTokens: 5, completionTokens: 6, totalTokens: 11 },
        finishReason: 'stop',
      },
    }));
    expect(value).toBe('TITLE');
    const end = calls[1]!.data as StepEndData;
    expect(end.usage).toEqual({ promptTokens: 5, completionTokens: 6, totalTokens: 11 });
    expect(end.finishReason).toBe('stop');
    expect(end.error).toBeUndefined();
  });

  it('异常路径：以 error 语义收口后原样上抛（收口纪律）', async () => {
    const { writer, calls } = makeWriter();
    await expect(
      withStepBracket(writer, { turnId: null, step: 1, source: 'compaction', requestId: 'r8' }, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    const end = calls[1]!.data as StepEndData;
    expect(end.error).toEqual({ name: 'Error', message: 'boom' });
    expect(end.finishReason).toBeUndefined();
  });

  it('异常路径且 start append 失败：不写 end（括号不存在）', async () => {
    const { writer, calls } = makeWriter({
      appendStepStart: jest.fn(async () => {
        throw new Error('disk full');
      }),
    });
    await expect(
      withStepBracket(writer, { turnId: null, step: 1, source: 'compaction', requestId: 'r7' }, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(calls.filter((c) => c.kind === 'end')).toHaveLength(0);
  });
});
