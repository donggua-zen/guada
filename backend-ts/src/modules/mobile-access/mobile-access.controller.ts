import { Body, Controller, Get, Post, Put, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard";
import { MobileAccessService } from "./mobile-access.service";
import type { MobileAccessConfigInput } from "./mobile-access.types";

@Controller("mobile-access")
@UseGuards(AuthGuard)
export class MobileAccessController {
  constructor(private readonly mobileAccess: MobileAccessService) {}

  /** 当前配置（脱敏：永不返回 SSH 密码） */
  @Get("config")
  async getConfig() {
    return this.mobileAccess.getConfigView();
  }

  /** 保存配置；公网开关即时生效，局域网开关需重启应用 */
  @Put("config")
  async updateConfig(@Body() body: MobileAccessConfigInput) {
    return this.mobileAccess.updateConfig(body);
  }

  /** 实时状态：局域网地址、公网隧道状态与错误 */
  @Get("status")
  async getStatus() {
    return this.mobileAccess.getStatus();
  }

  /** 手动重连公网隧道（配置修正后无需重启应用） */
  @Post("tunnel/reconnect")
  async reconnectTunnel() {
    return this.mobileAccess.reconnectTunnel();
  }
}
