import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as path from 'path';
import * as fs from 'fs';
import { SettingsStorage } from '../utils/settings-storage.util';
import { SG_SYSTEM, SK_SYS_WORKSPACE_BASE_DIR } from '../../constants/settings.constants';

@Injectable()
export class WorkspaceService {
  private readonly logger = new Logger(WorkspaceService.name);
  private readonly fallbackBaseDir: string;
  private readonly safeWritePaths: Set<string> = new Set();

  constructor(
    private configService: ConfigService,
    private settingsStorage: SettingsStorage,
  ) {
    this.fallbackBaseDir = this.configService.get<string>('WORKSPACE_BASE_DIR') ||
                           path.join(process.cwd(), 'workspace');

    // 确保基础目录存在
    if (!fs.existsSync(this.fallbackBaseDir)) {
      fs.mkdirSync(this.fallbackBaseDir, { recursive: true });
      this.logger.log(`Created workspace base directory: ${this.fallbackBaseDir}`);
    }
  }

  /**
   * 获取当前生效的工作目录基路径
   * 优先级：全局设置 > 环境变量/内置默认值
   * @returns 生效的基路径绝对路径
   */
  getEffectiveBaseDir(): string {
    const globalBaseDir = this.settingsStorage.getSettingValue(
      SG_SYSTEM, SK_SYS_WORKSPACE_BASE_DIR, null,
    );
    if (globalBaseDir && typeof globalBaseDir === 'string' && path.isAbsolute(globalBaseDir)) {
      const resolved = path.resolve(globalBaseDir);
      // 确保目录存在
      if (!fs.existsSync(resolved)) {
        try {
          fs.mkdirSync(resolved, { recursive: true });
          this.logger.log(`Created global workspace base directory: ${resolved}`);
        } catch (error: any) {
          this.logger.error(`Failed to create global workspace base directory ${resolved}: ${error.message}`);
          return this.fallbackBaseDir;
        }
      }
      return resolved;
    }
    return this.fallbackBaseDir;
  }

  /**
   * 获取指定会话的工作目录
   * @param sessionId 会话 ID
   * @returns 会话专属工作目录的绝对路径
   */
  getWorkspaceDir(sessionId: string): string {
    const baseDir = this.getEffectiveBaseDir();
    // 使用 path.resolve 处理相对路径和特殊字符
    const sessionDir = path.resolve(baseDir, sessionId);
    const resolvedBaseDir = path.resolve(baseDir);

    // 路径安全检查：防止路径遍历攻击 (Path Traversal)
    if (!sessionDir.startsWith(resolvedBaseDir)) {
      throw new Error(`Invalid session ID: Path traversal detected for '${sessionId}'`);
    }

    // 如果目录不存在，自动创建
    if (!fs.existsSync(sessionDir)) {
      fs.mkdirSync(sessionDir, { recursive: true });
      this.logger.debug(`Created workspace directory for session: ${sessionId}`);
    }

    return sessionDir;
  }

  /**
   * 生成新命名规则的默认工作目录名称
   * 格式：{prefix}-YYYY-MM-DD-[四位随机字符]
   * @param prefix 前缀，默认为 'WORK'
   * @returns 工作目录名称
   */
  private generateWorkspaceDirName(prefix: string = 'WORK'): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    // 生成四位随机字符（大小写字母+数字）
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let randomCode = '';
    for (let i = 0; i < 4; i++) {
      randomCode += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return `${prefix}-${year}-${month}-${day}-${randomCode}`;
  }

  /**
   * 生成新的工作目录路径（用于创建新会话时分配默认工作目录）
   * 命名规则：{prefix}-YYYY-MM-DD-[四位随机字符防冲突]
   * 会自动检测目录名冲突并创建目录
   * @param prefix 前缀，默认为 'WORK'
   * @returns 新生成的工作目录绝对路径
   */
  generateWorkspaceDir(prefix: string = 'WORK'): string {
    const baseDir = this.getEffectiveBaseDir();
    const resolvedBaseDir = path.resolve(baseDir);

    let attempts = 0;
    const maxAttempts = 100;
    while (attempts < maxAttempts) {
      const dirName = this.generateWorkspaceDirName(prefix);
      const sessionDir = path.resolve(baseDir, dirName);

      // 路径安全检查
      if (!sessionDir.startsWith(resolvedBaseDir)) {
        throw new Error(`Invalid workspace dir name: Path traversal detected for '${dirName}'`);
      }

      // 检查目录是否已存在，不存在则创建并返回
      if (!fs.existsSync(sessionDir)) {
        fs.mkdirSync(sessionDir, { recursive: true });
        this.logger.log(`Created workspace directory: ${sessionDir}`);
        return sessionDir;
      }

      attempts++;
      this.logger.warn(`Workspace dir name collision detected: ${dirName}, retrying (${attempts}/${maxAttempts})`);
    }

    throw new Error(`Failed to generate unique workspace directory name after ${maxAttempts} attempts`);
  }

  /**
   * 获取指定会话的默认工作目录路径
   * 命名规则：直接使用 sessionId 作为目录名
   * @param sessionId 会话 ID
   * @returns 默认工作目录的绝对路径
   */
  getDefaultWorkspaceDir(sessionId: string): string {
    const baseDir = this.getEffectiveBaseDir();
    const sessionDir = path.resolve(baseDir, sessionId);
    const resolvedBaseDir = path.resolve(baseDir);

    // 路径安全检查：防止路径遍历攻击
    if (!sessionDir.startsWith(resolvedBaseDir)) {
      throw new Error(`Invalid session ID: Path traversal detected for '${sessionId}'`);
    }

    // 确保目录存在
    if (!fs.existsSync(sessionDir)) {
      fs.mkdirSync(sessionDir, { recursive: true });
      this.logger.debug(`Created workspace directory for session: ${sessionId}`);
    }

    return sessionDir;
  }

  /**
   * 确保目录存在（如果不存在则创建）
   * @param dirPath 目录路径
   */
  async ensureDirectoryExists(dirPath: string): Promise<void> {
    if (!fs.existsSync(dirPath)) {
      try {
        fs.mkdirSync(dirPath, { recursive: true });
        this.logger.debug(`Created directory: ${dirPath}`);
      } catch (error: any) {
        this.logger.error(`Failed to create directory ${dirPath}: ${error.message}`);
        throw new Error(`无法创建目录：${error.message}`);
      }
    }
  }

  /**
   * 验证自定义工作目录路径的安全性
   * @param customPath 自定义路径
   */
  async validateCustomWorkspacePath(customPath: string): Promise<void> {
    // 1. 检查路径是否为绝对路径
    if (!path.isAbsolute(customPath)) {
      throw new Error('自定义工作目录必须是绝对路径');
    }
    
    // TODO: 后期实现更安全的限制方法（如沙箱、权限控制等）
    // 当前暂时取消所有限制，允许用户指定任意绝对路径
  }

  /**
   * 清理会话的默认工作目录
   * 注意：只会删除默认工作目录（baseDir/sessionId），不会删除自定义工作目录
   * @param sessionId 会话 ID
   */
  async cleanupDefaultWorkspace(sessionId: string): Promise<void> {
    const defaultWorkspaceDir = this.getDefaultWorkspaceDir(sessionId);
    if (fs.existsSync(defaultWorkspaceDir)) {
      try {
        await fs.promises.rm(defaultWorkspaceDir, { recursive: true, force: true });
        this.logger.log(`Cleaned up default workspace for session: ${sessionId}`);
      } catch (error: any) {
        this.logger.error(`Failed to cleanup default workspace for session ${sessionId}: ${error.message}`);
      }
    }
  }

  /**
   * 解析会话的工作目录路径
   * 优先级：会话自定义路径 > 会话记录的默认工作目录
   * @param session 会话对象
   * @returns 解析后的工作目录绝对路径
   */
  resolveSessionWorkspaceDir(session: any): string {
    if (session?.workspacePath) {
      return path.resolve(session.workspacePath);
    }
    // 会话未设置工作目录时，使用基于 sessionId 的旧路径（兼容已有会话）
    return this.getDefaultWorkspaceDir(session.id);
  }

  /**
   * 注册安全写入路径
   * @param safePath 允许写入的绝对路径
   */
  registerSafeWritePath(safePath: string): void {
    const normalizedPath = path.resolve(safePath);
    this.safeWritePaths.add(normalizedPath);
    this.logger.debug(`Registered safe write path: ${normalizedPath}`);
  }

  /**
   * 注销安全写入路径
   * @param safePath 要移除的安全路径
   */
  unregisterSafeWritePath(safePath: string): void {
    const normalizedPath = path.resolve(safePath);
    this.safeWritePaths.delete(normalizedPath);
    this.logger.debug(`Unregistered safe write path: ${normalizedPath}`);
  }

  /**
   * 获取所有安全写入路径列表
   * @returns 安全写入路径数组
   */
  getSafeWritePaths(): string[] {
    return Array.from(this.safeWritePaths);
  }

  /**
   * 检查路径是否为安全写入路径
   * @param targetPath 要检查的目标路径
   * @param extraSafePaths 额外允许的安全路径数组（如工作目录）
   * @returns 是否允许写入
   */
  isSafeWritePath(targetPath: string, extraSafePaths: string[] = []): boolean {
    const resolvedTarget = path.resolve(targetPath);
    
    // 合并系统注册的安全路径和额外传入的安全路径
    const allSafePaths = [...this.safeWritePaths, ...extraSafePaths];
    
    // 检查目标路径是否在任何安全路径之下
    for (const safePath of allSafePaths) {
      const resolvedSafePath = path.resolve(safePath);
      if (resolvedTarget.startsWith(resolvedSafePath + path.sep) || resolvedTarget === resolvedSafePath) {
        return true;
      }
    }
    
    return false;
  }

  /**
   * 验证写入路径是否安全
   * @param targetPath 目标写入路径
   * @param extraSafePaths 额外允许的安全路径数组（如工作目录）
   * @throws Error 如果路径不安全
   */
  validateWritePath(targetPath: string, extraSafePaths: string[] = []): void {
    if (!this.isSafeWritePath(targetPath, extraSafePaths)) {
      throw new Error(
        `不允许写入该路径: ${targetPath}。只能写入当前会话的工作目录或已注册的安全路径。`
      );
    }
  }

  /**
   * 解析文件路径：如果是相对路径且有 session_id，则基于会话工作目录解析
   * @param filePath 文件路径（绝对或相对）
   * @param sessionId 会话 ID（可选）
   * @returns 解析后的绝对路径
   */
  /**
   * 解析文件路径
   * 
   * 将相对路径解析为绝对路径。如果是绝对路径则直接返回。
   * 相对路径基于提供的工作目录解析。
   * 
   * @param filePath 文件路径（相对或绝对）
   * @param workspaceDir 工作目录路径（必选）
   * @returns 解析后的绝对路径
   */
  resolveFilePath(filePath: string, workspaceDir: string): string {
    if (path.isAbsolute(filePath)) {
      return path.normalize(filePath);
    }

    // 基于工作目录解析相对路径
    return path.join(workspaceDir, filePath);
  }

}
