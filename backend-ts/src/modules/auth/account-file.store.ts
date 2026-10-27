import * as fs from "fs";
import * as fsp from "fs/promises";
import * as path from "path";
import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PasswordHashUtil } from "../../common/utils/password-hash.util";
import { atomicWriteFile, iso } from "../../common/persistence/file-store-kit";

/**
 * 单一全局账户文件存储
 *
 * 权威来源 = `<SETTINGS_DIR>/account.json`（与 models.json 同目录；Electron 下即 ~/.guada/account.json）。
 *
 * 定位：**不是安全边界**。应用数据本身在磁盘明文存储，账户密码只用于
 * 「公网部署时不让人随便进」。因此不做密码复杂度策略、不做登录限流、不做 token 吊销
 * ——数据都裸奔了，给账户装好锁没有意义。遗忘密码的恢复方式是编辑本文件删掉
 * `passwordHash`（见 docs/design/single-account.md）。
 *
 * 密码可选：
 * - `passwordHash` 为 null/缺失 → **未设密码** → 免登录直接放行
 * - `passwordHash` 有值 → 必须登录
 * 这个判据同时取代了原先独立的 `autoLoginEnabled` 开关（两者语义重叠，
 * 留着会出现「设了密码却仍免登录」的坑）。
 *
 * 不存 id：单账户无需主键，JWT payload 用 username 标识。
 */

export const ACCOUNT_FILE = "account.json";

export interface AccountData {
  username: string;
  /** null = 未设密码（免登录模式） */
  passwordHash: string | null;
  nickname: string | null;
  avatarUrl: string | null;
  wallpaperUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

/** 对外的账户视图（绝不外泄 passwordHash） */
export interface AccountView {
  username: string;
  nickname: string | null;
  avatarUrl: string | null;
  wallpaperUrl: string | null;
  /** 是否已设密码（前端据此决定要不要强制登录） */
  passwordSet: boolean;
}

@Injectable()
export class AccountFileStore implements OnModuleDestroy {
  private readonly logger = new Logger(AccountFileStore.name);
  private readonly accountPath: string;

  /** 内存缓存（认证是每请求热路径，内存读比每次解析文件更快） */
  private account: AccountData | null = null;
  private ready: Promise<void> | null = null;
  private writeChain: Promise<unknown> = Promise.resolve();

  constructor(private readonly configService: ConfigService) {
    const settingsDir =
      this.configService.get<string>("SETTINGS_DIR") ||
      path.join(process.cwd(), ".config");
    this.accountPath = path.join(settingsDir, ACCOUNT_FILE);
  }

  getFilePath(): string {
    return this.accountPath;
  }

  /** 幂等初始化：读入内存；文件缺失时落默认账户（无密码 → 免登录） */
  async initialize(): Promise<void> {
    this.ready ??= this.doInitialize();
    return this.ready;
  }

  private async doInitialize(): Promise<void> {
    this.account = await this.readFromDisk();
    if (!this.account) {
      // 文件存在但解析失败：保留原文件，避免覆盖可能仍可人工恢复的密码
      if (fs.existsSync(this.accountPath)) {
        this.logger.warn(
          `账户文件无法解析，保留原文件不覆盖: ${this.accountPath}`,
        );
        return;
      }
      this.account = this.defaultAccount();
      await this.write(this.account);
      this.logger.log(
        `账户文件已创建（默认账户，未设密码 → 免登录）: ${this.accountPath}`,
      );
    }
  }

  // ============ 读取 API（内存，同步） ============

  /** 原始账户（含 passwordHash）；未初始化时返回 null */
  get(): AccountData | null {
    return this.account;
  }

  /**
   * 确保索引已就绪（幂等）。
   *
   * 认证是每请求热路径：Guard 等入口**必须**先 await 本方法，
   * 否则在预热完成前读到空账户会误判为「未设密码」而放行——这是安全语义问题，非性能问题。
   */
  async ensureReady(): Promise<void> {
    await this.initialize();
  }

  /** 对外视图（不含 passwordHash） */
  getView(): AccountView {
    const a = this.account;
    return {
      username: a?.username ?? "guada",
      nickname: a?.nickname ?? null,
      avatarUrl: a?.avatarUrl ?? null,
      wallpaperUrl: a?.wallpaperUrl ?? null,
      passwordSet: this.isPasswordSet(),
    };
  }

  /** 是否已设密码（= 是否需要登录） */
  isPasswordSet(): boolean {
    return !!this.account?.passwordHash;
  }

  /** 校验密码（大小写不敏感，沿用既有行为） */
  async verifyPassword(password: string): Promise<boolean> {
    const hash = this.account?.passwordHash;
    if (!hash || !password) return false;
    return PasswordHashUtil.compare(password.toLowerCase(), hash);
  }

  // ============ 写入 API（原子写） ============

  /** 设定密码（调用方负责在已设密码时先校验旧密码） */
  async setPassword(password: string): Promise<void> {
    await this.initialize();
    const hashed = await PasswordHashUtil.hash(password.toLowerCase());
    await this.patch({ passwordHash: hashed });
  }

  /** 清除密码 → 回到免登录模式（「可选」的退出通道） */
  async clearPassword(): Promise<void> {
    await this.initialize();
    await this.patch({ passwordHash: null });
  }

  /** 更新展示性资料（用户名/昵称/头像/壁纸） */
  async updateProfile(patch: {
    username?: string;
    nickname?: string | null;
    avatarUrl?: string | null;
    wallpaperUrl?: string | null;
  }): Promise<AccountData> {
    await this.initialize();
    return this.patch(patch);
  }

  /** 直接写入完整账户（供启动期导入） */
  async writeDirect(data: AccountData): Promise<void> {
    await this.withLock(async () => {
      await this.write(data);
      this.account = data;
    });
  }

  private async patch(patch: Partial<AccountData>): Promise<AccountData> {
    return this.withLock(async () => {
      const base: AccountData =
        this.account ?? this.defaultAccount();
      const next: AccountData = { ...base };
      for (const [key, value] of Object.entries(patch)) {
        if (value === undefined) continue;
        (next as any)[key] = value;
      }
      next.updatedAt = new Date().toISOString();
      await this.write(next);
      this.account = next;
      return next;
    });
  }

  /** 全新安装的默认账户（无密码 → 免登录） */
  defaultAccount(): AccountData {
    const now = new Date().toISOString();
    return {
      username: "guada",
      passwordHash: null,
      nickname: "管理员",
      avatarUrl: null,
      wallpaperUrl: null,
      createdAt: now,
      updatedAt: now,
    };
  }

  // ============ 内部 ============

  private async readFromDisk(): Promise<AccountData | null> {
    try {
      const raw = await fsp.readFile(this.accountPath, "utf8");
      const doc = JSON.parse(raw);
      if (!doc || typeof doc !== "object" || Array.isArray(doc)) return null;
      const r = doc as Record<string, any>;
      const now = new Date().toISOString();
      return {
        username:
          typeof r.username === "string" && r.username.trim()
            ? r.username.trim()
            : "guada",
        // 兼容旧值：空字符串视为未设密码
        passwordHash:
          typeof r.passwordHash === "string" && r.passwordHash
            ? r.passwordHash
            : null,
        nickname: typeof r.nickname === "string" ? r.nickname : null,
        avatarUrl: typeof r.avatarUrl === "string" ? r.avatarUrl : null,
        wallpaperUrl:
          typeof r.wallpaperUrl === "string" ? r.wallpaperUrl : null,
        createdAt: iso(r.createdAt) ?? now,
        updatedAt: iso(r.updatedAt) ?? now,
      };
    } catch (err: any) {
      if (err?.code === "ENOENT") return null;
      this.logger.error(
        `账户文件损坏，按未设置处理: ${this.accountPath} — ${err?.message || err}`,
      );
      return null;
    }
  }

  private async write(data: AccountData): Promise<void> {
    await fsp.mkdir(path.dirname(this.accountPath), { recursive: true });
    await atomicWriteFile(this.accountPath, JSON.stringify(data, null, 2));
  }

  private async withLock<T>(fn: () => Promise<T>): Promise<T> {
    const previous = this.writeChain;
    const run = previous.then(fn, fn);
    const tracked = run.then(
      () => undefined,
      () => undefined,
    );
    this.writeChain = tracked;
    return run;
  }

  onModuleDestroy(): void {
    /* 无 watcher；账户文件只由本进程写入 */
  }
}
