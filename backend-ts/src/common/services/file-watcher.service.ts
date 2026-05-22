import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import * as chokidar from "chokidar";
import { WorkspaceService } from "./workspace.service";

export interface FileChangeEvent {
  type: "add" | "change" | "unlink" | "addDir" | "unlinkDir";
  path: string;
  sessionId: string;
  timestamp: number;
}

interface WatcherInfo {
  watcher: chokidar.FSWatcher;
  workspacePath: string;
}

/**
 * 文件监听服务
 * 使用 chokidar 跨平台监听工作目录变化
 */
@Injectable()
export class FileWatcherService implements OnModuleDestroy {
  private readonly logger = new Logger(FileWatcherService.name);
  private watchers: Map<string, WatcherInfo> = new Map();

  /**
   * 文件变化回调函数集合
   * key: sessionId, value: 回调函数数组
   */
  private listeners: Map<string, Set<(event: FileChangeEvent) => void>> = new Map();

  constructor(private readonly workspaceService: WorkspaceService) {}

  /**
   * 开始监听会话的工作目录
   */
  startWatching(sessionId: string, workspacePath: string): void {
    // 如果已经在监听，先停止
    this.stopWatching(sessionId);

    try {
      const watcher = chokidar.watch(workspacePath, {
        ignored: [
          /node_modules/,
          /\.git/,
          /\.next/,
          /dist/,
          /build/,
        ],
        persistent: true,
        ignoreInitial: true,
        awaitWriteFinish: {
          stabilityThreshold: 500,
          pollInterval: 100,
        },
      });

      watcher.on("all", (event, filePath) => {
        const relativePath = filePath.replace(workspacePath + "\\", "").replace(workspacePath + "/", "");
        this.notifyListeners(sessionId, {
          type: event as FileChangeEvent["type"],
          path: relativePath,
          sessionId,
          timestamp: Date.now(),
        });
      });

      watcher.on("error", (error: any) => {
        this.logger.error(`Watcher error for session ${sessionId}: ${error.message}`);
      });

      this.watchers.set(sessionId, {
        watcher,
        workspacePath,
      });

      this.logger.log(`Started watching workspace for session ${sessionId}: ${workspacePath}`);
    } catch (error: any) {
      this.logger.error(`Failed to start watching workspace: ${error.message}`);
    }
  }

  /**
   * 停止监听指定会话
   */
  stopWatching(sessionId: string): void {
    const watcherInfo = this.watchers.get(sessionId);
    if (watcherInfo) {
      watcherInfo.watcher.close();
      this.watchers.delete(sessionId);
      this.listeners.delete(sessionId);
      this.logger.log(`Stopped watching workspace for session ${sessionId}`);
    }
  }

  /**
   * 注册文件变化监听器
   */
  onFileChange(sessionId: string, callback: (event: FileChangeEvent) => void): () => void {
    if (!this.listeners.has(sessionId)) {
      this.listeners.set(sessionId, new Set());
    }
    this.listeners.get(sessionId)!.add(callback);

    // 返回取消订阅函数
    return () => {
      this.listeners.get(sessionId)?.delete(callback);
    };
  }

  /**
   * 通知所有监听器
   */
  private notifyListeners(sessionId: string, event: FileChangeEvent): void {
    const sessionListeners = this.listeners.get(sessionId);
    if (sessionListeners) {
      sessionListeners.forEach((callback) => {
        try {
          callback(event);
        } catch (error: any) {
          this.logger.error(`Error notifying listener: ${error.message}`);
        }
      });
    }
  }

  /**
   * 获取会话的工作目录路径
   */
  getWorkspacePath(sessionId: string): string | undefined {
    return this.watchers.get(sessionId)?.workspacePath;
  }

  /**
   * 模块销毁时清理所有监听器
   */
  onModuleDestroy() {
    this.watchers.forEach((info, sessionId) => {
      info.watcher.close();
      this.logger.log(`Cleaned up watcher for session ${sessionId}`);
    });
    this.watchers.clear();
    this.listeners.clear();
  }
}
