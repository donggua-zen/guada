import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { SkillDiscoveryService } from './skill-discovery.service';
import { SkillRegistry } from './skill-registry.service';
import { SkillLoaderService } from './skill-loader.service';
import { SkillVersionManager } from './skill-version-manager.service';
import { SkillDefinition } from '../interfaces/skill-manifest.interface';
import { SkillDiscoveryResult } from '../interfaces/index';

/**
 * Skill 匹配结果
 */
export interface SkillMatch {
  skillId: string;
  confidence: number; // 0-1 匹配度
  reason: string;
}

@Injectable()
export class SkillOrchestrator implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SkillOrchestrator.name);

  constructor(
    private discovery: SkillDiscoveryService,
    private registry: SkillRegistry,
    private loader: SkillLoaderService,
    private versionManager: SkillVersionManager,
  ) {}

  /**
   * 模块初始化时自动扫描
   */
  async onModuleInit(): Promise<void> {
    this.logger.log('Initializing Skills framework...');
    try {
      await this.discovery.scan();
      this.logger.log(`Skills framework initialized with ${this.registry.getAll().size} skills`);
    } catch (error) {
      this.logger.error(`Failed to initialize Skills framework: ${error}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.logger.log('Shutting down Skills framework...');
  }

  /**
   * 手动触发扫描
   */
  async triggerScan(): Promise<SkillDiscoveryResult> {
    return this.discovery.scan();
  }

  /**
   * 获取 L1 元数据注入文本（用于 System Prompt）
   * 仅包含 Skills 列表，详细说明由 SkillToolBridge 通过 getPrompt 提供
   */
  getMetadataInjection(): string {
    const skills = Array.from(this.registry.getAll().values());
    
    if (skills.length === 0) {
      return '';
    }

    const metadataList = skills.map(skill => 
      `- ${skill.manifest.name}: ${skill.manifest.description}`
    ).join('\n');

    return `\n\n# Available Skills\nThe following professional skills are available. Use the skill management tools to interact with them:\n\n${metadataList}`;
  }

  /**
   * 获取 L2 指令注入文本（激活时加载）
   */
  async getInstructionInjection(skillId: string): Promise<string> {
    const skill = this.registry.get(skillId);
    if (!skill) {
      throw new Error(`Skill ${skillId} not found`);
    }

    const instructions = await this.loader.loadInstructions(skill);
    
    return `\n\n## Active Skill: ${skill.manifest.name}\n${instructions}`;
  }

  /**
   * 根据用户消息匹配相关 Skills（简单关键词匹配，可扩展为 Embedding）
   */
  async matchSkills(userMessage: string): Promise<SkillMatch[]> {
    const skills = Array.from(this.registry.getAll().values());
    const matches: SkillMatch[] = [];

    for (const skill of skills) {
      const keywords = [
        skill.manifest.name,
        ...(skill.manifest.tags || []),
      ];

      const lowerMessage = userMessage.toLowerCase();
      const matchedKeywords = keywords.filter(kw => 
        lowerMessage.includes(kw.toLowerCase())
      );

      if (matchedKeywords.length > 0) {
        matches.push({
          skillId: skill.id,
          confidence: matchedKeywords.length / keywords.length,
          reason: `Matched keywords: ${matchedKeywords.join(', ')}`,
        });
      }
    }

    return matches.sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * 列出所有 Skills
   */
  listSkills(): SkillDefinition[] {
    return Array.from(this.registry.getAll().values());
  }

  /**
   * 获取 Skill 详情
   */
  getSkillDetail(skillId: string): SkillDefinition | null {
    return this.registry.get(skillId) || null;
  }

  /**
   * 获取 Skill 的完整文档内容（SKILL.md）
   */
  async getSkillDocumentation(skillId: string): Promise<string | null> {
    const skill = this.registry.get(skillId);
    if (!skill) {
      throw new Error(`Skill ${skillId} not found`);
    }

    // 直接加载并返回指令内容
    return await this.loader.loadInstructions(skill);
  }

  /**
   * 重新加载指定 Skill
   */
  async reloadSkill(skillId: string): Promise<SkillDefinition> {
    const skill = this.registry.get(skillId);
    if (!skill) {
      throw new Error(`Skill ${skillId} not found`);
    }

    // 重新解析 Manifest
    const updatedSkill = await this.loader.reloadManifest(skill);
    
    // 更新注册表
    this.registry.update(updatedSkill);
    
    // 记录版本更新（如果不存在则创建初始记录）
    if (updatedSkill.manifest.version) {
      try {
        await this.versionManager.recordUpdate(
          skillId,
          updatedSkill.manifest.version,
          updatedSkill.contentHash
        );
      } catch (error) {
        // 如果版本记录不存在，创建初始记录
        if (error.message.includes('not found in version records')) {
          await this.versionManager.recordInstall(
            skillId,
            updatedSkill.manifest.version,
            updatedSkill.contentHash
          );
          this.logger.debug(`Created initial version record for skill: ${skillId}`);
        } else {
          throw error;
        }
      }
    }

    this.logger.log(`Reloaded skill: ${skillId}`);
    return updatedSkill;
  }
}
