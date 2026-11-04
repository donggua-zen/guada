/**
 * 会话目标完成校验器 — 回合结束后判定是否达成，未达成则自动续跑下一轮。
 *
 * 设计对齐 zcode：
 * - 独立的无工具模型调用（模型不得自判完成）
 * - 回写携带发起时的 goalId + revision，CAS 拒绝即丢弃陈旧结果
 * - 校验器故障 / 无 nextAction → 显式暂停，不静默判完成、不无限续跑
 *
 * 触发点：`chat.turn_finished`（ChatRunner finally 发出，fire-and-forget），
 * 因此本监听器必须自行捕获全部异常，不能让 rejection 逃逸。
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { randomUUID } from 'crypto';
import {
  IMessageStore,
  MESSAGE_STORE_TOKEN,
} from '../../common/persistence/message-store.interface';
import { LLMService } from '../llm-core/llm.service';
import type { LLMCompletionResult } from '../llm-core/types/llm.types';
import { ProviderFileStore } from '../llm-core/provider-file.store';
import { toRuntimeProviderConfig } from '../llm-core/utils/provider-runtime.util';
import { resolveThinkingEffort } from '../llm-core';
import { SessionService } from '../chat/session.service';
import { ChatRunnerService } from '../chat/chat-runner.service';
import { wrapSystemReminder } from '../../common/utils/system-reminder.util';
import { GoalService } from './goal.service';
import {
  buildGoalContinuationPrompt,
  buildGoalVerificationPrompt,
  parseGoalVerification,
} from './goal.types';

interface TurnFinishedEvent {
  sessionId: string;
  sessionType?: string;
  reason?: string;
  normalFinish: boolean;
}

@Injectable()
export class GoalVerifierService {
  private readonly logger = new Logger(GoalVerifierService.name);
  /** 防重入：同一会话同时只跑一次校验 */
  private readonly inFlight = new Set<string>();

  constructor(
    private readonly goalService: GoalService,
    private readonly sessionService: SessionService,
    private readonly chatRunner: ChatRunnerService,
    private readonly llmService: LLMService,
    private readonly modelStore: ProviderFileStore,
    @Inject(MESSAGE_STORE_TOKEN) private readonly messageStore: IMessageStore,
  ) {}

  @OnEvent('chat.turn_finished')
  async handleTurnFinished(event: TurnFinishedEvent): Promise<void> {
    try {
      await this.onTurnFinished(event);
    } catch (error: any) {
      // fire-and-forget 监听器：异常必须在此收口
      this.logger.warn(
        `[goal] verifier failed for ${event?.sessionId}: ${error?.message ?? error}`,
      );
      if (event?.sessionId) {
        await this.goalService.pauseOnInterruption(
          event.sessionId,
          `verifier error: ${error?.message ?? 'unknown'}`,
        );
      }
    }
  }

  private async onTurnFinished(event: TurnFinishedEvent): Promise<void> {
    const { sessionId } = event;
    if (!sessionId) return;
    if (event.sessionType === 'sub_agent' || event.sessionType === 'bot') return;

    // 用户取消 / 流异常 → 暂停目标，不自动重试
    if (!event.normalFinish) {
      await this.goalService.pauseOnInterruption(
        sessionId,
        `turn ended abnormally (${event.reason ?? 'unknown'})`,
      );
      return;
    }

    const state = await this.goalService.getState(sessionId);
    const goal = state.goal;
    if (!goal || goal.phase !== 'active') return;
    if (state.failure) return;
    // 进程内激活态：重启后一律 disarmed，必须显式 resume（DSH 语义）
    if (!this.goalService.isArmed(sessionId)) return;
    if (this.inFlight.has(sessionId)) return;

    // 计划模式与目标模式互斥（事实源是 session.settings.planEnabled）
    const session = await this.sessionService.getSessionById(sessionId);
    if (!session) return;
    if ((session.settings as Record<string, unknown> | undefined)?.planEnabled === true) return;

    if (goal.iteration >= goal.maxRounds) return;

    this.inFlight.add(sessionId);
    const expected = {
      goalId: goal.goalId,
      revision: goal.revision,
      iteration: goal.iteration,
    };
    try {
      const result = await this.verify(sessionId, goal.objective);
      const applied = await this.goalService.applyVerification(
        sessionId,
        expected,
        result.verification,
        result.failureReason,
      );
      if (applied.shouldContinue && applied.nextAction && applied.state.goal) {
        const snapshot = applied.state.goal;
        await this.chatRunner.enqueueMessage({
          sessionId,
          blocks: [
            {
              type: 'text',
              text: wrapSystemReminder(
                buildGoalContinuationPrompt(snapshot, applied.nextAction),
              ),
            },
          ],
          source: {
            kind: 'goal',
            goalId: snapshot.goalId,
            iteration: snapshot.iteration,
            hidden: true,
          },
        });
      }
    } finally {
      this.inFlight.delete(sessionId);
    }
  }

  /** 独立无工具模型调用；任何失败返回 verification=null + 原因，不抛给调用链 */
  private async verify(
    sessionId: string,
    objective: string,
  ): Promise<{ verification: ReturnType<typeof parseGoalVerification>; failureReason: string | null }> {
    const model = await this.resolveModel(sessionId);
    if (!model) {
      return { verification: null, failureReason: 'no model configured for goal verification' };
    }
    const recent = await this.recentExcerpt(sessionId);
    try {
      const response = (await this.llmService.completions({
        model: model.modelName,
        messages: [
          {
            id: `goal-verifier-${randomUUID()}`,
            role: 'user',
            kind: 'user',
            source: { kind: 'user' },
            metadata: {},
            content: [{ type: 'text', text: buildGoalVerificationPrompt(objective, recent) }],
          },
        ],
        temperature: 0.1,
        maxTokens: 400,
        thinkingEffort: resolveThinkingEffort(model, 'none'),
        stream: false,
        providerConfig: toRuntimeProviderConfig(model.provider),
        purpose: 'goal_verification',
        usageContext: { sessionId },
        abortSignal: AbortSignal.timeout(60_000),
      } as any)) as LLMCompletionResult;
      const content = typeof response?.content === 'string' ? response.content : '';
      const parsed = parseGoalVerification(content);
      if (!parsed) {
        return { verification: null, failureReason: 'verifier returned no usable JSON' };
      }
      return { verification: parsed, failureReason: null };
    } catch (error: any) {
      this.logger.warn(`[goal] verification call failed for ${sessionId}: ${error?.message ?? error}`);
      return {
        verification: null,
        failureReason: `verifier call failed: ${error?.message ?? 'unknown'}`,
      };
    }
  }

  /** 会话模型优先，回退智能体模型；不引入全局默认模型，避免与主链路口径漂移 */
  private async resolveModel(sessionId: string): Promise<any | null> {
    const session = await this.sessionService.getSessionById(sessionId);
    const modelId = (session?.modelId ?? session?.agent?.modelId) as string | undefined;
    if (!modelId) return null;
    return this.modelStore.findModel(modelId) ?? null;
  }

  /** 最近可见对话摘要（过滤 hidden 注入消息，控制 token） */
  private async recentExcerpt(sessionId: string): Promise<string> {
    try {
      const messages = await this.messageStore.loadContext({ sessionId, maxMessages: 8 });
      return messages
        .filter((m) => !m.metadata?.hidden)
        .map((m) => {
          const text = (m.content ?? [])
            .map((b: any) => (b?.type === 'text' ? b.text : b?.type === 'tool-result' ? b.content : ''))
            .join('')
            .trim();
          return text ? `${m.role}: ${text.slice(0, 1200)}` : '';
        })
        .filter(Boolean)
        .slice(-6)
        .join('\n');
    } catch (error: any) {
      this.logger.warn(`[goal] failed to load recent context for ${sessionId}: ${error?.message}`);
      return '';
    }
  }
}
