import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import { Request } from "express";
import { IS_PUBLIC_KEY } from "./public.decorator";
import { AuthService } from "./auth.service";
import { UserRepository } from "../../common/database/user.repository";

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private jwtService: JwtService,
    private reflector: Reflector,
    private authService: AuthService,
    private userRepo: UserRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // 检查是否标记为公开路由
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const token = this.extractTokenFromHeader(request);

    if (!token) {
      // 尝试自动登录
      const autoLoginResult = await this.authService.autoLogin();
      if (autoLoginResult) {
        // 验证自动登录的用户是否存在于数据库中，并获取完整用户信息
        const user = await this.userRepo.findById(autoLoginResult.user.id);
        if (!user) {
          throw new UnauthorizedException("Auto-login user no longer exists");
        }
        // 将完整的用户对象附加到请求上（排除敏感字段）
        const { passwordHash, ...safeUser } = user;
        request["user"] = safeUser;
        return true;
      }
      throw new UnauthorizedException("Missing authentication token");
    }

    try {
      const payload = await this.jwtService.verifyAsync(token, {
        secret: process.env.JWT_SECRET,
      });
      
      // 验证用户是否存在于数据库中，并获取完整用户信息
      const user = await this.userRepo.findById(payload.sub);
      if (!user) {
        throw new UnauthorizedException("User no longer exists");
      }
      
      // 将完整的用户对象附加到请求对象上（排除敏感字段）
      const { passwordHash, ...safeUser } = user;
      request["user"] = safeUser;
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      throw new UnauthorizedException("Invalid token");
    }

    return true;
  }

  private extractTokenFromHeader(request: Request): string | undefined {
    const [type, token] = request.headers.authorization?.split(" ") ?? [];
    return type === "Bearer" ? token : undefined;
  }
}
