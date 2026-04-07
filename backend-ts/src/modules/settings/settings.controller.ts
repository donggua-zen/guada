import { Controller, Get, Put, Body } from '@nestjs/common';
import { SettingsService } from './settings.service';

@Controller()
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get('settings')
  async getSettings() {
    return this.settingsService.getSettings();
  }

  @Put('settings')
  async updateSettings(@Body() data: Record<string, any>) {
    return this.settingsService.updateSettings(data);
  }
}
