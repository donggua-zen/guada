/**
 * 轨迹 REST（GET /api/v1/sessions/:sessionId/trajectory）
 *
 * 台账数据源：共享时间线 + step 卡。limit 截取最近 N 个调用卡（缺省 200），
 * 时间线始终全量返回（前端按 seq 区间切片组装 IN/OUT）。
 */
import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { TrajectoryService } from './trajectory.service';

@Controller()
@UseGuards(AuthGuard)
export class TrajectoryController {
  constructor(private readonly trajectoryService: TrajectoryService) {}

  @Get('sessions/:sessionId/trajectory')
  async getTrajectory(
    @Param('sessionId') sessionId: string,
    @Query('limit') limit?: string,
  ) {
    const parsed = limit !== undefined ? Number.parseInt(limit, 10) : NaN;
    return this.trajectoryService.getTrajectory(
      sessionId,
      Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 1000) : 200,
    );
  }
}
