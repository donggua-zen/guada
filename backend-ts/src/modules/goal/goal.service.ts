/**
 * 会话目标服务 — 状态的唯一写入口。
 *
 * 事实源是 JSONL 事件日志（`goal/change`），本服务不持有状态副本；
 * 唯一的进程内状态是 `armed`（激活态，重启即失效，须显式 resume，对齐 DSH）。
 *
 * 所有写操作经 `IMessageStore.appendGoalChange` 的 CAS 门：在 runExclusive 临界区内
 * 完成「读折叠态 → 校验期望版本 → 预检状态迁移 → 追加 → 增量 fold」。
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  GoalChangeData,
  GoalFoldState,
  GoalSnapshot,
  GoalVerificationResult,
} from '../../common/persistence/types';
import {
  IMessageStore,
  MESSAGE_STORE_TOKEN,
} from '../../common/persistence/message-store.interface';
import { GoalStateError } from '../../common/persistence/errors';
import { EventBusService } from '../../common/events/event-bus.service';
import { HOOKS } from '../chat/types/hooks.contract';
import {
  DEFAULT_MAX_GOAL_ROUNDS,
  GoalStateResponse,
  GoalVerification,
} from './goal.types';

@Injectable()
export class GoalService {
  private readonly logger = new Logger(GoalService.name);
  /**
   * 进程内激活态：只有显式 set/resume 才 arm；进程重启后自动清空。
   * 与 DSH 的 GoalActivation 同义——恢复/fork/重启后目标存在但不会自己跑起来。
   */
  private readonly armedSessions = new Set<string>();

  constructor(
    @Inject(MESSAGE_STORE_TOKEN) private readonly messageStore: IMessageStore,
    private readonly eventBus: EventBusService,
  ) {}

  isArmed(sessionId: string): boolean {
    return this.armedSessions.has(sessionId);
  }

  private arm(sessionId: string): void {
    this.armedSessions.add(sessionId);
  }

  private disarm(sessionId: string): void {
    this.armedSessions.delete(sessionId);
  }

  async getState(sessionId: string): Promise<GoalStateResponse> {
    const state = await this.messageStore.getGoalState(sessionId);
    return {
      goal: state.goal,
      lastSeq: state.lastSeq,
      failure: state.failure,
      armed: this.isArmed(sessionId),
    };
  }

  /** 写成功后广播 goal_updated（非流事件，前端靠 REST 重拉） */
  private notify(sessionId: string, action: string, state: GoalStateResponse): void {
    this.eventBus.emit(HOOKS.GOAL_UPDATED, {
      sessionId,
      timestamp: new Date().toISOString(),
      payload: { action, goal: state.goal, lastSeq: state.lastSeq, failure: state.failure },
    });
  }

  private async commit(
    sessionId: string,
    data: GoalChangeData,
    options?: { expectedRevision?: number; expectedGoalId?: string },
    action: string = data.operation,
  ): Promise<GoalStateResponse> {
    await this.messageStore.appendGoalChange(sessionId, data, options);
    const state = await this.getState(sessionId);
    this.notify(sessionId, action, state);
    return state;
  }

  /** 设定目标；已有目标时先 clear 再 create（每次 create 换新 goalId + revision=1） */
  async setGoal(
    sessionId: string,
    objective: string,
    maxRounds = DEFAULT_MAX_GOAL_ROUNDS,
    expectedRevision?: number,
  ): Promise<GoalStateResponse> {
    const current = await this.messageStore.getGoalState(sessionId);
    if (current.failure) {
      throw new GoalStateError(
        `goal state is corrupt for ${sessionId}: ${current.failure}`,
        'GOAL_STATE_CORRUPT',
      );
    }
    const hadGoal = !!current.goal;
    if (current.goal) {
      await this.messageStore.appendGoalChange(
        sessionId,
        {
          operation: 'clear',
          goal: null,
          clearedGoalId: current.goal.goalId,
          reason: 'replaced by new objective',
        },
        { expectedRevision, expectedGoalId: current.goal.goalId },
      );
    }
    const now = Date.now();
    const snapshot: GoalSnapshot = {
      goalId: `goal-${randomUUID()}`,
      revision: 1,
      objective: objective.trim(),
      phase: 'active',
      maxRounds,
      iteration: 0,
      tokensUsed: 0,
      tokenBudget: null,
      lastVerification: null,
      createdAt: now,
      updatedAt: now,
    };
    const state = await this.commit(
      sessionId,
      { operation: 'create', goal: snapshot },
      // clear 后折叠态已无目标（currentRevision=0），create 的期望版本须归零；
      // 若两次写入之间有并发 create，CAS 会正确拒绝而不是静默覆盖。
      { expectedRevision: hadGoal ? 0 : expectedRevision },
      'set',
    );
    this.arm(sessionId);
    return { ...state, armed: true };
  }

  async pause(
    sessionId: string,
    expectedRevision?: number,
    reason = 'paused by user',
  ): Promise<GoalStateResponse> {
    const state = await this.requireActive(sessionId);
    const next = await this.commit(
      sessionId,
      {
        operation: 'pause',
        goal: this.patch(state.goal!, { phase: 'paused' }, reason),
        reason,
      },
      { expectedRevision, expectedGoalId: state.goal!.goalId },
      'paused',
    );
    this.disarm(sessionId);
    return next;
  }

  /**
   * 恢复：phase=active 但进程内未 armed（重启后）时只重新 arm，不写事件；
   * paused/blocked 时写 resume 事件（phase→active）。
   */
  async resume(sessionId: string, expectedRevision?: number): Promise<GoalStateResponse> {
    const state = await this.messageStore.getGoalState(sessionId);
    if (state.failure) {
      throw new GoalStateError(
        `goal state is corrupt for ${sessionId}: ${state.failure}`,
        'GOAL_STATE_CORRUPT',
      );
    }
    const goal = state.goal;
    if (!goal) {
      throw new GoalStateError('no goal to resume', 'GOAL_INVALID_TRANSITION');
    }
    if (goal.phase === 'active') {
      this.arm(sessionId);
      const current = await this.getState(sessionId);
      this.notify(sessionId, 'resumed', current);
      return current;
    }
    const next = await this.commit(
      sessionId,
      { operation: 'resume', goal: this.patch(goal, { phase: 'active' }, 'resumed by user') },
      { expectedRevision, expectedGoalId: goal.goalId },
      'resumed',
    );
    this.arm(sessionId);
    return { ...next, armed: true };
  }

  async clear(sessionId: string, expectedRevision?: number): Promise<GoalStateResponse> {
    const state = await this.messageStore.getGoalState(sessionId);
    if (!state.goal) return { ...state, armed: false };
    const next = await this.commit(
      sessionId,
      {
        operation: 'clear',
        goal: null,
        clearedGoalId: state.goal.goalId,
      },
      { expectedRevision, expectedGoalId: state.goal.goalId },
      'cleared',
    );
    this.disarm(sessionId);
    return next;
  }

  /**
   * 校验器结果回写（供 GoalVerifierService 调用）。
   * 携带发起时的 goalId + revision，CAS 拒绝即丢弃本次结果，防止旧结果复活目标。
   */
  async applyVerification(
    sessionId: string,
    expected: { goalId: string; revision: number; iteration: number },
    result: GoalVerification | null,
    failureReason: string | null,
  ): Promise<{ state: GoalStateResponse; shouldContinue: boolean; nextAction: string | null }> {
    const state = await this.messageStore.getGoalState(sessionId);
    const goal = state.goal;
    if (!goal || goal.goalId !== expected.goalId || goal.revision !== expected.revision) {
      // 目标已被改/清除：本次校验结果陈旧，直接丢弃
      return { state: { ...state, armed: this.isArmed(sessionId) }, shouldContinue: false, nextAction: null };
    }
    const verification: GoalVerificationResult = {
      passed: result?.passed ?? false,
      reason: result?.reason ?? failureReason ?? 'verifier produced no usable result',
      nextAction: result?.nextAction ?? null,
      at: Date.now(),
    };
    const options = { expectedRevision: expected.revision, expectedGoalId: goal.goalId };

    if (result?.passed) {
      const next = await this.commit(
        sessionId,
        { operation: 'complete', goal: this.patch(goal, { phase: 'complete' }, verification.reason, verification) },
        options,
        'complete',
      );
      this.disarm(sessionId);
      return { state: { ...next, armed: false }, shouldContinue: false, nextAction: null };
    }

    if (goal.iteration + 1 >= goal.maxRounds) {
      const next = await this.commit(
        sessionId,
        {
          operation: 'budget_limited',
          goal: this.patch(goal, { phase: 'budget_limited' }, 'round limit reached', verification),
          reason: 'round limit reached',
        },
        options,
        'budget_limited',
      );
      this.disarm(sessionId);
      return { state: { ...next, armed: false }, shouldContinue: false, nextAction: null };
    }

    // 校验器故障 / 无 nextAction → 显式暂停（不静默判完成、不无限续跑）
    if (!result || !result.nextAction) {
      const next = await this.commit(
        sessionId,
        {
          operation: 'pause',
          goal: this.patch(goal, { phase: 'paused' }, verification.reason, verification),
          reason: verification.reason,
        },
        options,
        'paused',
      );
      this.disarm(sessionId);
      return { state: { ...next, armed: false }, shouldContinue: false, nextAction: null };
    }

    const next = await this.commit(
      sessionId,
      {
        operation: 'iteration',
        goal: this.patch(goal, {}, verification.reason, verification),
        reason: verification.reason,
      },
      options,
      'iteration',
    );
    return { state: next, shouldContinue: true, nextAction: result.nextAction };
  }

  /** 用户停止 / 流异常时暂停目标（不自动重试） */
  async pauseOnInterruption(sessionId: string, reason: string): Promise<void> {
    const state = await this.messageStore.getGoalState(sessionId);
    const goal = state.goal;
    if (!goal || goal.phase !== 'active' || state.failure) return;
    try {
      await this.commit(
        sessionId,
        { operation: 'pause', goal: this.patch(goal, { phase: 'paused' }, reason), reason },
        { expectedRevision: goal.revision, expectedGoalId: goal.goalId },
        'paused',
      );
      this.disarm(sessionId);
    } catch (error: any) {
      this.logger.warn(`Failed to pause goal on interruption for ${sessionId}: ${error?.message}`);
    }
  }

  private async requireActive(sessionId: string): Promise<GoalFoldState> {
    const state = await this.messageStore.getGoalState(sessionId);
    if (state.failure) {
      throw new GoalStateError(
        `goal state is corrupt for ${sessionId}: ${state.failure}`,
        'GOAL_STATE_CORRUPT',
      );
    }
    if (!state.goal || state.goal.phase !== 'active') {
      throw new GoalStateError('goal is not active', 'GOAL_INVALID_TRANSITION');
    }
    return state;
  }

  /** 生成下一版快照：revision+1、iteration+1（iteration 操作）、updatedAt 刷新 */
  private patch(
    goal: GoalSnapshot,
    changes: Partial<Pick<GoalSnapshot, 'phase'>>,
    reason: string,
    verification?: GoalVerificationResult,
  ): GoalSnapshot {
    const iterationBump = changes.phase === undefined && !!verification && !verification.passed;
    return {
      ...goal,
      ...changes,
      revision: goal.revision + 1,
      iteration: iterationBump ? goal.iteration + 1 : goal.iteration,
      lastVerification: verification ?? goal.lastVerification ?? null,
      blockedReason: changes.phase === 'blocked' || changes.phase === 'budget_limited'
        ? reason
        : null,
      updatedAt: Date.now(),
    };
  }
}
