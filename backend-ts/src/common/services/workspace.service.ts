import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as path from 'path';
import * as fs from 'fs';
import { EventEmitter } from 'events';

@Injectable()
export class WorkspaceService {
  private readonly logger = new Logger(WorkspaceService.name);
  private readonly baseDir: string;
  private readonly safeWritePaths: Set<string> = new Set();
  public readonly events: EventEmitter;

  constructor(private configService: ConfigService) {
    this.baseDir = this.configService.get<string>('WORKSPACE_BASE_DIR') || 
                   path.join(process.cwd(), 'workspace');
    this.events = new EventEmitter();
    
    // 确保基础目录存在
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
      this.logger.log(`Created workspace base directory: ${this.baseDir}`);
    }
  }

  /**
   * 获取指定会话的工作目录
   * @param sessionId 会话 ID
   * @returns 会话专属工作目录的绝对路径
   */
  getWorkspaceDir(sessionId: string): string {
    // 使用 path.resolve 处理相对路径和特殊字符
    const sessionDir = path.resolve(this.baseDir, sessionId);
    const resolvedBaseDir = path.resolve(this.baseDir);

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
   * 异步清理会话工作目录
   * @param sessionId 会话 ID
   */
  async cleanupWorkspace(sessionId: string): Promise<void> {
    const sessionDir = this.getWorkspaceDir(sessionId);
    if (fs.existsSync(sessionDir)) {
      try {
        await fs.promises.rm(sessionDir, { recursive: true, force: true });
        this.logger.log(`Cleaned up workspace for session: ${sessionId}`);
      } catch (error: any) {
        this.logger.error(`Failed to cleanup workspace for session ${sessionId}: ${error.message}`);
      }
    }
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
   * 检查路径是否为安全写入路径（需要提供 sessionId）
   * @param targetPath 要检查的目标路径
   * @param sessionId 会话 ID（必填）
   * @returns 是否允许写入
   */
  isSafeWritePath(targetPath: string, sessionId?: string): boolean {
    if (!sessionId) {
      return false;
    }

    const resolvedTarget = path.resolve(targetPath);
    
    // 获取会话工作目录
    try {
      const sessionWorkspaceDir = this.getWorkspaceDir(sessionId);
      const resolvedSessionDir = path.resolve(sessionWorkspaceDir);
      
      // 检查目标路径是否在会话工作目录之下
      if (resolvedTarget.startsWith(resolvedSessionDir + path.sep) || resolvedTarget === resolvedSessionDir) {
        return true;
      }
    } catch (error) {
      // 如果获取会话目录失败，返回 false
      return false;
    }
    
    // 检查目标路径是否在其他已注册的安全路径之下
    for (const safePath of this.safeWritePaths) {
      if (resolvedTarget.startsWith(safePath + path.sep) || resolvedTarget === safePath) {
        return true;
      }
    }
    
    return false;
  }

  /**
   * 验证写入路径是否安全（需要提供 sessionId）
   * @param targetPath 目标写入路径
   * @param sessionId 会话 ID（必填）
   * @throws Error 如果路径不安全
   */
  validateWritePath(targetPath: string, sessionId?: string): void {
    if (!this.isSafeWritePath(targetPath, sessionId)) {
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
  resolveFilePath(filePath: string, sessionId?: string): string {
    if (path.isAbsolute(filePath)) {
      return path.normalize(filePath);
    }

    // 如果存在 session_id，则相对于会话工作目录解析
    if (sessionId) {
      try {
        const workspaceDir = this.getWorkspaceDir(sessionId);
        return path.join(workspaceDir, filePath);
      } catch (error: any) {
        this.logger.warn(`Failed to resolve path for session ${sessionId}: ${error.message}`);
      }
    }

    // 否则使用系统默认解析（相对于进程启动目录）
    return path.resolve(filePath);
  }

  /**
   * 通知工作目录变更
   * @param sessionId 会话 ID
   */
  notifyWorkspaceChange(sessionId: string): void {
    this.events.emit('workspace-changed', sessionId);
  }
}
