import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as path from 'path';
import * as fs from 'fs';

@Injectable()
export class WorkspaceService {
  private readonly logger = new Logger(WorkspaceService.name);
  private readonly baseDir: string;

  constructor(private configService: ConfigService) {
    this.baseDir = this.configService.get<string>('WORKSPACE_BASE_DIR') || 
                   path.join(process.cwd(), 'workspace');
    
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
}
