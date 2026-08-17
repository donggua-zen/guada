/**
 * 搜索索引同步服务
 *
 * 只负责调度：将构建/增量同步任务交给独立 Worker 进程（sync-worker.ts）执行，
 * 避免占用主进程 CPU / 阻塞启动流程。
 *
 * 调度策略（低优先级）：
 * - 启动延迟后执行一次全量回填（如无游标则回填，worker 自带断点续传）
 * - 此后每 5 分钟 spawn 一次增量同步 worker
 * - worker 内部小批次 + 批间休眠，让出 CPU；跨进程锁保证多实例不并发写
 */

import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from "@nestjs/common";
import { spawn, ChildProcess } from "child_process";
import * as path from "path";
import * as fs from "fs";
import { SearchIndexService } from "./search-index.service";

const INITIAL_DELAY_MS = 3 * 1000; // 启动后 3 秒发起首次回填
const SYNC_INTERVAL_MS = 30 * 60 * 1000; // 增量同步间隔 30 分钟（低频，不打扰）

@Injectable()
export class SearchSyncService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SearchSyncService.name);
  private initTimer: ReturnType<typeof setTimeout> | null = null;
  private syncInterval: ReturnType<typeof setInterval> | null = null;
  private destroyed = false;
  private readonly workers = new Set<ChildProcess>();

  constructor(private searchIndex: SearchIndexService) {}

  onModuleInit() {
    this.initTimer = setTimeout(() => {
      // 启动后触发一次全量回填（如已有游标则 worker 会快速跳过/只做增量）
      this.spawnWorker("fullbackfill");
      // 定期增量同步
      this.syncInterval = setInterval(
        () => this.spawnWorker("incremental"),
        SYNC_INTERVAL_MS,
      );
      if (!this.destroyed) {
        this.logger.log(
          `搜索索引同步调度已启动: 全量回填(启动时) + 增量每 ${SYNC_INTERVAL_MS / 1000 / 60} 分钟`,
        );
      }
    }, INITIAL_DELAY_MS);

    this.logger.log(
      `搜索索引同步调度中: 首次执行延迟 ${INITIAL_DELAY_MS / 1000}s`,
    );
  }

  onModuleDestroy() {
    this.destroyed = true;
    if (this.initTimer) {
      clearTimeout(this.initTimer);
      this.initTimer = null;
    }
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
    // 终止所有 worker
    for (const child of this.workers) {
      try {
        child.kill();
      } catch (e) {
        /* ignore */
      }
    }
    this.workers.clear();
  }

  /**
   * 启动一个独立 worker 进程执行同步任务
   *
   * 生产模式：node dist/common/search/sync-worker.js（编译产物，随 extraResources 打包）
   * 开发模式：node -r ts-node/register src/common/search/sync-worker.ts
   */
  private spawnWorker(mode: "fullbackfill" | "incremental") {
    if (this.destroyed) return;

    // 当前文件目录：dev 为 src/common/search，生产为 dist/common/search
    const srcWorker = path.join(__dirname, "sync-worker.ts");
    const distWorker = path.join(__dirname, "sync-worker.js");
    const isProd =
      fs.existsSync(distWorker) && process.env.NODE_ENV === "production";

    const workerPath = isProd ? distWorker : srcWorker;
    const args = isProd
      ? [workerPath, `--mode=${mode}`]
      : ["-r", "ts-node/register", workerPath, `--mode=${mode}`];

    this.logger.log(`启动同步 worker(${mode}): ${workerPath}`);

    const child = spawn(process.execPath, args, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    this.workers.add(child);

    child.stdout?.on("data", (d: Buffer) => {
      const msg = d.toString().trim();
      if (msg) this.logger.log(`[sync-worker/${mode}] ${msg}`);
    });
    child.stderr?.on("data", (d: Buffer) => {
      const msg = d.toString().trim();
      if (msg) this.logger.warn(`[sync-worker/${mode}] ${msg}`);
    });
    child.on("exit", (code, signal) => {
      this.workers.delete(child);
      this.logger.log(`同步 worker(${mode}) 退出: code=${code} signal=${signal}`);
    });
    child.on("error", (err) => {
      this.workers.delete(child);
      this.logger.error(`同步 worker(${mode}) 启动失败: ${err.message}`);
    });
  }
}