/**
 * 自定义错误类
 *
 * 用于在 API 拦截器中替代动态附加属性到 Error 实例的写法，
 * 使错误类型在编译期可被 TypeScript 追踪。
 */

export class NetworkError extends Error {
  readonly isNetworkError = true;

  constructor(message: string) {
    super(message);
    this.name = "NetworkError";
  }
}

export class AuthError extends Error {
  readonly isAuthError = true;
  readonly statusCode: number;

  constructor(message: string, statusCode = 401) {
    super(message);
    this.name = "AuthError";
    this.statusCode = statusCode;
  }
}

export class ApiError extends Error {
  readonly statusCode?: number;

  constructor(message: string, statusCode?: number) {
    super(message);
    this.name = "ApiError";
    this.statusCode = statusCode;
  }
}
