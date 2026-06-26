import { Controller, Get, Post, Param, Body, Logger, Query, UseInterceptors, UploadedFile } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { SkillOrchestrator } from '../core/skill-orchestrator.service';
import { SkillWatcherService } from '../core/skill-watcher.service';
import { SkillDefinition } from '../interfaces/skill-manifest.interface';
import { SkillDiscoveryResult } from '../interfaces/index';
import { createPaginatedResponse, PaginatedResponse } from '../../../common/types/pagination';
import { SkillMetadataValidator } from '../common/skill-metadata.validator';
import { ConfigService } from '@nestjs/config';
import * as path from 'path';
import * as fs from 'fs/promises';
import AdmZip from 'adm-zip';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

@Controller('skills')
export class SkillsController {
  private readonly logger = new Logger(SkillsController.name);
  private readonly skillsDir: string;

  constructor(
    private orchestrator: SkillOrchestrator,
    private watcher: SkillWatcherService,
    private configService: ConfigService,
  ) {
    this.skillsDir = this.configService.get<string>('SKILLS_DIR') || 
                     path.join(process.cwd(), 'skills');
  }

  /**
   * 获取用户可安装的目标目录（排除 .system）
   */
  private getUserSkillsDir(): string {
    return this.skillsDir;
  }

  /**
   * 列出所有已加载的 Skills（支持分页）
   */
  @Get()
  listSkills(
    @Query('page') page?: number,
    @Query('size') size?: number,
  ): PaginatedResponse<SkillDefinition> {
    const allSkills = this.orchestrator.listSkills(false);
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
    const skill = this.orchestrator.getSkillDetail(skillId);
    if (!skill) {
      return { content: '' };
    }

    // 直接读取原始 SKILL.md 文件内容
    const fs = await import('fs/promises');
    const path = await import('path');
    const skillMdPath = path.join(skill.baseDir, skill.basePath, 'SKILL.md');
    const rawContent = await fs.readFile(skillMdPath, 'utf-8');

    return { content: rawContent };
  }

  /**
   * 触发手动扫描
   */
  @Post('scan')
  async triggerScan(): Promise<{ success: boolean; message: string }> {
    this.logger.log('Manual scan triggered');
    try {
      await this.orchestrator.triggerScan();
      return { success: true, message: 'Scan completed' };
    } catch (error: any) {
      return { success: false, message: error.message };
    }
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
   * 启用技能
   */
  @Post(':id/enable')
  async enableSkill(@Param('id') skillId: string): Promise<{ success: boolean; message: string }> {
    this.logger.log(`Enabling skill: ${skillId}`);
    try {
      await this.orchestrator.enableSkill(skillId);
      return { success: true, message: `Skill '${skillId}' enabled` };
    } catch (error: any) {
      return { success: false, message: error.message };
    }
  }

  /**
   * 禁用技能
   */
  @Post(':id/disable')
  async disableSkill(@Param('id') skillId: string): Promise<{ success: boolean; message: string }> {
    this.logger.log(`Disabling skill: ${skillId}`);
    try {
      await this.orchestrator.disableSkill(skillId);
      return { success: true, message: `Skill '${skillId}' disabled` };
    } catch (error: any) {
      return { success: false, message: error.message };
    }
  }

  /**
   * 批量启用/禁用技能
   */
  @Post('batch-toggle')
  async batchToggleSkills(@Body() body: { ids: string[]; enabled: boolean }): Promise<{ success: boolean; message: string }> {
    this.logger.log(`Batch toggle skills: ${body.ids.length} skills -> enabled=${body.enabled}`);
    try {
      await this.orchestrator.batchToggleSkills(body.ids, body.enabled);
      return { success: true, message: `${body.ids.length} skills ${body.enabled ? 'enabled' : 'disabled'}` };
    } catch (error: any) {
      return { success: false, message: error.message };
    }
  }

  /**
   * 获取所有技能的启用状态
   */
  @Get('enabled-status')
  getEnabledStatus(): Array<{ id: string; enabled: boolean }> {
    return this.orchestrator.listSkills(false).map(s => ({
      id: s.id,
      enabled: s.enabled !== false,
    }));
  }

  /**
   * 从 Git 仓库安装技能
   */
  @Post('install-from-git')
  async installFromGit(@Body() body: { 
    url: string; 
    branch?: string;
    subdirectory?: string;
    force?: boolean;
  }): Promise<{ success: boolean; skillId?: string; message: string }> {
    try {
      const { url, branch, subdirectory, force } = body;

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

      // 确定技能源目录
      let skillSourceDir = tempDir;
      if (subdirectory) {
        skillSourceDir = path.join(tempDir, subdirectory);
      }

      // 智能查找 SKILL.md 文件（两级目录搜索）
      const skillInfo = await this.findSkillWithSmartLevel(skillSourceDir);
      if (!skillInfo) {
        await fs.rm(tempDir, { recursive: true, force: true });
        return { success: false, message: 'No SKILL.md found in the repository (searched up to 2 levels deep)' };
      }

      const { skillMdPath, skillDir } = skillInfo;

      // 读取 SKILL.md 获取技能元数据
      const skillMdContent = await fs.readFile(skillMdPath, 'utf-8');
      const frontmatterMatch = skillMdContent.match(/^---\s*\n([\s\S]*?)\n---/);
      let manifestName = '';
      let description = '';
      if (frontmatterMatch) {
        const yamlContent = frontmatterMatch[1];
        const nameMatch = yamlContent.match(/^name:\s*(.+)/im);
        if (nameMatch) {
          manifestName = nameMatch[1].trim().replace(/^['"]|['"]$/g, '');
        }
        const descMatch = yamlContent.match(/description:\s*(.+)/i);
        if (descMatch) {
          description = descMatch[1].trim().replace(/^['"]|['"]$/g, '');
        }
      }

      // 必须从 manifest 中提取到 name，不用 skillInfo.skillName（那是临时目录名）
      if (!manifestName) {
        await fs.rm(tempDir, { recursive: true, force: true });
        return { success: false, message: 'Skill name not found in SKILL.md frontmatter' };
      }

      // 必须从 manifest 中提取到 name，不用 skillInfo.skillName（那是临时目录名）
      if (!manifestName) {
        await fs.rm(tempDir, { recursive: true, force: true });
        return { success: false, message: 'Skill name not found in SKILL.md frontmatter' };
      }

      // 使用公共验证器验证技能元数据
      const validationResult = SkillMetadataValidator.validateMetadata(
        manifestName,
        description,
        manifestName,  // 目录名以 manifest name 为准
      );
      
      if (!validationResult.isValid) {
        await fs.rm(tempDir, { recursive: true, force: true });
        return { success: false, message: validationResult.errors.join('; ') };
      }

      // 检查是否和内置技能冲突
      const systemDir = path.join(this.skillsDir, '.system', manifestName);
      try {
        await fs.access(systemDir);
        await fs.rm(tempDir, { recursive: true, force: true });
        return { success: false, message: `Skill '${manifestName}' is a system built-in skill and cannot be overwritten.` };
      } catch {
        // 不是内置技能，继续
      }

      // 移动到 skills 目录
      const targetDir = path.join(this.skillsDir, manifestName);
      
      // 检查是否已存在
      try {
        await fs.access(targetDir);
        
        if (!force) {
          await fs.rm(tempDir, { recursive: true, force: true });
          return { success: false, message: `Skill '${manifestName}' already exists. Use force=true to overwrite.` };
        }
        
        // 强制覆盖：删除旧目录
        this.logger.log(`Force overwriting existing skill from Git: ${manifestName}`);
        await fs.rm(targetDir, { recursive: true, force: true });
      } catch {
        // 目录不存在，继续
      }

      // 确保目标父目录存在
      await fs.mkdir(path.dirname(targetDir), { recursive: true });
      
      // 移动目录（自动转换到正确层级）
      // 注意：使用 copy + rm 替代 rename，以支持跨磁盘分区移动
      await this.copyDirectory(skillDir, targetDir);
      await fs.rm(skillDir, { recursive: true, force: true });

      // 清理临时文件
      await fs.rm(tempDir, { recursive: true, force: true });

      // 触发扫描以加载新 Skill
      await this.orchestrator.triggerScan();

      this.logger.log(`Successfully installed skill from Git: ${manifestName}${force ? ' (forced overwrite)' : ''}`);
      return { 
        success: true, 
        skillId: manifestName, 
        message: `Skill '${manifestName}' installed successfully from Git${force ? ' (overwritten)' : ''}` 
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to install skill from Git: ${errorMessage}`);
      return { success: false, message: `Installation failed: ${errorMessage}` };
    }
  }

  /**
   * 从 URL 安装技能（下载 ZIP 包）
   * 支持包内包含多个技能
   */
  @Post('install-from-url')
  async installFromUrl(@Body() body: {
    url: string;
    force?: boolean;
  }): Promise<{ success: boolean; skillIds?: string[]; message: string }> {
    try {
      const { url, force } = body;

      if (!url) {
        return { success: false, message: 'URL is required' };
      }

      // 验证 URL 格式
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        return { success: false, message: 'Invalid URL. Must start with http:// or https://' };
      }

      this.logger.log(`Downloading skill from URL: ${url}`);

      // 创建临时目录
      const tempDirName = `skill-url-${Date.now()}`;
      const tempDir = path.join(process.cwd(), 'temp', tempDirName);
      await fs.mkdir(tempDir, { recursive: true });

      // 下载 ZIP 文件
      const zipPath = path.join(tempDir, 'skill.zip');
      const response = await fetch(url);
      if (!response.ok) {
        await fs.rm(tempDir, { recursive: true, force: true });
        return { success: false, message: `Failed to download ZIP: HTTP ${response.status} ${response.statusText}` };
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      await fs.writeFile(zipPath, buffer);

      // 验证 & 解压 ZIP
      let zip: AdmZip;
      try {
        zip = new AdmZip(zipPath);
      } catch {
        await fs.rm(tempDir, { recursive: true, force: true });
        return { success: false, message: 'Downloaded file is not a valid ZIP archive' };
      }
      zip.extractAllTo(tempDir, true);

      // 安装包内所有技能
      const result = await this.installSkillsFromDir(tempDir, force);

      // 清理临时文件
      await fs.rm(tempDir, { recursive: true, force: true });

      // 有成功安装的技能时触发扫描
      if (result.installed.length > 0) {
        await this.orchestrator.triggerScan();
      }

      // 构造返回消息
      const parts: string[] = [];
      if (result.installed.length > 0) {
        parts.push(`Installed: ${result.installed.map(s => `'${s.skillId}'`).join(', ')}`);
      }
      if (result.errors.length > 0) {
        parts.push(`Errors: ${result.errors.map(e => e.error).join('; ')}`);
      }

      const success = result.installed.length > 0;
      return {
        success,
        skillIds: result.installed.map(s => s.skillId),
        message: parts.length > 0 ? parts.join('. ') : 'No skills found in the ZIP archive',
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to install skill from URL: ${errorMessage}`);
      return { success: false, message: `Installation failed: ${errorMessage}` };
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
      const gitDir = path.join(skill.baseDir, skill.basePath, '.git');
      try {
        await fs.access(gitDir);
      } catch {
        return { success: false, message: `Skill '${skillId}' was not installed from Git, cannot update` };
      }

      this.logger.log(`Updating skill from Git: ${skillId}`);

      // 执行 git pull
      await execAsync('git pull', { 
        cwd: path.join(skill.baseDir, skill.basePath),
        timeout: 30000 
      });

      // 重新加载技能
      await this.orchestrator.reloadSkill(skillId);

      this.logger.log(`Successfully updated skill: ${skillId}`);
      return { success: true, message: `Skill '${skillId}' updated successfully` };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to update skill: ${errorMessage}`);
      return { success: false, message: `Update failed: ${errorMessage}` };
    }
  }

  /**
   * 安装技能包（上传 ZIP 文件）
   * 支持包内包含多个技能
   */
  @Post('install')
  @UseInterceptors(FileInterceptor('file'))
  async installSkill(
    @UploadedFile() file: Express.Multer.File,
    @Body() body?: { force?: boolean }
  ): Promise<{ success: boolean; skillIds?: string[]; message: string }> {
    try {
      if (!file) {
        return { success: false, message: 'No file uploaded' };
      }

      // 验证文件类型
      if (!file.originalname.endsWith('.zip')) {
        return { success: false, message: 'Only ZIP files are supported' };
      }

      const force = body?.force === true || String(body?.force) === 'true';

      // 创建临时目录解压
      const tempDir = path.join(process.cwd(), 'temp', `skill-install-${Date.now()}`);
      await fs.mkdir(tempDir, { recursive: true });

      // 保存 ZIP 文件
      const zipPath = path.join(tempDir, file.originalname);
      await fs.writeFile(zipPath, file.buffer);

      // 解压 ZIP
      const zip = new AdmZip(zipPath);
      zip.extractAllTo(tempDir, true);

      // 安装包内所有技能
      const result = await this.installSkillsFromDir(tempDir, force);

      // 清理临时文件
      await fs.rm(tempDir, { recursive: true, force: true });

      // 有成功安装的技能时触发扫描
      if (result.installed.length > 0) {
        await this.orchestrator.triggerScan();
      }

      // 构造返回消息
      const parts: string[] = [];
      if (result.installed.length > 0) {
        parts.push(`Installed: ${result.installed.map(s => `'${s.skillId}'`).join(', ')}`);
      }
      if (result.errors.length > 0) {
        parts.push(`Errors: ${result.errors.map(e => e.error).join('; ')}`);
      }

      const success = result.installed.length > 0;
      return {
        success,
        skillIds: result.installed.map(s => s.skillId),
        message: parts.length > 0 ? parts.join('. ') : 'No skills found in the ZIP archive',
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to install skill: ${errorMessage}`);
      return { success: false, message: `Installation failed: ${errorMessage}` };
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

      // 禁止卸载系统内置技能
      if (skill.source === 'system') {
        return { success: false, message: `Skill '${skillId}' is a system built-in skill and cannot be uninstalled.` };
      }

      // 删除技能目录
      await fs.rm(path.join(skill.baseDir, skill.basePath), { recursive: true, force: true });

      // 触发扫描以更新注册表
      await this.orchestrator.triggerScan();

      this.logger.log(`Successfully uninstalled skill: ${skillId}`);
      return { success: true, message: `Skill '${skillId}' uninstalled successfully` };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to uninstall skill: ${errorMessage}`);
      return { success: false, message: `Uninstallation failed: ${errorMessage}` };
    }
  }

  /**
   * 智能查找 SKILL.md 文件（两级目录搜索）
   * 优先在当前目录查找，如果没有则在一级子目录中查找
   * 返回第一个找到的 SKILL.md 及其所在目录信息
   */
  private async findSkillWithSmartLevel(dir: string): Promise<{
    skillMdPath: string;
    skillDir: string;
    skillName: string;
  } | null> {
    // 第一级：检查当前目录是否有 SKILL.md
    const currentLevelSkillMd = path.join(dir, 'SKILL.md');
    try {
      await fs.access(currentLevelSkillMd);
      return {
        skillMdPath: currentLevelSkillMd,
        skillDir: dir,
        skillName: path.basename(dir),
      };
    } catch {
      // 当前目录没有 SKILL.md，继续检查子目录
    }

    // 第二级：检查一级子目录
    const entries = await fs.readdir(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      
      // 跳过隐藏目录和 node_modules
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;

      const subDir = path.join(dir, entry.name);
      const subSkillMd = path.join(subDir, 'SKILL.md');
      
      try {
        await fs.access(subSkillMd);
        return {
          skillMdPath: subSkillMd,
          skillDir: subDir,
          skillName: entry.name,
        };
      } catch {
        // 这个子目录没有 SKILL.md，继续下一个
        continue;
      }
    }

    return null;
  }

  /**
   * 从 SKILL.md 文件中解析技能名称和描述
   */
  private async parseSkillMetadata(skillMdPath: string): Promise<{
    name: string;
    description: string;
  } | null> {
    try {
      const skillMdContent = await fs.readFile(skillMdPath, 'utf-8');
      const frontmatterMatch = skillMdContent.match(/^---\s*\n([\s\S]*?)\n---/);
      let manifestName = '';
      let description = '';
      if (frontmatterMatch) {
        const yamlContent = frontmatterMatch[1];
        const nameMatch = yamlContent.match(/^name:\s*(.+)/im);
        if (nameMatch) {
          manifestName = nameMatch[1].trim().replace(/^['"]|['"]$/g, '');
        }
        const descMatch = yamlContent.match(/description:\s*(.+)/i);
        if (descMatch) {
          description = descMatch[1].trim().replace(/^['"]|['"]$/g, '');
        }
      }
      if (!manifestName) {
        return null;
      }
      return { name: manifestName, description };
    } catch {
      return null;
    }
  }

  /**
   * 从解压目录安装所有技能（支持多技能包）
   */
  private async installSkillsFromDir(
    tempDir: string,
    force: boolean,
  ): Promise<{
    installed: Array<{ skillId: string }>;
    errors: Array<{ skillId: string; error: string }>;
  }> {
    const result: { installed: Array<{ skillId: string }>; errors: Array<{ skillId: string; error: string }> } = {
      installed: [],
      errors: [],
    };

    // 递归查找所有 SKILL.md
    const skillMdFiles = await this.findSkillMdFiles(tempDir);
    if (skillMdFiles.length === 0) {
      return result;
    }

    for (const skillMdPath of skillMdFiles) {
      const skillDir = path.dirname(skillMdPath);

      // 解析元数据
      const metadata = await this.parseSkillMetadata(skillMdPath);
      if (!metadata) {
        result.errors.push({ skillId: path.basename(skillDir), error: 'Skill name not found in SKILL.md frontmatter' });
        continue;
      }

      const { name: manifestName, description } = metadata;

      // 验证元数据
      const validationResult = SkillMetadataValidator.validateMetadata(
        manifestName,
        description,
        manifestName,
      );
      if (!validationResult.isValid) {
        result.errors.push({ skillId: manifestName, error: validationResult.errors.join('; ') });
        continue;
      }

      // 检查是否和内置技能冲突
      const systemDir = path.join(this.skillsDir, '.system', manifestName);
      try {
        await fs.access(systemDir);
        result.errors.push({ skillId: manifestName, error: `Skill '${manifestName}' is a system built-in skill` });
        continue;
      } catch {
        // 不是内置技能，继续
      }

      // 复制到 skills 目录
      const targetDir = path.join(this.skillsDir, manifestName);

      try {
        // 检查是否已存在
        try {
          await fs.access(targetDir);
          if (!force) {
            result.errors.push({ skillId: manifestName, error: `Skill already exists. Use force=true to overwrite` });
            continue;
          }
          this.logger.log(`Force overwriting existing skill: ${manifestName}`);
          await fs.rm(targetDir, { recursive: true, force: true });
        } catch {
          // 目录不存在，继续
        }

        // 确保目标父目录存在
        await fs.mkdir(path.dirname(targetDir), { recursive: true });

        // 复制目录
        await this.copyDirectory(skillDir, targetDir);

        result.installed.push({ skillId: manifestName });
        this.logger.log(`Installed skill: ${manifestName}`);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        result.errors.push({ skillId: manifestName, error: errorMessage });
      }
    }

    return result;
  }

  /**
   * 递归复制目录
   * @param src 源目录
   * @param dest 目标目录
   */
  private async copyDirectory(src: string, dest: string): Promise<void> {
    // 创建目标目录
    await fs.mkdir(dest, { recursive: true });
    
    // 读取源目录内容
    const entries = await fs.readdir(src, { withFileTypes: true });
    
    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      
      if (entry.isDirectory()) {
        // 递归复制子目录
        await this.copyDirectory(srcPath, destPath);
      } else {
        // 复制文件
        await fs.copyFile(srcPath, destPath);
      }
    }
  }

  /**
   * 递归查找 SKILL.md 文件（保留用于其他用途）
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
