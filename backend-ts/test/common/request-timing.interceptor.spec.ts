/**
 * RequestTimingInterceptor 单元测试
 *
 * 覆盖 SSE 长连接的静默规则：@Sse 路由的 observable 只在客户端断开时 complete，
 * 计出来的是连接存活时长，若照常打点会随建连/HMR/重连刷屏（实证：单日 2.9 万条
 * GET /api/v1/events/sessions 记录）。
 */
import { CallHandler, ExecutionContext } from "@nestjs/common";
import { of } from "rxjs";
import { RequestTimingInterceptor } from "../../src/common/interceptors/request-timing.interceptor";

/** 构造最小可用的 ExecutionContext：handler 携带 @Sse 元数据时表示 SSE 路由 */
function createContext(options: {
  url: string;
  isSse?: boolean;
}): ExecutionContext {
  const handler = function handler() {
    /* 占位：仅用于挂载元数据 */
  };
  if (options.isSse) {
    Reflect.defineMetadata("__sse__", true, handler);
  }

  return {
    getHandler: () => handler,
    switchToHttp: () => ({
      getRequest: () => ({ method: "GET", originalUrl: options.url, url: options.url }),
      getResponse: () => ({ statusCode: 200 }),
    }),
  } as unknown as ExecutionContext;
}

describe("RequestTimingInterceptor", () => {
  const originalEnv = process.env.ENABLE_REQUEST_TIMING;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.ENABLE_REQUEST_TIMING;
    } else {
      process.env.ENABLE_REQUEST_TIMING = originalEnv;
    }
    jest.restoreAllMocks();
  });

  function captureLogs(interceptor: RequestTimingInterceptor): string[] {
    const logs: string[] = [];
    jest
      .spyOn(
        (interceptor as unknown as { logger: { log: (msg: string) => void } })
          .logger,
        "log",
      )
      .mockImplementation((msg: string) => {
        logs.push(msg);
      });
    return logs;
  }

  it("SSE 路由完成时不打点", (done) => {
    process.env.ENABLE_REQUEST_TIMING = "true";
    const interceptor = new RequestTimingInterceptor();
    const logs = captureLogs(interceptor);
    const context = createContext({
      url: "/api/v1/events/sessions",
      isSse: true,
    });

    const next: CallHandler = { handle: () => of("ok") };

    interceptor.intercept(context, next).subscribe({
      next: () => {
        /* 消费数据 */
      },
      complete: () => {
        expect(logs).toEqual([]);
        done();
      },
    });
  });

  it("普通路由完成时照常打点", (done) => {
    process.env.ENABLE_REQUEST_TIMING = "true";
    const interceptor = new RequestTimingInterceptor();
    const logs = captureLogs(interceptor);
    const context = createContext({ url: "/api/v1/models" });

    const next: CallHandler = { handle: () => of("ok") };

    interceptor.intercept(context, next).subscribe({
      next: () => {
        /* 消费数据 */
      },
      complete: () => {
        expect(logs).toHaveLength(1);
        expect(logs[0]).toMatch(/^GET \/api\/v1\/models 200 \d+ms$/);
        done();
      },
    });
  });

  it("health 看门狗路由不打点", (done) => {
    process.env.ENABLE_REQUEST_TIMING = "true";
    const interceptor = new RequestTimingInterceptor();
    const logs = captureLogs(interceptor);
    const context = createContext({ url: "/api/v1/health" });

    const next: CallHandler = { handle: () => of("ok") };

    interceptor.intercept(context, next).subscribe({
      next: () => {
        /* 消费数据 */
      },
      complete: () => {
        expect(logs).toEqual([]);
        done();
      },
    });
  });

  it("ENABLE_REQUEST_TIMING 非 true 时整体关闭", (done) => {
    process.env.ENABLE_REQUEST_TIMING = "false";
    const interceptor = new RequestTimingInterceptor();
    const logs = captureLogs(interceptor);
    const context = createContext({ url: "/api/v1/models" });

    const next: CallHandler = { handle: () => of("ok") };

    interceptor.intercept(context, next).subscribe({
      next: () => {
        /* 消费数据 */
      },
      complete: () => {
        expect(logs).toEqual([]);
        done();
      },
    });
  });
});
