import { Observable, Subject } from 'rxjs';
import {
  IBotPlatform,
  BotConfig,
  BotMessage,
  BotResponse,
  BotStatus,
  PlatformCapabilities,
  BotDisconnectEvent,
} from '../interfaces/bot-platform.interface';

/**
 * 机器人适配器基类
 * 
 * 提供通用的事件发射器管理，消除各适配器的重复代码
 * 子类只需实现平台特定的连接、消息发送等逻辑
 */
export abstract class BaseBotAdapter implements IBotPlatform {
  protected messageSubject: Subject<BotMessage>;
  protected disconnectSubject: Subject<BotDisconnectEvent>;
  protected connectSubject: Subject<void>;
  protected status: BotStatus = BotStatus.STOPPED;
  protected config: BotConfig | null = null;

  constructor() {
    this.messageSubject = new Subject<BotMessage>();
    this.disconnectSubject = new Subject<BotDisconnectEvent>();
    this.connectSubject = new Subject<void>();
  }

  /**
   * 获取平台名称（子类必须实现）
   */
  abstract getPlatform(): string;

  /**
   * 获取平台能力（子类必须实现）
   */
  abstract getCapabilities(): PlatformCapabilities;

  /**
   * 连接到机器人平台（子类必须实现）
   */
  abstract connect(config: BotConfig): Promise<void>;

  /**
   * 发送消息（子类必须实现）
   */
  abstract sendMessage(response: BotResponse): Promise<void>;

  /**
   * 关闭连接（子类必须实现）
   */
  abstract shutdown(): Promise<void>;

  /**
   * 重连（子类可选实现，默认抛出异常）
   */
  async reconnect(): Promise<void> {
    throw new Error('Reconnect not implemented for this platform');
  }

  /**
   * 监听消息事件
   */
  onMessage(): Observable<BotMessage> {
    return this.messageSubject.asObservable();
  }

  /**
   * 监听连接成功事件
   */
  onConnect(): Observable<void> {
    return this.connectSubject.asObservable();
  }

  /**
   * 监听断开连接事件
   */
  onDisconnect(): Observable<BotDisconnectEvent> {
    return this.disconnectSubject.asObservable();
  }

  /**
   * 获取当前状态
   */
  getStatus(): BotStatus {
    return this.status;
  }

  /**
   * 发射消息事件（供子类调用）
   */
  protected emitMessage(message: BotMessage): void {
    this.messageSubject.next(message);
  }

  /**
   * 发射连接成功事件（供子类调用）
   */
  protected emitConnected(): void {
    this.connectSubject.next();
  }

  /**
   * 发射断开连接事件（供子类调用）
   */
  protected emitDisconnected(event: BotDisconnectEvent): void {
    this.disconnectSubject.next(event);
  }

  /**
   * 下载消息附件到指定目录（可选实现，默认返回空数组）
   * @param message 机器人消息
   * @param saveDir 保存目录的绝对路径
   * @returns 下载后的本地路径列表
   */
  async downloadAttachment(_message: BotMessage, _saveDir: string): Promise<string[]> {
    return [];
  }

  /**
   * 完成所有 Subject（供子类在 shutdown 时调用）
   */
  protected completeSubjects(): void {
    this.messageSubject.complete();
    this.disconnectSubject.complete();
    this.connectSubject.complete();
  }
}
