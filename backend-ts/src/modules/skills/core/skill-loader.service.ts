import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs/promises';
import * as path from 'path';
import { createHash } from 'crypto';
import * as yaml from 'js-yaml';
import { SkillManifest, SkillDefinition } from '../interfaces/skill-manifest.interface';

/**
 * YAML frontmatter 解析结果
 */
interface FrontmatterParseResult {
  manifest: SkillManifest;
  body: string;
}

@Injectable()
export class SkillLoaderService {
  private readonly logger = new Logger(SkillLoaderService.name);

  /**
   * 从目录加载 Skill 元数据（L1）
   */
  async loadManifest(skillDir: string): Promise<SkillDefinition> {
    const skillMdPath = path.join(skillDir, 'SKILL.md');

    // 读取并解析 YAML frontmatter
    const content = await fs.readFile(skillMdPath, 'utf-8');
    const { manifest, body } = this.parseFrontmatter(content);

    // 验证必填字段
    this.validateManifest(manifest);

    // 计算内容哈希
    const contentHash = this.computeContentHash(content);

    const stat = await fs.stat(skillMdPath);

    return {
      id: manifest.name.toLowerCase(),
      basePath: skillDir,
      manifest,
      contentHash,
    };
  }

  /**
   * 加载 L2 指令（SKILL.md 正文）
   */
  async loadInstructions(skill: SkillDefinition): Promise<string> {
    const skillMdPath = path.join(skill.basePath, 'SKILL.md');
    const content = await fs.readFile(skillMdPath, 'utf-8');
    const { body } = this.parseFrontmatter(content);

    this.logger.debug(`Loaded instructions for skill: ${skill.id}`);
    return body.trim();
  }

  /**
   * 重新加载 Manifest（用于热更新）
   */
  async reloadManifest(skill: SkillDefinition): Promise<SkillDefinition> {
    const skillMdPath = path.join(skill.basePath, 'SKILL.md');
    const content = await fs.readFile(skillMdPath, 'utf-8');
    const { manifest, body } = this.parseFrontmatter(content);

    // 验证新 manifest
    this.validateManifest(manifest);

    // 计算新的内容哈希
    const newContentHash = this.computeContentHash(content);

    const stat = await fs.stat(skillMdPath);

    // 更新 skill 定义
    skill.manifest = manifest;
    skill.contentHash = newContentHash;

    this.logger.log(`Reloaded manifest for skill: ${skill.id}, hash changed: ${skill.contentHash !== newContentHash}`);

    return skill;
  }

  /**
   * 解析 YAML frontmatter
   */
  private parseFrontmatter(content: string): FrontmatterParseResult {
    const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);

    if (!match) {
      throw new Error('Invalid SKILL.md format: missing YAML frontmatter');
    }

    const yamlContent = match[1];
    const body = match[2];

    // 使用 js-yaml 解析
    try {
      const manifest = yaml.load(yamlContent) as SkillManifest;
      
      // 验证解析结果是否为对象
      if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
        throw new Error('YAML frontmatter must be an object');
      }
      
      return { manifest, body };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to parse YAML frontmatter: ${errorMessage}`);
    }
  }

  /**
   * 验证 Manifest 必填字段
   */
  private validateManifest(manifest: SkillManifest): void {
    if (!manifest.name || manifest.name.length > 64) {
      throw new Error('Skill name is required and must be ≤64 characters');
    }

    if (!/^[a-z0-9-]+$/.test(manifest.name)) {
      throw new Error('Skill name must contain only lowercase letters, numbers, and hyphens');
    }

    if (!manifest.description || manifest.description.length > 1024) {
      throw new Error('Skill description is required and must be ≤1024 characters');
    }
  }

  /**
   * 计算内容哈希（SHA256）
   */
  computeContentHash(content: string): string {
    return createHash('sha256').update(content).digest('hex');
  }
}
