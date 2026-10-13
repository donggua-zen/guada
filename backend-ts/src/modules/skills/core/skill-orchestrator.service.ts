import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from "@nestjs/common";
import * as path from "path";
import { SkillSourceManager } from "./skill-source.manager";
import { SkillRegistry } from "./skill-registry.service";
import { SkillLoaderService } from "./skill-loader.service";
import { SkillVersionManager } from "./skill-version-manager.service";
import { SkillDefinition, SkillLearnResult, SkillResourceBase } from "../interfaces/skill-manifest.interface";
import { PluginManager } from "../../plugins/plugin.manager";

/**
 * Skill 匹配结果
 */
export interface SkillMatch {
  skillId: string;
  confidence: number;
  reason: string;
}

@Injectable()
export class SkillOrchestrator implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SkillOrchestrator.name);

  constructor(
    private sourceManager: SkillSourceManager,
    private registry: SkillRegistry,
    private loader: SkillLoaderService,
    private versionManager: SkillVersionManager,
    private pluginManager: PluginManager,
  ) {}

  async onModuleInit(): Promise<void> {
    this.logger.log("Initializing Skills framework...");
    try {
      // 由 SkillsModule.onModuleInit 先调用 watcher.start() 和 sourceManager.start()
      const n = this.registry.getAll().size;
      this.logger.log(`Skills framework initialized with ${n} skills`);
    } catch (error) {
      this.logger.error(`Failed to initialize Skills framework: ${error}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.logger.log("Shutting down Skills framework...");
  }

  /**
   * 重新触发全量扫描（现有 system + global 来源重新加载）
   */
  async triggerScan(): Promise<void> {
    this.logger.log("Triggering manual scan...");
    // 重新注册 system + global，更新 registry
    await this.sourceManager.restart();
  }

  /**
   * 列出所有 Skills，支持按工作目录合并 workspace skills。
   * 优先级：workspace > global > system。
   */
  listSkills(
    filterEnabled = true,
    workspacePath?: string,
    session?: any,
  ): SkillDefinition[] {
    // system + global（来自 Registry，按 enabled 过滤）
    const base = filterEnabled
      ? this.registry.getEnabled()
      : Array.from(this.registry.getAll().values());

    if (!workspacePath) return this.filterByPlugins(base, session);

    // workspace 技能（来自 SourceManager 独立缓存）
    const wsKey = "workspace_" + workspacePath;
    const wsSkills = this.sourceManager.getSourceSkills(wsKey);
    if (wsSkills.length === 0) return this.filterByPlugins(base, session);

    const merged = new Map<string, SkillDefinition>();
    for (const s of base) merged.set(s.id, s);
    for (const s of wsSkills) merged.set(s.id, s); // 同名覆盖
    return this.filterByPlugins(Array.from(merged.values()), session);
  }

  /**
   * 单技能在此会话是否可见（插件启停过滤，对齐工具"插件关闭→搜集跳过"）。
   * 非插件技能（file/workspace）始终可见；插件技能在插件未启用或已卸载时不可见。
   *
   * 插件启用状态以 PluginManager 为权威（instance.enabled，与注册/启停同源）。
   * 不能依赖 session.getResolvedPlugins()：skill 工具包 handler 在 resolvePlugins
   * 执行期间被调用，此刻 resolvedPlugins 尚未赋值（恒为空数组），会导致插件技能
   * 被误判不可见（循环依赖）。
   */
  isPluginSkillVisible(skill: SkillDefinition): boolean {
    if (!skill.provider || !skill.provider.startsWith("plugin:")) return true;
    const pluginId = skill.provider.slice("plugin:".length);
    return this.pluginManager.isPluginEnabled(pluginId);
  }

  /** 按会话过滤技能集合 */
  private filterByPlugins(
    skills: SkillDefinition[],
    session?: any,
  ): SkillDefinition[] {
    if (!session) return skills;
    return skills.filter((s) => this.isPluginSkillVisible(s));
  }

  /**
   * 获取 Skill 详情
   */
  getSkillDetail(skillId: string): SkillDefinition | null {
    return this.registry.get(skillId) || null;
  }

  async enableSkill(skillId: string): Promise<void> {
    const skill = this.registry.get(skillId);
    if (!skill) throw new Error(`Skill ${skillId} not found`);
    if (skill.provider?.startsWith("plugin:")) {
      throw new Error(
        `Skill ${skillId} 由插件提供，请到「插件」页面控制启停`,
      );
    }
    return this.registry.enable(skillId);
  }

  async disableSkill(skillId: string): Promise<void> {
    const skill = this.registry.get(skillId);
    if (!skill) throw new Error(`Skill ${skillId} not found`);
    if (skill.provider?.startsWith("plugin:")) {
      throw new Error(
        `Skill ${skillId} 由插件提供，请到「插件」页面控制启停`,
      );
    }
    return this.registry.disable(skillId);
  }

  async batchToggleSkills(skillIds: string[], enabled: boolean): Promise<void> {
    return this.registry.batchToggle(skillIds, enabled);
  }

  /**
   * 获取 Skill 的完整文档内容（SKILL.md）
   */
  async getSkillDocumentation(skillId: string): Promise<string | null> {
    const skill = this.registry.get(skillId);
    if (!skill) {
      throw new Error(`Skill ${skillId} not found`);
    }
    return await this.loader.loadInstructions(skill);
  }

  /**
   * 通过名称获取技能内容（纯正文，不含 YAML 头）和位置信息
   * 供 skill_learn 工具调用
   */
  async skillLearn(
    name: string,
    session?: any,
  ): Promise<SkillLearnResult | null> {
    const skill = this.registry.get(name.toLowerCase());
    if (!skill) return null;
    // 对齐工具：插件关闭（当前会话岗位/智能体配置下未启用）→ 该插件技能等同于不存在
    if (!this.isPluginSkillVisible(skill)) return null;
    const content = await this.loader.loadInstructions(skill);

    // 位置信息分两类：
    // - 文件型技能（有磁盘 SKILL.md）：技能自身目录即资源根，SKILL.md 在其下。
    // - 插件注册型技能（内嵌正文、无文件）：以声明的 resourceBase 目录为资源根
    //   （内置技能共享 bundled-skills/，脚本在 scripts/ 下），无文件可续读。
    // 都没有来源时保持 null——宁可说"未知"，也不拼出 __plugin__ 这类假路径。
    const skillDir = skill.baseDir
      ? path.join(skill.baseDir, skill.basePath)
      : null;
    const fileBacked = !skill.content && !!skillDir;

    let baseDirectory: string | null = null;
    if (skill.resourceBase?.kind === "directory") {
      baseDirectory = skill.resourceBase.path;
    } else if (skillDir) {
      baseDirectory = skillDir;
    }
    const skillMdPath = fileBacked ? path.join(skillDir!, "SKILL.md") : null;

    // 未声明且无技能目录 → 保持 null：位置头会如实说"未声明资源目录"，
    // 而不是拼出 __plugin__ 这类假路径让模型去 read 一个不存在的文件。
    const resourceBase: SkillResourceBase | null =
      skill.resourceBase ??
      (skillDir ? { kind: "directory", path: skillDir } : null);

    return {
      name: skill.manifest.name,
      content,
      path: skillMdPath ?? baseDirectory ?? "",
      resourceBase,
      baseDirectory,
      skillMdPath,
    };
  }

  /**
   * 重新加载指定 Skill
   */
  async reloadSkill(skillId: string): Promise<SkillDefinition> {
    const skill = this.registry.get(skillId);
    if (!skill) {
      throw new Error(`Skill ${skillId} not found`);
    }

    const updatedSkill = await this.loader.reloadManifest(skill);
    this.registry.update(updatedSkill);

    if (updatedSkill.manifest.version) {
      try {
        await this.versionManager.recordUpdate(
          skillId,
          updatedSkill.manifest.version,
          updatedSkill.contentHash,
        );
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        if (errorMessage.includes("not found in version records")) {
          await this.versionManager.recordInstall(
            skillId,
            updatedSkill.manifest.version,
            updatedSkill.contentHash,
          );
          this.logger.debug(
            `Created initial version record for skill: ${skillId}`,
          );
        } else {
          throw error;
        }
      }
    }

    this.logger.log(`Reloaded skill: ${skillId}`);
    return updatedSkill;
  }

  /**
   * 根据用户消息匹配相关 Skills
   */
  async matchSkills(userMessage: string): Promise<SkillMatch[]> {
    const skills = Array.from(this.registry.getAll().values());
    const matches: SkillMatch[] = [];

    for (const skill of skills) {
      const keywords = [skill.manifest.name, ...(skill.manifest.tags || [])];

      const lowerMessage = userMessage.toLowerCase();
      const matchedKeywords = keywords.filter((kw) =>
        lowerMessage.includes(kw.toLowerCase()),
      );

      if (matchedKeywords.length > 0) {
        matches.push({
          skillId: skill.id,
          confidence: matchedKeywords.length / keywords.length,
          reason: `Matched keywords: ${matchedKeywords.join(", ")}`,
        });
      }
    }

    return matches.sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * 列出所有 Skills（元数据注入用）
   */
  getMetadataInjection(): string {
    const skills = Array.from(this.registry.getAll().values());
    if (skills.length === 0) return "";

    const metadataList = skills
      .map((skill) => `- ${skill.manifest.name}: ${skill.manifest.description}`)
      .join("\n");

    return `\n\n# Available Skills\nThe following professional skills are available. Use the skill management tools to interact with them:\n\n${metadataList}`;
  }
}
