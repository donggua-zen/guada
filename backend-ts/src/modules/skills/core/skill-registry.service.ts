import { Injectable, Logger } from '@nestjs/common';
import { SkillDefinition } from '../interfaces/skill-manifest.interface';

/**
 * 注册表事件类型
 */
export type SkillRegistryEvent = 
  | { type: 'registered'; skill: SkillDefinition }
  | { type: 'updated'; skill: SkillDefinition }
  | { type: 'unregistered'; skillId: string };

@Injectable()
export class SkillRegistry {
  private readonly logger = new Logger(SkillRegistry.name);
  private readonly skills = new Map<string, SkillDefinition>();
  private readonly listeners: Array<(event: SkillRegistryEvent) => void> = [];

  /**
   * 注册 Skill
   */
  register(skill: SkillDefinition): void {
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
