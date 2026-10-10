import { delay } from "./internal/async-tools";
import {
    ILINK_LONG_WAIT_MS,
    ILINK_RETRY_INITIAL_MS,
    ILINK_RETRY_MAX_MS,
} from "./internal/config";
import { GatewayFault, StaleCredentialFault } from "./internal/errors";
import type { CredentialBlob, PollingOptions } from "./protocol/chat-event";
import type { InboundWirePacket } from "./protocol/wire-models";
import type { IlinkJsonTransport } from "./transport/ilink-json-transport";

export interface PollingLoopContext {
    transport: IlinkJsonTransport;
    session: CredentialBlob;
    options: PollingOptions;
    signal: AbortSignal;
    isCurrent(): boolean;
    persist(): Promise<void>;
    ingest(event: InboundWirePacket): Promise<unknown>;
    credentialStale(error: StaleCredentialFault): Promise<void>;
    reportError(error: unknown): void;
}

/** 执行单个 generation 的无限长轮询；代际与中止状态均由宿主管理。 */
export async function runPollingLoop(context: PollingLoopContext): Promise<void> {
    let ceiling = context.options.timeoutMs ?? ILINK_LONG_WAIT_MS;
    const initialDelay =
        context.options.retryInitialDelayMs ?? context.options.retryDelayMs ?? ILINK_RETRY_INITIAL_MS;
    let retryDelay = initialDelay;
    const retryMax = Math.max(initialDelay, context.options.retryMaxDelayMs ?? ILINK_RETRY_MAX_MS);
    while (context.isCurrent() && !context.signal.aborted) {
        try {
            const batch = await context.transport.pullUnreadBatch(
                context.session.syncBuffer ?? "",
                ceiling,
                context.signal,
            );
            if ((batch.errcode ?? batch.ret ?? 0) === -14) {
                throw new StaleCredentialFault(batch.errmsg ?? "凭证失效");
            }
            if ((batch.errcode ?? 0) !== 0 || (batch.ret ?? 0) !== 0) {
                throw new GatewayFault(
                    "GET_UPDATES_FAILED",
                    `getupdates 异常 ret=${String(batch.ret ?? "")} errcode=${String(batch.errcode ?? "")}`,
                );
            }
            if (batch.longpolling_timeout_ms && batch.longpolling_timeout_ms > 0) {
                ceiling = batch.longpolling_timeout_ms;
            }
            for (const event of batch.msgs ?? []) {
                try {
                    await context.ingest(event);
                } catch (error) {
                    if (error instanceof GatewayFault && error.code === "INVALID_EVENT") {
                        // 无法形成稳定身份的毒事件即使重拉也无法恢复，只隔离这一类输入。
                        context.reportError(error);
                        continue;
                    }
                    throw error;
                }
            }
            // 只有全部非毒事件成功投递后才提交；持久化失败必须回滚内存游标。
            if (typeof batch.get_updates_buf === "string") {
                const previousBuffer = context.session.syncBuffer;
                context.session.syncBuffer = batch.get_updates_buf;
                try {
                    await context.persist();
                } catch (error) {
                    context.session.syncBuffer = previousBuffer;
                    throw error;
                }
            }
            retryDelay = initialDelay;
        } catch (error) {
            if (context.signal.aborted || !context.isCurrent()) break;
            if (error instanceof StaleCredentialFault) {
                await context.credentialStale(error);
                break;
            }
            context.reportError(error);
            await delay(retryDelay, context.signal);
            retryDelay = Math.min(retryDelay * 2, retryMax);
        }
    }
}
