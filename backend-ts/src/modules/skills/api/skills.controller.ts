import { Controller, Get, Post, Param, Body, Logger, Query, UseInterceptors, UploadedFile } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { SkillOrchestrator } from '../core/skill-orchestrator.service';
import { SkillWatcherService } from '../core/skill-watcher.service';
import { SkillDefinition } from '../interfaces/skill-manifest.interface';
import { SkillDiscoveryResult } from '../interfaces/index';
import { createPaginatedResponse, PaginatedResponse } from '../../../common/types/pagination';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as AdmZip from 'adm-zip';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

@Controller('skills')
export class SkillsController {
  private readonly logger = new Logger(SkillsController.name);

  constructor(
    private orchestrator: SkillOrchestrator,
    private watcher: SkillWatcherService,
  ) {}

  /**
   * 列出所有已加载的 Skills（支持分页）
   */
  @Get()
  listSkills(
    @Query('page') page?: number,
    @Query('size') size?: number,
  ): PaginatedResponse<SkillDefinition> {
    const allSkills = this.orchestrator.listSkills();
    const total = allSkills.length;

    // 如果未提供分页参数，返回全部数据
    if (!page || !size) {
      return createPaginatedResponse(allSkills, total);
    }

    // 计算分页
    const skip = (page - 1) * size;
    const items = allSkills.slice(skip, skip + size);

    return createPaginatedResponse(items, total, { page, size });
  }

  /**
   * 获取 Skill 详情
   */
  @Get(':id')
  getSkillDetail(@Param('id') skillId: string): SkillDefinition | null {
    return this.orchestrator.getSkillDetail(skillId);
  }

  /**
   * 获取 Skill 的文档内容（SKILL.md）
   */
  @Get(':id/documentation')
  async getSkillDocumentation(@Param('id') skillId: string): Promise<{ content: string }> {
    const content = await this.orchestrator.getSkillDocumentation(skillId);
    return { content: content || '' };
  }

  /**
   * 触发手动扫描
   */
  @Post('scan')
  async triggerScan(): Promise<SkillDiscoveryResult> {
    this.logger.log('Manual scan triggered');
    return this.orchestrator.triggerScan();
  }

  /**
   * 热加载指定 Skill
   */
  @Post(':id/reload')
  async reloadSkill(@Param('id') skillId: string): Promise<SkillDefinition> {
    this.logger.log(`Reload requested for skill: ${skillId}`);
    return this.orchestrator.reloadSkill(skillId);
  }

  /**
   * 获取自动扫描状态
   */
  @Get('watcher/status')
  getWatcherStatus(): { enabled: boolean } {
    // TODO: 从配置中读取，目前默认启用
    return { enabled: true };
  }

  /**
   * 切换自动扫描开关
   */
  @Post('watcher/toggle')
  async toggleWatcher(@Body() body: { enabled: boolean }): Promise<{ enabled: boolean }> {
    this.logger.log(`Auto-watch toggled: ${body.enabled ? 'enabled' : 'disabled'}`);
    // TODO: 实现动态启用/禁用监听器
    // 目前仅返回状态，实际需要在 SkillWatcherService 中添加 enable/disable 方法
    return { enabled: body.enabled };
  }

  /**
   * 从 Git 仓库安装技能
   */
  @Post('install-from-git')
  async installFromGit(@Body() body: { 
    url: string; 
    branch?: string;
    subdirectory?: string;
  }): Promise<{ success: boolean; skillId?: string; message: string }> {
    try {
      const { url, branch, subdirectory } = body;

      if (!url) {
        return { success: false, message: 'Git URL is required' };
      }

      // 验证 URL 格式
      if (!url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('git@')) {
        return { success: false, message: 'Invalid Git URL. Must start with http://, https://, or git@' };
      }

      // 生成临时目录名
      const tempDirName = `skill-git-${Date.now()}`;
      const tempDir = path.join(process.cwd(), 'temp', tempDirName);
      await fs.mkdir(tempDir, { recursive: true });

      this.logger.log(`Cloning skill from Git: ${url}`);

      // 构建 git clone 命令
      let cloneCommand = `git clone ${url} "${tempDir}"`;
      if (branch) {
        cloneCommand += ` --branch ${branch} --single-branch`;
      }
      cloneCommand += ' --depth 1'; // 只克隆最新提交，加快速度

      // 执行 git clone
      await execAsync(cloneCommand, { timeout: 60000 }); // 60秒超时

      // 确定技能目录
      let skillSourceDir = tempDir;
      if (subdirectory) {
        skillSourceDir = path.join(tempDir, subdirectory);
      }

      // 查找 SKILL.md 文件
      const entries = await this.findSkillMdFiles(skillSourceDir);
      if (entries.length === 0) {
        await fs.rm(tempDir, { recursive: true, force: true });
        return { success: false, message: 'No SKILL.md found in the repository' };
      }

      // 如果找到多个 SKILL.md，使用第一个
      const skillMdPath = entries[0];
      const skillDir = path.dirname(skillMdPath);
      const skillName = path.basename(skillDir);

      // 移动到 skills 目录
      const targetDir = path.join(process.cwd(), 'skills', skillName);
      
      // 检查是否已存在
      try {
        await fs.access(targetDir);
        await fs.rm(tempDir, { recursive: true, force: true });
        return { success: false, message: `Skill '${skillName}' already exists. Please uninstall it first.` };
      } catch {
        // 目录不存在，继续
      }

      // 移动目录
      await fs.rename(skillDir, targetDir);

      // 清理临时文件
      await fs.rm(tempDir, { recursive: true, force: true });

      // 触发扫描以加载新 Skill
      await this.orchestrator.triggerScan();

      this.logger.log(`Successfully installed skill from Git: ${skillName}`);
      return { 
        success: true, 
        skillId: skillName, 
        message: `Skill '${skillName}' installed successfully from Git` 
      };
    } catch (error) {
      this.logger.error(`Failed to install skill from Git: ${error.message}`);
      return { success: false, message: `Installation failed: ${error.message}` };
    }
  }

  /**
   * 更新技能（从 Git 重新拉取）
   */
  @Post(':id/update')
  async updateSkill(@Param('id') skillId: string): Promise<{ success: boolean; message: string }> {
    try {
      const skill = this.orchestrator.getSkillDetail(skillId);
      if (!skill) {
        return { success: false, message: `Skill '${skillId}' not found` };
      }

      // 检查是否是 Git 仓库
      const gitDir = path.join(skill.basePath, '.git');
      try {
        await fs.access(gitDir);
      } catch {
        return { success: false, message: `Skill '${skillId}' was not installed from Git, cannot update` };
      }

      this.logger.log(`Updating skill from Git: ${skillId}`);

      // 执行 git pull
      await execAsync('git pull', { 
        cwd: skill.basePath,
        timeout: 30000 
      });

      // 重新加载技能
      await this.orchestrator.reloadSkill(skillId);

      this.logger.log(`Successfully updated skill: ${skillId}`);
      return { success: true, message: `Skill '${skillId}' updated successfully` };
    } catch (error) {
      this.logger.error(`Failed to update skill: ${error.message}`);
      return { success: false, message: `Update failed: ${error.message}` };
    }
  }

  /**
   * 安装技能包（上传 ZIP 文件）
   */
  @Post('install')
  @UseInterceptors(FileInterceptor('file'))
  async installSkill(@UploadedFile() file: Express.Multer.File): Promise<{ success: boolean; skillId?: string; message: string }> {
    try {
      if (!file) {
        return { success: false, message: 'No file uploaded' };
      }

      // 验证文件类型
      if (!file.originalname.endsWith('.zip')) {
        return { success: false, message: 'Only ZIP files are supported' };
      }

      // 创建临时目录解压
      const tempDir = path.join(process.cwd(), 'temp', `skill-install-${Date.now()}`);
      await fs.mkdir(tempDir, { recursive: true });

      // 保存 ZIP 文件
      const zipPath = path.join(tempDir, file.originalname);
      await fs.writeFile(zipPath, file.buffer);

      // 解压 ZIP
      const zip = new AdmZip(zipPath);
      zip.extractAllTo(tempDir, true);

      // 查找 SKILL.md 文件
      const entries = await this.findSkillMdFiles(tempDir);
      if (entries.length === 0) {
        await fs.rm(tempDir, { recursive: true, force: true });
        return { success: false, message: 'No SKILL.md found in the ZIP file' };
      }

      // 只支持单个 Skill 安装
      if (entries.length > 1) {
        await fs.rm(tempDir, { recursive: true, force: true });
        return { success: false, message: 'ZIP file contains multiple skills. Please upload one skill at a time.' };
      }

      const skillMdPath = entries[0];
      const skillDir = path.dirname(skillMdPath);
      const skillName = path.basename(skillDir);

      // 移动到 skills 目录
      const targetDir = path.join(process.cwd(), 'skills', skillName);
      
      // 检查是否已存在
      try {
        await fs.access(targetDir);
        await fs.rm(tempDir, { recursive: true, force: true });
        return { success: false, message: `Skill '${skillName}' already exists. Please uninstall it first or use a different name.` };
      } catch {
        // 目录不存在，继续
      }

      // 移动目录
      await fs.rename(skillDir, targetDir);

      // 清理临时文件
      await fs.rm(tempDir, { recursive: true, force: true });

      // 触发扫描以加载新 Skill
      await this.orchestrator.triggerScan();

      this.logger.log(`Successfully installed skill: ${skillName}`);
      return { success: true, skillId: skillName, message: `Skill '${skillName}' installed successfully` };
    } catch (error) {
      this.logger.error(`Failed to install skill: ${error.message}`);
      return { success: false, message: `Installation failed: ${error.message}` };
    }
  }

  /**
   * 卸载技能
   */
  @Post(':id/uninstall')
  async uninstallSkill(@Param('id') skillId: string): Promise<{ success: boolean; message: string }> {
    try {
      const skill = this.orchestrator.getSkillDetail(skillId);
      if (!skill) {
        return { success: false, message: `Skill '${skillId}' not found` };
      }

      // 删除技能目录
      await fs.rm(skill.basePath, { recursive: true, force: true });

      // 触发扫描以更新注册表
      await this.orchestrator.triggerScan();

      this.logger.log(`Successfully uninstalled skill: ${skillId}`);
      return { success: true, message: `Skill '${skillId}' uninstalled successfully` };
    } catch (error) {
      this.logger.error(`Failed to uninstall skill: ${error.message}`);
      return { success: false, message: `Uninstallation failed: ${error.message}` };
    }
  }

  /**
   * 递归查找 SKILL.md 文件
   */
  private async findSkillMdFiles(dir: string): Promise<string[]> {
    const results: string[] = [];
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      
      if (entry.isDirectory()) {
        // 跳过隐藏目录和 node_modules
        if (!entry.name.startsWith('.') && entry.name !== 'node_modules') {
          const subResults = await this.findSkillMdFiles(fullPath);
          results.push(...subResults);
        }
      } else if (entry.name === 'SKILL.md') {
        results.push(fullPath);
      }
    }

    return results;
  }

  // TODO: 实现批量安装、从 URL 安装等功能
}
