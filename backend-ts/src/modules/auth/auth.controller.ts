import { Body, Controller, Post, BadRequestException } from "@nestjs/common";
import { AuthService } from "./auth.service";
import { Public } from "./public.decorator";

@Controller("auth")
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post("login")
  async login(
    @Body() body: { username?: string; password?: string },
  ) {
    const { username, password } = body;

    // 验证必填字段
    if (!username || !password) {
      throw new BadRequestException("Username and password are required");
    }

    const user = await this.authService.validateUserByUsername(username, password);

    if (!user) {
      throw new BadRequestException("Invalid credentials");
    }

    return this.authService.login(user);
  }

  @Post("register")
  async register(
    @Body() body: { username?: string; password?: string; nickname?: string },
  ) {
    // 验证必填字段
    if (!body.username || !body.password) {
      throw new BadRequestException("Username and password are required");
    }

    return this.authService.register(body.username, body.password, body.nickname);
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
