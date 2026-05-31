import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import * as chokidar from "chokidar";
import * as path from "path";
import { WorkspaceService } from "./workspace.service";

export interface FileChangeEvent {
  type: "add" | "change" | "unlink" | "addDir" | "unlinkDir";
  path: string;
  sessionId: string;
  timestamp: number;
}

/**
 * 客户端展开状态
 */
interface ClientExpandedState {
  clientId: string;
  expandedPaths: Set<string>;
}

/**
 * Watcher 信息
 */
interface WatcherInfo {
  watcher: chokidar.FSWatcher;
  workspacePath: string;
  clients: Map<string, ClientExpandedState>;
  refCount: number;
}

/**
 * 文件监听服务
 * 使用 chokidar 跨平台监听工作目录变化
 * 支持多客户端、动态调整监听范围
 *
 * 设计要点：
 * 1. 使用 depth: 0 禁用递归，只监听指定目录的直接子项
 * 2. 通过 watcher.add() / unwatch() 动态调整监听路径，无需重建 watcher
 * 3. 多客户端共享 watcher，展开路径取并集
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
   * 支持多客户端，同一 session 共享一个 watcher
   */
  startWatching(sessionId: string, workspacePath: string, clientId: string): void {
    const existing = this.watchers.get(sessionId);

    if (existing) {
      // 已有 watcher，增加引用计数，注册新客户端
      existing.refCount++;
      existing.clients.set(clientId, {
        clientId,
        expandedPaths: new Set(),
      });
      this.logger.debug(
        `Client ${clientId} joined watcher for session ${sessionId}, total clients: ${existing.refCount}`
      );
      return;
    }

    // 创建新 watcher，初始只监听根目录，depth: 0 禁用递归
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
        depth: 0,
      });

      // 绑定事件处理器
      this.bindWatcherEvents(watcher, sessionId, workspacePath);

      this.watchers.set(sessionId, {
        watcher,
        workspacePath,
        clients: new Map([[clientId, { clientId, expandedPaths: new Set() }]]),
        refCount: 1,
      });

      this.logger.debug(
        `Started watching workspace for session ${sessionId}, client: ${clientId}`
      );
    } catch (error: any) {
      this.logger.error(`Failed to start watching workspace: ${error.message}`);
    }
  }

  /**
   * 绑定 watcher 事件处理器
   */
  private bindWatcherEvents(
    watcher: chokidar.FSWatcher,
    sessionId: string,
    workspacePath: string
  ): void {
    watcher.on("all", (event, filePath) => {
      const relativePath = filePath
        .replace(workspacePath + "\\", "")
        .replace(workspacePath + "/", "");
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
  }

  /**
   * 更新指定客户端的展开目录路径
   * 所有客户端的展开路径取并集作为监听范围
   * 使用 watcher.add() / unwatch() 动态调整，无需重建 watcher
   */
  updateExpandedPaths(sessionId: string, clientId: string, expandedPaths: string[]): void {
    const watcherInfo = this.watchers.get(sessionId);
    if (!watcherInfo) {
      return;
    }

    const clientState = watcherInfo.clients.get(clientId);
    if (!clientState) {
      return;
    }

    const newExpandedSet = new Set(expandedPaths);

    // 检查该客户端的展开状态是否有变化
    const hasChanged =
      newExpandedSet.size !== clientState.expandedPaths.size ||
      [...newExpandedSet].some((p) => !clientState.expandedPaths.has(p)) ||
      [...clientState.expandedPaths].some((p) => !newExpandedSet.has(p));

    if (!hasChanged) {
      return;
    }

    // 计算旧并集和新并集，确定需要 add/unwatch 的路径
    const oldUnion = this.calculateUnionPaths(watcherInfo);
    clientState.expandedPaths = newExpandedSet;
    const newUnion = this.calculateUnionPaths(watcherInfo);

    // 计算差异路径
    const pathsToAdd = newUnion.filter((p) => !oldUnion.includes(p));
    const pathsToRemove = oldUnion.filter((p) => !newUnion.includes(p) && p !== watcherInfo.workspacePath);

    // 动态添加新路径
    if (pathsToAdd.length > 0) {
      watcherInfo.watcher.add(pathsToAdd);
    }

    // 动态移除不再需要的路径
    if (pathsToRemove.length > 0) {
      watcherInfo.watcher.unwatch(pathsToRemove);
    }

    this.logger.debug(
      `Updated watch paths for session ${sessionId}, client ${clientId}, ` +
        `added: ${pathsToAdd.length}, removed: ${pathsToRemove.length}, ` +
        `total: ${newUnion.length} paths`
    );
  }

  /**
   * 计算所有客户端展开路径的并集
   */
  private calculateUnionPaths(watcherInfo: WatcherInfo): string[] {
    const paths = new Set<string>();

    // 始终监听根目录
    paths.add(watcherInfo.workspacePath);

    for (const client of watcherInfo.clients.values()) {
      for (const relativePath of client.expandedPaths) {
        if (!relativePath) continue;
        const fullPath = path.join(watcherInfo.workspacePath, relativePath);
        paths.add(fullPath);
      }
    }

    return Array.from(paths);
  }

  /**
   * 停止监听指定会话的某个客户端
   * 当引用计数归零时才真正关闭 watcher
   * 传入 '__force_close__' 作为 clientId 可强制关闭（用于会话删除场景）
   */
  stopWatching(sessionId: string, clientId: string): void {
    const watcherInfo = this.watchers.get(sessionId);
    if (!watcherInfo) {
      return;
    }

    // 强制关闭模式：直接清理所有资源
    if (clientId === '__force_close__') {
      watcherInfo.watcher.close();
      this.watchers.delete(sessionId);
      this.listeners.delete(sessionId);
      this.logger.debug(`Force stopped watching workspace for session ${sessionId}`);
      return;
    }

    // 移除该客户端
    watcherInfo.clients.delete(clientId);
    watcherInfo.refCount--;

    this.logger.debug(
      `Client ${clientId} left watcher for session ${sessionId}, remaining: ${watcherInfo.refCount}`
    );

    // 如果还有客户端在使用，更新监听范围
    if (watcherInfo.refCount > 0) {
      const oldUnion = this.calculateUnionPaths(watcherInfo);
      // 重新计算并移除该客户端贡献的路径
      const newUnion = this.calculateUnionPaths(watcherInfo);
      const pathsToRemove = oldUnion.filter((p) => !newUnion.includes(p) && p !== watcherInfo.workspacePath);

      if (pathsToRemove.length > 0) {
        watcherInfo.watcher.unwatch(pathsToRemove);
      }
      return;
    }

    // 最后一个客户端断开，彻底清理
    watcherInfo.watcher.close();
    this.watchers.delete(sessionId);
    this.listeners.delete(sessionId);
    this.logger.debug(`Stopped watching workspace for session ${sessionId}`);
  }

  /**
   * 注册文件变化监听器
   */
  onFileChange(
    sessionId: string,
    callback: (event: FileChangeEvent) => void
  ): () => void {
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
