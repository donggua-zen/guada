import { Injectable, Logger, Inject, Optional } from '@nestjs/common';
import { SettingsStorage } from '../../../common/utils/settings-storage.util';
import { SkillDefinition } from '../interfaces/skill-manifest.interface';

/**
 * 注册表事件类型
 */
export type SkillRegistryEvent = 
  | { type: 'registered'; skill: SkillDefinition }
  | { type: 'updated'; skill: SkillDefinition }
  | { type: 'unregistered'; skillId: string }
  | { type: 'enabled'; skillId: string; enabled: boolean }
  | { type: 'disabled'; skillId: string; enabled: boolean };

@Injectable()
export class SkillRegistry {
  private readonly logger = new Logger(SkillRegistry.name);
  private readonly skills = new Map<string, SkillDefinition>();
  private readonly listeners: Array<(event: SkillRegistryEvent) => void> = [];
  private static SKILL_ENABLED_PREFIX = 'skills.';

  constructor(
    @Optional() @Inject(SettingsStorage) private settingsStorage?: SettingsStorage,
  ) {}

  /**
   * 注册 Skill
   */
  register(skill: SkillDefinition): void {
    // 从持久化读取启用状态（默认 true）
    if (skill.enabled === undefined) skill.enabled = true;
    this.loadPersistedEnabled(skill);
    if (this.skills.has(skill.id)) {
      this.logger.warn(`Skill ${skill.id} already registered, updating...`);
      this.update(skill);
      return;
    }

    this.skills.set(skill.id, skill);
    this.notifyListeners({ type: 'registered', skill });
    this.logger.debug(`Registered skill: ${skill.id}`);
  }

  /**
   * 更新 Skill
   */
  /**
   * 从持久化存储读取技能的 enabled 状态
   */
  private loadPersistedEnabled(skill: SkillDefinition): void {
    if (!this.settingsStorage) return;
    try {
      const key = SkillRegistry.SKILL_ENABLED_PREFIX + skill.id;
      this.settingsStorage.getSettings('plugins').then(cfg => {
        if (cfg && typeof cfg[key] === 'boolean') {
          skill.enabled = cfg[key];
        }
      }).catch(() => {});
    } catch { /* ignore */ }
  }

  /**
   * 启用技能
   */
  async enable(skillId: string): Promise<void> {
    const skill = this.skills.get(skillId);
    if (!skill) throw new Error(`Skill ${skillId} not found`);
    if (skill.enabled) return;
    skill.enabled = true;
    await this.persistEnabled(skillId, true);
    this.notifyListeners({ type: 'enabled', skillId, enabled: true });
    this.logger.log(`Skill enabled: ${skillId}`);
  }

  /**
   * 禁用技能
   */
  async disable(skillId: string): Promise<void> {
    const skill = this.skills.get(skillId);
    if (!skill) throw new Error(`Skill ${skillId} not found`);
    if (!skill.enabled) return;
    skill.enabled = false;
    await this.persistEnabled(skillId, false);
    this.notifyListeners({ type: 'disabled', skillId, enabled: false });
    this.logger.log(`Skill disabled: ${skillId}`);
  }

  /**
   * 批量启用/禁用
   */
  async batchToggle(skillIds: string[], enabled: boolean): Promise<void> {
    for (const id of skillIds) {
      const skill = this.skills.get(id);
      if (skill) {
        skill.enabled = enabled;
      }
    }
    await this.persistEnabled('*', null); // 全量保存
    this.logger.log(`Batch toggle: ${skillIds.length} skills -> enabled=${enabled}`);
  }

  /**
   * 持久化技能的启用状态到 SettingsStorage
   */
  private async persistEnabled(skillId: string, enabled: boolean | null): Promise<void> {
    if (!this.settingsStorage) return;
    try {
      if (skillId === '*') {
        // 全量保存所有技能的 enabled 状态
        const update: Record<string, boolean> = {};
        for (const [id, s] of this.skills) {
          update[SkillRegistry.SKILL_ENABLED_PREFIX + id] = s.enabled;
        }
        await this.settingsStorage.updateSettings('plugins', update);
      } else {
        const key = SkillRegistry.SKILL_ENABLED_PREFIX + skillId;
        await this.settingsStorage.updateSettings('plugins', { [key]: enabled });
      }
    } catch (err) {
      this.logger.error(`Failed to persist skill enabled state: ${err}`);
    }
  }

  /**
   * 获取已启用的技能列表
   */
  getEnabled(): SkillDefinition[] {
    return Array.from(this.skills.values()).filter(s => s.enabled !== false);
  }

  /**
   * 获取已禁用的技能列表
   */
  getDisabled(): SkillDefinition[] {
    return Array.from(this.skills.values()).filter(s => s.enabled === false);
  }

  /**
   * 判断技能是否启用
   */
  isEnabled(skillId: string): boolean {
    const skill = this.skills.get(skillId);
    return skill ? skill.enabled !== false : false;
  }

  update(skill: SkillDefinition): void {
    if (!this.skills.has(skill.id)) {
      throw new Error(`Skill ${skill.id} not found for update`);
    }

    this.skills.set(skill.id, skill);
    this.notifyListeners({ type: 'updated', skill });
    this.logger.debug(`Updated skill: ${skill.id}`);
  }

  /**
   * 注销 Skill
   */
  unregister(skillId: string): void {
    if (!this.skills.delete(skillId)) {
      this.logger.warn(`Skill ${skillId} not found for unregistration`);
      return;
    }

    this.notifyListeners({ type: 'unregistered', skillId });
    this.logger.debug(`Unregistered skill: ${skillId}`);
  }

  /**
   * 获取单个 Skill
   */
  get(skillId: string): SkillDefinition | undefined {
    return this.skills.get(skillId);
  }

  /**
   * 获取所有 Skills
   */
  getAll(): ReadonlyMap<string, SkillDefinition> {
    return this.skills;
  }

  /**
   * 按标签搜索
   */
  searchByTags(tags: string[]): SkillDefinition[] {
    if (!tags.length) return [];
    
    return Array.from(this.skills.values()).filter(skill => 
      skill.manifest.tags?.some(tag => tags.includes(tag))
    );
  }

  /**
   * 快照（用于调试或备份）
   */
  snapshot(): Readonly<SkillDefinition[]> {
    return Object.freeze(Array.from(this.skills.values()));
  }

  /**
   * 注册变更监听器
   * @returns 取消订阅函数
   */
  onChange(listener: (event: SkillRegistryEvent) => void): () => void {
    this.listeners.push(listener);
    return () => {
      const index = this.listeners.indexOf(listener);
      if (index > -1) this.listeners.splice(index, 1);
    };
  }

  /**
   * 通知所有监听器
   */
  private notifyListeners(event: SkillRegistryEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        this.logger.error(`Listener error: ${error}`);
      }
    }
  }
}
