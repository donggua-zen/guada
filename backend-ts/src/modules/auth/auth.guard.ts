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
import { AccountFileStore, AccountView } from "./account-file.store";

/**
 * 鉴权守卫（单账户）
 *
 * 两种放行路径：
 * 1. 带 token → 校验 JWT，挂载账户视图
 * 2. 不带 token 且**未设密码** → 直接放行并挂载账户（免登录模式）
 *
 * 已设密码且无有效 token → 401。
 * 注意：这里保留的是「鉴权」（能不能访问本服务），与已移除的
 * 「归属校验」（这条数据是不是你的）是两件事——后者在单账户下无意义。
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private jwtService: JwtService,
    private reflector: Reflector,
    private accountStore: AccountFileStore,
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

    // 必须先确保账户已加载：预热前读到空账户会把「已设密码」误判为免登录而放行
    await this.accountStore.ensureReady();

    const request = context.switchToHttp().getRequest();
    const token = this.extractTokenFromHeader(request);

    if (!token) {
      // 未设密码 → 免登录直通（取代原先的 autoLoginEnabled 开关）
      if (!this.accountStore.isPasswordSet()) {
        request["user"] = this.accountStore.getView();
        return true;
      }
      throw new UnauthorizedException("Missing authentication token");
    }

    try {
      await this.jwtService.verifyAsync(token, {
        secret: process.env.JWT_SECRET,
      });
      request["user"] = this.accountStore.getView();
    } catch {
      throw new UnauthorizedException("Invalid token");
    }

    return true;
  }

  /**
   * token 来源（三种通道）：
   * - Authorization: Bearer（常规请求）
   * - query `?token=`（图片等资源请求）
   * - cookie `ws_token`（html-preview 子资源请求）
   */
  private extractTokenFromHeader(request: Request): string | undefined {
    const [type, token] = request.headers.authorization?.split(" ") ?? [];
    if (type === "Bearer" && token) {
      return token;
    }
    const queryToken = request.query?.token;
    if (typeof queryToken === "string" && queryToken) {
      return queryToken;
    }
    const cookies = (request as any).cookies;
    if (cookies?.ws_token) {
      return cookies.ws_token;
    }
    return undefined;
  }
}

/** 供非 HTTP 通道（WebSocket 等）复用：校验 token 并返回账户视图 */
export async function verifyTokenToAccount(
  jwtService: JwtService,
  accountStore: AccountFileStore,
  token: string,
): Promise<AccountView | null> {
  try {
    await jwtService.verifyAsync(token, { secret: process.env.JWT_SECRET });
    await accountStore.ensureReady();
    return accountStore.getView();
  } catch {
    return null;
  }
}
