import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Observable } from "rxjs";
import { tap } from "rxjs/operators";
import { Request } from "express";

/**
 * @Sse 装饰器写入的元数据键（值同 @nestjs/common 的 SSE_METADATA，
 * 该常量未从包入口导出，故此处复刻；Nest 路由层同样按此键识别 SSE 端点）
 */
const SSE_METADATA = "__sse__";

/**
 * 请求耗时拦截器
 *
 * 通过环境变量 ENABLE_REQUEST_TIMING 控制开关：
 * - 设置为 true/1/yes 时开启
 * - 未设置或其他值时关闭
 *
 * 输出格式: [TIMING] GET /api/v1/users 200 45ms
 */
@Injectable()
export class RequestTimingInterceptor implements NestInterceptor {
  private readonly logger = new Logger("RequestTiming");
  private readonly isEnabled: boolean;
  private readonly reflector = new Reflector();

  constructor() {
    const envValue = process.env.ENABLE_REQUEST_TIMING?.toLowerCase();
    this.isEnabled =
      envValue === "true" || envValue === "1" || envValue === "yes";
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    // 未开启则直接放行，不做任何处理
    if (!this.isEnabled) {
      return next.handle();
    }

    // SSE 长连接不打点：@Sse 路由的 observable 只在客户端断开/服务端关流时 complete，
    // 计出来的是「连接存活时长」而非请求耗时；每个窗口建连、HMR、刷新、重连各留一条，
    // 关闭时集中刷屏 combined 日志。/health 看门狗同理（15s 一次存活探测）。
    const isSse = this.reflector.get<boolean>(
      SSE_METADATA,
      context.getHandler(),
    );
    if (isSse) {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<Request>();
    const method = request.method;
    const url = request.originalUrl || request.url;

    // /health 是 Electron 看门狗的 15s 一次的存活探测，记录会刷屏 combined 日志
    if (url.startsWith("/api/v1/health")) {
      return next.handle();
    }

    const startTime = Date.now();

    return next.handle().pipe(
      tap(() => {
        const duration = Date.now() - startTime;
        const response = context.switchToHttp().getResponse();
        const statusCode = response.statusCode || 200;

        this.logger.log(`${method} ${url} ${statusCode} ${duration}ms`);
      }),
    );
  }
}
