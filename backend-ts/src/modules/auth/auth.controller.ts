import { Body, Controller, Post, BadRequestException } from '@nestjs/common';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('login')
  async login(@Body() body: { type?: string; username?: string; password?: string }) {
    const { type, username, password } = body;

    // 验证必填字段
    if (!type || !username || !password) {
      throw new BadRequestException('Type, username and password are required');
    }

    // 根据 type 选择登录方式
    let user;
    if (type === 'phone') {
      user = await this.authService.validateUserByPhone(username, password);
    } else if (type === 'email') {
      user = await this.authService.validateUserByEmail(username, password);
    } else {
      throw new BadRequestException('Invalid login type. Use "phone" or "email"');
    }

    if (!user) {
      throw new BadRequestException('Invalid credentials');
    }

    return this.authService.login(user);
  }

  @Post('register')
  async register(@Body() body: { email?: string; password?: string; nickname?: string }) {
    // 验证必填字段
    if (!body.email || !body.password) {
      throw new BadRequestException('Email and password are required');
    }

    return this.authService.register(body.email, body.password, body.nickname);
  }
}
