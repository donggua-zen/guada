import {
  Controller, Get, Post, Put, Param, Body, Logger, Query, UseInterceptors, UploadedFile,
  Inject, NotFoundException, BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { SkillOrchestrator } from '../core/skill-orchestrator.service';
import { SkillWatcherService } from '../core/skill-watcher.service';
import {
  SkillToggleConfigService,
  type SkillToggleConfig,
} from '../core/skill-toggle-config.service';
import { SkillDefinition, SkillOrigin } from '../interfaces/skill-manifest.interface';
import {
  copyDirectory,
  extractZipSafely,
  installSkillsFromDirectory,
} from '../core/skill-package.installer';
import { SkillDiscoveryResult } from '../interfaces/index';
import { createPaginatedResponse, PaginatedResponse } from '../../../common/types/pagination';
import { SkillMetadataValidator } from '../common/skill-metadata.validator';
import { ConfigService } from '@nestjs/config';
import { PROJECT_GROUP_PORT } from '../../../common/store/ports/group.port';
import type { ProjectGroupPort } from '../../../common/store/ports/group.port';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
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
    // 目录分组端口（StoreModule 为 @Global）：只查项目路径，不反向依赖 ChatModule
    @Inject(PROJECT_GROUP_PORT) private projectGroups: ProjectGroupPort,
    private toggleConfig: SkillToggleConfigService,
  ) {
    this.skillsDir = this.configService.get<string>('SKILLS_DIR') || 
                     path.join(process.cwd(), 'skills');
  }

  /**
   * 把「项目分组 id」解析成项目主工作目录。
   *
   * 管理页的项目视图只按目录作用域工作：无 id = 全局口径（行为与历史一致）；
   * 有 id 但分组不存在 = 404（项目可能刚被删除，前端应回落全局视图）。
   */
  private async resolveProjectPath(projectGroupId?: string): Promise<string | undefined> {
    const id = typeof projectGroupId === 'string' ? projectGroupId.trim() : '';
    if (!id) return undefined;
    const group = await this.projectGroups.findProjectGroup(id);
    if (!group?.path) {
      throw new NotFoundException(`Project group ${id} not found`);
    }
    return group.path;
  }

  /**
   * 用户可安装的技能目录
   */
  private getUserSkillsDir(): string {
    return this.skillsDir;
  }

  /**
   * 列出所有已加载的 Skills（支持分页）
   *
   * 默认（管理页口径）只返回**全局共享**技能。智能体专属技能（注册时声明了
   * visibleTo）随智能体绑定，不在此列——它们既不能被其他智能体使用，
   * 也无法在管理页开关，列出来只会误导。
   *
   * `?agentId=` 时切换为**智能体配置页口径**：全局共享 + 该智能体的专属技能，
   * 供面板把专属技能以锁定态展示。
   *
   * `?projectGroupId=` 时切换为**项目口径**：全局共享 + 该项目 `.guada/skills`
   * （同名覆盖，被覆盖项带 `overridden: true`）。项目分组不存在 → 404。
   * 两者互斥：同时传入以 projectGroupId 为准（页面不会这样用）。
   */
  @Get()
  async listSkills(
    @Query('page') page?: number,
    @Query('size') size?: number,
    @Query('agentId') agentId?: string,
    @Query('projectGroupId') projectGroupId?: string,
  ): Promise<PaginatedResponse<SkillDefinition>> {
    const projectPath = await this.resolveProjectPath(projectGroupId);
    let allSkills: SkillDefinition[];

    if (projectPath) {
      // 页面可能在会话从未运行过时打开：显式加载该项目来源
      await this.orchestrator.ensureProjectSkills(projectPath);
      allSkills = this.orchestrator.listManageableSkillsForProject(projectPath, false);
    } else if (agentId) {
      allSkills = this.orchestrator.listSkillsForAgent(agentId, false);
    } else {
      allSkills = this.orchestrator.listManageableSkills(false);
    }

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
   * 获取自动扫描状态
   *
   * 注意：必须注册在所有 `@Get(':id')` 之前。Nest 按声明顺序匹配路由，
   * `:id` 会把 `watcher/status`、`enabled-status` 这类字面量段吞掉。
   */
  @Get('watcher/status')
  getWatcherStatus(): { enabled: boolean } {
    // TODO: 从配置中读取，目前默认启用
    return { enabled: true };
  }

  /**
   * 获取所有技能的启用状态
   *
   * 同样必须早于 `@Get(':id')`：否则会被当作 id="enabled-status" 的技能详情，
   * 返回 200 空体。
   */
  @Get('enabled-status')
  getEnabledStatus(): Array<{ id: string; enabled: boolean }> {
    return this.orchestrator.listManageableSkills(false).map(s => ({
      id: s.id,
      enabled: s.enabled !== false,
    }));
  }

  /**
   * 技能开关配置（全局或项目，格式统一为 `skills.yaml` 的覆盖表）
   *
   * - `?projectGroupId=` 缺省 → 全局：`<SETTINGS_DIR>/skills.yaml`
   * - 带 `projectGroupId` → 项目：`<项目>/.guada/skills.yaml`
   *
   * 必须早于 `@Get(':id')`，否则会被当作 id="project-config" 的技能详情。
   * 文件不存在时返回空覆盖表（不代表出错——大多数项目不会配置这个文件）。
   */
  @Get('project-config')
  async getSkillToggleConfig(
    @Query('projectGroupId') projectGroupId?: string,
  ): Promise<SkillToggleConfig> {
    const projectPath = await this.resolveProjectPath(projectGroupId);
    return projectPath
      ? this.toggleConfig.readProject(projectPath)
      : this.toggleConfig.readGlobal();
  }

  /**
   * 设置某技能在该作用域的**期望状态**（作用域由 `projectGroupId` 决定）。
   *
   * - 全局：`enabled=true` 删除覆盖（默认态）；`false` 写显式 false
   * - 项目：与全局状态相同 → 删除覆盖（回到继承）；不同 → 写显式覆盖
   *
   * 项目可以**双向**覆盖全局：既能关掉全局已启用的技能，也能打开全局已禁用的。
   */
  @Put('project-config')
  async updateSkillToggleConfig(
    @Body() body: {
      projectGroupId?: string;
      skillId?: string;
      enabled?: boolean;
    },
  ): Promise<SkillToggleConfig> {
    const skillId = String(body?.skillId || '').trim().toLowerCase();
    if (!skillId) {
      throw new BadRequestException('skillId is required');
    }
    if (typeof body?.enabled !== 'boolean') {
      throw new BadRequestException('enabled must be a boolean');
    }

    const projectPath = await this.resolveProjectPath(body?.projectGroupId);

    // 技能必须真实存在（全局或该项目），否则写进去的是一条永远不生效的配置
    if (projectPath) await this.orchestrator.ensureProjectSkills(projectPath);
    const known =
      this.orchestrator.getManageableSkillDetail(skillId, projectPath) !== null;
    if (!known) {
      throw new BadRequestException(`Skill '${skillId}' not found`);
    }

    if (!projectPath) {
      return await this.toggleConfig.setGlobalEnabled(skillId, body.enabled);
    }

    // 项目作用域：与全局状态一致时不留覆盖，保持文件干净
    const globalEnabled =
      this.orchestrator.resolveSkillEnabled(skillId).enabled;
    return await this.toggleConfig.setProjectOverride(
      projectPath,
      skillId,
      body.enabled === globalEnabled ? undefined : body.enabled,
    );
  }

  /**
   * 获取 Skill 详情
   *
   * `?projectGroupId=` 时按项目作用域解析（项目版本优先于全局同名版本）。
   */
  @Get(':id')
  async getSkillDetail(
    @Param('id') skillId: string,
    @Query('projectGroupId') projectGroupId?: string,
  ): Promise<SkillDefinition | null> {
    const projectPath = await this.resolveProjectPath(projectGroupId);
    if (projectPath) await this.orchestrator.ensureProjectSkills(projectPath);
    return this.orchestrator.getManageableSkillDetail(skillId, projectPath);
  }

  /**
   * 获取 Skill 的文档内容（SKILL.md）
   *
   * 项目视图下必须读项目版本：同名技能在项目里覆盖全局时，读全局那份会让
   * 页面显示与实际学习内容不一致。
   */
  @Get(':id/documentation')
  async getSkillDocumentation(
    @Param('id') skillId: string,
    @Query('projectGroupId') projectGroupId?: string,
  ): Promise<{ content: string }> {
    const projectPath = await this.resolveProjectPath(projectGroupId);
    if (projectPath) await this.orchestrator.ensureProjectSkills(projectPath);

    const skill = this.orchestrator.getManageableSkillDetail(skillId, projectPath);
    if (!skill) {
      return { content: '' };
    }

    // 注册式技能（插件提供，内嵌正文）→ 直接返回 content
    if (skill.content) {
      return { content: skill.content };
    }

    // 文件式技能：直接读取原始 SKILL.md 文件内容
    const fs = await import('fs/promises');
    const path = await import('path');
    const skillMdPath = path.join(skill.baseDir, skill.basePath, 'SKILL.md');
    try {
      const rawContent = await fs.readFile(skillMdPath, 'utf-8');
      return { content: rawContent };
    } catch (error: any) {
      if (error?.code === 'ENOENT') {
        throw new NotFoundException(`SKILL.md not found for ${skillId}`);
      }
      throw error;
    }
  }

  /**
   * 触发手动扫描
   *
   * `?projectGroupId=` 时先刷新该项目来源（重建 watcher 与清单），再走全量 scan。
   */
  @Post('scan')
  async triggerScan(
    @Query('projectGroupId') projectGroupId?: string,
  ): Promise<{ success: boolean; message: string }> {
    this.logger.log('Manual scan triggered');
    try {
      const projectPath = await this.resolveProjectPath(projectGroupId);
      if (projectPath) {
        await this.orchestrator.ensureProjectSkills(projectPath);
      }
      await this.orchestrator.triggerScan();
      return { success: true, message: 'Scan completed' };
    } catch (error: any) {
      return { success: false, message: error.message };
    }
  }

  /**
   * 热加载指定 Skill（`?projectGroupId=` 时按项目来源重载）
   */
  @Post(':id/reload')
  async reloadSkill(
    @Param('id') skillId: string,
    @Query('projectGroupId') projectGroupId?: string,
  ): Promise<SkillDefinition> {
    this.logger.log(`Reload requested for skill: ${skillId}`);
    const projectPath = await this.resolveProjectPath(projectGroupId);
    // 只在有项目作用域时传第二参，保持全局调用的签名与历史一致
    return projectPath
      ? this.orchestrator.reloadSkill(skillId, projectPath)
      : this.orchestrator.reloadSkill(skillId);
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
   *
   * 项目技能（`source=workspace`）不在注册表里，此处的 "not found" 即是拒绝；
   * 启停状态无项目维度（`settings.plugins["skills.<id>"]`），页面也因此把项目
   * 技能的开关置为只读，避免误改全局同名技能。
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
      const tempDir = path.join(os.tmpdir(), tempDirName);
      await fs.mkdir(tempDir, { recursive: true });

      this.logger.log(`Cloning skill from Git: ${url}`);

      // 构建 git clone 命令
      let cloneCommand = `git clone ${url} "${tempDir}"`;
      if (branch) {
        cloneCommand += ` --branch ${branch} --single-branch`;
      }
      cloneCommand += ' --depth 1'; // 只克隆最新提交，加快速度

      // 执行 git clone（windowsHide：打包版后端无控制台，否则子进程会新建控制台窗口）
      await execAsync(cloneCommand, { timeout: 60000, windowsHide: true }); // 60秒超时

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
      await copyDirectory(skillDir, targetDir);
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
    /** 市场来源；官网市场安装时由前端带上，手动粘贴 URL 时缺省 */
    origin?: SkillOrigin;
  }): Promise<{ success: boolean; skillIds?: string[]; message: string }> {
    try {
      const { url, force, origin } = body;

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
      const tempDir = path.join(os.tmpdir(), tempDirName);
      await fs.mkdir(tempDir, { recursive: true });

      try {
        // 下载 ZIP 文件
        const zipPath = path.join(tempDir, 'skill.zip');
        const response = await fetch(url);
        if (!response.ok) {
          return { success: false, message: `Failed to download ZIP: HTTP ${response.status} ${response.statusText}` };
        }
        const buffer = Buffer.from(await response.arrayBuffer());
        await fs.writeFile(zipPath, buffer);

        // 解压到独立子目录：避免 ZIP 内是根级 SKILL.md 时把 skill.zip 一起复制进技能目录
        const extractedDir = path.join(tempDir, 'extracted');
        await fs.mkdir(extractedDir, { recursive: true });
        try {
          extractZipSafely(zipPath, extractedDir);
        } catch {
          return { success: false, message: 'Downloaded file is not a valid ZIP archive' };
        }

        // 安装包内所有技能
        const result = await installSkillsFromDirectory(extractedDir, this.skillsDir, {
          force,
          origin,
        });

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
      } finally {
        // 清理临时文件
        await fs.rm(tempDir, { recursive: true, force: true });
      }
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
      const skill = this.orchestrator.getManageableSkillDetail(skillId);
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

      // 执行 git pull（windowsHide：同 git clone，避免打包版闪出控制台窗口）
      await execAsync('git pull', { 
        cwd: path.join(skill.baseDir, skill.basePath),
        timeout: 30000,
        windowsHide: true
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
      const tempDir = path.join(os.tmpdir(), `skill-install-${Date.now()}`);
      await fs.mkdir(tempDir, { recursive: true });

      try {
        // 保存 ZIP 文件（固定文件名，不信任上传文件名里的路径片段）
        const zipPath = path.join(tempDir, 'skill.zip');
        await fs.writeFile(zipPath, file.buffer);

        // 解压到独立子目录：避免根级 SKILL.md 时把 ZIP 自身复制进技能目录
        const extractedDir = path.join(tempDir, 'extracted');
        await fs.mkdir(extractedDir, { recursive: true });
        extractZipSafely(zipPath, extractedDir);

        // 安装包内所有技能
        const result = await installSkillsFromDirectory(extractedDir, this.skillsDir, { force });

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
      } finally {
        // 清理临时文件
        await fs.rm(tempDir, { recursive: true, force: true });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to install skill: ${errorMessage}`);
      return { success: false, message: `Installation failed: ${errorMessage}` };
    }
  }

  /**
   * 卸载技能
   *
   * 项目技能（`.guada/skills`）属项目资产，管理页只读，不允许从这里删除；
   * 传 `projectGroupId` 时按项目作用域解析，避免同名时误删全局版本。
   */
  @Post(':id/uninstall')
  async uninstallSkill(
    @Param('id') skillId: string,
    @Query('projectGroupId') projectGroupId?: string,
  ): Promise<{ success: boolean; message: string }> {
    try {
      const projectPath = await this.resolveProjectPath(projectGroupId);
      if (projectPath) await this.orchestrator.ensureProjectSkills(projectPath);

      const skill = this.orchestrator.getManageableSkillDetail(skillId, projectPath);
      if (!skill) {
        return { success: false, message: `Skill '${skillId}' not found` };
      }

      if (skill.source === 'workspace') {
        return {
          success: false,
          message: `Skill '${skillId}' belongs to the project directory (.guada/skills) and cannot be uninstalled from here.`,
        };
      }

      // 禁止卸载系统内置技能（source=system 现为插件注册的文本技能，无磁盘目录可删）
      if (skill.source === 'system') {
        return { success: false, message: `Skill '${skillId}' is a built-in skill registered by a plugin and cannot be uninstalled.` };
      }

      // 禁止卸载共享目录技能（~/.agents/skills/）
      if (skill.source === 'agents') {
        return { success: false, message: `Skill '${skillId}' is from the shared agents directory (~/.agents/skills/) and cannot be uninstalled from here. Remove the directory manually if needed.` };
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

  // 安装/解压/SKILL.md 解析统一在 core/skill-package.installer.ts
}
