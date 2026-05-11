import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

interface TempFileRecord {
  filePath: string;
  createdAt: number;
  ttl: number; // 存活时间（毫秒）
}

/**
 * 临时文件管理器
 * 
 * 负责管理平台适配器产生的临时文件，防止磁盘空间泄漏
 * - 自动跟踪临时文件的创建时间和TTL
 * - 定时清理过期文件
 * - 支持手动触发清理
 */
@Injectable()
export class TempFileManager implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TempFileManager.name);
  private tempFiles: Map<string, TempFileRecord> = new Map();
  private cleanupTimer: NodeJS.Timeout | null = null;
  private readonly defaultTTL = 5 * 60 * 1000; // 默认5分钟
  private readonly cleanupInterval = 2 * 60 * 1000; // 每2分钟清理一次
  private readonly tempDir: string;

  constructor() {
    // 临时文件目录：backend-ts/data/temp-attachments/
    this.tempDir = path.join(process.cwd(), 'data', 'temp-attachments');
    this.ensureTempDirExists();
  }

  /**
   * 模块初始化时启动定时清理
   */
  onModuleInit() {
    this.startCleanupTimer();
    this.logger.log('TempFileManager initialized, cleanup interval: 2 minutes');
  }

  /**
   * 模块销毁时停止定时清理
   */
  onModuleDestroy() {
    this.stopCleanupTimer();
  }

  /**
   * 确保临时目录存在
   */
  private ensureTempDirExists(): void {
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
      this.logger.log(`Created temp directory: ${this.tempDir}`);
    }
  }

  /**
   * 生成临时文件路径
   * @param prefix 文件名前缀
   * @param ext 文件扩展名
   */
  generateTempPath(prefix: string, ext: string): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    const fileName = `${prefix}_${timestamp}_${random}${ext}`;
    return path.join(this.tempDir, fileName);
  }

  /**
   * 注册临时文件（用于跟踪和清理）
   * @param filePath 文件路径
   * @param ttl 存活时间（毫秒），默认5分钟
   */
  registerTempFile(filePath: string, ttl?: number): void {
    this.tempFiles.set(filePath, {
      filePath,
      createdAt: Date.now(),
      ttl: ttl || this.defaultTTL,
    });
    this.logger.debug(`Registered temp file: ${filePath}, TTL: ${ttl || this.defaultTTL}ms`);
  }

  /**
   * 注销临时文件（文件已被处理，不再需要清理）
   */
  unregisterTempFile(filePath: string): void {
    this.tempFiles.delete(filePath);
    this.logger.debug(`Unregistered temp file: ${filePath}`);
  }

  /**
   * 保存buffer到临时文件
   * @param buffer 文件内容
   * @param prefix 文件名前缀
   * @param ext 文件扩展名
   * @param ttl 存活时间（毫秒）
   */
  async saveToTemp(
    buffer: Buffer,
    prefix: string,
    ext: string,
    ttl?: number
  ): Promise<string> {
    const tempPath = this.generateTempPath(prefix, ext);
    
    // 写入文件
    await fs.promises.writeFile(tempPath, buffer);
    
    // 注册到管理器
    this.registerTempFile(tempPath, ttl);
    
    this.logger.debug(`Saved temp file: ${tempPath}, size: ${buffer.length} bytes`);
    
    return tempPath;
  }

  /**
   * 清理过期的临时文件
   */
  private cleanupExpiredFiles(): void {
    const now = Date.now();
    let cleanedCount = 0;

    for (const [filePath, record] of this.tempFiles.entries()) {
      const age = now - record.createdAt;
      
      if (age > record.ttl) {
        try {
          // 删除文件
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            this.logger.debug(`Deleted expired temp file: ${filePath}`);
          }
          
          // 从记录中移除
          this.tempFiles.delete(filePath);
          cleanedCount++;
        } catch (error: any) {
          this.logger.error(`Failed to delete temp file ${filePath}: ${error.message}`);
        }
      }
    }

    if (cleanedCount > 0) {
      this.logger.log(`Cleaned up ${cleanedCount} expired temp files`);
    }
  }

  /**
   * 启动定时清理任务
   */
  private startCleanupTimer(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanupExpiredFiles();
    }, this.cleanupInterval);
  }

  /**
   * 停止定时清理任务
   */
  private stopCleanupTimer(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
      this.logger.log('Stopped temp file cleanup timer');
    }
  }

  /**
   * 手动触发清理（可用于测试或紧急清理）
   */
  triggerCleanup(): number {
    const beforeCount = this.tempFiles.size;
    this.cleanupExpiredFiles();
    const afterCount = this.tempFiles.size;
    return beforeCount - afterCount;
  }

  /**
   * 获取当前临时文件数量
   */
  getTempFileCount(): number {
    return this.tempFiles.size;
  }

  /**
   * 清理所有临时文件（谨慎使用）
   */
  cleanupAllTempFiles(): void {
    this.logger.warn('Cleaning up ALL temp files...');
    
    for (const filePath of this.tempFiles.keys()) {
      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      } catch (error: any) {
        this.logger.error(`Failed to delete temp file ${filePath}: ${error.message}`);
      }
    }
    
    const count = this.tempFiles.size;
    this.tempFiles.clear();
    this.logger.log(`Cleaned up all ${count} temp files`);
  }
}
