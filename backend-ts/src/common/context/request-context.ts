import { AsyncLocalStorage } from 'async_hooks';

/**
 * 请求上下文接口
 * 
 * 用于在异步调用链中自动传递请求级数据，避免层层透传参数。
 * 基于 Node.js 的 AsyncLocalStorage API 实现。
 */
export interface RequestContextData {
  /** 中止信号，用于客户端断开连接时中止所有相关操作 */
  abortSignal?: AbortSignal;
  
  /** 会话 ID */
  sessionId?: string;
  
  /** 请求唯一标识 */
  requestId: string;
  
  /** 请求开始时间 */
  startTime: Date;
}

/**
 * AsyncLocalStorage 实例
 * 
 * 单例模式，整个应用共享一个存储实例。
 * 每个请求会在独立的上下文中执行，互不干扰。
 */
const storage = new AsyncLocalStorage<RequestContextData>();

/**
 * 请求上下文管理工具
 * 
 * 提供便捷的 API 来设置、获取和操作请求上下文。
 * 
 * 使用示例：
 * ```typescript
 * // 在入口处设置上下文
 * RequestContext.run(
 *   { abortSignal, sessionId, requestId: crypto.randomUUID() },
 *   () => {
 *     // 内部任何地方都可以访问上下文
 *     const signal = RequestContext.abortSignal();
 *   }
 * );
 * 
 * // 在服务中获取信号
 * const abortSignal = RequestContext.abortSignal();
 * 
 * // 检查是否已中止
 * RequestContext.checkAborted();
 * ```
 */
export const RequestContext = {
  /**
   * 在请求上下文中执行函数
   * 
   * 该方法会创建一个新的异步上下文，并在其中执行提供的回调函数。
   * 回调函数及其所有异步调用都可以访问该上下文。
   * 
   * @param context 上下文数据（不包含 startTime，会自动添加）
   * @param fn 要执行的函数
   * @returns 函数的返回值
   * 
   * @example
   * ```typescript
   * const result = RequestContext.run(
   *   { abortSignal, sessionId, requestId: 'req-123' },
   *   () => someAsyncOperation()
   * );
   * ```
   */
  run<T>(context: Omit<RequestContextData, 'startTime'>, fn: () => T): T {
    return storage.run(
      { ...context, startTime: new Date() },
      fn
    );
  },

  /**
   * 获取当前请求上下文
   * 
   * 如果在上下文之外调用，返回 undefined。
   * 
   * @returns 当前请求上下文数据，或 undefined
   * 
   * @example
   * ```typescript
   * const ctx = RequestContext.current();
   * if (ctx) {
   *   console.log(`Request ${ctx.requestId} started at ${ctx.startTime}`);
   * }
   * ```
   */
  current(): RequestContextData | undefined {
    return storage.getStore();
  },

  /**
   * 获取当前请求的中止信号
   * 
   * 这是最常用的方法，用于在深层调用中检查是否需要中止操作。
   * 
   * @returns 中止信号，或 undefined（如果不在上下文中）
   * 
   * @example
   * ```typescript
   * async function longRunningTask() {
   *   const abortSignal = RequestContext.abortSignal();
   *   
   *   for (const item of largeDataset) {
   *     if (abortSignal?.aborted) {
   *       throw new Error('Task aborted');
   *     }
   *     await processItem(item);
   *   }
   * }
   * ```
   */
  abortSignal(): AbortSignal | undefined {
    return storage.getStore()?.abortSignal;
  },

  /**
   * 检查当前请求是否已中止
   * 
   * 如果已中止，抛出异常。这是一种便捷的中止检查方式。
   * 
   * @throws Error 如果请求已中止
   * 
   * @example
   * ```typescript
   * async function compressHistory(messages: MessageRecord[]) {
   *   // 在关键操作前检查
   *   RequestContext.checkAborted();
   *   
   *   const stream = llmService.completions({ messages });
   *   
   *   for await (const chunk of stream) {
   *     // 每次迭代都检查
   *     RequestContext.checkAborted();
   *     processChunk(chunk);
   *   }
   * }
   * ```
   */
  checkAborted(): void {
    const signal = storage.getStore()?.abortSignal;
    if (signal?.aborted) {
      throw new Error('Request aborted');
    }
  },

  /**
   * 获取当前请求已耗时（毫秒）
   * 
   * 用于性能监控和超时控制。
   * 
   * @returns 从请求开始到现在的毫秒数，如果不在上下文中则返回 0
   * 
   * @example
   * ```typescript
   * const elapsed = RequestContext.elapsedMs();
   * if (elapsed > 30000) {
   *   logger.warn(`Request taking too long: ${elapsed}ms`);
   * }
   * ```
   */
  elapsedMs(): number {
    const ctx = storage.getStore();
    return ctx ? Date.now() - ctx.startTime.getTime() : 0;
  },
};
