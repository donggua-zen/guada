import { Controller, Get, Put, Body, UseGuards } from "@nestjs/common";
import { SettingsService } from "./settings.service";
import { AuthGuard } from "../auth/auth.guard";
import { CurrentUser } from "../auth/current-user.decorator";

@UseGuards(AuthGuard)
@Controller()
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get("settings")
  async getSettings(@CurrentUser() user: any) {
    return this.settingsService.getSettings(user.sub);
  }

  @Put("settings")
  async updateSettings(
    @Body() data: Record<string, any>,
    @CurrentUser() user: any,
  ) {
    return this.settingsService.updateSettings(user.sub, data);
  }
}
