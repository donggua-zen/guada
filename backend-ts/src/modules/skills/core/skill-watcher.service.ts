import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import { SkillDiscoveryService } from './skill-discovery.service';

/**
 * Skill 文件监听器服务
 * 使用 fs.watch 监控 Skills 目录的变更，实现自动扫描和热重载
 */
@Injectable()
export class SkillWatcherService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SkillWatcherService.name);
  private readonly skillsDir: string;
  private watcher: fs.FSWatcher | null = null;
  private debounceTimer: NodeJS.Timeout | null = null;
  private readonly DEBOUNCE_DELAY = 1000; // 防抖延迟 1 秒

  constructor(
    private configService: ConfigService,
    private discoveryService: SkillDiscoveryService,
  ) {
    this.skillsDir = this.configService.get<string>('SKILLS_DIR') || 
                     path.join(process.cwd(), 'skills');
  }

  /**
   * 模块初始化时启动监听
   */
  async onModuleInit(): Promise<void> {
    const enableWatch = this.configService.get<boolean>('SKILLS_ENABLE_WATCH', true);
    
    if (!enableWatch) {
      this.logger.log('Skills file watching is disabled by configuration');
      return;
    }

    try {
      await this.startWatching();
      this.logger.log('Skills file watcher initialized successfully');
    } catch (error) {
      this.logger.error(`Failed to initialize Skills watcher: ${error}`);
    }
  }

  /**
   * 模块销毁时停止监听
   */
  async onModuleDestroy(): Promise<void> {
    this.stopWatching();
  }

  /**
   * 启动文件监听
   */
  private async startWatching(): Promise<void> {
    // 确保目录存在
    await fs.promises.mkdir(this.skillsDir, { recursive: true });

    // 创建监听器
    this.watcher = fs.watch(this.skillsDir, { recursive: true }, (eventType, filename) => {
      if (!filename) return;

      // 忽略隐藏文件和临时文件
      if (filename.startsWith('.') || filename.endsWith('.tmp')) {
        return;
      }

      this.logger.debug(`File change detected: ${eventType} - ${filename}`);
      
      // 使用防抖避免频繁扫描
      this.debounceScan();
    });

    this.logger.log(`Started watching Skills directory: ${this.skillsDir}`);
  }

  /**
   * 停止文件监听
   */
  private stopWatching(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
      this.logger.log('Skills file watcher stopped');
    }

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  /**
   * 防抖扫描：在指定延迟后执行扫描，如果期间有新事件则重置计时器
   */
  private debounceScan(): void {
    // 清除之前的定时器
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    // 设置新的定时器
    this.debounceTimer = setTimeout(async () => {
      try {
        this.logger.log('Auto-scanning Skills directory due to file changes...');
        const result = await this.discoveryService.scan();
        
        // 记录扫描结果
        if (result.added.length > 0) {
          this.logger.log(`Auto-scan: Added ${result.added.length} new skill(s): ${result.added.map(s => s.id).join(', ')}`);
        }
        if (result.updated.length > 0) {
          this.logger.log(`Auto-scan: Updated ${result.updated.length} skill(s): ${result.updated.map(s => s.id).join(', ')}`);
        }
        if (result.removed.length > 0) {
          this.logger.log(`Auto-scan: Removed ${result.removed.length} skill(s): ${result.removed.join(', ')}`);
        }
        if (result.errors.length > 0) {
          this.logger.warn(`Auto-scan encountered ${result.errors.length} error(s)`);
        }
      } catch (error) {
        this.logger.error(`Auto-scan failed: ${error}`);
      } finally {
        this.debounceTimer = null;
      }
    }, this.DEBOUNCE_DELAY);
  }

  /**
   * 手动重启监听（用于配置变更后）
   */
  async restartWatching(): Promise<void> {
    this.stopWatching();
    await this.startWatching();
  }
}
