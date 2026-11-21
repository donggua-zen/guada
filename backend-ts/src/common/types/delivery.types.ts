/**
 * 消息投递时机（会话级通用能力，不区分人类用户与主代理）
 *
 * 同一份队列承载所有"追加到运行中会话"的消息，唯一差异是投递时机：
 * - queue     ：排队，等当前回合自然结束再发（默认）
 * - inject    ：当前回合跑到「工具批次执行完、本该发起下一次 LLM 请求」的边界时，
 *               结束本回合并以该消息开启新回合（不注入当前请求）
 * - interrupt ：立即中止当前回合（abort），随后以该消息开启新回合
 *
 * 子代理收到的"主代理补充指令"同样是 inject 投递，只通过 MessageSource.kind
 * ('coordinator') 区分来源，不另建通道。
 */
export type DeliveryMode = "queue" | "inject" | "interrupt";

export const DEFAULT_DELIVERY_MODE: DeliveryMode = "queue";

export function normalizeDeliveryMode(value: unknown): DeliveryMode {
  return value === "inject" || value === "interrupt" || value === "queue"
    ? value
    : DEFAULT_DELIVERY_MODE;
}
