import { Controller, Get, Put, Body, UseGuards, Post } from "@nestjs/common";
import { SettingsService } from "./settings.service";
import { AuthGuard } from "../auth/auth.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { Public } from "../auth/public.decorator";

@Controller()
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) { }

  @UseGuards(AuthGuard)
  @Get("settings")
  async getSettings(@CurrentUser() user: any) {
    return this.settingsService.getSettings(user.sub);
  }

  @UseGuards(AuthGuard)
  @Put("settings")
  async updateSettings(
    @Body() data: Record<string, any>,
    @CurrentUser() user: any,
  ) {
    return this.settingsService.updateSettings(user.sub, data);
  }

  /**
   * 获取免登录状态 - 公开访问
   */
  @Public()
  @Get("settings/auto-login")
  async getAutoLoginStatus() {
    const enabled = await this.settingsService.getAutoLoginEnabled();
    return { enabled };
  }

  /**
   * 设置免登录状态 - 需要认证
   */
  @UseGuards(AuthGuard)
  @Post("settings/auto-login")
  async setAutoLoginStatus(
    @Body() body: { enabled: boolean },
    @CurrentUser() user: any,
  ) {
    await this.settingsService.setAutoLoginEnabled(body.enabled);
    return { success: true };
  }
}
