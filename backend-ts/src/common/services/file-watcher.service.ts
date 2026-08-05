import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import * as chokidar from "chokidar";
import * as fs from "fs";
import * as path from "path";

export interface FileChangeEvent {
  type: "add" | "change" | "unlink" | "addDir" | "unlinkDir";
  path: string;
  sessionId: string;
  timestamp: number;
}

interface ClientWatchState {
  clientId: string;
  expandedPaths: Set<string>;
  expandedPathsVersion: number;
  connections: Map<symbol, (() => void) | undefined>;
}

interface SessionWatchState {
  workspacePath: string;
  workspaceKey: string;
  clients: Map<string, ClientWatchState>;
  watchTargets: Map<string, string>;
}

interface NormalizedPath {
  key: string;
  value: string;
}

interface PendingExpandedState {
  expandedPaths: string[];
  version: number;
}

interface ChokidarDirEntry {
  add(item: string): void;
  dispose(): void;
}

interface ChokidarInternals {
  _closers?: Map<string, unknown>;
  _watched?: Map<string, ChokidarDirEntry>;
  _symlinkPaths?: Map<string, unknown>;
  _getWatchedDir?: (directory: string) => ChokidarDirEntry;
  _removeIgnoredPath?: (ignoredPath: string) => void;
}

const FILE_CHANGE_TYPES = new Set<string>([
  "add",
  "change",
  "unlink",
  "addDir",
  "unlinkDir",
]);
const MAX_TRACKED_CLIENT_VERSIONS = 1000;

/**
 * 文件监听服务
 * 所有会话共享一个 chokidar 实例，会话和客户端仅维护各自的逻辑监听范围。
 */
@Injectable()
export class FileWatcherService implements OnModuleDestroy {
  private readonly logger = new Logger(FileWatcherService.name);
  private readonly watcher: chokidar.FSWatcher;
  private readonly sessions = new Map<string, SessionWatchState>();
  private readonly workspaceOverrides = new Map<string, NormalizedPath>();
  private readonly pendingExpandedPaths = new Map<
    string,
    Map<string, PendingExpandedState>
  >();
  private readonly clientExpandedVersions = new Map<
    string,
    Map<string, number>
  >();
  private readonly physicalTargets = new Map<string, string>();
  private desiredTargets = new Map<string, string>();
  private readonly listeners = new Map<
    string,
    Set<(event: FileChangeEvent) => void>
  >();
  private reconcileRevision = 0;
  private reconciledRevision = 0;
  private reconciliationRunning = false;
  private reconciliationPromise: Promise<void> = Promise.resolve();
  private destroyed = false;

  constructor() {
    this.watcher = chokidar.watch([], {
      ignored: [/node_modules/, /\.git/, /\.next/, /dist/, /build/],
      persistent: true,
      ignoreInitial: true,
      followSymlinks: false,
      depth: 0,
    });

    this.watcher.on("all", (event, filePath) => {
      this.handleWatcherEvent(event, filePath);
    });
    this.watcher.on("error", (error: unknown) => {
      this.logger.error(`Workspace watcher error: ${String(error)}`);
    });
  }

  /**
   * 注册一条会话监听连接，并返回幂等的释放函数。
   */
  startWatching(
    sessionId: string,
    workspacePath: string,
    clientId: string,
    onForceClose?: () => void,
  ): () => void {
    if (this.destroyed) {
      return () => undefined;
    }

    const suppliedWorkspace = this.normalizeAbsolutePath(workspacePath);
    const workspaceOverride = this.workspaceOverrides.get(sessionId);
    const normalizedWorkspace = workspaceOverride ?? suppliedWorkspace;
    if (workspaceOverride?.key === suppliedWorkspace.key) {
      this.workspaceOverrides.delete(sessionId);
    }

    let sessionState = this.sessions.get(sessionId);
    if (!sessionState) {
      sessionState = {
        workspacePath: normalizedWorkspace.value,
        workspaceKey: normalizedWorkspace.key,
        clients: new Map(),
        watchTargets: new Map(),
      };
      this.sessions.set(sessionId, sessionState);
    }

    let clientState = sessionState.clients.get(clientId);
    if (!clientState) {
      const currentVersion =
        this.clientExpandedVersions.get(sessionId)?.get(clientId) ?? 0;
      clientState = {
        clientId,
        expandedPaths: new Set(),
        expandedPathsVersion: currentVersion,
        connections: new Map(),
      };
      sessionState.clients.set(clientId, clientState);

      const pendingState = this.pendingExpandedPaths
        .get(sessionId)
        ?.get(clientId);
      if (pendingState && pendingState.version >= currentVersion) {
        clientState.expandedPaths = this.normalizeExpandedPaths(
          sessionId,
          sessionState,
          pendingState.expandedPaths,
        );
        clientState.expandedPathsVersion = pendingState.version;
      }
      this.deletePendingExpandedState(sessionId, clientId);
    }

    const connectionId = Symbol(clientId);
    clientState.connections.set(connectionId, onForceClose);
    this.refreshSessionTargets(sessionState);
    this.syncGlobalWatchTargets();

    this.logger.debug(
      `Client ${clientId} joined workspace watcher for session ${sessionId}, ` +
        `connections: ${clientState.connections.size}`,
    );

    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;
      this.releaseConnection(sessionId, clientId, connectionId);
    };
  }

  /**
   * 更新活跃会话的工作目录，并清空旧目录的展开状态。
   */
  rebindWorkspace(sessionId: string, workspacePath: string): void {
    if (this.destroyed) {
      return;
    }

    const normalizedWorkspace = this.normalizeAbsolutePath(workspacePath);
    this.workspaceOverrides.set(sessionId, normalizedWorkspace);
    this.pendingExpandedPaths.delete(sessionId);

    const sessionState = this.sessions.get(sessionId);
    if (!sessionState || sessionState.workspaceKey === normalizedWorkspace.key) {
      return;
    }

    const forceCloseCallbacks = Array.from(sessionState.clients.values()).flatMap(
      (clientState) => Array.from(clientState.connections.values()),
    );
    sessionState.workspacePath = normalizedWorkspace.value;
    sessionState.workspaceKey = normalizedWorkspace.key;
    for (const clientState of sessionState.clients.values()) {
      clientState.expandedPaths = new Set();
    }
    this.refreshSessionTargets(sessionState);
    this.syncGlobalWatchTargets();
    this.logger.debug(`Rebound workspace watcher for session ${sessionId}`);
    this.invokeForceCloseCallbacks(forceCloseCallbacks);
  }

  /**
   * 更新指定客户端的展开目录。所有客户端的目录会在会话内聚合，
   * 再与其他会话的监听目录计算全局并集。
   */
  updateExpandedPaths(
    sessionId: string,
    clientId: string,
    expandedPaths: string[],
    version: number = 0,
  ): void {
    if (this.destroyed) {
      return;
    }

    const normalizedVersion =
      Number.isFinite(version) && version > 0 ? Math.floor(version) : 0;
    const currentVersion =
      this.clientExpandedVersions.get(sessionId)?.get(clientId) ?? 0;
    if (
      (normalizedVersion > 0 && normalizedVersion <= currentVersion) ||
      (normalizedVersion === 0 && currentVersion > 0)
    ) {
      return;
    }
    this.setClientExpandedVersion(sessionId, clientId, normalizedVersion);

    const sessionState = this.sessions.get(sessionId);
    const clientState = sessionState?.clients.get(clientId);
    if (!sessionState || !clientState) {
      if (!this.pendingExpandedPaths.has(sessionId)) {
        this.pendingExpandedPaths.set(sessionId, new Map());
      }
      this.pendingExpandedPaths.get(sessionId)!.set(clientId, {
        expandedPaths: [...expandedPaths],
        version: normalizedVersion,
      });
      return;
    }

    const normalizedPaths = this.normalizeExpandedPaths(
      sessionId,
      sessionState,
      expandedPaths,
    );
    clientState.expandedPathsVersion = normalizedVersion;
    if (this.areSetsEqual(clientState.expandedPaths, normalizedPaths)) {
      return;
    }

    clientState.expandedPaths = normalizedPaths;
    this.refreshSessionTargets(sessionState);
    this.syncGlobalWatchTargets();

    this.logger.debug(
      `Updated watch paths for session ${sessionId}, client ${clientId}, ` +
        `session targets: ${sessionState.watchTargets.size}`,
    );
  }

  /**
   * 移除指定客户端及其全部连接。
   * 保留此方法以兼容按 clientId 主动清理的调用方。
   */
  stopWatching(sessionId: string, clientId: string): void {
    if (clientId === "__force_close__") {
      this.stopWatchingSession(sessionId);
      return;
    }

    const sessionState = this.sessions.get(sessionId);
    const clientState = sessionState?.clients.get(clientId);
    if (!sessionState || !clientState) {
      return;
    }

    const forceCloseCallbacks = Array.from(clientState.connections.values());
    sessionState.clients.delete(clientId);
    if (sessionState.clients.size === 0) {
      this.sessions.delete(sessionId);
    } else {
      this.refreshSessionTargets(sessionState);
    }
    this.syncGlobalWatchTargets();
    this.invokeForceCloseCallbacks(forceCloseCallbacks);

    this.logger.debug(
      `Client ${clientId} left workspace watcher for session ${sessionId}`,
    );
  }

  /**
   * 强制移除会话的全部监听状态，用于会话删除。
   */
  stopWatchingSession(sessionId: string): void {
    const sessionState = this.sessions.get(sessionId);
    const forceCloseCallbacks = sessionState
      ? Array.from(sessionState.clients.values()).flatMap((clientState) =>
          Array.from(clientState.connections.values()),
        )
      : [];
    const hadSession = this.sessions.delete(sessionId);

    this.workspaceOverrides.delete(sessionId);
    this.pendingExpandedPaths.delete(sessionId);
    this.clientExpandedVersions.delete(sessionId);
    this.listeners.delete(sessionId);

    if (hadSession) {
      this.syncGlobalWatchTargets();
      this.logger.debug(`Stopped workspace watcher for session ${sessionId}`);
    }
    this.invokeForceCloseCallbacks(forceCloseCallbacks);
  }

  /**
   * 注册文件变化监听器。
   */
  onFileChange(
    sessionId: string,
    callback: (event: FileChangeEvent) => void,
  ): () => void {
    if (!this.listeners.has(sessionId)) {
      this.listeners.set(sessionId, new Set());
    }
    this.listeners.get(sessionId)!.add(callback);

    let subscribed = true;
    return () => {
      if (!subscribed) {
        return;
      }
      subscribed = false;

      const sessionListeners = this.listeners.get(sessionId);
      sessionListeners?.delete(callback);
      if (sessionListeners?.size === 0) {
        this.listeners.delete(sessionId);
      }
    };
  }

  /**
   * 获取会话的工作目录路径。
   */
  getWorkspacePath(sessionId: string): string | undefined {
    return this.sessions.get(sessionId)?.workspacePath;
  }

  async onModuleDestroy(): Promise<void> {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;

    const forceCloseCallbacks = Array.from(this.sessions.values()).flatMap(
      (sessionState) =>
        Array.from(sessionState.clients.values()).flatMap((clientState) =>
          Array.from(clientState.connections.values()),
        ),
    );
    this.sessions.clear();
    this.workspaceOverrides.clear();
    this.pendingExpandedPaths.clear();
    this.clientExpandedVersions.clear();
    this.listeners.clear();
    this.desiredTargets = new Map();
    this.requestReconciliation();
    this.invokeForceCloseCallbacks(forceCloseCallbacks);

    await this.waitForSynchronization();
    this.physicalTargets.clear();
    await this.watcher.close();
    this.logger.log("Cleaned up global workspace watcher");
  }

  private releaseConnection(
    sessionId: string,
    clientId: string,
    connectionId: symbol,
  ): void {
    const sessionState = this.sessions.get(sessionId);
    const clientState = sessionState?.clients.get(clientId);
    if (!sessionState || !clientState || !clientState.connections.delete(connectionId)) {
      return;
    }

    if (clientState.connections.size === 0) {
      sessionState.clients.delete(clientId);
      this.deletePendingExpandedState(sessionId, clientId);
      this.clientExpandedVersions.get(sessionId)?.delete(clientId);
    }

    if (sessionState.clients.size === 0) {
      this.sessions.delete(sessionId);
      this.pendingExpandedPaths.delete(sessionId);
      this.clientExpandedVersions.delete(sessionId);
    } else {
      this.refreshSessionTargets(sessionState);
    }
    this.syncGlobalWatchTargets();

    this.logger.debug(
      `Released workspace watcher connection for session ${sessionId}, client ${clientId}`,
    );
  }

  private refreshSessionTargets(sessionState: SessionWatchState): void {
    const targets = new Map<string, string>();
    targets.set(sessionState.workspaceKey, sessionState.workspacePath);

    for (const clientState of sessionState.clients.values()) {
      for (const relativePath of clientState.expandedPaths) {
        const target = this.normalizeAbsolutePath(
          path.resolve(sessionState.workspacePath, relativePath),
        );
        targets.set(target.key, target.value);
      }
    }

    sessionState.watchTargets = targets;
  }

  private syncGlobalWatchTargets(): void {
    const desiredTargets = new Map<string, string>();
    for (const sessionState of this.sessions.values()) {
      for (const [key, targetPath] of sessionState.watchTargets) {
        desiredTargets.set(key, targetPath);
      }
    }

    this.desiredTargets = desiredTargets;
    this.requestReconciliation();
  }

  private requestReconciliation(): void {
    this.reconcileRevision++;
    if (this.reconciliationRunning) {
      return;
    }

    this.reconciliationRunning = true;
    this.reconciliationPromise = this.runReconciliationLoop();
  }

  private async runReconciliationLoop(): Promise<void> {
    try {
      while (this.reconciledRevision !== this.reconcileRevision) {
        const revision = this.reconcileRevision;
        const desiredTargets = new Map(this.desiredTargets);
        try {
          await this.reconcileWatchTargets(desiredTargets);
        } catch (error: unknown) {
          this.logger.error(
            `Failed to reconcile workspace watcher targets: ${String(error)}`,
          );
        }
        this.reconciledRevision = revision;
      }
    } finally {
      this.reconciliationRunning = false;
      if (this.reconciledRevision !== this.reconcileRevision) {
        this.requestReconciliation();
      }
    }
  }

  private async reconcileWatchTargets(
    desiredTargets: Map<string, string>,
  ): Promise<void> {
    const pathsToRemove = Array.from(this.physicalTargets.entries()).filter(
      ([key]) => !desiredTargets.has(key),
    );
    for (const [key, targetPath] of pathsToRemove) {
      this.removePhysicalTarget(key, targetPath, desiredTargets);
    }

    const pathsToAdd = Array.from(desiredTargets.entries()).filter(
      ([key, targetPath]) =>
        !this.physicalTargets.has(key) && fs.existsSync(targetPath),
    );
    if (pathsToAdd.length === 0) {
      return;
    }

    this.watcher.add(pathsToAdd.map(([, targetPath]) => targetPath));
    const initializedTargets = await this.waitForWatcherTargets(
      pathsToAdd.map(([, targetPath]) => targetPath),
    );
    for (const [key, targetPath] of pathsToAdd) {
      if (initializedTargets.has(key)) {
        this.physicalTargets.set(key, targetPath);
      }
    }
  }

  private removePhysicalTarget(
    targetKey: string,
    targetPath: string,
    desiredTargets: Map<string, string>,
  ): void {
    const watcher = this.getChokidarInternals();
    const pathsToUnwatch = new Map<string, string>();
    pathsToUnwatch.set(targetKey, targetPath);

    if (watcher._closers instanceof Map) {
      for (const closerPath of watcher._closers.keys()) {
        const normalizedCloser = this.normalizeAbsolutePath(closerPath);
        const isTarget = normalizedCloser.key === targetKey;
        const isDirectChild =
          this.normalizeAbsolutePath(path.dirname(normalizedCloser.value)).key ===
          targetKey;
        const isIndependentDesiredTarget =
          normalizedCloser.key !== targetKey &&
          desiredTargets.has(normalizedCloser.key);

        if ((isTarget || isDirectChild) && !isIndependentDesiredTarget) {
          pathsToUnwatch.set(normalizedCloser.key, closerPath);
        }
      }
    }

    const unwatchPaths = Array.from(pathsToUnwatch.values());
    this.watcher.unwatch(unwatchPaths);
    unwatchPaths.forEach((unwatchPath) => {
      this.clearChokidarIgnoredPath(unwatchPath);
    });

    const parentPath = this.normalizeAbsolutePath(path.dirname(targetPath));
    const parentRemainsWatched = desiredTargets.has(parentPath.key);

    let restoreTargetDirectoryMarker = false;
    if (watcher._watched instanceof Map) {
      for (const [watchedPath, watchedEntry] of watcher._watched) {
        const normalizedWatched = this.normalizeAbsolutePath(watchedPath);
        const isTarget = normalizedWatched.key === targetKey;
        const isDirectChild =
          this.normalizeAbsolutePath(path.dirname(normalizedWatched.value)).key ===
          targetKey;
        if (isTarget && parentRemainsWatched) {
          watchedEntry.dispose();
          watcher._watched.delete(watchedPath);
          restoreTargetDirectoryMarker = true;
          continue;
        }
        if (
          (isTarget || isDirectChild) &&
          !desiredTargets.has(normalizedWatched.key)
        ) {
          watchedEntry.dispose();
          watcher._watched.delete(watchedPath);
        }
      }
    }
    const directDesiredChildren = Array.from(desiredTargets.values()).filter(
      (desiredPath) =>
        this.normalizeAbsolutePath(path.dirname(desiredPath)).key === targetKey,
    );
    if (restoreTargetDirectoryMarker || directDesiredChildren.length > 0) {
      const targetDirectory = watcher._getWatchedDir?.(targetPath);
      directDesiredChildren.forEach((desiredPath) => {
        targetDirectory?.add(path.basename(desiredPath));
      });
    }

    if (watcher._symlinkPaths instanceof Map) {
      for (const symlinkPath of watcher._symlinkPaths.keys()) {
        const normalizedSymlink = this.normalizeAbsolutePath(symlinkPath);
        if (
          normalizedSymlink.key === targetKey ||
          this.normalizeAbsolutePath(path.dirname(normalizedSymlink.value)).key ===
            targetKey
        ) {
          watcher._symlinkPaths.delete(symlinkPath);
        }
      }
    }

    if (parentRemainsWatched) {
      watcher._getWatchedDir?.(parentPath.value).add(path.basename(targetPath));
    }

    this.physicalTargets.delete(targetKey);
  }

  private async waitForWatcherTargets(
    targetPaths: string[],
  ): Promise<Set<string>> {
    const watcher = this.getChokidarInternals();
    const expectedKeys = targetPaths.map(
      (targetPath) => this.normalizeAbsolutePath(targetPath).key,
    );
    if (!(watcher._closers instanceof Map)) {
      return new Set(expectedKeys);
    }

    const deadline = Date.now() + 10000;
    let initializedKeys = new Set<string>();

    while (Date.now() < deadline) {
      initializedKeys = new Set(
        Array.from(watcher._closers.keys()).map(
          (closerPath) => this.normalizeAbsolutePath(closerPath).key,
        ),
      );
      if (expectedKeys.every((key) => initializedKeys.has(key))) {
        return new Set(expectedKeys);
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    this.logger.warn(
      `Timed out waiting for ${targetPaths.length} workspace watch targets to initialize`,
    );
    return new Set(expectedKeys.filter((key) => initializedKeys.has(key)));
  }

  private async waitForSynchronization(): Promise<void> {
    while (this.reconciliationRunning) {
      await this.reconciliationPromise;
    }
  }

  private handleWatcherEvent(event: string, filePath: string): void {
    if (!FILE_CHANGE_TYPES.has(event)) {
      return;
    }

    const absolutePath = this.normalizeAbsolutePath(filePath);
    const parentKey = this.normalizeAbsolutePath(
      path.dirname(absolutePath.value),
    ).key;
    const timestamp = Date.now();

    if (event === "unlinkDir" && this.physicalTargets.has(absolutePath.key)) {
      this.physicalTargets.delete(absolutePath.key);
      this.requestReconciliation();
    }

    for (const [sessionId, sessionState] of this.sessions) {
      const watchesParent = sessionState.watchTargets.has(parentKey);
      const watchesRemovedDirectory =
        event === "unlinkDir" &&
        sessionState.watchTargets.has(absolutePath.key);

      if (!watchesParent && !watchesRemovedDirectory) {
        continue;
      }
      if (!this.isSameOrDescendant(sessionState.workspaceKey, absolutePath.key)) {
        continue;
      }

      this.notifyListeners(sessionId, {
        type: event as FileChangeEvent["type"],
        path: path.relative(sessionState.workspacePath, absolutePath.value),
        sessionId,
        timestamp,
      });
    }

    if (
      event === "addDir" &&
      this.desiredTargets.has(absolutePath.key) &&
      !this.physicalTargets.has(absolutePath.key)
    ) {
      this.requestReconciliation();
    }
  }

  private notifyListeners(sessionId: string, event: FileChangeEvent): void {
    const sessionListeners = this.listeners.get(sessionId);
    if (!sessionListeners) {
      return;
    }

    sessionListeners.forEach((callback) => {
      try {
        callback(event);
      } catch (error: unknown) {
        this.logger.error(`Error notifying listener: ${String(error)}`);
      }
    });
  }

  private normalizeExpandedPaths(
    sessionId: string,
    sessionState: SessionWatchState,
    expandedPaths: string[],
  ): Set<string> {
    const normalizedPaths = new Set<string>();
    let invalidPathCount = 0;

    for (const expandedPath of expandedPaths) {
      if (
        typeof expandedPath !== "string" ||
        expandedPath.length === 0 ||
        expandedPath.includes("\0") ||
        path.isAbsolute(expandedPath)
      ) {
        invalidPathCount++;
        continue;
      }

      const target = this.normalizeAbsolutePath(
        path.resolve(sessionState.workspacePath, expandedPath),
      );
      if (!this.isSameOrDescendant(sessionState.workspaceKey, target.key)) {
        invalidPathCount++;
        continue;
      }

      const relativePath = path.relative(
        sessionState.workspacePath,
        target.value,
      );
      if (relativePath) {
        normalizedPaths.add(relativePath);
      }
    }

    if (invalidPathCount > 0) {
      this.logger.warn(
        `Ignored ${invalidPathCount} invalid expanded paths for session ${sessionId}`,
      );
    }

    return normalizedPaths;
  }

  private normalizeAbsolutePath(inputPath: string): NormalizedPath {
    let normalizedPath = path.normalize(path.resolve(inputPath));
    const rootPath = path.parse(normalizedPath).root;

    while (
      normalizedPath.length > rootPath.length &&
      normalizedPath.endsWith(path.sep)
    ) {
      normalizedPath = normalizedPath.slice(0, -1);
    }

    return {
      key:
        process.platform === "win32"
          ? normalizedPath.toLowerCase()
          : normalizedPath,
      value: normalizedPath,
    };
  }

  private getChokidarInternals(): chokidar.FSWatcher & ChokidarInternals {
    return this.watcher as chokidar.FSWatcher & ChokidarInternals;
  }

  private clearChokidarIgnoredPath(targetPath: string): void {
    // chokidar 4 的 unwatch 会保留 ignored 标记，必须清除后才能独立重加父子目标。
    this.getChokidarInternals()._removeIgnoredPath?.(
      path.normalize(targetPath).replace(/\\/g, "/"),
    );
  }

  private isSameOrDescendant(basePath: string, candidatePath: string): boolean {
    const relativePath = path.relative(basePath, candidatePath);
    return (
      relativePath === "" ||
      (relativePath !== ".." &&
        !relativePath.startsWith(`..${path.sep}`) &&
        !path.isAbsolute(relativePath))
    );
  }

  private areSetsEqual(firstSet: Set<string>, secondSet: Set<string>): boolean {
    return (
      firstSet.size === secondSet.size &&
      Array.from(firstSet).every((value) => secondSet.has(value))
    );
  }

  private setClientExpandedVersion(
    sessionId: string,
    clientId: string,
    version: number,
  ): void {
    if (!this.clientExpandedVersions.has(sessionId)) {
      this.clientExpandedVersions.set(sessionId, new Map());
    }
    const sessionVersions = this.clientExpandedVersions.get(sessionId)!;
    sessionVersions.delete(clientId);
    sessionVersions.set(clientId, version);
    while (sessionVersions.size > MAX_TRACKED_CLIENT_VERSIONS) {
      const oldestClientId = sessionVersions.keys().next().value;
      if (!oldestClientId) {
        break;
      }
      sessionVersions.delete(oldestClientId);
    }
  }

  private deletePendingExpandedState(
    sessionId: string,
    clientId: string,
  ): void {
    const sessionPending = this.pendingExpandedPaths.get(sessionId);
    sessionPending?.delete(clientId);
    if (sessionPending?.size === 0) {
      this.pendingExpandedPaths.delete(sessionId);
    }
  }

  private invokeForceCloseCallbacks(
    callbacks: Array<(() => void) | undefined>,
  ): void {
    callbacks.forEach((callback) => {
      try {
        callback?.();
      } catch (error: unknown) {
        this.logger.error(
          `Failed to close workspace watcher connection: ${String(error)}`,
        );
      }
    });
  }
}
