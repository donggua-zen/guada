import { Injectable } from "@nestjs/common";
import { GlobalSettingRepository } from "../../common/database/global-setting.repository";

@Injectable()
export class SettingsService {
  private readonly DEFAULT_KEYS = [
    "defaultChatModelId",
    "defaultSearchModelId",
    "defaultSummaryModelId",
    "searchPromptContextLength",
    "searchApiKey",
    "summaryModelId",
    "summaryPrompt",
    "defaultTitleSummaryModelId",
    "defaultTitleSummaryPrompt",
    "defaultTranslationModelId",
    "defaultTranslationPrompt",
    "defaultHistoryCompressionModelId",
    "defaultHistoryCompressionPrompt",
  ];

  constructor(private settingRepo: GlobalSettingRepository) {}

  async getSettings(userId: string) {
    const allSettings = await this.settingRepo.findAll(userId);
    const settingsMap: Record<string, any> = {};

    // 初始化默认值
    this.DEFAULT_KEYS.forEach((key) => {
      settingsMap[key] = null;
    });

    // 覆盖数据库中的值（将 snake_case 转换为 camelCase）
    allSettings.forEach((item) => {
      const camelKey = this.snakeToCamel(item.key);
      settingsMap[camelKey] = item.value;
    });

    return settingsMap;
  }

  async updateSettings(userId: string, data: Record<string, any>) {
    // 将 camelCase 转换为 snake_case 存储到数据库
    const updates = Object.entries(data).map(([key, value]) => ({
      key: this.camelToSnake(key),
      value,
      userId,
    }));

    await this.settingRepo.saveBatch(updates);
    return this.getSettings(userId);
  }

  /**
   * 将 snake_case 转换为 camelCase
   */
  private snakeToCamel(str: string): string {
    return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
  }

  /**
   * 将 camelCase 转换为 snake_case
   */
  private camelToSnake(str: string): string {
    return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
  }
}
