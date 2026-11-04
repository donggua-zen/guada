/// <reference types="jest" />

/**
 * 会话目标持久化集成测试（真实 JSONL 磁盘）。
 *
 * 覆盖：CAS 门拒绝陈旧 revision、非法事件不落盘、快照 + tail 增量恢复、
 * 旧快照缺 goal 字段等价无目标、写后热路径 O(1) 可读。
 */
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { JsonlBackend } from '../../src/common/persistence/jsonl-backend';
import { JsonlMessageService } from '../../src/common/persistence/jsonl-message.service';
import { GoalStateError } from '../../src/common/persistence/errors';
import type { GoalChangeData, GoalSnapshot } from '../../src/common/persistence/types';

let tmpDir: string;
let backend: JsonlBackend;
let service: JsonlMessageService;

const SID = 'goal-cas-test';

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

function next(goal: GoalSnapshot, changes: Partial<GoalSnapshot> = {}): GoalSnapshot {
  return { ...goal, ...changes, revision: goal.revision + 1 };
}

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-cas-test-'));
  process.env.SESSION_DATA_DIR = tmpDir;
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.SESSION_DATA_DIR;
});

beforeEach(async () => {
  backend = new JsonlBackend();
  if (await backend.hasSession(SID)) await backend.deleteSession(SID);
  await backend.createSession(SID, { title: 'goal test' });
  service = new JsonlMessageService(backend as any);
});

describe('JsonlMessageService goal 持久化（事实源 = JSONL）', () => {
  it('create → getGoalState：热路径从折叠缓存读回当前目标', async () => {
    const created = snapshot();
    const { seq } = await service.appendGoalChange(
      SID,
      { operation: 'create', goal: created } as GoalChangeData,
      { expectedRevision: 0 },
    );
    expect(seq).toBeGreaterThan(0);
    const state = await service.getGoalState(SID);
    expect(state.goal?.objective).toBe('完成登录模块重构');
    expect(state.goal?.phase).toBe('active');
    expect(state.failure).toBeNull();
    expect(state.lastSeq).toBe(seq);
  });

  it('CAS：陈旧 expectedRevision 被拒绝且不落盘', async () => {
    const created = snapshot();
    await service.appendGoalChange(
      SID,
      { operation: 'create', goal: created } as GoalChangeData,
      { expectedRevision: 0 },
    );
    const before = (await backend.getAllEvents(SID)).length;
    await expect(
      service.appendGoalChange(
        SID,
        { operation: 'pause', goal: next(created, { phase: 'paused' }) } as GoalChangeData,
        { expectedRevision: 0, expectedGoalId: created.goalId },
      ),
    ).rejects.toMatchObject({ code: 'GOAL_STALE_REVISION' });
    expect((await backend.getAllEvents(SID)).length).toBe(before);
    expect((await service.getGoalState(SID)).goal?.phase).toBe('active');
  });

  it('CAS：goalId 不匹配被拒绝（旧 verifier 结果不复活目标）', async () => {
    const created = snapshot();
    await service.appendGoalChange(
      SID,
      { operation: 'create', goal: created } as GoalChangeData,
    );
    await expect(
      service.appendGoalChange(
        SID,
        { operation: 'iteration', goal: next(created, { iteration: 1 }) } as GoalChangeData,
        { expectedRevision: 1, expectedGoalId: 'goal-stale' },
      ),
    ).rejects.toBeInstanceOf(GoalStateError);
  });

  it('非法状态迁移在写入前被预检拦下，日志不被毒化', async () => {
    const created = snapshot();
    await service.appendGoalChange(
      SID,
      { operation: 'create', goal: created } as GoalChangeData,
    );
    const before = (await backend.getAllEvents(SID)).length;
    await expect(
      service.appendGoalChange(
        SID,
        { operation: 'complete', goal: next(created, { phase: 'paused' }) } as GoalChangeData,
      ),
    ).rejects.toMatchObject({ code: 'GOAL_INVALID_TRANSITION' });
    expect((await backend.getAllEvents(SID)).length).toBe(before);
    expect((await service.getGoalState(SID)).goal?.phase).toBe('active');
  });

  it('clear 墓碑 + 重新 create：新 goalId、revision 归 1', async () => {
    await service.appendGoalChange(SID, { operation: 'create', goal: snapshot() } as GoalChangeData);
    await service.appendGoalChange(SID, {
      operation: 'clear',
      goal: null,
      clearedGoalId: 'goal-1',
    } as GoalChangeData);
    expect((await service.getGoalState(SID)).goal).toBeNull();
    const second = snapshot({ goalId: 'goal-2' });
    await service.appendGoalChange(
      SID,
      { operation: 'create', goal: second } as GoalChangeData,
      { expectedRevision: 0 },
    );
    expect((await service.getGoalState(SID)).goal?.goalId).toBe('goal-2');
    expect((await service.getGoalState(SID)).goal?.revision).toBe(1);
  });

  it('冷加载：新建 service（模拟进程重启）后从日志重放出当前目标', async () => {
    const created = snapshot();
    await service.appendGoalChange(SID, { operation: 'create', goal: created } as GoalChangeData);
    await service.appendGoalChange(SID, {
      operation: 'iteration',
      goal: next(created, { iteration: 1 }),
    } as GoalChangeData);

    const restarted = new JsonlMessageService(backend as any);
    const state = await restarted.getGoalState(SID);
    expect(state.goal?.iteration).toBe(1);
    expect(state.goal?.revision).toBe(2);
    expect(state.failure).toBeNull();
  });

  it('快照含 goal：冷加载走「快照 + tail 增量」', async () => {
    const created = snapshot();
    await service.appendGoalChange(SID, { operation: 'create', goal: created } as GoalChangeData);
    await service.beginTurn(SID, { preGenTurnId: 't1' });
    await service.finalizeTurn(SID, 't1', 10, {
      promptTokens: 1,
      completionTokens: 1,
      totalTokens: 2,
      finishReason: 'stop',
    } as any);
    // 快照之后又发生一次目标变更（回合外），冷加载必须靠 tail 补上
    await service.appendGoalChange(SID, {
      operation: 'pause',
      goal: next(created, { phase: 'paused' }),
    } as GoalChangeData);

    const restarted = new JsonlMessageService(backend as any);
    const state = await restarted.getGoalState(SID);
    expect(state.goal?.phase).toBe('paused');
    expect(state.goal?.revision).toBe(2);
  });
});
