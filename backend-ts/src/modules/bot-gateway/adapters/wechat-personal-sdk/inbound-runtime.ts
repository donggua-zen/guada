import type { EventEmitter } from "node:events";

import { GatewayFault } from "./internal/errors";
import { mapInboundWirePacket } from "./protocol/inbound-mapper";
import { AuthorKind } from "./protocol/wire-models";
import type { InboundWirePacket } from "./protocol/wire-models";
import type { NormalizedChatEvent, OnTextListener } from "./protocol/chat-event";

export interface RegexBinding {
    pattern: RegExp;
    listener: OnTextListener;
}

/**
 * SDK 边界只接受可定位、可回复的真实消息，避免污染上下文与媒体缓存。
 *
 * 与上游 onebots 的严格版本相比，这里刻意放宽 `message_type`：只把显式的 BOT
 * 副本（`AuthorKind.Bot`）排除在外，缺失或未知 `message_type` 一律按用户消息处理，
 * 以免误丢真实用户消息。其余结构校验保持严格。
 */
export function assertInboundWirePacket(value: unknown): asserts value is InboundWirePacket {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new GatewayFault("INVALID_EVENT", "iLink 事件必须是对象");
    }
    const event = value as Record<string, unknown>;
    if (
        event.message_type !== AuthorKind.Bot &&
        (typeof event.from_user_id !== "string" || !event.from_user_id.trim())
    ) {
        throw new GatewayFault("INVALID_EVENT", "iLink 用户事件缺少 from_user_id");
    }
    const hasNumericId =
        (typeof event.message_id === "number" && Number.isFinite(event.message_id)) ||
        (typeof event.seq === "number" && Number.isFinite(event.seq));
    const hasClientId = typeof event.client_id === "string" && Boolean(event.client_id.trim());
    if (!hasNumericId && !hasClientId) {
        throw new GatewayFault("INVALID_EVENT", "iLink 事件缺少 message_id、seq 或 client_id");
    }
    if (event.item_list !== undefined && !Array.isArray(event.item_list)) {
        throw new GatewayFault("INVALID_EVENT", "iLink 事件 item_list 必须是数组");
    }
    if (
        Array.isArray(event.item_list) &&
        event.item_list.some(item => !item || typeof item !== "object" || Array.isArray(item))
    ) {
        throw new GatewayFault("INVALID_EVENT", "iLink 事件 item_list 只能包含对象");
    }
    // 刻意不校验 group_id 与 context_token：线上私聊事件会把 group_id 传成空串，
    // 且二者都可能为 null。它们既不是处理消息的必需字段（映射层用 ?? "" 与可选链兜底），
    // 一旦拒绝就会把真实用户消息当毒事件丢掉。
}

/**
 * 生成一条入站事件在当前机器人会话内稳定的投递键。
 *
 * iLink 在不同消息形态下可能只提供 message_id、seq 或 client_id 之一；优先采用
 * 服务端标识，并把发送方纳入键空间，避免不同会话之间的局部序号相互碰撞。
 */
export function inboundEventKey(event: InboundWirePacket): string {
    const sender = event.from_user_id ?? "unknown";
    if (typeof event.message_id === "number") return `message:${sender}:${event.message_id}`;
    if (typeof event.seq === "number") return `sequence:${sender}:${event.seq}`;
    if (typeof event.client_id === "string") return `client:${sender}:${event.client_id}`;
    throw new GatewayFault("INVALID_EVENT", "入站事件缺少可用于确认投递的标识");
}

/** 维护有界事件缓存，供媒体下载动作按 message_id 定位原始句柄。 */
export function rememberRecentMessage(
    cache: Map<string, NormalizedChatEvent>,
    event: NormalizedChatEvent,
): void {
    const messageId = String(event.id ?? event.seq ?? "");
    if (!messageId) return;
    cache.set(messageId, event);
    if (cache.size <= 256) return;
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
}

/** 逐个等待 canonical 监听器；失败会报告诊断事件并阻止上游确认。 */
export async function emitInbound(
    emitter: EventEmitter,
    eventName: string,
    event: NormalizedChatEvent,
): Promise<void> {
    for (const listener of emitter.rawListeners(eventName)) {
        try {
            await Reflect.apply(listener, emitter, [event]);
        } catch (error) {
            reportListenerError(emitter, eventName, error);
            throw new GatewayFault("EVENT_DELIVERY_FAILED", "iLink 事件监听器执行失败", {
                cause: error,
            });
        }
    }
}

export function reportListenerError(
    emitter: EventEmitter,
    eventName: string,
    error: unknown,
): void {
    try {
        emitter.emit("listener_error", { event: eventName, error });
    } catch {
        // listener_error 本身不得再次破坏消息接收；宿主应注册可靠的日志监听器。
    }
}

export async function runTextBindings(
    emitter: EventEmitter,
    bindings: readonly RegexBinding[],
    event: NormalizedChatEvent,
): Promise<void> {
    if (!event.text) return;
    for (const { pattern, listener } of bindings) {
        const match = pattern.exec(event.text);
        pattern.lastIndex = 0;
        if (!match) continue;
        try {
            await listener(event, match);
        } catch (error) {
            reportListenerError(emitter, "text_match", error);
            throw new GatewayFault("EVENT_DELIVERY_FAILED", "iLink 文本绑定执行失败", {
                cause: error,
                operation: "text_match",
            });
        }
    }
}
