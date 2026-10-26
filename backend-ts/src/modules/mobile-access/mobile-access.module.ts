import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { MobileAccessController } from "./mobile-access.controller";
import { MobileAccessService } from "./mobile-access.service";
import { SshTunnelService } from "./ssh-tunnel.service";

/**
 * 移动访问模块：局域网 + 公网（SSH 反向隧道）。
 * SettingsStorage 由全局 SharedModule 提供，无需显式 import。
 */
@Module({
  imports: [AuthModule],
  controllers: [MobileAccessController],
  providers: [MobileAccessService, SshTunnelService],
  exports: [MobileAccessService],
})
export class MobileAccessModule {}
