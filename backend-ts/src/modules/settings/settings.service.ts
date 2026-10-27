import { Injectable, Logger, BadRequestException, OnModuleInit } from "@nestjs/common";
import { SettingsStorage } from '../../common/utils/settings-storage.util';
import { isValidChatUploadSubdir, normalizeChatUploadSubdir } from '../../common/utils/attachment-subdir.util';
import { ProviderFileStore } from '../llm-core/provider-file.store';
import { assertResolvableModelRef } from '../llm-core/utils/model-reference.util';
import { assertUsableKbRoot } from '../knowledge-base/kb-database.service';
import {
  SG_SYSTEM,
  SG_MODELS,
  SG_PLUGINS,
  SG_OCR,
  SG_APPEARANCE,
  SK_SYS_WORKSPACE_BASE_DIR,
  SK_SYS_CHAT_UPLOAD_SUBDIR,
  DEFAULT_CHAT_UPLOAD_SUBDIR,
  SK_SYS_KB_STORAGE_ROOT,
  SK_SYS_KEEP_AWAKE_MODE,
  KEEP_AWAKE_MODES,
  LEGACY_SK_MOD_CHAT,
  MODEL_ID_KEYS,
} from '../../constants/settings.constants';

@Injectable()
export class SettingsService implements OnModuleInit {
  private readonly logger = new Logger(SettingsService.name);

  constructor(
    private readonly storage: SettingsStorage,
    private readonly modelStore: ProviderFileStore,
  ) {}

  /** 启动清理：全局默认对话模型已移除，删掉 models.json 里的历史残留键 */
  async onModuleInit(): Promise<void> {
    try {
      const settings = await this.storage.getSettings(SG_MODELS);
      if (settings && Object.prototype.hasOwnProperty.call(settings, LEGACY_SK_MOD_CHAT)) {
        await this.storage.deleteSettingValue(SG_MODELS, LEGACY_SK_MOD_CHAT);
      }
    } catch (error) {
      this.logger.warn(`清理历史默认对话模型配置失败: ${(error as Error)?.message ?? error}`);
    }
  }

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
    if (group === SG_SYSTEM && SK_SYS_CHAT_UPLOAD_SUBDIR in data) {
      // 附件子目录会被拼进会话工作目录路径，拒绝含分隔符/盘符/上跳的值。
      // 这里用「抛错」而不是像运行时那样静默回退：设置页需要立刻知道这个值不接受，
      // 否则用户以为改了子目录、实际还在写默认目录。
      const incoming = data[SK_SYS_CHAT_UPLOAD_SUBDIR];
      if (typeof incoming === "string" && incoming.trim() && !isValidChatUploadSubdir(incoming)) {
        throw new BadRequestException(
          "附件子目录名只能是单层目录名（不能包含路径分隔符、盘符或 ..）",
        );
      }
    }
    if (group === SG_SYSTEM && SK_SYS_KEEP_AWAKE_MODE in data) {
      // 该值经 bridge 驱动 Electron 主进程的 powerSaveBlocker，非法值会让主进程静默回退，
      // 用户以为改成了却仍按缺省跑 —— 与 chatUploadSubdir 同理，这里直接拒。
      const incoming = data[SK_SYS_KEEP_AWAKE_MODE];
      if (!KEEP_AWAKE_MODES.includes(incoming)) {
        throw new BadRequestException(
          `keepAwakeMode 只能是 ${KEEP_AWAKE_MODES.join(' / ')}`,
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

  /**
   * 聊天附件子目录名（会话工作目录下，非图片附件的落点）。
   * 单层目录名；空/非法值回退默认 'uploads'（运行时容错，见 attachment-subdir.util）。
   */
  async getChatUploadSubdir(): Promise<string> {
    const value = await this.getSettingValue(SG_SYSTEM, SK_SYS_CHAT_UPLOAD_SUBDIR, null);
    return normalizeChatUploadSubdir(typeof value === "string" ? value : null);
  }

  /** 更新聊天附件子目录名（传空则清除，恢复默认 'uploads'） */
  async setChatUploadSubdir(subdir: string | null): Promise<void> {
    const normalized = typeof subdir === "string" && subdir.trim() ? subdir.trim() : null;
    await this.updateGroupSettings(SG_SYSTEM, {
      [SK_SYS_CHAT_UPLOAD_SUBDIR]: normalized,
    });
  }
}
