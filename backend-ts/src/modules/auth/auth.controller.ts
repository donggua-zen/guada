import {
  Body,
  Controller,
  Get,
  Post,
  BadRequestException,
  UnauthorizedException,
} from "@nestjs/common";
import { AuthService } from "./auth.service";
import { Public } from "./public.decorator";

@Controller("auth")
export class AuthController {
  constructor(private authService: AuthService) {}

  /**
   * 认证状态：前端据此决定是否需要强制登录。
   * 仅暴露 passwordSet，不泄露任何账户细节。
   */
  @Public()
  @Get("status")
  async getStatus() {
    await this.authService.ensureReady();
    return this.authService.getStatus();
  }

  @Public()
  @Post("login")
  async login(@Body() body: { username?: string; password?: string }) {
    const { username, password } = body;

    if (!username) {
      throw new BadRequestException("用户名不能为空");
    }

    await this.authService.ensureReady();

    // 仅已设密码时才要求密码；免密模式下允许空密码，
    // 避免免密实例被卡在登录页（任何密码都失败的死路）。
    if (this.authService.isPasswordSet() && !password) {
      throw new BadRequestException("密码不能为空");
    }

    const valid = await this.authService.validateCredentials(
      username,
      password ?? "",
    );
    if (!valid) {
      // 统一 401，不区分用户名不存在或密码错误
      throw new UnauthorizedException("用户名或密码错误");
    }

    return this.authService.login();
  }

  /**
   * 自动登录：仅在**未设密码**时可用（取代原先的免登录开关）。
   * 已设密码时返回 400 —— 此时必须走 /auth/login。
   */
  @Public()
  @Post("auto-login")
  async autoLogin() {
    await this.authService.ensureReady();
    const result = this.authService.autoLoginIfPasswordless();
    if (!result) {
      throw new BadRequestException("已设置密码，请使用账号密码登录");
    }
    return result;
  }
}
