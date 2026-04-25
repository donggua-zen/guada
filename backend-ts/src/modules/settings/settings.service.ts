import { Injectable, Logger } from "@nestjs/common";
import * as path from 'path';
import { SettingsStorage } from '../../common/utils/settings-storage.util';
import {
  SG_SYSTEM,
  SG_MODELS,
  SG_TOOLS,
} from '../../constants/settings.constants';

@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);

  constructor(private readonly storage: SettingsStorage) {}

  /**
   * 获取分组内所有设置
   */
  async getGroupSettings(group: string): Promise<any> {
    return this.storage.getSettings(group);
  }

  /**
   * 更新分组内的一个或多个设置项，并自动保存
   */
  async updateGroupSettings(group: string, data: Record<string, any>): Promise<void> {
    this.storage.updateSettings(group, data);
  }

  /**
   * 获取单个设置项的值
   */
  async getSettingValue(group: string, key: string, defaultValue: any = null): Promise<any> {
    return this.storage.getSettingValue(group, key, defaultValue);
  }

  /**
   * 获取所有设置（合并所有分组，仅用于前端初始化）
   */
  async getSettings() {
    const result: Record<string, any> = {};
    const groups = [SG_SYSTEM, SG_MODELS, SG_TOOLS];
    
    for (const group of groups) {
      const groupData = await this.getGroupSettings(group);
      if (group === SG_TOOLS) {
        result['tools'] = groupData;
      } else {
        Object.assign(result, groupData);
      }
    }
    return result;
  }

  /**
   * 获取免登录配置状态
   */
  async getAutoLoginEnabled(): Promise<boolean> {
    const val = await this.getSettingValue(SG_SYSTEM, 'autoLoginEnabled', false);
    return val === true || val === 'true';
  }

  /**
   * 设置免登录配置状态
   */
  async setAutoLoginEnabled(enabled: boolean): Promise<void> {
    await this.updateGroupSettings(SG_SYSTEM, { autoLoginEnabled: enabled });
  }
}
