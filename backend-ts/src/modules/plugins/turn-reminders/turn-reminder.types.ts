/**
 * 每轮提醒 provider（Turn Reminder Provider）。
 *
 * 引擎在每次 LLM 迭代前向 registry 收集提醒，provider 自行决定：
 * - `persist`：需要写入会话历史的消息（完整指导、退出说明等，可审计）；
 * - `transient`：只追加到本次请求的临时消息（稀疏提醒等，不落库）。
 *
 * 引擎只认识这个通用契约，不感知具体插件（如计划模式）。
 */
import type { Message } from "../../../common/types/conversation.types";
import type { ISessionContext } from "../../chat/session-context";

export interface TurnReminderProviderInput {
  sessionContext: ISessionContext;
  /** 单次 run 内的 LLM 迭代序号（从 1 开始） */
  iterationCount: number;
  /** 本轮迭代开始时的可见历史（压缩已生效） */
  history: readonly Message[];
}

export interface TurnReminderInjection {
  /** 请求前写入会话历史的消息（由引擎 appendMessages 后重读历史） */
  persist?: Message[];
  /** 只追加到本次请求尾部的临时消息（不落库） */
  transient?: Message[];
}

export interface TurnReminderProvider {
  /** 插件内唯一 id（同一插件重复注册时按 id 覆盖） */
  id: string;
  /** 执行顺序，越小越先；缺省 0 */
  order?: number;
  build(
    input: TurnReminderProviderInput,
  ): TurnReminderInjection | Promise<TurnReminderInjection>;
}

export interface RegisteredTurnReminderProvider {
  pluginId: string;
  provider: TurnReminderProvider;
}
