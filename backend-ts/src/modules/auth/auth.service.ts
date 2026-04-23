import { Injectable, Logger } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcrypt";
import { UserRepository } from "../../common/database/user.repository";
import { GlobalSettingRepository } from "../../common/database/global-setting.repository";

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private jwtService: JwtService,
    private userRepo: UserRepository,
    private settingRepo: GlobalSettingRepository,
  ) {}

  async validateUserByEmail(email: string, password: string): Promise<any> {
    const user = await this.userRepo.findByEmail(email);
    if (user && (await bcrypt.compare(password, user.passwordHash))) {
      const { passwordHash, ...result } = user;
      return result;
    }
    return null;
  }

  async validateUserByPhone(phone: string, password: string): Promise<any> {
    const user = await this.userRepo.findByPhone(phone);
    if (user && (await bcrypt.compare(password, user.passwordHash))) {
      const { passwordHash, ...result } = user;
      return result;
    }
    return null;
  }

  async login(user: any) {
    const payload = { email: user.email, sub: user.id };
    return {
      accessToken: this.jwtService.sign(payload),
      user: {
        id: user.id,
        email: user.email,
        phone: user.phone,
        nickname: user.nickname,
        avatarUrl: user.avatarUrl,
        role: user.role,
      },
    };
  }

  async register(email: string, password: string, nickname?: string) {
    const hashedPassword = await bcrypt.hash(password, 10);
    return this.userRepo.create({
      email,
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
      const setting = await this.settingRepo.findByKey("autoLoginEnabled", null);
      const autoLoginEnabled = setting?.value === "true";
      
      this.logger.debug(`免登录配置: ${autoLoginEnabled}, setting: ${JSON.stringify(setting)}`);
      
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
      const payload = { email: primaryUser.email, sub: primaryUser.id };
      const accessToken = this.jwtService.sign(payload);

      this.logger.log(`自动登录成功，用户ID: ${primaryUser.id}, Email: ${primaryUser.email}`);

      return {
        accessToken,
        user: {
          id: primaryUser.id,
          email: primaryUser.email,
          phone: primaryUser.phone,
          nickname: primaryUser.nickname,
          avatarUrl: primaryUser.avatarUrl,
          role: primaryUser.role,
        },
      };
    } catch (error) {
      this.logger.error("自动登录失败", error instanceof Error ? error.stack : String(error));
      return null;
    }
  }
}
