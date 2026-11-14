import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TrajectoryController } from './trajectory.controller';
import { TrajectoryService } from './trajectory.service';

/**
 * 轨迹模块（对齐 dsh trajectory：JSONL 即轨迹 + 拉式投影）
 *
 * MESSAGE_STORE_TOKEN 由全局 PersistenceModule 提供；AuthGuard 依赖 JwtService
 * （AuthModule），与 usage/goal 等使用守卫的模块同款导入。
 */
@Module({
  imports: [AuthModule],
  controllers: [TrajectoryController],
  providers: [TrajectoryService],
  exports: [TrajectoryService],
})
export class TrajectoryModule {}
