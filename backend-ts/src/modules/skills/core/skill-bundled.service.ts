import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs/promises';
import * as path from 'path';
import { createHash } from 'crypto';

/**
 * 内置技能同步服务
 *
 * 负责将打包时内置的技能（bundled-skills/）同步到用户数据目录的 skills/.system/ 中。
 *
 * 同步策略：
 * - 启动时检查 bundled-skills/ 目录是否存在
 * - 将内置技能直接覆盖拷贝到 skills/.system/（不考虑用户是否修改）
 * - 用户安装的技能在 skills/ 根目录，与 .system/ 隔离
 */
@Injectable()
export class SkillBundledService {
  private readonly logger = new Logger(SkillBundledService.name);
  private readonly bundledSkillsDir: string;
  private readonly systemSkillsDir: string;

  constructor(private configService: ConfigService) {
    // 内置技能源目录：打包时放在 backend-ts/bundled-skills/
    this.bundledSkillsDir = path.join(process.cwd(), 'bundled-skills');

    // 目标目录：用户数据目录下的 skills/.system/
    const skillsDir = this.configService.get<string>('SKILLS_DIR') ||
                      path.join(process.cwd(), 'skills');
    this.systemSkillsDir = path.join(skillsDir, '.system');
  }

  /**
   * 同步内置技能到 .system 目录
   * 应用启动时调用
   */
  async syncBundledSkills(): Promise<void> {
    // 检查内置技能源目录是否存在
    try {
      await fs.access(this.bundledSkillsDir);
    } catch {
      this.logger.debug('No bundled skills directory found, skipping sync');
      return;
    }

    // 读取所有内置技能
    const bundledSkills = await this.discoverBundledSkills();
    if (bundledSkills.length === 0) {
      this.logger.debug('No bundled skills to sync');
      return;
    }

    // 确保 .system 目录存在
    await fs.mkdir(this.systemSkillsDir, { recursive: true });

    // 同步每个内置技能（直接覆盖）
    for (const skill of bundledSkills) {
      const targetPath = path.join(this.systemSkillsDir, skill.id);

      // 删除旧版本（如果存在）
      try {
        await fs.rm(targetPath, { recursive: true, force: true });
      } catch {
        // 忽略删除错误
      }

      // 拷贝新版本
      await this.copyDirectory(skill.sourcePath, targetPath);
      this.logger.log(`Synced bundled skill: ${skill.id}`);
    }

    this.logger.log(`Synced ${bundledSkills.length} bundled skills to .system/`);
  }

  /**
   * 发现所有内置技能
   */
  private async discoverBundledSkills(): Promise<Array<{ id: string; sourcePath: string }>> {
    const entries = await fs.readdir(this.bundledSkillsDir, { withFileTypes: true });
    const skills: Array<{ id: string; sourcePath: string }> = [];

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;

      const skillPath = path.join(this.bundledSkillsDir, entry.name);
      const skillMdPath = path.join(skillPath, 'SKILL.md');

      try {
        await fs.access(skillMdPath);
        skills.push({ id: entry.name.toLowerCase(), sourcePath: skillPath });
      } catch {
        this.logger.warn(`Invalid bundled skill (missing SKILL.md): ${entry.name}`);
      }
    }

    return skills;
  }

  /**
   * 递归复制目录
   */
  private async copyDirectory(src: string, dest: string): Promise<void> {
    await fs.mkdir(dest, { recursive: true });
    const entries = await fs.readdir(src, { withFileTypes: true });

    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);

      if (entry.isDirectory()) {
        await this.copyDirectory(srcPath, destPath);
      } else {
        await fs.copyFile(srcPath, destPath);
      }
    }
  }
}
