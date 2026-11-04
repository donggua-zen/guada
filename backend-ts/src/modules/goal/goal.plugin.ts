/**
 * 会话目标插件 — 只做一件事：每轮把当前目标以 transient 提醒注入模型请求。
 *
 * transient = 不落库、用户不可见，与计划模式 reminder 同一通道。
 * 目标状态从 IMessageStore 的折叠态读取（热路径 O(1) 内存缓存）。
 */
import { Inject, Injectable } from '@nestjs/common';
import { PluginBase } from '../plugins/base-plugin';
import { PluginApi } from '../plugins/api/plugin-api';
import type {
  TurnReminderProvider,
  TurnReminderProviderInput,
} from '../plugins/turn-reminders/turn-reminder.types';
import type { Message } from '../../common/types/conversation.types';
import {
  IMessageStore,
  MESSAGE_STORE_TOKEN,
} from '../../common/persistence/message-store.interface';
import { wrapSystemReminder } from '../../common/utils/system-reminder.util';

function createGoalReminderProvider(
  messageStore: IMessageStore,
): TurnReminderProvider {
  return {
    id: 'goal-state',
    order: 105, // plan-mode=100 之后、todo=110 之前
    async build(input: TurnReminderProviderInput): Promise<{ transient: Message[] }> {
      const state = await messageStore.getGoalState(input.sessionContext.sessionId);
      const goal = state.goal;
      if (!goal || goal.phase !== 'active' || state.failure) return { transient: [] };
      const text = [
        '[Current session goal — authoritative]',
        `Objective: ${goal.objective}`,
        `Round: ${goal.iteration}/${goal.maxRounds}`,
        'An independent verifier decides completion after each turn — do NOT mark the goal complete yourself.',
        'Keep making concrete progress toward the objective.',
      ].join('\n');
      return {
        transient: [
          {
            id: `goal-reminder-${input.iterationCount}`,
            role: 'user',
            kind: 'model',
            source: { kind: 'plugin', plugin: 'goal' },
            metadata: { hidden: true, goalReminder: true },
            content: [{ type: 'text', text: wrapSystemReminder(text) }],
          } as Message,
        ],
      };
    },
  };
}

@Injectable()
export class GoalPlugin extends PluginBase {
  manifest = {
    id: 'goal',
    name: '会话目标',
    description: '会话目标自动推进：每轮注入当前目标，回合结束后由独立校验器裁定完成',
    version: '1.0.0',
    category: 'system' as const,
    essential: true,
  };

  constructor(
    @Inject(MESSAGE_STORE_TOKEN) private readonly messageStore: IMessageStore,
  ) {
    super();
  }

  async onLoad(api: PluginApi): Promise<void> {
    api.registerTurnReminderProvider(createGoalReminderProvider(this.messageStore));
  }
}
