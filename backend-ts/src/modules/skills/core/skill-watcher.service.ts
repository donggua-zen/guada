import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import * as chokidar from "chokidar";
import * as fs from "fs";
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
    // 不存在的路径绝不能交给 chokidar.add()：v4 会退化为「监听父目录 + 只放行
    // 该 target」，把同父目录下其他子目录的新增事件一并过滤掉，且后续 re-add
    // 也无法恢复（父目录 watcher 已被复用）。缺目录时跳过并告警，由调用方
    // 负责先建目录（见 SkillSourceManager.register）。
    if (!fs.existsSync(baseDir)) {
      this.logger.warn(`Watcher skipped (dir not found): ${pattern}`);
      this.handlers.set(pattern, h);
      return;
    }
    this.watcher.add(baseDir);
    this.handlers.set(pattern, h);
    this.logger.log(`Watcher added: ${pattern}`);
  }

  /** 移除监控模式 */
  removeWatch(pattern: string): void {
    if (!this.watcher) return;
    // unwatch 必须用实际添加的 baseDir（glob 不会被 chokidar 匹配，等于没移除，
    // 监听器与底层 fs.watch 会持续泄漏并在 restart 后重复触发）
    const baseDir = path.resolve(pattern.replace(/\*.*$/, ""));
    this.watcher.unwatch(baseDir);
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
    let matched: { key: string; h: FileEventHandlers; base: string } | null = null;
    let maxLen = -1;
    // resolve 统一路径分隔符 且 将相对路径转为绝对路径，
    // 避免 chokidar 发出相对路径而 handler key 是绝对路径时 startsWith 不匹配
    const normalizedFilePath = path.resolve(filePath);
    for (const [key, h] of this.handlers) {
      const base = path.resolve(key.replace(/\*.*$/, ""));
      if (normalizedFilePath.startsWith(base) && base.length > maxLen) {
        maxLen = base.length;
        matched = { key, h, base };
      }
    }
    if (!matched) return;
    const { h, base } = matched;

    // 只处理严格结构：<base>/<skill-name>/SKILL.md（增改删文件）与 <base>/<skill-name>（删目录）。
    // 技能内 scripts/ assets/ 等嵌套文件的增删不应触发注册/注销。
    const relSegments = path
      .relative(base, normalizedFilePath)
      .split(/[/\\]/g)
      .filter(Boolean);

    if (event === "unlink" || event === "unlinkDir") {
      const isSkillMd = relSegments.length === 2 && relSegments[1] === "SKILL.md";
      const isSkillDir = relSegments.length === 1;
      const target = isSkillMd ? relSegments[0] : isSkillDir ? relSegments[0] : null;
      if (!target || target.startsWith(".")) return;
      h.onRemove(target.toLowerCase());
      return;
    }

    if (relSegments.length !== 2 || relSegments[1] !== "SKILL.md") return;
    const dirName = relSegments[0];
    if (!dirName || dirName.startsWith(".")) return;
    const skillDir = path.resolve(base, dirName);
    this.debounced("file:" + skillDir, () => h.onAdd(skillDir));
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
