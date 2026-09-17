import * as fs from "fs";
import * as fsp from "fs/promises";
import * as path from "path";
import { Injectable, Logger } from "@nestjs/common";
import * as yaml from "js-yaml";
import {
  META_DOMAIN_BOTS,
  MetadataBootstrapGate,
} from "../../common/database/metadata-bootstrap.gate";
import {
  atomicWriteFile,
  iso,
  mintId,
  removeFileWithRetry,
} from "../../common/persistence/file-store-kit";

/**
 * 机器人实例文件存储（对齐 providers/*.yaml 的既有范式）
 *
 * 权威来源 = `<BOT_DATA_DIR>/<botId>.yaml`，每个实例一个 YAML 文件。
 * - 文件名（去扩展名）即 id（cuid，与原 DB 主键一致）→ 引用零改写
 * - 内存缓存（外部手改文件重启生效；UI 走 API 修改即时更新缓存）
 * - 原子写（tmp + rename + Windows EPERM 退避重试）
 * - 非法文件隔离：解析失败仅记录，不崩服务、不挤占缓存
 *
 * 运行时状态语义（与 DB 版一致）：
 * - status / lastStartedAt / lastError 是持久化点，由 start/stop/重连耗尽三处写入
 * - 运行中的真实状态（CONNECTING/CONNECTED/重连计数）在 BotInstanceManager 内存中，不落盘
 * - 重启自启只读 enabled=true 的实例
 */

export const BOTS_MIGRATED_MARKER = ".migrated-bots";

/** 机器人实例（= 原 bot_instance 表行，字段名保持一致） */
export interface BotFileInstance {
  id: string;
  platform: string;
  name: string;
  enabled: boolean;
  platformConfig: Record<string, any> | null;
  reconnectEnabled: boolean;
  maxRetries: number;
  retryInterval: number;
  defaultAgentId: string;
  defaultModelId: string | null;
  defaultThinkingEffort: string | null;
  status: string;
  lastStartedAt: string | null;
  lastError: string | null;
  additionalKwargs: Record<string, any> | null;
  createdAt: string;
  updatedAt: string;
}

export interface BotLoadError {
  file: string;
  message: string;
}

/** 目录解析：BOT_DATA_DIR → USERDATA_DIR/bots → cwd()/data/bots */
export function resolveBotsDir(): string {
  return (
    process.env.BOT_DATA_DIR ||
    (process.env.USERDATA_DIR
      ? path.join(process.env.USERDATA_DIR, "bots")
      : path.join(process.cwd(), "data", "bots"))
  );
}

@Injectable()
export class BotFileStore {
  private readonly logger = new Logger(BotFileStore.name);
  private readonly botsDir: string;

  private cache = new Map<string, BotFileInstance>();
  private loadErrors = new Map<string, BotLoadError>();

  private ready: Promise<void> | null = null;

  /** 每实例写互斥（YAML 是整文件重写） */
  private writeChains = new Map<string, Promise<unknown>>();

  constructor(private readonly gate: MetadataBootstrapGate) {
    this.botsDir = resolveBotsDir();
  }

  getDirectory(): string {
    return this.botsDir;
  }

  async initialize(): Promise<void> {
    this.ready ??= this.doInitialize();
    return this.ready;
  }

  private async doInitialize(): Promise<void> {
    // 迁移导出未完成时不得读索引
    await this.gate.wait(META_DOMAIN_BOTS);
    await fsp.mkdir(this.botsDir, { recursive: true });
    await this.loadAll();
    this.logger.log(
      `Bot file store ready at ${this.botsDir} (${this.cache.size} instance(s))`,
    );
  }

  /**
   * 外部批量写入（迁移导出）后强制重载。
   * 不经过 initialize()：导出引导在门控放行前调用，等待门控会自锁。
   */
  async reload(): Promise<void> {
    await this.loadAll();
  }

  // ============ 读取 API（缓存，同步） ============

  list(): BotFileInstance[] {
    return Array.from(this.cache.values());
  }

  listEnabled(): BotFileInstance[] {
    return this.list().filter((b) => b.enabled);
  }

  findById(id: string): BotFileInstance | undefined {
    return this.cache.get(id);
  }

  listLoadErrors(): BotLoadError[] {
    return Array.from(this.loadErrors.values());
  }

  // ============ 写入 API（原子写） ============

  async create(data: Partial<BotFileInstance> & { id?: string }): Promise<BotFileInstance> {
    await this.initialize();
    const id = data.id ?? mintId("bot-");
    const now = new Date().toISOString();
    const instance: BotFileInstance = {
      id,
      platform: data.platform ?? "",
      name: data.name ?? "",
      enabled: data.enabled !== false,
      platformConfig: data.platformConfig ?? null,
      reconnectEnabled: data.reconnectEnabled !== false,
      maxRetries: data.maxRetries ?? 5,
      retryInterval: data.retryInterval ?? 5000,
      defaultAgentId: data.defaultAgentId ?? "",
      defaultModelId: data.defaultModelId ?? null,
      defaultThinkingEffort: data.defaultThinkingEffort ?? null,
      status: data.status ?? "stopped",
      lastStartedAt: data.lastStartedAt ?? null,
      lastError: data.lastError ?? null,
      additionalKwargs: data.additionalKwargs ?? null,
      createdAt: data.createdAt ?? now,
      updatedAt: now,
    };
    await this.withLock(id, async () => {
      await this.writeInstance(instance);
      this.cache.set(id, instance);
    });
    return instance;
  }

  /** 部分更新（undefined 保持原值） */
  async update(
    id: string,
    data: Partial<BotFileInstance>,
  ): Promise<BotFileInstance | undefined> {
    await this.initialize();
    if (!this.cache.has(id)) return undefined;
    return this.withLock(id, async () => {
      const current = this.cache.get(id)!;
      const merged: BotFileInstance = { ...current };
      for (const [key, value] of Object.entries(data)) {
        if (value === undefined || key === "id") continue;
        (merged as any)[key] = value;
      }
      merged.updatedAt = new Date().toISOString();
      await this.writeInstance(merged);
      this.cache.set(id, merged);
      return merged;
    });
  }

  async delete(id: string): Promise<boolean> {
    await this.initialize();
    const existed = this.cache.has(id);
    if (!existed) return false;
    await this.withLock(id, async () => {
      await removeFileWithRetry(path.join(this.botsDir, `${id}.yaml`));
      this.cache.delete(id);
    });
    return true;
  }

  /** 由外部（迁移导出）直接写入并刷新缓存 */
  async writeInstanceDirect(instance: BotFileInstance): Promise<void> {
    await this.withLock(instance.id, async () => {
      await this.writeInstance(instance);
      this.cache.set(instance.id, instance);
    });
  }

  // ============ 内部：加载与解析 ============

  private async loadAll(): Promise<void> {
    let entries: fs.Dirent[];
    try {
      entries = await fsp.readdir(this.botsDir, { withFileTypes: true });
    } catch {
      return;
    }
    const next = new Map<string, BotFileInstance>();
    const nextErrors = new Map<string, BotLoadError>();

    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (ext !== ".yaml" && ext !== ".yml") continue;
      const id = path.basename(entry.name, ext);
      try {
        const content = await fsp.readFile(
          path.join(this.botsDir, entry.name),
          "utf8",
        );
        next.set(id, this.parse(content, id));
      } catch (err: any) {
        nextErrors.set(id, {
          file: entry.name,
          message: err?.message || String(err),
        });
        this.logger.warn(
          `Invalid bot file "${entry.name}" (isolated): ${err?.message || err}`,
        );
      }
    }

    this.cache = next;
    this.loadErrors = nextErrors;
  }

  private parse(content: string, fileId: string): BotFileInstance {
    const doc = yaml.load(content);
    if (doc === null || doc === undefined) throw new Error("empty document");
    if (typeof doc !== "object" || Array.isArray(doc)) {
      throw new Error("root must be a mapping");
    }
    const raw = doc as Record<string, any>;
    if (typeof raw.id === "string" && raw.id.trim() && raw.id.trim() !== fileId) {
      this.logger.warn(
        `Bot file "${fileId}" declares id "${raw.id}", using file name instead`,
      );
    }
    const now = new Date().toISOString();
    return {
      id: fileId,
      platform: this.str(raw.platform) ?? "",
      name: this.str(raw.name) ?? fileId,
      enabled: raw.enabled !== false,
      platformConfig: this.obj(raw.platformConfig),
      reconnectEnabled: raw.reconnectEnabled !== false,
      maxRetries: this.num(raw.maxRetries, 5),
      retryInterval: this.num(raw.retryInterval, 5000),
      defaultAgentId: this.str(raw.defaultAgentId) ?? "",
      defaultModelId: this.str(raw.defaultModelId),
      defaultThinkingEffort: this.str(raw.defaultThinkingEffort),
      status: this.str(raw.status) ?? "stopped",
      lastStartedAt: this.str(raw.lastStartedAt),
      lastError: this.str(raw.lastError),
      additionalKwargs: this.obj(raw.additionalKwargs),
      createdAt: iso(raw.createdAt) ?? now,
      updatedAt: iso(raw.updatedAt) ?? now,
    };
  }

  private str(value: any): string | null {
    return typeof value === "string" && value.length > 0 ? value : null;
  }

  private num(value: any, fallback: number): number {
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
  }

  private obj(value: any): Record<string, any> | null {
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, any>)
      : null;
  }

  private async writeInstance(instance: BotFileInstance): Promise<void> {
    await fsp.mkdir(this.botsDir, { recursive: true });
    const body = yaml.dump(instance, { lineWidth: -1, noRefs: true });
    await atomicWriteFile(
      path.join(this.botsDir, `${instance.id}.yaml`),
      body,
    );
  }

  private async withLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.writeChains.get(id) ?? Promise.resolve();
    const run = previous.then(fn, fn);
    const tracked = run.then(
      () => undefined,
      () => undefined,
    );
    this.writeChains.set(id, tracked);
    try {
      return await run;
    } finally {
      if (this.writeChains.get(id) === tracked) this.writeChains.delete(id);
    }
  }
}
