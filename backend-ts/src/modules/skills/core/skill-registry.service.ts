import { Injectable, Logger, Inject, Optional } from '@nestjs/common';
import { SkillDefinition } from '../interfaces/skill-manifest.interface';
import { SkillToggleConfigService } from './skill-toggle-config.service';

/**
 * 注册表事件类型
 */
export type SkillRegistryEvent = 
  | { type: 'registered'; skill: SkillDefinition }
  | { type: 'updated'; skill: SkillDefinition }
  | { type: 'unregistered'; skillId: string }
  | { type: 'enabled'; skillId: string; enabled: boolean }
  | { type: 'disabled'; skillId: string; enabled: boolean };

/** 技能提供方（注册式技能源） */
export interface SkillProvider {
  name: string;
  /** 返回该提供方提供的技能（可含内嵌 content） */
  getSkills(): SkillDefinition[];
}

@Injectable()
export class SkillRegistry {
  private static instance?: SkillRegistry;
  private readonly logger = new Logger(SkillRegistry.name);
  private readonly skills = new Map<string, SkillDefinition>();
  private readonly listeners: Array<(event: SkillRegistryEvent) => void> = [];
  private readonly providers = new Map<string, SkillProvider>();

  constructor(
    // 可选注入：单测/嵌入场景不提供配置服务时退化为「全部启用」
    @Optional() @Inject(SkillToggleConfigService)
    private toggleConfig?: SkillToggleConfigService,
  ) {
    SkillRegistry.instance = this;
  }

  /** 供非注入上下文（如插件 API）访问注册表单例 */
  static getInstance(): SkillRegistry | undefined {
    return SkillRegistry.instance;
  }

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
   * 注册技能提供方：将提供方返回的技能注册进注册表（支持内嵌 content）。
   * 供内置技能（bundled）及第三方插件注册技能——不再需要文件复制/扫描。
   */
  registerProvider(provider: SkillProvider): void {
    if (this.providers.has(provider.name)) {
      throw new Error(`Skill provider ${provider.name} already registered`);
    }
    this.providers.set(provider.name, provider);
    const skills = provider.getSkills();
    for (const skill of skills) {
      this.register(skill);
    }
    this.logger.log(`Registered skill provider: ${provider.name} (${skills.length} skills)`);
  }

  /** 已注册的支持权方名列表（诊断） */
  listProviders(): string[] {
    return Array.from(this.providers.keys());
  }

  /**
   * 按提供方移除技能（插件禁用/卸载时撤销其注册的技能）。
   */
  unregisterByProvider(provider: string): void {
    for (const [id, skill] of Array.from(this.skills.entries())) {
      if (skill.provider === provider) {
        this.skills.delete(id);
        this.notifyListeners({ type: "unregistered", skillId: id });
        this.logger.log(`Unregistered skill by provider: ${id} (${provider})`);
      }
    }
  }

  /**
   * 从配置文件读取技能的 enabled 状态（全局作用域）。
   *
   * 同步读：`register()` 在模块启动与热加载路径上调用，`skills.yaml` 用
   * mtime 缓存，代价是一次 stat。
   */
  private loadPersistedEnabled(skill: SkillDefinition): void {
    if (!this.toggleConfig) return;
    try {
      // 全局是顶层：显式 false 才关掉；true/未配置都保持默认启用
      if (this.toggleConfig.getGlobalOverride(skill.id) === false) {
        skill.enabled = false;
      }
    } catch {
      /* 配置不可读时保持默认（启用），不阻塞注册 */
    }
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
    // 逐个持久化：配置文件是「禁用列表」，只能逐项增删
    for (const id of skillIds) {
      await this.persistEnabled(id, enabled);
    }
    this.logger.log(`Batch toggle: ${skillIds.length} skills -> enabled=${enabled}`);
  }

  /**
   * 持久化技能的启用状态到 `skills.yaml`（全局作用域）
   */
  private async persistEnabled(skillId: string, enabled: boolean): Promise<void> {
    if (!this.toggleConfig) return;
    try {
      await this.toggleConfig.setGlobalEnabled(skillId, enabled);
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
   * 按提供方过滤技能（如 `plugin:<pluginId>`）。
   * 插件详情/诊断用；注意插件禁用后其技能仍在表中，由 orchestrator 侧做可见性过滤。
   */
  getByProvider(provider: string): SkillDefinition[] {
    return Array.from(this.skills.values()).filter(
      (skill) => skill.provider === provider,
    );
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
