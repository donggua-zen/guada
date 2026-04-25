import { Injectable, Logger } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcrypt";
import { UserRepository } from "../../common/database/user.repository";
import { SettingsStorage } from "../../common/utils/settings-storage.util";
import { UrlService } from "../../common/services/url.service";
import { SG_SYSTEM, SK_SYS_AUTO_LOGIN } from "../../constants/settings.constants";

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private jwtService: JwtService,
    private userRepo: UserRepository,
    private settingsStorage: SettingsStorage,
    private urlService: UrlService,
  ) {}

  async validateUserByUsername(username: string, password: string): Promise<any> {
    // 将用户名统一转换为小写，实现不区分大小写的登录
    const normalizedUsername = username.toLowerCase();
    const user = await this.userRepo.findByUsername(normalizedUsername);
    if (user && (await bcrypt.compare(password, user.passwordHash))) {
      const { passwordHash, ...result } = user;
      return result;
    }
    return null;
  }

  async login(user: any) {
    const payload = { username: user.username, sub: user.id };
    return {
      accessToken: this.jwtService.sign(payload),
      user: this.urlService.transformUrls({
        id: user.id,
        username: user.username,
        nickname: user.nickname,
        avatarUrl: user.avatarUrl,
        role: user.role,
      }),
    };
  }

  async register(username: string, password: string, nickname?: string) {
    // 将用户名统一转换为小写存储，避免重复注册
    const normalizedUsername = username.toLowerCase();
    const hashedPassword = await bcrypt.hash(password, 10);
    return this.userRepo.create({
      username: normalizedUsername,
      passwordHash: hashedPassword,
      nickname,
      role: 'primary', // 默认注册即为主账户
    });
  }

  /**
   * 自动登录 - 当免登录模式开启时，使用 primary 用户自动登录
   */
  async autoLogin(): Promise<{ accessToken: string; user: any } | null> {
    try {
      // 检查是否开启免登录模式
      const autoLoginEnabled = this.settingsStorage.getSettingValue(
        SG_SYSTEM,
        SK_SYS_AUTO_LOGIN,
        false,
      );
      
      this.logger.debug(`免登录配置: ${autoLoginEnabled}`);
      
      if (!autoLoginEnabled) {
        this.logger.log("免登录模式未开启");
        return null;
      }

      // 查询 role='primary' 的用户
      const primaryUser = await this.userRepo.findPrimaryUser();
      this.logger.debug(`查找 primary 用户: ${primaryUser ? `找到 (ID: ${primaryUser.id})` : "未找到"}`);
      
      if (!primaryUser) {
        this.logger.warn("未找到 primary 用户，无法自动登录");
        return null;
      }

      // 生成 JWT token
      const payload = { username: primaryUser.username, sub: primaryUser.id };
      const accessToken = this.jwtService.sign(payload);

      this.logger.log(`自动登录成功，用户ID: ${primaryUser.id}, Username: ${primaryUser.username}`);

      return {
        accessToken,
        user: this.urlService.transformUrls({
          id: primaryUser.id,
          username: primaryUser.username,
          nickname: primaryUser.nickname,
          avatarUrl: primaryUser.avatarUrl,
          role: primaryUser.role,
        }),
      };
    } catch (error) {
      this.logger.error("自动登录失败", error instanceof Error ? error.stack : String(error));
      return null;
    }
  }
}
