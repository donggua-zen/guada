import { Body, Controller, Post, BadRequestException, UnauthorizedException } from "@nestjs/common";
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
      throw new BadRequestException("用户名和密码不能为空");
    }

    const user = await this.authService.validateUserByUsername(username, password);

    if (!user) {
      // 统一返回 401，不区分用户不存在或密码错误，避免信息泄露
      throw new UnauthorizedException("用户名或密码错误");
    }

    return this.authService.login(user);
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
