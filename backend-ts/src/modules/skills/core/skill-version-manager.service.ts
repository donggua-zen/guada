import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * 版本记录
 */
interface VersionRecord {
  skillId: string;
  version: string;
  contentHash: string;
  installedAt: string;
  lastUpdatedAt: string;
}

@Injectable()
export class SkillVersionManager {
  private readonly logger = new Logger(SkillVersionManager.name);
  private readonly versionsFile: string;

  constructor(private configService: ConfigService) {
    const skillsDir = this.configService.get<string>('SKILLS_DIR') || 
                      path.join(process.cwd(), 'skills');
    this.versionsFile = path.join(skillsDir, '.versions', 'versions.json');
  }

  /**
   * 记录安装
   */
  async recordInstall(skillId: string, version: string, contentHash: string): Promise<void> {
    const versions = await this.loadVersions();
    const now = new Date().toISOString();

    versions[skillId] = {
      skillId,
      version,
      contentHash,
      installedAt: now,
      lastUpdatedAt: now,
    };

    await this.saveVersions(versions);
    this.logger.log(`Recorded install for skill ${skillId} v${version}`);
  }

  /**
   * 记录更新
   */
  async recordUpdate(skillId: string, version: string, contentHash: string): Promise<void> {
    const versions = await this.loadVersions();
    
    if (!versions[skillId]) {
      throw new Error(`Skill ${skillId} not found in version records`);
    }

    const oldVersion = versions[skillId].version;
    const comparison = this.compareVersions(oldVersion, version);

    if (comparison.majorChange) {
      this.logger.warn(`Major version upgrade for ${skillId}: ${oldVersion} → ${version}`);
    } else if (comparison.minorChange) {
      this.logger.log(`Minor version upgrade for ${skillId}: ${oldVersion} → ${version}`);
    } else {
      this.logger.debug(`Patch version upgrade for ${skillId}: ${oldVersion} → ${version}`);
    }

    versions[skillId].version = version;
    versions[skillId].contentHash = contentHash;
    versions[skillId].lastUpdatedAt = new Date().toISOString();

    await this.saveVersions(versions);
  }

  /**
   * 记录卸载
   */
  async recordUninstall(skillId: string): Promise<void> {
    const versions = await this.loadVersions();
    
    if (versions[skillId]) {
      delete versions[skillId];
      await this.saveVersions(versions);
      this.logger.log(`Recorded uninstall for skill ${skillId}`);
    }
  }

  /**
   * 获取版本信息
   */
  async getVersion(skillId: string): Promise<VersionRecord | null> {
    const versions = await this.loadVersions();
    return versions[skillId] || null;
  }

  /**
   * 比较版本（语义化版本）
   */
  compareVersions(oldVersion: string, newVersion: string): {
    majorChange: boolean;
    minorChange: boolean;
    patchChange: boolean;
  } {
    const parse = (v: string) => v.split('.').map(Number);
    const [oldMajor = 0, oldMinor = 0, oldPatch = 0] = parse(oldVersion);
    const [newMajor = 0, newMinor = 0, newPatch = 0] = parse(newVersion);

    return {
      majorChange: newMajor > oldMajor,
      minorChange: newMinor > oldMinor && newMajor === oldMajor,
      patchChange: newPatch > oldPatch && newMajor === oldMajor && newMinor === oldMinor,
    };
  }

  /**
   * 加载版本记录
   */
  private async loadVersions(): Promise<Record<string, VersionRecord>> {
    try {
      const content = await fs.readFile(this.versionsFile, 'utf-8');
      return JSON.parse(content);
    } catch {
      return {};
    }
  }

  /**
   * 保存版本记录
   */
  private async saveVersions(versions: Record<string, VersionRecord>): Promise<void> {
    const dir = path.dirname(this.versionsFile);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(this.versionsFile, JSON.stringify(versions, null, 2), 'utf-8');
  }
}
