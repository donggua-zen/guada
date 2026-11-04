/**
 * 会话目标 REST 接口。
 *
 * 事实源是 JSONL 事件日志，不查 `_meta.db` 的目标表（也不存在这样的表）。
 * `GET` 走 `IMessageStore.getGoalState()` 的折叠态缓存（热路径 O(1)）。
 */
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { SessionService } from '../chat/session.service';
import { GoalStateError } from '../../common/persistence/errors';
import { GoalService } from './goal.service';
import { GoalMutationDto, SetGoalDto } from './dto/goal.dto';

@Controller()
@UseGuards(AuthGuard)
export class GoalController {
  constructor(
    private readonly goalService: GoalService,
    private readonly sessionService: SessionService,
  ) {}

  private async assertSession(id: string): Promise<void> {
    const session = await this.sessionService.getSessionById(id);
    if (!session) throw new NotFoundException('Session not found');
  }

  /** CAS/非法迁移 → 409，折叠态损坏 → 409（前端提示后不再盲目重试） */
  private rethrow(error: unknown): never {
    if (error instanceof GoalStateError) {
      // 附带稳定 code 便于前端区分「陈旧版本」与「折叠态损坏」
      throw new HttpException(
        { error: error.message, code: error.code },
        HttpStatus.CONFLICT,
      );
    }
    throw error;
  }

  @Get('sessions/:id/goal')
  async getGoal(@Param('id') id: string) {
    await this.assertSession(id);
    return this.goalService.getState(id);
  }

  @Put('sessions/:id/goal')
  async setGoal(@Param('id') id: string, @Body() dto: SetGoalDto) {
    await this.assertSession(id);
    try {
      return await this.goalService.setGoal(
        id,
        dto.objective,
        dto.maxRounds,
        dto.expectedRevision,
      );
    } catch (error) {
      return this.rethrow(error);
    }
  }

  @Delete('sessions/:id/goal')
  @HttpCode(HttpStatus.OK)
  async clearGoal(@Param('id') id: string, @Body() dto: GoalMutationDto) {
    await this.assertSession(id);
    try {
      return await this.goalService.clear(id, dto?.expectedRevision);
    } catch (error) {
      return this.rethrow(error);
    }
  }

  @Post('sessions/:id/goal/pause')
  async pauseGoal(@Param('id') id: string, @Body() dto: GoalMutationDto) {
    await this.assertSession(id);
    try {
      return await this.goalService.pause(id, dto?.expectedRevision, dto?.reason);
    } catch (error) {
      return this.rethrow(error);
    }
  }

  @Post('sessions/:id/goal/resume')
  async resumeGoal(@Param('id') id: string, @Body() dto: GoalMutationDto) {
    await this.assertSession(id);
    try {
      return await this.goalService.resume(id, dto?.expectedRevision);
    } catch (error) {
      return this.rethrow(error);
    }
  }
}
