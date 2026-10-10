/**
 * 压缩协调器（对齐 deepseek-harness：agent 循环零压缩逻辑，能力插件订阅钩子）
 *
 * 订阅 agent 钩子：
 * - agent/pre_step：预步骤压力触发（返回 enter.messages=压缩后刷新消息，或 undefined 旁路）
 * - agent/request_error：上下文溢出恢复（识别溢出错误 → force 压缩 → 返回 { kind: 'retry' }）
 *
 * 编排委托 CompactionService（v1.3：压缩编排彻底移出会话，只经 CompactionDataSource 窄接口操作）。
 * 状态：溢出重试计数（每会话，上限 1 防死循环；压力解除时重置）。
 * 流内事件（compression_start/error/compaction_summary）经 sessionContext.publishStream 直发
 * （唯一发布面，对齐 DSH session.append 深层直发）；compaction.before 事件由 CompactionService
 * 在确认二级压缩后发射（parallel 等待记忆同步等订阅者完成，payload 携带全量 ISessionContext
 * 供影子轮次使用）——协调器只透传钩子 payload 来源（hook 选项），不感知发射细节。
 */
import { Injectable, Logger } from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";
import { isContextWindowExceeded } from "../../llm-core/utils/retry-on-error.util";
import { CompactionService } from "./compaction.service";
import type { CompactionDataSource } from "./types";
import { CompactionCancelledError } from "./compaction-cancelled.error";
import type { ISessionContext } from "../session-context";
import type { Message } from "../../../common/types/conversation.types";
import {
  HOOKS,
  type PreStepPayload,
  type RequestErrorAction,
  type RequestErrorPayload,
} from "../types/hooks.contract";
import type {
  CompressionStartEvent,
  CompressionErrorEvent,
  CompressionEndEvent,
  CompactionSummaryEvent,
} from "../types/event-chunk.types";

export interface CompactionOutcome {
  messages: Message[] | null;
  didRun: boolean;
}

export interface MaybeCompressOptions {
  abortSignal?: AbortSignal;
  /** 强制压缩（跳过 triggerRatio 阈值判断） */
  force?: boolean;
  /** 触发方式（前端展示） */
  reason?: "auto" | "manual" | "overflow";
}

@Injectable()
export class CompactionCoordinatorService {
  private readonly logger = new Logger(CompactionCoordinatorService.name);
  /** 溢出恢复重试计数（每会话；压力解除时重置，防死循环） */
  private readonly overflowRetries = new Map<string, number>();
  private static readonly MAX_OVERFLOW_RETRIES = 1;

  constructor(
    private readonly compactionService: CompactionService,
  ) {}

  /**
   * 预步骤压力触发（agent/pre_step 钩子，副作用管线）
   *
   * 只做副作用（压力压缩原地改写会话存储），返回 void 放行——
   * agent-engine 在钩子后重读 getMessages() 即得压缩后消息（对齐 DSH：请求消息派生自会话 surface）。
   */
  @OnEvent(HOOKS.PRE_STEP)
  async onPreStep(payload: PreStepPayload): Promise<void> {
    const outcome = await this.maybeCompress(payload.sessionContext, {
      abortSignal: payload.abortSignal,
      reason: "auto",
    });
    // 压力未触发（didRun=false）→ 上下文已瘦，重置溢出重试计数
    if (!outcome.didRun) {
      this.overflowRetries.delete(payload.sessionContext.sessionId);
    }
  }

  /** 上下文溢出恢复（agent/request_error 钩子） */
  @OnEvent(HOOKS.REQUEST_ERROR)
  async onRequestError(
    payload: RequestErrorPayload,
  ): Promise<RequestErrorAction> {
    if (!isContextWindowExceeded(payload.error)) return undefined;
    const sessionId = payload.sessionContext.sessionId;
    const retries = this.overflowRetries.get(sessionId) ?? 0;
    if (retries >= CompactionCoordinatorService.MAX_OVERFLOW_RETRIES) {
      return undefined; // 已恢复过一次仍溢出 → 保留原始错误
    }
    this.logger.warn("[overflow] context window exceeded, compacting and retrying");
    const outcome = await this.maybeCompress(payload.sessionContext, {
      abortSignal: payload.abortSignal,
      force: true,
      reason: "overflow",
    });
    if (outcome.didRun) {
      this.overflowRetries.set(sessionId, retries + 1);
      return { kind: "retry" };
    }
    return undefined;
  }

  /**
   * 执行压缩（自动/手动/溢出路径共用）。
   * 编排委托 CompactionService；会话经 CompactionDataSource 窄接口操作（内部窄化）。
   * 自动/溢出路径由钩子调用；手动路径（HTTP 端点，不在流内）由 session.service 直接调用——
   * 手动路径无活跃流，publishStream 静默丢弃（publish 的 isRunning 守卫）。
   */
  async maybeCompress(
    context: ISessionContext,
    opts: MaybeCompressOptions = {},
  ): Promise<CompactionOutcome> {
    // 会话经 CompactionDataSource 窄接口操作（JsonlSessionContext 同时实现两接口）
    const ds = context as unknown as CompactionDataSource;

    // 0. 档位关闭（enabled=false）：非 force 直接旁路，不发 compression_start；
    //    force（手动/溢出恢复）不受门控，保留逃生口
    if (!opts.force && ds.getCompressionConfig().enabled === false) {
      return { messages: null, didRun: false };
    }

    // 1. 决策（force=溢出恢复路径，跳过阈值）——委托 CompactionService
    if (!opts.force && !(await this.compactionService.shouldCompress(ds))) {
      return { messages: null, didRun: false };
    }

    await context.publishStream({
      type: "compression_start",
      reason: opts.reason ?? "auto",
    } as CompressionStartEvent);

    try {
      const outcome = await this.compactionService.compress(ds, {
        abortSignal: opts.abortSignal,
        force: opts.force,
        // 钩子 payload 来源：确认需要二级压缩后由 CompactionService 发 compaction.before
        // （事件通道，替代旧 onBeforeCompaction 回调穿透；协调器不再感知发射细节）
        hook: { sessionContext: context },
      });
      // 压缩运行结束：统一广播 compression_end（compacted 与纯裁剪都发）携带压缩后占用与本次结果，
      // 前端据此即时更新上下文使用率环形指示器并展示"做了什么"（无需 REST）。
      await context.publishStream({
        type: "compression_end",
        reason: opts.reason ?? "auto",
        ...(outcome.contextStats
          ? { contextStats: outcome.contextStats }
          : {}),
        ...(outcome.pruneEvents === undefined
          ? {}
          : { pruneEvents: outcome.pruneEvents }),
        compacted: outcome.compacted,
        shadowedCount: outcome.shadowedCount,
        ...(outcome.skipReason === undefined
          ? {}
          : { skipReason: outcome.skipReason }),
      } as CompressionEndEvent);
      // 压缩完成（仅遮蔽路径）：广播遮蔽信息（compaction_summary，与瞬态 compression_start/error 区分）。
      // 前端据此标记"已压缩"消息 + 生成压缩占位（live 路径实时对齐，刷新靠 replay 页重建）。
      // 遮蔽表示为分界点消息 id（shadowedEndId，一个值）+ 条数——前端标记的唯一依据。
      if (outcome.compacted && (outcome.shadowedCount ?? 0) > 0) {
        await context.publishStream({
          type: "compaction_summary",
          messageId: outcome.summaryMessageId,
          shadowedEndId: outcome.shadowedEndId,
          shadowedCount: outcome.shadowedCount,
          summary: outcome.summary ?? "",
          ...(outcome.contextStats ? { contextStats: outcome.contextStats } : {}),
        } as CompactionSummaryEvent);
      }
      return { messages: outcome.messages, didRun: true };
    } catch (e: any) {
      // 取消（用户中止维护流）与失败区分记录并随事件下发；
      // abortSignal 主判据（覆盖 OpenAI SDK 的 APIUserAbortError 等各类中止错误名），
      // compression_error 照常广播，前端移除"压缩中"占位卡并按 cancelled 决定提示形态
      const cancelled =
        opts.abortSignal?.aborted === true ||
        e instanceof CompactionCancelledError ||
        e?.name === "CompactionCancelledError" ||
        e?.name === "AbortError";
      if (cancelled) {
        this.logger.log(`[compaction] cancelled by user: ${e?.message ?? e}`);
      } else {
        this.logger.error(`[compaction] failed: ${e?.message ?? e}`);
      }
      await context.publishStream({
        type: "compression_error",
        error: e?.message ?? String(e),
        ...(cancelled ? { cancelled: true } : {}),
      } as CompressionErrorEvent);
      return { messages: null, didRun: true };
    }
  }
}
