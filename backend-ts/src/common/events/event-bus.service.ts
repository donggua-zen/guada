import { Injectable, Logger } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";

/**
 * 全局事件总线服务
 *
 * 对 @nestjs/event-emitter 的薄封装，供业务模块使用。
 * 避免业务代码直接依赖 EventEmitter2，便于未来替换底层实现。
 *
 * 提供三种调度模式（对齐 deepseek-harness / Cordis dispatch modes，
 * 钩子事件清单见 hooks.contract.ts）：
 * - emit：fire-and-forget 通知（不阻塞、不 veto）
 * - parallel：并发 await 全部监听器，收集返回值（如 turn.stopping 收集续跑消息）
 * - serial：串行 await，首个返回"非 undefined"者接管（短路），undefined 旁路
 *   （如 agent.pre_step / agent.request_error 的决策型钩子）
 *
 * 带 await 的模式均 fail-open：单个监听器抛错只记录日志并继续，绝不 veto 主流程。
 */
@Injectable()
export class EventBusService {
  private readonly logger = new Logger(EventBusService.name);

  constructor(private readonly eventEmitter: EventEmitter2) {}

  /**
   * 发布事件（fire-and-forget 通知，不阻塞、不 veto）
   * @param event 事件名（如 stream.finished, session.created）
   * @param payload 事件负载
   */
  emit<T>(event: string, payload: T): void {
    this.eventEmitter.emit(event, payload);
  }

  /**
   * parallel 调度：并发 await 全部监听器，收集各监听器返回值（保持注册顺序）。
   * 单个监听器抛错只记录日志并继续（fail-open，返回 undefined 不贡献结果）。
   *
   * 语义对齐 DSH parallel：所有订阅者都会执行（如回合关闭前收集全部续跑消息）。
   *
   * @param event 事件名（钩子事件，见 hooks.contract.ts）
   * @param payload 事件负载
   * @returns 各监听器返回值数组（保持注册顺序）
   */
  async parallel<T = unknown>(event: string, payload: unknown): Promise<T[]> {
    const listeners = this.eventEmitter.listeners(event) as Array<
      (p: unknown) => unknown
    >;
    return Promise.all(
      listeners.map(async (listener) => {
        try {
          return (await listener(payload)) as T;
        } catch (e) {
          this.logger.warn(
            `[event-bus] "${event}" listener rejected: ${String(e)}`,
          );
          return undefined as unknown as T;
        }
      }),
    );
  }

  /**
   * serial 调度：串行 await 监听器，首个返回"非 undefined"者接管（短路）。
   * 全部监听器旁路（返回 undefined 或被 fail-open）时返回 fallback()。
   *
   * 语义对齐 DSH serial（bail）：决策型钩子返回非 undefined = 接管
   * （如压缩插件返回 { kind: 'enter' } 让循环用压缩后消息）；undefined = 旁路走默认。
   *
   * @param event 事件名（钩子事件，见 hooks.contract.ts）
   * @param payload 事件负载
   * @param fallback 默认结果（无监听器接管时）
   */
  async serial<T>(
    event: string,
    payload: unknown,
    fallback: () => T | Promise<T>,
  ): Promise<T> {
    const listeners = this.eventEmitter.listeners(event) as Array<
      (p: unknown) => unknown
    >;
    for (const listener of listeners) {
      try {
        const result = (await listener(payload)) as T | undefined;
        if (result !== undefined) return result; // 接管（短路）
      } catch (e) {
        this.logger.warn(
          `[event-bus] hook "${event}" listener rejected: ${String(e)}`,
        );
      }
    }
    return fallback();
  }
}
