import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs/promises';
import * as path from 'path';
import { SkillDefinition } from '../interfaces/skill-manifest.interface';
import { SkillDiscoveryResult } from '../interfaces/index';
import { SkillLoaderService } from './skill-loader.service';
import { SkillRegistry } from './skill-registry.service';

@Injectable()
export class SkillDiscoveryService {
  private readonly logger = new Logger(SkillDiscoveryService.name);
  private readonly skillsDir: string;

  constructor(
    private configService: ConfigService,
    private loader: SkillLoaderService,
    private registry: SkillRegistry,
  ) {
    this.skillsDir = this.configService.get<string>('SKILLS_DIR') || 
                     path.join(process.cwd(), 'skills');
  }

  /**
   * 全量扫描 Skills 目录
   */
  async scan(): Promise<SkillDiscoveryResult> {
    const startTime = Date.now();
    const result: SkillDiscoveryResult = {
      added: [],
      updated: [],
      removed: [],
      errors: [],
      scanDurationMs: 0,
    };

    try {
      // 确保 Skills 目录存在
      await fs.mkdir(this.skillsDir, { recursive: true });

      // 读取所有子目录（排除隐藏目录）
      const entries = await fs.readdir(this.skillsDir, { withFileTypes: true });
      const skillDirs = entries
        .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
        .map(entry => path.join(this.skillsDir, entry.name));

      // 获取当前注册表中的所有 Skill ID
      const knownIds = Array.from(this.registry.getAll().keys());
      const currentDirNames = skillDirs.map(dir => path.basename(dir).toLowerCase());

      // 检测已移除的 Skills（使用小写比较以兼容不同大小写的目录名）
      result.removed = knownIds.filter(id => !currentDirNames.includes(id.toLowerCase()));

      // 并行加载每个 Skill 目录
      const tasks = skillDirs.map(async (dir) => {
        try {
          const skillDef = await this.loader.loadManifest(dir);
          const existingSkill = this.registry.get(skillDef.id);
          
          // 判断是新增还是更新
          const isNew = !existingSkill;
          const isUpdated = existingSkill && existingSkill.contentHash !== skillDef.contentHash;
          
          return { skill: skillDef, isNew, isUpdated };
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          return { error: { path: dir, error: errorMsg } };
        }
      });

      const results = await Promise.allSettled(tasks);

      // 分类处理结果
      for (const r of results) {
        if (r.status === 'fulfilled') {
          const value = r.value as any;
          if (value.error) {
            result.errors.push(value.error);
          } else {
            const { skill, isNew, isUpdated } = value;
            if (isNew) {
              result.added.push(skill);
              this.registry.register(skill);
            } else if (isUpdated) {
              result.updated.push(skill);
              this.registry.update(skill);
            }
          }
        } else {
          result.errors.push({
            path: '',
            error: r.reason instanceof Error ? r.reason.message : String(r.reason),
          });
        }
      }

      // 移除已删除的 Skills
      for (const removedId of result.removed) {
        this.registry.unregister(removedId);
      }

    } catch (error) {
      this.logger.error(`Scan failed: ${error}`);
      throw error;
    }

    result.scanDurationMs = Date.now() - startTime;
    
    // 记录详细错误信息
    if (result.errors.length > 0) {
      this.logger.warn(`Scan encountered ${result.errors.length} error(s):`);
      result.errors.forEach((err, index) => {
        this.logger.warn(`  Error ${index + 1}: [${err.path || 'unknown'}] ${err.error}`);
      });
    }
    
    this.logger.log(`Scan completed: +${result.added.length} ~${result.updated.length} -${result.removed.length} (errors: ${result.errors.length})`);
    
    return result;
  }
}
