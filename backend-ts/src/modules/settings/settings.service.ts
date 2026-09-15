import { Injectable, Logger } from "@nestjs/common";
import { SettingsStorage } from '../../common/utils/settings-storage.util';
import { ProviderFileStore } from '../llm-core/provider-file.store';
import { assertResolvableModelRef } from '../llm-core/utils/model-reference.util';
import { MODEL_ID_KEYS } from '../../common/database/bootstrap/model-reference-migration';
import { assertUsableKbRoot } from '../knowledge-base/kb-database.service';
import {
  SG_SYSTEM,
  SG_MODELS,
  SG_PLUGINS,
  SG_OCR,
  SG_APPEARANCE,
  SK_SYS_WORKSPACE_BASE_DIR,
  SK_SYS_KB_STORAGE_ROOT,
} from '../../constants/settings.constants';

@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);

  constructor(
    private readonly storage: SettingsStorage,
    private readonly modelStore: ProviderFileStore,
  ) {}

  /**
   * 获取分组内所有设置
   */
  async getGroupSettings(group: string): Promise<any> {
    return this.storage.getSettings(group);
  }

  /**
   * 设置变更时的校验钩子：kbStorageRoot 必须可用（本地绝对路径），
   * 否则整组设置有被反复持久化的风险（前端表单会原样回写）。
   */
  async updateGroupSettings(group: string, data: Record<string, any>): Promise<void> {
    if (group === SG_MODELS) {
      for (const [key, value] of Object.entries(data)) {
        if (MODEL_ID_KEYS.has(key)) {
          assertResolvableModelRef(this.modelStore, value as string | null, key);
        }
      }
    }
    if (group === SG_SYSTEM && SK_SYS_KB_STORAGE_ROOT in data) {
      const incoming = data[SK_SYS_KB_STORAGE_ROOT];
      const current = await this.getKbStorageRoot();
      const next = typeof incoming === "string" && incoming.trim() ? incoming.trim() : null;

      if (next) assertUsableKbRoot(next);

      // 只在实际变更时提示：设置页是自动保存的，且每次都会回写整组，
      // 无条件告警会在每次改动任何 system 设置时刷一条毫无信息量的日志。
      if (next !== current) {
        // 不热切换根：存储根在进程内只解析一次（见 kb-database.service 的读设置逻辑），
        // 已打开的句柄也仍在旧根——热切换会出现半个进程读新根的半程状态。
        this.logger.warn(
          next
            ? `知识库存储根已改为 ${next}，重启后生效；原位置的库目录需要你手动移动过去（知识库不会自动搬迁）。`
            : `知识库存储根已清空，重启后回到默认位置（数据目录下的 data/kb）。`,
        );
      }
    }
    await this.storage.updateSettings(group, data);
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
    const groups = [SG_SYSTEM, SG_MODELS, SG_PLUGINS, SG_OCR, SG_APPEARANCE];

    for (const group of groups) {
      const groupData = await this.getGroupSettings(group);
      if (group === SG_PLUGINS) {
        result['plugins'] = groupData;
      } else if (group === SG_OCR) {
        result['ocr'] = groupData;
      } else if (group === SG_APPEARANCE) {
        result['appearance'] = groupData;
      } else {
        Object.assign(result, groupData);
      }
    }
    return result;
  }

  /**
   * 获取全局工作目录基路径
   */
  async getWorkspaceBaseDir(): Promise<string | null> {
    return this.getSettingValue(SG_SYSTEM, SK_SYS_WORKSPACE_BASE_DIR, null);
  }

  /**
   * 设置全局工作目录基路径
   */
  async setWorkspaceBaseDir(dirPath: string | null): Promise<void> {
    await this.updateGroupSettings(SG_SYSTEM, { [SK_SYS_WORKSPACE_BASE_DIR]: dirPath });
  }

  /** 知识库存储根设置（空 = 用默认位置） */
  async getKbStorageRoot(): Promise<string | null> {
    const value = await this.getSettingValue(SG_SYSTEM, SK_SYS_KB_STORAGE_ROOT, null);
    return typeof value === "string" && value.trim() ? value.trim() : null;
  }
}
