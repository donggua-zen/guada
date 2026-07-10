import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import * as chokidar from "chokidar";
import * as path from "path";

/** 文件变更事件回调 */
export interface FileEventHandlers {
  onAdd: (absDir: string) => Promise<void>;
  onRemove: (id: string) => void;
}

@Injectable()
export class SkillWatcherService implements OnModuleDestroy {
  private readonly logger = new Logger(SkillWatcherService.name);
  private watcher: chokidar.FSWatcher | null = null;
  private handlers = new Map<string, FileEventHandlers>();
  private debounceTimers = new Map<string, NodeJS.Timeout>();

  start(): void {
    if (this.watcher) {
      this.logger.warn("Watcher already started, ignoring");
      return;
    }

    this.logger.log("Starting skills file watcher...");
    // 不传初始 patterns，所有路径由 addWatch 添加
    this.watcher = chokidar.watch([], {
      ignoreInitial: true,
      ignorePermissionErrors: true,
      persistent: true,
    });

    this.watcher
      .on("add", (fp) => this.dispatch("add", fp))
      .on("change", (fp) => this.dispatch("change", fp))
      .on("unlink", (fp) => this.dispatch("unlink", fp))
      .on("unlinkDir", (fp) => this.dispatch("unlinkDir", fp))
      .on("error", (err) => this.logger.error("Watcher error: " + String(err)));
  }

  /** 添加监控模式，绑定该模式的事件处理器 */
  addWatch(pattern: string, h: FileEventHandlers): void {
    if (!this.watcher) return;
    // chokidar.add() 传 glob 模式在 Windows 上不工作，
    // 提取基准目录（去掉 /*/SKILL.md 部分）后直接添加目录
    const baseDir = path.resolve(pattern.replace(/\*.*$/, ""));
    this.watcher.add(baseDir);
    this.handlers.set(pattern, h);
    this.logger.log(`Watcher added: ${pattern}`);
  }

  /** 移除监控模式 */
  removeWatch(pattern: string): void {
    if (!this.watcher) return;
    this.watcher.unwatch(pattern);
    this.handlers.delete(pattern);
    this.logger.log(`Watcher removed: ${pattern}`);
  }

  async stop(): Promise<void> {
    for (const t of this.debounceTimers.values()) clearTimeout(t);
    this.debounceTimers.clear();
    this.handlers.clear();
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
      this.logger.log("Skill watcher stopped");
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.stop();
  }

  // ── 内部 ──

  private dispatch(event: string, filePath: string): void {
    // 按 pattern 前缀匹配最长的（防止嵌套目录误匹配）
    let matched: { key: string; h: FileEventHandlers } | null = null;
    let maxLen = -1;
    // resolve 统一路径分隔符 且 将相对路径转为绝对路径，
    // 避免 chokidar 发出相对路径而 handler key 是绝对路径时 startsWith 不匹配
    const normalizedFilePath = path.resolve(filePath);
    for (const [key, h] of this.handlers) {
      const base = path.resolve(key.replace(/\*.*$/, ""));
      if (normalizedFilePath.startsWith(base) && base.length > maxLen) {
        maxLen = base.length;
        matched = { key, h };
      }
    }
    if (!matched) return;

    if (event === "unlink") {
      const dirName = filePath.split(/[/\\]/g).slice(-2, -1)[0];
      if (!dirName || dirName.startsWith(".")) return;
      matched.h.onRemove(dirName.toLowerCase());
    } else if (event === "unlinkDir") {
      // unlinkDir 的 filePath 是目录本身，取最后一段
      const dirName = filePath.split(/[/\\]/g).slice(-1)[0];
      if (!dirName || dirName.startsWith(".")) return;
      matched.h.onRemove(dirName.toLowerCase());
    } else {
      const dir = filePath.substring(0, filePath.lastIndexOf("/") !== -1
        ? filePath.lastIndexOf("/")
        : filePath.lastIndexOf("\\"));
      const dirName = dir.split(/[/\\]/g).pop();
      if (!dirName || dirName.startsWith(".")) return;
      this.debounced("file:" + dirName, () => matched!.h.onAdd(path.resolve(dir)));
    }
  }

  private debounced(key: string, fn: () => Promise<void>, ms = 300): void {
    const existing = this.debounceTimers.get(key);
    if (existing) clearTimeout(existing);
    this.debounceTimers.set(
      key,
      setTimeout(async () => {
        this.debounceTimers.delete(key);
        try { await fn(); } catch (e: any) {
          this.logger.error(`Watcher handler error: ${e.message}`);
        }
      }, ms),
    );
  }
}
