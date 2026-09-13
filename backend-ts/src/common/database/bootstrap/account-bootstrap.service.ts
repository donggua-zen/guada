import * as fs from "fs";
import * as fsp from "fs/promises";
import * as path from "path";
import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma.service";
import {
  META_DOMAIN_ACCOUNT,
  MetadataBootstrapGate,
} from "../metadata-bootstrap.gate";
import { AccountData, AccountFileStore } from "../../../modules/auth/account-file.store";

/**
 * ⚠️ 迁移脚手架（临时代码）：预计两个版本后随 Prisma/主库整体移除，
 * 由 MigrationBootstrapService 编排调用，移除清单见 docs/design/metadata-file-format.md。
 *
 * 单账户启动期引导
 *
 * 目标：把「账户」从 DB `user` 表迁到 account.json，且**不丢密码**。
 *
 * 三种情形：
 * 1. account.json 已存在 → 跳过（幂等）
 * 2. 不存在且 DB `user` 表有行（老用户升级）→ **导入该行**，passwordHash 原样搬运
 * 3. 都不存在（全新安装）→ 写默认账户（无密码 = 免登录）
 *
 * 情形 2 是硬要求：若只做「文件缺失就写默认值」，老用户升级后密码会丢、
 * 实例直接变成敞开状态，恰好违背引入账户的目的（公网别让人随便进）。
 *
 * 导入失败**不落 marker 且不放行门控**，下次启动重试——避免用空账户覆盖既有密码。
 */
@Injectable()
export class AccountBootstrapService {
  private readonly logger = new Logger(AccountBootstrapService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gate: MetadataBootstrapGate,
    private readonly accountStore: AccountFileStore,
  ) {}

  async run(): Promise<void> {
    try {
      await this.bootstrap();
    } catch (err) {
      // 无论如何放行门控，避免认证链路因等待而挂起（超时兜底仍会放行）
      this.logger.error(`账户引导失败: ${String(err)}`);
    }
    this.gate.complete(META_DOMAIN_ACCOUNT);
  }

  private async bootstrap(): Promise<void> {
    const filePath = this.accountStore.getFilePath();

    if (fs.existsSync(filePath)) {
      this.logger.log(`账户文件已存在，跳过导入: ${filePath}`);
      return;
    }

    const imported = await this.importFromDb();
    if (imported) {
      this.logger.log(
        `账户已从 DB 导入（保留原密码状态: ${imported.passwordHash ? "已设密码" : "未设密码"}）`,
      );
      return;
    }

    const fallback = this.accountStore.defaultAccount();
    await this.accountStore.writeDirect(fallback);
    this.logger.log("账户文件已创建（默认账户，未设密码 → 免登录）");
  }

  /**
   * 从 DB `user` 表导入既有账户。
   * @returns 导入的账户；DB 不可读或无行时返回 null（交由调用方写默认值）
   */
  private async importFromDb(): Promise<AccountData | null> {
    let rows: Array<Record<string, any>>;
    try {
      rows = await this.prisma.user.findMany();
    } catch (err) {
      this.logger.warn(`DB 不可读，无法导入既有账户: ${String(err)}`);
      return null;
    }
    if (rows.length === 0) return null;

    // 多账户历史数据：优先 role='primary'，否则取第一条
    const row =
      rows.find((r) => r.role === "primary") ?? rows[0];
    if (rows.length > 1) {
      this.logger.warn(
        `DB 中有 ${rows.length} 个用户行，仅导入 "${row.username}"（其余忽略——单账户模型）`,
      );
    }

    const now = new Date().toISOString();
    const account: AccountData = {
      username:
        typeof row.username === "string" && row.username.trim()
          ? row.username.trim()
          : "guada",
      passwordHash:
        typeof row.passwordHash === "string" && row.passwordHash
          ? row.passwordHash
          : null,
      nickname: typeof row.nickname === "string" ? row.nickname : null,
      avatarUrl: typeof row.avatarUrl === "string" ? row.avatarUrl : null,
      wallpaperUrl:
        typeof row.wallpaperUrl === "string" ? row.wallpaperUrl : null,
      createdAt: this.iso(row.createdAt) ?? now,
      updatedAt: this.iso(row.updatedAt) ?? now,
    };

    await fsp.mkdir(path.dirname(this.accountStore.getFilePath()), {
      recursive: true,
    });
    await this.accountStore.writeDirect(account);
    return account;
  }

  private iso(value: any): string | null {
    if (value === null || value === undefined) return null;
    if (value instanceof Date) return value.toISOString();
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
}
