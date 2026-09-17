import * as fs from "fs";
import * as fsp from "fs/promises";
import * as path from "path";
import { Injectable, Logger } from "@nestjs/common";
import * as yaml from "js-yaml";
import {
  atomicWriteFile,
  iso,
  mintId,
  removeFileWithRetry,
} from "../../common/persistence/file-store-kit";
import {
  META_DOMAIN_MCP,
  MetadataBootstrapGate,
} from "../../common/database/metadata-bootstrap.gate";

/**
 * MCP 服务器文件存储（对齐 bots/<id>.yaml 的既有范式）
 *
 * 权威来源 = `<MCP_DATA_DIR>/<id>.yaml`（配置正本，人类/AI 可直接编辑）；
 * 工具列表抓取结果存同目录 `<id>.tools.json`（派生缓存，删掉可重抓）。
 *
 * - 文件名（去扩展名）即 id（cuid，与原 DB 主键一致）→ 引用零改写：
 *   角色设置里的 `toolkits_deny`/`toolkits_allow` 存的是 `mcp_<id>`，改 id 会静默失效
 * - 配置与工具缓存分开的理由：tools 是几十个工具 × inputSchema 的冗长 JSON，
 *   内联会让 YAML 膨胀几百行、把配置淹没（同 AGENT.md + avatar、file.json + chunks.jsonl）
 * - 内存缓存是盘的只读视图，**不做实时监听**：外部手改文件重启后生效。
 *   写路径只有 API 与迁移导出，两者都是写后主动刷新缓存，无需 watcher 兜底
 * - 原子写（tmp + rename + Windows EPERM 退避重试）
 * - 非法文件隔离：解析失败仅记录，不崩服务、不挤占缓存
 */

export const MCP_MIGRATED_MARKER = ".migrated-mcp";
/** 工具缓存文件后缀（非配置正本，loadAll 不当作实例加载） */
export const MCP_TOOLS_SUFFIX = ".tools.json";

/** MCP 服务器配置（= 原 mcp_server 表行的非派生字段） */
export interface McpServerConfig {
  id: string;
  name: string;
  url: string | null;
  type: string | null;
  description: string | null;
  headers: Record<string, any> | null;
  command: string | null;
  args: any[] | null;
  env: Record<string, string> | null;
  cwd: string | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * 对外行视图：额外合并 tools 缓存，字段名与 Prisma 行完全一致（前端零改动）。
 * `tools` 为 `{ [toolName]: { description, inputSchema } }`，未抓取过则为 null。
 */
export interface McpServerRow extends McpServerConfig {
  tools: Record<string, any> | null;
}

export interface McpLoadError {
  file: string;
  message: string;
}

/** 目录解析：MCP_DATA_DIR → USERDATA_DIR/mcp-servers → cwd()/data/mcp-servers */
export function resolveMcpDir(): string {
  return (
    process.env.MCP_DATA_DIR ||
    (process.env.USERDATA_DIR
      ? path.join(process.env.USERDATA_DIR, "mcp-servers")
      : path.join(process.cwd(), "data", "mcp-servers"))
  );
}

/** id 用作文件名前的合法性校验（对齐 ProviderFileStore.saveProvider） */
function assertValidId(id: string): void {
  if (!id || /[\\/:*?"<>|]/.test(id) || id.startsWith(".")) {
    throw new Error(`Invalid MCP server id: "${id}"`);
  }
}

@Injectable()
export class McpFileStore {
  private readonly logger = new Logger(McpFileStore.name);
  private readonly mcpDir: string;

  private cache = new Map<string, McpServerConfig>();
  /** 工具缓存独立成表：与配置的读改写互不覆盖（避免丢更新） */
  private toolsCache = new Map<string, Record<string, any> | null>();
  private loadErrors = new Map<string, McpLoadError>();
  private ready: Promise<void> | null = null;

  /** 每实例写互斥（YAML 是整文件重写） */
  private writeChains = new Map<string, Promise<unknown>>();

  constructor(private readonly gate: MetadataBootstrapGate) {
    this.mcpDir = resolveMcpDir();
  }

  getDirectory(): string {
    return this.mcpDir;
  }

  async initialize(): Promise<void> {
    this.ready ??= this.doInitialize();
    return this.ready;
  }

  private async doInitialize(): Promise<void> {
    // 迁移导出未完成时不得读索引
    await this.gate.wait(META_DOMAIN_MCP);
    await fsp.mkdir(this.mcpDir, { recursive: true });
    await this.loadAll();
    this.logger.log(
      `MCP file store ready at ${this.mcpDir} (${this.cache.size} server(s))`,
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

  /** 全部服务器，按 createdAt 降序（对齐原 findAll 的 orderBy） */
  list(): McpServerRow[] {
    return Array.from(this.cache.values())
      .sort((a, b) =>
        a.createdAt === b.createdAt
          ? a.id.localeCompare(b.id)
          : a.createdAt < b.createdAt
            ? 1
            : -1,
      )
      .map((cfg) => this.toRow(cfg));
  }

  listEnabled(): McpServerRow[] {
    return this.list().filter((s) => s.enabled);
  }

  getRow(id: string): McpServerRow | undefined {
    const cfg = this.cache.get(id);
    return cfg ? this.toRow(cfg) : undefined;
  }

  /** 配置正本视图（不含 tools 缓存） */
  getConfig(id: string): McpServerConfig | undefined {
    return this.cache.get(id);
  }

  listLoadErrors(): McpLoadError[] {
    return Array.from(this.loadErrors.values());
  }

  // ============ 写入 API（原子写） ============

  async create(
    data: Partial<McpServerConfig> & { id?: string },
  ): Promise<McpServerRow> {
    await this.initialize();
    const id = data.id ?? mintId("mcp-");
    assertValidId(id);
    const now = new Date().toISOString();
    const config: McpServerConfig = {
      id,
      name: data.name ?? "",
      url: data.url ?? null,
      type: data.type ?? null,
      description: data.description ?? null,
      headers: data.headers ?? null,
      command: data.command ?? null,
      args: data.args ?? null,
      env: data.env ?? null,
      cwd: data.cwd ?? null,
      enabled: data.enabled !== false,
      createdAt: data.createdAt ?? now,
      updatedAt: now,
    };
    await this.withLock(id, async () => {
      await this.writeConfig(config);
      this.cache.set(id, config);
    });
    return this.toRow(config);
  }

  /** 部分更新（undefined 保持原值；id 不可改） */
  async update(
    id: string,
    data: Partial<McpServerConfig>,
  ): Promise<McpServerRow | undefined> {
    await this.initialize();
    if (!this.cache.has(id)) return undefined;
    return this.withLock(id, async () => {
      const current = this.cache.get(id)!;
      const merged: McpServerConfig = { ...current };
      for (const [key, value] of Object.entries(data)) {
        if (value === undefined || key === "id") continue;
        (merged as any)[key] = value;
      }
      merged.updatedAt = new Date().toISOString();
      await this.writeConfig(merged);
      this.cache.set(id, merged);
      return this.toRow(merged);
    });
  }

  async delete(id: string): Promise<boolean> {
    await this.initialize();
    if (!this.cache.has(id)) return false;
    await this.withLock(id, async () => {
      await removeFileWithRetry(this.configPath(id));
      await removeFileWithRetry(this.toolsPath(id));
      this.cache.delete(id);
      this.toolsCache.delete(id);
    });
    return true;
  }

  /** 写入工具列表抓取结果（派生缓存） */
  async writeTools(
    id: string,
    tools: Record<string, any>,
  ): Promise<McpServerRow | undefined> {
    await this.initialize();
    if (!this.cache.has(id)) return undefined;
    await this.withLock(id, async () => {
      await this.writeToolsFile(id, tools);
      this.toolsCache.set(id, tools);
      // 工具缓存变化也是「配置视图」的变化，但不必改 updatedAt（与 DB 版一致：
      // updateTools 走 prisma.update，会刷新 updatedAt）
      const current = this.cache.get(id)!;
      const refreshed: McpServerConfig = {
        ...current,
        updatedAt: new Date().toISOString(),
      };
      await this.writeConfig(refreshed);
      this.cache.set(id, refreshed);
    });
    return this.getRow(id);
  }

  /** 由外部（迁移导出）直接写入并刷新缓存 */
  async writeDirect(row: McpServerRow): Promise<void> {
    const { tools, ...config } = row;
    await this.withLock(config.id, async () => {
      await this.writeConfig(config as McpServerConfig);
      this.cache.set(config.id, config as McpServerConfig);
      if (tools && Object.keys(tools).length > 0) {
        await this.writeToolsFile(config.id, tools);
        this.toolsCache.set(config.id, tools);
      }
    });
  }

  // ============ 内部：加载与解析 ============

  private configPath(id: string): string {
    return path.join(this.mcpDir, `${id}.yaml`);
  }

  private toolsPath(id: string): string {
    return path.join(this.mcpDir, `${id}${MCP_TOOLS_SUFFIX}`);
  }

  private toRow(config: McpServerConfig): McpServerRow {
    return { ...config, tools: this.toolsCache.get(config.id) ?? null };
  }

  private async loadAll(): Promise<void> {
    let entries: fs.Dirent[];
    try {
      entries = await fsp.readdir(this.mcpDir, { withFileTypes: true });
    } catch {
      return;
    }
    const next = new Map<string, McpServerConfig>();
    const nextTools = new Map<string, Record<string, any> | null>();
    const nextErrors = new Map<string, McpLoadError>();

    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (ext !== ".yaml" && ext !== ".yml") continue;
      const id = path.basename(entry.name, ext);
      try {
        const content = await fsp.readFile(
          path.join(this.mcpDir, entry.name),
          "utf8",
        );
        next.set(id, this.parse(content, id));
        nextTools.set(id, await this.readToolsFile(id));
      } catch (err: any) {
        nextErrors.set(id, {
          file: entry.name,
          message: err?.message || String(err),
        });
        this.logger.warn(
          `Invalid MCP server file "${entry.name}" (isolated): ${err?.message || err}`,
        );
      }
    }

    this.cache = next;
    this.toolsCache = nextTools;
    this.loadErrors = nextErrors;
  }

  private parse(content: string, fileId: string): McpServerConfig {
    const doc = yaml.load(content);
    if (doc === null || doc === undefined) throw new Error("empty document");
    if (typeof doc !== "object" || Array.isArray(doc)) {
      throw new Error("root must be a mapping");
    }
    const raw = doc as Record<string, any>;
    if (typeof raw.id === "string" && raw.id.trim() && raw.id.trim() !== fileId) {
      this.logger.warn(
        `MCP server file "${fileId}" declares id "${raw.id}", using file name instead`,
      );
    }
    const now = new Date().toISOString();
    return {
      id: fileId,
      name: this.str(raw.name) ?? fileId,
      url: this.str(raw.url),
      type: this.str(raw.type),
      description: this.str(raw.description),
      headers: this.obj(raw.headers),
      command: this.str(raw.command),
      args: Array.isArray(raw.args) ? raw.args : null,
      env: this.strMap(raw.env),
      cwd: this.str(raw.cwd),
      enabled: raw.enabled !== false,
      createdAt: iso(raw.createdAt) ?? now,
      updatedAt: iso(raw.updatedAt) ?? now,
    };
  }

  private async readToolsFile(
    id: string,
  ): Promise<Record<string, any> | null> {
    try {
      const content = await fsp.readFile(this.toolsPath(id), "utf8");
      const doc = JSON.parse(content);
      const tools =
        doc && typeof doc === "object" && !Array.isArray(doc)
          ? (doc as any).tools
          : null;
      return tools && typeof tools === "object" && !Array.isArray(tools)
        ? (tools as Record<string, any>)
        : null;
    } catch {
      return null;
    }
  }

  private str(value: any): string | null {
    return typeof value === "string" && value.length > 0 ? value : null;
  }

  private obj(value: any): Record<string, any> | null {
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, any>)
      : null;
  }

  /** env 的值统一转字符串（YAML 里 `PORT: 8080` 会被解析成数字） */
  private strMap(value: any): Record<string, string> | null {
    const obj = this.obj(value);
    if (!obj) return null;
    const out: Record<string, string> = {};
    for (const [key, val] of Object.entries(obj)) {
      if (val === null || val === undefined) continue;
      out[key] = typeof val === "string" ? val : String(val);
    }
    return out;
  }

  /**
   * 写配置正本：省略空值字段，让 YAML 只留真正生效的配置
   * （stdio 的 command/args/env 与 HTTP 的 url/headers 互斥，全写上会各留一半 null）。
   * id 不入文件——文件名即 id（同 AGENT.md 以目录名为 id 的约定）。
   */
  private async writeConfig(config: McpServerConfig): Promise<void> {
    await fsp.mkdir(this.mcpDir, { recursive: true });
    const { id, ...rest } = config;
    const body: Record<string, any> = {};
    for (const [key, value] of Object.entries(rest)) {
      if (value === null || value === undefined) continue;
      if (Array.isArray(value) && value.length === 0) continue;
      if (
        typeof value === "object" &&
        !Array.isArray(value) &&
        Object.keys(value).length === 0
      ) {
        continue;
      }
      body[key] = value;
    }
    const text = yaml.dump(body, { lineWidth: -1, noRefs: true });
    await atomicWriteFile(this.configPath(id), text);
  }

  private async writeToolsFile(
    id: string,
    tools: Record<string, any>,
  ): Promise<void> {
    await fsp.mkdir(this.mcpDir, { recursive: true });
    const body = JSON.stringify(
      { fetchedAt: new Date().toISOString(), tools },
      null,
      2,
    );
    await atomicWriteFile(this.toolsPath(id), body);
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
