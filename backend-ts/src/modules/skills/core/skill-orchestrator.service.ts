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
import { SkillDefinition } from "../interfaces/skill-manifest.interface";

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
  listSkills(filterEnabled = true, workspacePath?: string): SkillDefinition[] {
    // system + global（来自 Registry，按 enabled 过滤）
    const base = filterEnabled
      ? this.registry.getEnabled()
      : Array.from(this.registry.getAll().values());

    if (!workspacePath) return base;

    // workspace 技能（来自 SourceManager 独立缓存）
    const wsKey = "workspace_" + workspacePath;
    const wsSkills = this.sourceManager.getSourceSkills(wsKey);
    if (wsSkills.length === 0) return base;

    const merged = new Map<string, SkillDefinition>();
    for (const s of base) merged.set(s.id, s);
    for (const s of wsSkills) merged.set(s.id, s); // 同名覆盖
    return Array.from(merged.values());
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
    return this.registry.enable(skillId);
  }

  async disableSkill(skillId: string): Promise<void> {
    const skill = this.registry.get(skillId);
    if (!skill) throw new Error(`Skill ${skillId} not found`);
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
   * 通过名称获取技能内容（纯正文，不含 YAML 头）和路径
   * 供 skill_lean 工具调用
   */
  async skillLearn(
    name: string,
  ): Promise<{ name: string; content: string; path: string } | null> {
    const skill = this.registry.get(name.toLowerCase());
    if (!skill) return null;
    const content = await this.loader.loadInstructions(skill);
    const fullPath = path.join(skill.baseDir, skill.basePath, "SKILL.md");
    return { name: skill.manifest.name, content, path: fullPath };
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
