import { Injectable, Logger } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { AccountFileStore, AccountView } from "./account-file.store";
import { UrlService } from "../../common/services/url.service";

/**
 * 认证服务（单账户）
 *
 * 账户权威来源是 account.json（见 AccountFileStore）。
 * 密码可选：未设密码时无需登录（autoLogin 直通），设了密码则必须登录。
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private jwtService: JwtService,
    private accountStore: AccountFileStore,
    private urlService: UrlService,
  ) {}

  /** 校验用户名 + 密码（用户名与密码均大小写不敏感，沿用既有行为） */
  async validateCredentials(
    username: string,
    password: string,
  ): Promise<boolean> {
    const account = this.accountStore.get();
    if (!account) {
      this.logger.warn("登录失败：账户未初始化");
      return false;
    }
    if (account.username.toLowerCase() !== username.toLowerCase()) {
      this.logger.warn(`登录失败：用户名不匹配 - ${username}`);
      return false;
    }
    const ok = await this.accountStore.verifyPassword(password);
    if (!ok) this.logger.warn(`登录失败：密码错误 - ${username}`);
    return ok;
  }

  /** 签发登录凭据 */
  login(): { accessToken: string; user: AccountView } {
    const account = this.accountStore.get();
    const payload = { username: account?.username ?? "guada" };
    return {
      accessToken: this.jwtService.sign(payload),
      user: this.withAbsoluteAvatar(this.accountStore.getView()),
    };
  }

  /**
   * 未设密码时的自动登录（取代原先独立的 autoLoginEnabled 开关）。
   * @returns 凭据；已设密码时返回 null（此时必须显式登录）
   */
  autoLoginIfPasswordless(): { accessToken: string; user: AccountView } | null {
    if (this.accountStore.isPasswordSet()) {
      this.logger.debug("已设置密码，跳过自动登录");
      return null;
    }
    return this.login();
  }

  /** 前端据此决定是否需要强制登录 */
  getStatus(): { passwordSet: boolean } {
    return { passwordSet: this.accountStore.isPasswordSet() };
  }

  /** 供控制器在调用前确保账户已加载（避免预热前误判免登录） */
  async ensureReady(): Promise<void> {
    await this.accountStore.ensureReady();
  }

  /** 账户视图（含头像绝对 URL） */
  getProfile(): AccountView {
    return this.withAbsoluteAvatar(this.accountStore.getView());
  }

  private withAbsoluteAvatar(view: AccountView): AccountView {
    return {
      ...view,
      avatarUrl: view.avatarUrl
        ? this.urlService.toResourceAbsoluteUrl(view.avatarUrl)
        : null,
      wallpaperUrl: view.wallpaperUrl
        ? this.urlService.toResourceAbsoluteUrl(view.wallpaperUrl)
        : null,
    };
  }
}
