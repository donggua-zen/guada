/// <reference types="jest" />

/**
 * 会话目标（goal/change）折叠与 CAS 门回归测试。
 *
 * 事实源只有 JSONL 事件日志：非法事件记 goalFailure 但不阻塞消息折叠；
 * CAS 门在 runExclusive 内拒绝陈旧 revision，防止旧 verifier 结果覆盖新目标。
 */
import { foldEvents, createInitialState, goalChangeError } from '../../src/common/persistence/replayer';
import type {
  BaseEvent,
  GoalChangeData,
  GoalSnapshot,
} from '../../src/common/persistence/types';

function ev(partial: Partial<BaseEvent> & { type: BaseEvent['type'] }): BaseEvent {
  return { seq: 0, time: 1700000000000, data: {}, ...partial } as BaseEvent;
}

function snapshot(over: Partial<GoalSnapshot> = {}): GoalSnapshot {
  return {
    goalId: 'goal-1',
    revision: 1,
    objective: '完成登录模块重构',
    phase: 'active',
    maxRounds: 30,
    iteration: 0,
    tokensUsed: 0,
    tokenBudget: null,
    lastVerification: null,
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
    ...over,
  };
}

function change(operation: GoalChangeData['operation'], goal: GoalSnapshot | null, seq: number): BaseEvent {
  return ev({
    type: 'goal/change',
    seq,
    data: { operation, goal } as unknown as Record<string, unknown>,
  });
}

function next(goal: GoalSnapshot, changes: Partial<GoalSnapshot> = {}): GoalSnapshot {
  return { ...goal, ...changes, revision: goal.revision + 1 };
}

describe('goal/change 折叠（事实源 = JSONL 事件日志）', () => {
  it('create → iteration → complete：last-wins 全量快照，revision 连续', () => {
    const created = snapshot();
    const iterated = next(created, { iteration: 1 });
    const completed = next(iterated, { phase: 'complete' });
    const state = foldEvents(
      [change('create', created, 1), change('iteration', iterated, 2), change('complete', completed, 3)],
      createInitialState(),
    );
    expect(state.goal?.phase).toBe('complete');
    expect(state.goal?.iteration).toBe(1);
    expect(state.goal?.revision).toBe(3);
    expect(state.goalFailure).toBeNull();
  });

  it('clear 墓碑把当前目标置空，历史留在日志', () => {
    const state = foldEvents(
      [change('create', snapshot(), 1), change('clear', null, 2)],
      createInitialState(),
    );
    expect(state.goal).toBeNull();
    expect(state.goalFailure).toBeNull();
  });

  it('非法 revision 断档 → 记 goalFailure，但消息折叠继续', () => {
    const created = snapshot();
    const bad: GoalSnapshot = { ...created, revision: 9, iteration: 1 };
    const state = foldEvents(
      [
        ev({ type: 'turn/start', seq: 1, data: { turnId: 't1', kind: 'turn', metadata: {} } }),
        change('create', created, 2),
        ev({ type: 'user/message', seq: 3, data: { messageId: 'u1', kind: 'user', blocks: [{ type: 'text', contentId: 'u1', text: '你好' }], metadata: {} } }),
        change('iteration', bad, 4),
      ],
      createInitialState(),
    );
    expect(state.goalFailure).toMatch(/revision gap/);
    expect(state.goal?.revision).toBe(1);
    // 消息仍在（goal 坏事件不能让整个会话打不开）
    expect(state.messages).toHaveLength(1);
    expect(state.lastProcessedSeq).toBe(4);
  });

  it('非法 phase 迁移（paused → complete）被拒绝', () => {
    const created = snapshot();
    const paused = next(created, { phase: 'paused' });
    const bad = next(paused, { phase: 'complete' });
    const state = foldEvents(
      [change('create', created, 1), change('pause', paused, 2), change('complete', bad, 3)],
      createInitialState(),
    );
    expect(state.goalFailure).toMatch(/illegal phase transition/);
    expect(state.goal?.phase).toBe('paused');
  });

  it('旧快照缺 goal 字段等价「无目标」，可直接 create', () => {
    const legacy = { ...createInitialState() } as any;
    delete legacy.goal;
    delete legacy.goalFailure;
    const state = foldEvents([change('create', snapshot(), 1)], legacy);
    expect(state.goal?.phase).toBe('active');
    // 旧快照无该字段时是 undefined；真实冷加载的形状守卫会补 null
    expect(state.goalFailure).toBeFalsy();
  });

  it('goalId 不匹配被拒绝', () => {
    const created = snapshot();
    const bad = next(created, { goalId: 'goal-other' });
    const state = foldEvents(
      [change('create', created, 1), change('iteration', bad, 2)],
      createInitialState(),
    );
    expect(state.goalFailure).toMatch(/goalId mismatch/);
  });
});

describe('goalChangeError 纯校验（CAS 写入前预检）', () => {
  it('create 要求 from=null 且 revision=1', () => {
    expect(goalChangeError(createInitialState(), { operation: 'create', goal: snapshot() })).toBeNull();
    expect(
      goalChangeError(createInitialState(), { operation: 'create', goal: snapshot({ revision: 2 }) }),
    ).toMatch(/revision=1/);
  });

  it('resume 仅允许 paused/blocked', () => {
    const active = { ...createInitialState(), goal: snapshot(), goalFailure: null };
    expect(goalChangeError(active, { operation: 'resume', goal: next(active.goal!, { phase: 'active' }) }))
      .toMatch(/illegal phase transition/);
    const paused = { ...active, goal: next(active.goal!, { phase: 'paused' as const }) };
    expect(goalChangeError(paused, { operation: 'resume', goal: next(paused.goal!, { phase: 'active' }) }))
      .toBeNull();
  });

  it('空 objective 被拒绝', () => {
    expect(goalChangeError(createInitialState(), { operation: 'create', goal: snapshot({ objective: '  ' }) }))
      .toMatch(/empty objective/);
  });
});
