/**
 * `/goal` 斜杠命令处理器。
 *
 * 语法（与前端词表、i18n 一致）：
 *   /goal <objective>              设定（已有目标时替换）
 *   /goal pause|resume|clear       控制
 *   /goal edit <objective>         等价于设定
 *
 * 命令文本不进模型上下文；执行结果经 REST/SSE 同步到前端胶囊。
 */
import { BadRequestException, Injectable } from '@nestjs/common';
import { GoalService } from './goal.service';
import { GoalStateError } from '../../common/persistence/errors';
import { SessionService } from '../chat/session.service';
import type {
  LocalSlashCommandContext,
  LocalSlashCommandResult,
} from '../chat/commands/local-slash-command.registry';
import { DEFAULT_MAX_GOAL_ROUNDS } from './goal.types';

const CONTROL_WORDS = new Set(['pause', 'resume', 'clear']);

@Injectable()
export class GoalCommandHandler {
  constructor(
    private readonly goalService: GoalService,
    private readonly sessionService: SessionService,
  ) {}

  async handle(ctx: LocalSlashCommandContext): Promise<LocalSlashCommandResult> {
    const raw = (ctx.args ?? '').trim();
    const [first, ...rest] = raw.split(/\s+/);
    const word = (first ?? '').toLowerCase();

    try {
      if (!raw) {
        // 与前端一致：/goal 无参数即空目标，后端也拒绝（避免绕过前端时行为分叉）
        throw new BadRequestException({
          error: '请提供目标内容，例如 /goal 完成登录模块重构',
          code: 'GOAL_REQUIRES_OBJECTIVE',
        });
      }
      if (CONTROL_WORDS.has(word) && rest.length === 0) {
        if (word === 'pause') {
          const state = await this.goalService.getState(ctx.sessionId);
          await this.goalService.pause(ctx.sessionId, state.goal?.revision);
          return { action: 'paused' };
        }
        if (word === 'resume') {
          const state = await this.goalService.getState(ctx.sessionId);
          await this.goalService.resume(ctx.sessionId, state.goal?.revision);
          return { action: 'resumed' };
        }
        const state = await this.goalService.getState(ctx.sessionId);
        await this.goalService.clear(ctx.sessionId, state.goal?.revision);
        return { action: 'cleared' };
      }
      const objective = word === 'edit' ? rest.join(' ').trim() : raw;
      if (!objective) {
        throw new BadRequestException({
          error: '请提供目标内容，例如 /goal 完成登录模块重构',
          code: 'GOAL_REQUIRES_OBJECTIVE',
        });
      }
      // 计划模式互斥（前端也拦一道，这里是权威门控）
      const session = await this.sessionService.getSessionById(ctx.sessionId);
      if ((session?.settings as Record<string, unknown> | undefined)?.planEnabled === true) {
        throw new BadRequestException({
          error: '计划模式与目标模式互斥，请先关闭计划模式',
          code: 'GOAL_PLAN_CONFLICT',
        });
      }
      const state = await this.goalService.getState(ctx.sessionId);
      await this.goalService.setGoal(
        ctx.sessionId,
        objective,
        DEFAULT_MAX_GOAL_ROUNDS,
        state.goal?.revision,
      );
      return { action: 'set', objective };
    } catch (error: any) {
      if (error instanceof GoalStateError) {
        throw new BadRequestException({ error: error.message, code: error.code });
      }
      throw error;
    }
  }
}
