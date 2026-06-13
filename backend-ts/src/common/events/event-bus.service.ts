import { Injectable } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";

/**
 * 全局事件总线服务
 *
 * 对 @nestjs/event-emitter 的薄封装，供业务模块使用。
 * 避免业务代码直接依赖 EventEmitter2，便于未来替换底层实现。
 */
@Injectable()
export class EventBusService {
  constructor(private readonly eventEmitter: EventEmitter2) {}

  /**
   * 发布事件
   * @param event 事件名（如 stream.finished, session.created）
   * @param payload 事件负载
   */
  emit<T>(event: string, payload: T): void {
    this.eventEmitter.emit(event, payload);
  }
}
