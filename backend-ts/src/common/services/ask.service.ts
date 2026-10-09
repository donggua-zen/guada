/**
 * AskService - 统一人机交互服务（审批 / 询问共用一个闭环）
 *
 * 审批是 ask 的特例：requestApproval = 预置单问题（同意/拒绝/自定义回复）+ 答案解释器。
 * 无超时：等待只有两种终结——用户应答（POST /chat/respond 经 InteractionWaitService 唤醒）
 * 或用户停止（abortSignal 竞速胜出）。
 *
 * 闭环：requestId(uuid) → 审计 ask/asked → 直发 ask_requested（eventBuffer 可重放 + SSE 直投）
 *       → 原地等待 → 审计 ask/answered（cancelled 标记）→ 直发 ask_resolved（多窗口收卡）
 *       → 返回答案；拒绝/取消抛 AskDeniedError（终局，工具层以 isError tool-result 反馈模型）。
 */

import { Injectable, Logger } from "@nestjs/common";
import { InteractionWaitService } from "./interaction-wait.service";
import type { AskAnswerItem, AskRequest, AskSession } from "../types/ask.types";
import { AskDeniedError } from "../types/ask.types";

/** 命令审批的三个选项（前端按 label 原样渲染） */
export const COMMAND_ALLOW_ONCE = "本次允许";
export const COMMAND_ALLOW_SESSION = "本会话内始终允许";
export const COMMAND_DENY = "拒绝";

@Injectable()
export class AskService {
  private readonly logger = new Logger(AskService.name);

  constructor(private readonly wait: InteractionWaitService) {}

  /**
   * 发起一次交互并原地等待答案（多问题整批提交，前端分页收集）。
   *
   * @returns 答案批（与 questions 逐 id 对应）
   * @throws AskDeniedError('cancelled') 用户停止（abort 竞速胜出）
   */
  async ask(
    session: AskSession,
    request: AskRequest,
    abortSignal?: AbortSignal,
  ): Promise<AskAnswerItem[]> {
    if (!request.questions || request.questions.length === 0) {
      throw new Error("ask requires at least one question");
    }
    if (abortSignal?.aborted) {
      throw new AskDeniedError("用户已停止", "cancelled");
    }

    const requestId = crypto.randomUUID();

    // 1. 审计 ask/asked（持久事件；先入库后发事件）
    try {
      await session.appendAskAsked({
        requestId,
        kind: request.kind,
        title: request.title,
        questions: request.questions,
      });
    } catch (e: any) {
      this.logger.warn(`[ask] appendAskAsked failed: ${e?.message ?? e}`);
    }

    // 2. 直发请求帧（eventBuffer 可重放 + SSE 直投）
    await session.publishStream({
      type: "ask_requested",
      requestId,
      kind: request.kind,
      title: request.title,
      toolCallId: request.toolCallId,
      toolName: request.toolName,
      questions: request.questions,
    });

    // 3. 原地等待（无超时；仅与 abortSignal 竞速——用户"停止"撤回等待）
    const answersPromise = this.wait.waitForAnswers(
      session.sessionId,
      requestId,
      request.questions,
    );
    let resolveAbort!: (value: "abort") => void;
    const abortPromise = new Promise<"abort">((resolve) => {
      resolveAbort = resolve;
    });
    const onAbort = () => resolveAbort("abort");
    abortSignal?.addEventListener("abort", onAbort, { once: true });

    let result: AskAnswerItem[] | "abort";
    try {
      result = await Promise.race([answersPromise, abortPromise]);
    } finally {
      abortSignal?.removeEventListener("abort", onAbort);
    }

    if (result === "abort") {
      this.wait.cancel(session.sessionId, requestId);
      try {
        await session.appendAskAnswered({ requestId, cancelled: true });
      } catch (e: any) {
        this.logger.warn(`[ask] appendAskAnswered failed: ${e?.message ?? e}`);
      }
      await session.publishStream({
        type: "ask_resolved",
        requestId,
        outcome: "cancelled",
      });
      throw new AskDeniedError("用户已停止", "cancelled");
    }

    // 4. 审计 ask/answered + 终结帧（多窗口收卡）
    try {
      await session.appendAskAnswered({ requestId, answers: result });
    } catch (e: any) {
      this.logger.warn(`[ask] appendAskAnswered failed: ${e?.message ?? e}`);
    }
    await session.publishStream({
      type: "ask_resolved",
      requestId,
      outcome: "answered",
    });

    return result;
  }

  /**
   * 审批便捷方法（ask 的特例）：预置单问题「是否同意？」（同意 / 拒绝 / 自定义回复）。
   *
   * @throws AskDeniedError('rejected', feedback) 拒绝或自定义回复——feedback 为用户文本
   *         （无自定义时为缺省拒绝文案），工具层以 isError tool-result 反馈模型
   * @throws AskDeniedError('cancelled') 用户停止
   */
  async requestApproval(
    session: AskSession,
    params: {
      toolCallId?: string;
      toolName?: string;
      /** 审批标题/理由（卡片标题 + 问题支撑文本） */
      detail?: string;
      abortSignal?: AbortSignal;
    },
  ): Promise<void> {
    const answers = await this.ask(
      session,
      {
        kind: "approval",
        title: "需要审批",
        toolCallId: params.toolCallId,
        toolName: params.toolName,
        questions: [
          {
            id: "approval",
            question: "是否同意？",
            detail: params.detail,
            options: [{ label: "同意" }, { label: "拒绝" }],
          },
        ],
      },
      params.abortSignal,
    );

    const answer = answers[0];
    // 自定义回复 = 拒绝 + 用户文本反馈模型
    if (answer.custom && answer.custom.trim()) {
      throw new AskDeniedError(answer.custom.trim(), "rejected", answer.custom.trim());
    }
    if (answer.selected.includes("同意")) return;
    throw new AskDeniedError("用户拒绝了该请求", "rejected");
  }

  /**
   * 命令审批（Windows 命令策略层用）：本次允许 / 本会话内始终允许 / 拒绝。
   *
   * 与 requestApproval 分开是为了不动既有调用方（文件写入 / 计划审批仍是两选一）。
   * 「本会话内始终允许」的记账在调用方（command-policy 的内存表），这里只负责问。
   *
   * @throws AskDeniedError('rejected', feedback) 拒绝或自定义回复
   * @throws AskDeniedError('cancelled') 用户停止
   */
  async requestCommandApproval(
    session: AskSession,
    params: {
      toolCallId?: string;
      /** 待批准的命令原文（展示在审批卡里） */
      command: string;
      /** 为什么需要批准（不在白名单的原因） */
      reason?: string;
      abortSignal?: AbortSignal;
    },
  ): Promise<"once" | "session"> {
    const answers = await this.ask(
      session,
      {
        kind: "approval",
        title: "命令需要批准",
        toolCallId: params.toolCallId,
        toolName: "run_command",
        questions: [
          {
            id: "command-approval",
            question: "是否允许执行这条命令？",
            detail: [params.reason, "", params.command]
              .filter((part) => part !== undefined)
              .join("\n"),
            options: [
              { label: COMMAND_ALLOW_ONCE, description: "仅本次执行" },
              {
                label: COMMAND_ALLOW_SESSION,
                description: "本会话内遇到完全相同的命令不再询问",
              },
              { label: COMMAND_DENY, description: "不执行，并把拒绝反馈给模型" },
            ],
          },
        ],
      },
      params.abortSignal,
    );

    const answer = answers[0];
    // 自定义回复 = 拒绝 + 用户文本反馈模型（与 requestApproval 同语义）
    if (answer.custom && answer.custom.trim()) {
      throw new AskDeniedError(answer.custom.trim(), "rejected", answer.custom.trim());
    }
    if (answer.selected.includes(COMMAND_ALLOW_SESSION)) return "session";
    if (answer.selected.includes(COMMAND_ALLOW_ONCE)) return "once";
    throw new AskDeniedError("用户拒绝执行该命令", "rejected");
  }
}
