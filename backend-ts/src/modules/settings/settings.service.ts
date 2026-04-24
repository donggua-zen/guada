import { Injectable } from "@nestjs/common";
import { GlobalSettingRepository } from "../../common/database/global-setting.repository";

@Injectable()
export class SettingsService {
  private readonly DEFAULT_KEYS = [
    "defaultChatModelId",
    "defaultSearchModelId",
    "defaultSummaryModelId",
    "searchPromptContextLength",
    "defaultTitleSummaryModelId",
    "defaultTitleSummaryPrompt",
    "defaultTranslationModelId",
    "defaultTranslationPrompt",
    "defaultHistoryCompressionModelId",
    "defaultHistoryCompressionPrompt",
    "defaultVisualAssistantModelId",
  ];

  constructor(private settingRepo: GlobalSettingRepository) {}

  async getSettings(userId: string) {
    const allSettings = await this.settingRepo.findAll(userId);
    const settingsMap: Record<string, any> = {};

    // 初始化默认值
    this.DEFAULT_KEYS.forEach((key) => {
      settingsMap[key] = null;
    });

    // 覆盖数据库中的值（假设数据库中已统一使用驼峰命名）
    allSettings.forEach((item) => {
      // 尝试将字符串值反序列化为对象
      try {
        if (item.value && typeof item.value === 'string') {
          settingsMap[item.key] = JSON.parse(item.value);
        } else {
          settingsMap[item.key] = item.value;
        }
      } catch {
        // 如果不是有效的 JSON，直接使用原始值
        settingsMap[item.key] = item.value;
      }
    });

    return settingsMap;
  }

  async updateSettings(userId: string, data: Record<string, any>) {
    // 直接使用驼峰命名存储到数据库
    const updates = Object.entries(data).map(([key, value]) => ({
      key,
      value,
      userId,
    }));

    await this.settingRepo.saveBatch(updates);
    return this.getSettings(userId);
  }

  /**
   * 获取免登录配置状态
   */
  async getAutoLoginEnabled(): Promise<boolean> {
    try {
      const setting = await this.settingRepo.findByKey("autoLoginEnabled", null);
      if (!setting) {
        return false;
      }
      return setting.value === "true";
    } catch (error) {
      console.error("获取免登录配置失败:", error);
      return false;
    }
  }

  /**
   * 设置免登录配置状态
   */
  async setAutoLoginEnabled(enabled: boolean): Promise<void> {
    try {
      await this.settingRepo.upsert({
        key: "autoLoginEnabled",
        value: enabled ? "true" : "false",
        userId: null,
      });
    } catch (error) {
      console.error("设置免登录配置失败:", error);
      throw error;
    }
  }
}
