import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from "@nestjs/common";
import { Observable } from "rxjs";
import { tap } from "rxjs/operators";
import { Request } from "express";

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

  constructor() {
    const envValue = process.env.ENABLE_REQUEST_TIMING?.toLowerCase();
    this.isEnabled = true;
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    // 未开启则直接放行，不做任何处理
    if (!this.isEnabled) {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<Request>();
    const method = request.method;
    const url = request.originalUrl || request.url;
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
