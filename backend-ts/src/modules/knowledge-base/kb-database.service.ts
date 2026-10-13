import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import * as fs from "fs";
import * as fsp from "fs/promises";
import * as path from "path";
import Database from "better-sqlite3";
import {
  META_DOMAIN_KB,
  MetadataBootstrapGate,
} from "../../common/database/metadata-bootstrap.gate";
import { loadSqliteVec } from "../../common/utils/asar-path.util";
import { KB_DB_FILE, migrateKbDatabase } from "./kb-schema";

/** 一次最多同时持有多少个库句柄（超出按 LRU 关闭，避免累积句柄） */
const MAX_OPEN_DATABASES = 8;

/** 设置分组文件名（与 SettingsStorage 一致） */
const SYSTEM_SETTINGS_FILE = "system.json";
/** 设置项键名（与 settings.constants.ts 的 SK_SYS_KB_STORAGE_ROOT 保持一致） */
const KB_STORAGE_ROOT_KEY = "kbStorageRoot";

/**
 * 知识库存储根解析
 *
 * 优先级：`kbStorageRoot` 设置 → `KB_DATA_DIR` → `USERDATA_DIR/data/kb` → `./data/kb`
 *
 * **设置是直接读文件得到的，不依赖 SettingsService 的初始化时机。**
 *
 * 为什么不靠注入：SettingsService 在 AppModule 的导入序里排在持久化模块
 * （PersistenceModule，迁移脚手架所在）之后，而知识库迁移（MigrationBootstrapService.onModuleInit）
 * 先跑——实测结果是迁移按**默认根**执行、随后设置才注入，用户设了根却"知识库不见了"。
 * 存储根这种被启动期迁移依赖的东西必须自给自足，不能依赖另一个模块的 hook 顺序。
 */
let configuredRoot: string | null = null;
let settingsRootCache: { value: string | null } | null = null;
let warnedInvalidSetting = false;

/** 显式覆盖（测试与一次性脚本用；生产路径请改设置） */
export function setConfiguredKbRoot(dir: string | null): void {
  configuredRoot = dir && dir.trim() ? path.resolve(dir.trim()) : null;
}

/** 丢弃设置缓存（仅测试用：换根在运行期不生效，需重启） */
export function invalidateKbRootCache(): void {
  settingsRootCache = null;
}

/**
 * 从设置文件直接读 `kbStorageRoot`。**进程内只读一次并缓存**。
 *
 * 只读一次是刻意的：换根必须重启才生效，否则会出现"一部分连接指向旧根、新解析指向新根"
 * 的半程状态（比不生效更难排查）。设置页保存时也已提示需要重启。
 *
 * 非法值（相对路径 / UNC）在此处被拦下并退回默认根：手改 system.json 写坏了也不该让
 * 整个知识库打不开，但必须留一条明确的告警。
 */
function readSettingsRoot(): string | null {
  if (settingsRootCache) return settingsRootCache.value;

  let value: string | null = null;
  const settingsDir =
    process.env.SETTINGS_DIR || path.join(process.cwd(), ".config");
  try {
    const raw = fs.readFileSync(
      path.join(settingsDir, SYSTEM_SETTINGS_FILE),
      "utf8",
    );
    const doc = JSON.parse(raw);
    const candidate = doc?.[KB_STORAGE_ROOT_KEY];
    if (typeof candidate === "string" && candidate.trim()) {
      try {
        value = assertUsableKbRoot(candidate.trim());
      } catch (err: any) {
        if (!warnedInvalidSetting) {
          warnedInvalidSetting = true;
          new Logger("KbRoot").error(
            `${KB_STORAGE_ROOT_KEY} 设置不可用，本次退回默认存储位置：${err?.message || err}`,
          );
        }
        value = null;
      }
    }
  } catch {
    // 没有设置文件 / 解析失败 → 视为未设置
    value = null;
  }

  settingsRootCache = { value };
  return value;
}

/** 当前生效的 KB 存储根 */
export function resolveKbRoot(): string {
  if (configuredRoot) return configuredRoot;
  const fromSettings = readSettingsRoot();
  if (fromSettings) return fromSettings;
  const envDir = process.env.KB_DATA_DIR;
  if (envDir && envDir.trim()) return path.resolve(envDir.trim());
  return resolveDefaultKbRoot();
}

/** 无设置、无 env 时的默认根（也用于"换了根但旧根还有库"的提示对比） */
export function resolveDefaultKbRoot(): string {
  const userData = process.env.USERDATA_DIR;
  if (userData && userData.trim()) {
    return path.join(path.resolve(userData.trim()), "data", "kb");
  }
  return path.resolve(process.cwd(), "data", "kb");
}

/**
 * 校验存储根可用：必须**传入**绝对路径、且非 UNC/网络路径。
 *
 * 注意顺序：必须先判 `dir` 原样是不是绝对路径，再 resolve。若先 resolve 再判 isAbsolute，
 * 判断恒为真——相对路径会被静默解析成"相对于当前工作目录"，而 cwd 在开发/Electron 两种
 * 启动方式下并不相同，最终表现为"设置了根却找不到知识库"。
 *
 * WAL 模式在网络共享上的锁语义不可靠（SQLite 官方明确不支持），故一并拒绝 UNC。
 */
export function assertUsableKbRoot(dir: string): string {
  if (!path.isAbsolute(dir)) {
    throw new Error(`知识库存储根必须是绝对路径（不能是相对路径）：${dir}`);
  }
  const resolved = path.resolve(dir);
  // Windows UNC：\\server\share；POSIX 网络挂载无法在此层判断，交由用户
  if (/^[\\/]{2}[^\\/]/.test(resolved)) {
    throw new Error(
      `知识库存储根不能是网络路径（UNC）：${dir}。SQLite WAL 在网络共享上锁不可靠，请选择本地磁盘。`,
    );
  }
  return resolved;
}

/**
 * 每个知识库一个 SQLite 句柄的连接注册表
 *
 * 设计要点：
 * - **懒开**：只有真正访问某个库时才建连接；列出知识库不需要打开任何库（只读 kb.json）
 * - **LRU 上限**：同时最多 MAX_OPEN_DATABASES 个句柄，超出按最近使用时间关闭最旧的
 * - **删除前必须 close(kbId)**：Windows 上未关闭的句柄会让 rm -rf 整个库目录失败
 * - **打开即迁移**：按 user_version 在事务内升级，版本高于程序则拒绝打开（数据隔离而非损坏）
 * - **WAL + synchronous=NORMAL**：进度上报这类高频写不再每次 fsync
 * - **关闭前 checkpoint(TRUNCATE)**：空闲目录只留一个 kb.db，方便用户备份/拷贝
 */
@Injectable()
export class KbDatabaseService implements OnModuleDestroy {
  private readonly logger = new Logger(KbDatabaseService.name);
  /**
   * 存储根**惰性解析**，不在构造期定格。
   *
   * 原因：构造函数先于设置加载执行，若在此快照根路径，用户配置的 kbStorageRoot 会被
   * 静默忽略、程序继续读写默认位置（而这正是最难排查的一类问题）。改为每次访问解析，
   * 与「改设置后重启生效」的语义天然一致。
   */
  private get rootDir(): string {
    return resolveKbRoot();
  }
  /** kbId → 连接（含 LRU 时间戳） */
  private open = new Map<string, { db: Database.Database; usedAt: number }>();
  /** 打开失败的库（只记一次日志，避免刷屏） */
  private readonly failed = new Map<string, string>();
  /** 串行化「打开」动作，避免并发请求同时建库 */
  private pending = new Map<string, Promise<Database.Database>>();
  /** listKbIds 短缓存（启动期对账会循环调用） */
  private kbIdCache: { at: number; ids: string[] } | null = null;

  constructor(private readonly gate: MetadataBootstrapGate) {}

  getRootDir(): string {
    return this.rootDir;
  }

  getKbDir(kbId: string): string {
    return path.join(this.rootDir, kbId);
  }

  getDbPath(kbId: string): string {
    return path.join(this.getKbDir(kbId), KB_DB_FILE);
  }

  /** 原件目录根：`<kbId>/raw/` */
  getRawDir(kbId: string): string {
    return path.join(this.getKbDir(kbId), "raw");
  }

  /** 单个条目的原件目录：`<kbId>/raw/<itemId>/` */
  getItemRawDir(kbId: string, itemId: string): string {
    return path.join(this.getRawDir(kbId), itemId);
  }

  isOpen(kbId: string): boolean {
    return this.open.has(kbId);
  }

  /** 已打开句柄数（测试与诊断用） */
  openCount(): number {
    return this.open.size;
  }

  /**
   * 取某库的连接（懒开 + LRU）。
   *
   * 读路径也应先 await ready()，以保证迁移导出已完成再读。
   */
  async getDb(kbId: string): Promise<Database.Database> {
    assertValidKbId(kbId);
    const cached = this.open.get(kbId);
    if (cached) {
      cached.usedAt = Date.now();
      return cached.db;
    }

    const inflight = this.pending.get(kbId);
    if (inflight) return inflight;

    const task = this.openDatabase(kbId).finally(() => this.pending.delete(kbId));
    this.pending.set(kbId, task);
    return task;
  }

  /**
   * 等迁移门控放行（导出/导入完成前不得读写库）。
   * 所有公开读写的入口都应先 await 它。
   */
  async ready(): Promise<void> {
    await this.gate.wait(META_DOMAIN_KB);
  }

  /** 打开并迁移（内部） */
  private async openDatabase(kbId: string): Promise<Database.Database> {
    const dbPath = this.getDbPath(kbId);
    await fsp.mkdir(path.dirname(dbPath), { recursive: true });

    let db: Database.Database;
    try {
      db = new Database(dbPath);
      loadSqliteVec(db);
      db.pragma("journal_mode = WAL");
      db.pragma("busy_timeout = 5000");
      db.pragma("synchronous = NORMAL");
      migrateKbDatabase(db, kbId);
    } catch (err: any) {
      try {
        db!?.close();
      } catch {
        /* 打不开就没得关 */
      }
      const message = err?.message || String(err);
      if (this.failed.get(kbId) !== message) {
        this.failed.set(kbId, message);
        this.logger.error(`打开知识库数据库失败（已隔离）${kbId}: ${message}`);
      }
      throw err;
    }

    this.failed.delete(kbId);
    this.open.set(kbId, { db, usedAt: Date.now() });
    this.evictIfNeeded();
    return db;
  }

  /** LRU 淘汰：超出上限时关闭最久未使用的句柄（不关当前正在用的） */
  private evictIfNeeded(): void {
    while (this.open.size > MAX_OPEN_DATABASES) {
      let oldestKey: string | null = null;
      let oldestAt = Infinity;
      for (const [key, entry] of this.open) {
        if (entry.usedAt < oldestAt) {
          oldestAt = entry.usedAt;
          oldestKey = key;
        }
      }
      if (!oldestKey) return;
      this.closeSync(oldestKey, "LRU 淘汰");
    }
  }

  /** 同步关闭（LRU/退出路径用；先 checkpoint 再关） */
  private closeSync(kbId: string, reason: string): void {
    const entry = this.open.get(kbId);
    if (!entry) return;
    this.open.delete(kbId);
    try {
      entry.db.pragma("wal_checkpoint(TRUNCATE)");
    } catch {
      /* 库已损坏时 checkpoint 可能失败，仍要继续关闭 */
    }
    try {
      entry.db.close();
    } catch (err: any) {
      this.logger.warn(`关闭知识库数据库失败 ${kbId}: ${err?.message || err}`);
    }
    this.logger.debug(`已关闭知识库数据库 ${kbId}（${reason}）`);
  }

  /**
   * 关闭某库连接。**删除/移动库目录之前必须调用**，否则 Windows 上文件被占用。
   */
  async close(kbId: string): Promise<void> {
    this.closeSync(kbId, "显式关闭");
  }

  /** 目录是否还存在（用于区分"库被删了"与"库坏了"） */
  async exists(kbId: string): Promise<boolean> {
    try {
      await fsp.access(this.getKbDir(kbId));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 列出根下所有知识库 id（含 kb.json 的目录）。
   *
   * 列出知识库**不打开任何 kb.db**——空库只需要 kb.json，列表页也就不必建库文件。
   * 结果带 1s 缓存：启动期对账会在循环里多次调用它。
   */
  async listKbIds(): Promise<string[]> {
    const now = Date.now();
    if (this.kbIdCache && now - this.kbIdCache.at < 1000) {
      return this.kbIdCache.ids;
    }
    let entries: import("fs").Dirent[];
    try {
      entries = await fsp.readdir(this.rootDir, { withFileTypes: true });
    } catch {
      this.kbIdCache = { at: now, ids: [] };
      return [];
    }
    const ids: string[] = [];
    for (const entry of entries) {
      // `.` 开头的目录是迁移备份（.pre-sqlite）与临时目录，本就不是知识库
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      try {
        await fsp.access(path.join(this.rootDir, entry.name, "kb.json"));
        ids.push(entry.name);
      } catch {
        /* 无 kb.json（如迁移半程残留的 .new）不算知识库 */
      }
    }
    this.kbIdCache = { at: now, ids };
    return ids;
  }

  /** 新建/删除知识库后调用，让列表缓存立刻失效 */
  invalidateKbList(): void {
    this.kbIdCache = null;
  }

  async onModuleDestroy(): Promise<void> {
    for (const kbId of [...this.open.keys()]) {
      this.closeSync(kbId, "进程退出");
    }
  }
}

/**
 * kbId 合法性校验（目录名/主键两用）：非空、无路径分隔符与 Windows 保留字符、
 * 不以 `.` 开头（覆盖 `.` 与 `..`）、拒绝字面量 `undefined`/`null`。
 *
 * 拒绝 `undefined` 是必要的：旧实现里 `String(data.id)` 曾把缺失 id 变成字面量
 * "undefined"，成为所有新建条目的共用目录。
 */
export function assertValidKbId(id: string): void {
  if (
    !id ||
    /[\\/:*?"<>|]/.test(id) ||
    id.startsWith(".") ||
    id === "undefined" ||
    id === "null"
  ) {
    throw new Error(`非法的知识库/条目 id："${id}"`);
  }
}
