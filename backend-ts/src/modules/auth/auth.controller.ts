import { Body, Controller, Post, BadRequestException } from "@nestjs/common";
import { AuthService } from "./auth.service";
import { Public } from "./public.decorator";

@Controller("auth")
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post("login")
  async login(
    @Body() body: { type?: string; username?: string; password?: string },
  ) {
    const { type, username, password } = body;

    // 验证必填字段
    if (!type || !username || !password) {
      throw new BadRequestException("Type, username and password are required");
    }

    // 根据 type 选择登录方式
    let user;
    if (type === "phone") {
      user = await this.authService.validateUserByPhone(username, password);
    } else if (type === "email") {
      user = await this.authService.validateUserByEmail(username, password);
    } else {
      throw new BadRequestException(
        'Invalid login type. Use "phone" or "email"',
      );
    }

    if (!user) {
      throw new BadRequestException("Invalid credentials");
    }

    return this.authService.login(user);
  }

  @Post("register")
  async register(
    @Body() body: { email?: string; password?: string; nickname?: string },
  ) {
    // 验证必填字段
    if (!body.email || !body.password) {
      throw new BadRequestException("Email and password are required");
    }

    return this.authService.register(body.email, body.password, body.nickname);
  }

  /**
   * 自动登录接口 - 公开访问，用于前端主动触发自动登录
   */
  @Public()
  @Post("auto-login")
  async autoLogin() {
    const result = await this.authService.autoLogin();
    if (!result) {
      throw new BadRequestException("自动登录失败，请检查配置或联系管理员");
    }
    return result;
  }
}
