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
import { turnApprovalMemory } from "./turn-approval-memory";
import { deriveAllowRule } from "./command-policy";
import type { AskAnswerItem, AskCardKind, AskRequest, AskSession } from "../types/ask.types";
import { AskDeniedError, AUTO_APPROVABLE_CARD_KINDS } from "../types/ask.types";

/** 命令审批的选项（前端按 label 原样渲染） */
export const COMMAND_ALLOW_ONCE = "本次允许";
export const COMMAND_ALLOW_TURN = "本轮内自动放行";
export const COMMAND_ALLOW_PROJECT = "放通此类（本项目）";
export const COMMAND_ALLOW_GLOBAL = "放通此类（全局）";
export const COMMAND_DENY = "拒绝";

/** 文件写入审批的选项（工作区外路径；前端按 label 原样渲染） */
export const WRITE_ALLOW_ONCE = "本次允许";
export const WRITE_ALLOW_TURN = "本轮内自动放行";
export const WRITE_ALLOW_SESSION = "本会话内始终允许该路径";
export const WRITE_DENY = "拒绝";

/**
 * 卡片类型 → "本轮内自动放行"选项的 label（唯一映射）。
 *
 * 返回 undefined = 该类型不参与本轮自动放行（计划审批 / 提问 / 通用审批）。
 * 资格由 `AUTO_APPROVABLE_CARD_KINDS` 白名单兜底，调用方只声明 cardKind。
 */
function turnAllowLabel(cardKind: AskCardKind | undefined): string | undefined {
  if (cardKind === "write-approval") return WRITE_ALLOW_TURN;
  if (cardKind === "command-approval" || cardKind === "sensitive-path") {
    return COMMAND_ALLOW_TURN;
  }
  return undefined;
}

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

    // 本轮自动放行只对白名单内的单问题审批生效：多问题卡需要逐题作答，不能用一个 label 代替
    const autoAllowLabel =
      request.autoApprove === "turn" &&
      request.cardKind !== undefined &&
      AUTO_APPROVABLE_CARD_KINDS.has(request.cardKind) &&
      request.questions.length === 1
        ? turnAllowLabel(request.cardKind)
        : undefined;
    const autoAnswers = (): AskAnswerItem[] =>
      request.questions.map((q) => ({ id: q.id, selected: [autoAllowLabel!] }));

    // 用户本轮已选择"自动放行"：直接按允许返回，不建卡、不写 ask 审计事件
    if (autoAllowLabel && turnApprovalMemory.isAllowed(session.sessionId)) {
      this.logger.log(`[ask] auto-allowed by turn policy: ${request.title ?? request.kind}`);
      return autoAnswers();
    }

    const requestId = crypto.randomUUID();

    // 1. 审计 ask/asked（持久事件；先入库后发事件）
    try {
      await session.appendAskAsked({
        requestId,
        kind: request.kind,
        cardKind: request.cardKind,
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
      cardKind: request.cardKind,
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
      // 恢复卡片（/chat/pending-asks）要用的展示元数据；autoAllowLabel 只在进程内使用
      {
        kind: request.kind,
        cardKind: request.cardKind,
        title: request.title,
        toolCallId: request.toolCallId,
        toolName: request.toolName,
        autoAllowLabel,
      },
    );
    // 竞态兜底：预检与登记之间用户可能刚在另一张卡上点了「本轮内自动放行」，
    // 登记后再确认一次，否则这一路会永久挂起。
    if (autoAllowLabel && turnApprovalMemory.isAllowed(session.sessionId)) {
      this.wait.resolveAnswers(session.sessionId, requestId, autoAnswers());
    }
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
    // 本轮内自动放行：用户已在同一轮里授权过
    if (turnApprovalMemory.isAllowed(session.sessionId)) return;

    const answers = await this.ask(
      session,
      {
        kind: "approval",
        cardKind: "generic-approval",
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
   * 命令审批（Windows 命令策略层用）：本次允许 / 本轮内自动放行 / 放通此类 / 拒绝。
   *
   * 与 requestApproval 分开是为了不动既有调用方（文件写入 / 计划审批仍是两选一）。
   * 「放通此类」会由调用方把推导出的前缀规则写入 policy.yaml（本项目 / 全局），这里只负责问；
   * 「本轮内自动放行」是本轮内存态（不写规则、不落盘），由本方法直接消费。
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
      /** 为什么需要批准（命中哪条判定） */
      reason?: string;
      /**
       * "放通此类"要写入的前缀规则；`undefined` = 由本方法按命令推导；
       * `null` = 不提供放通选项（例如越界类询问——推导出的 `rm *` 会把越界删除也放通）
       */
      allowRule?: string | null;
      /** 规则种类：命令规则（默认）或路径规则（敏感路径放通用） */
      allowRuleKind?: "command" | "path";
      /** 敏感路径卡的补充说明（目标路径 / 操作） */
      pathDetail?: { target: string; op: "read" | "write" | "delete" };
      abortSignal?: AbortSignal;
    },
  ): Promise<"once" | { scope: "project" | "global" }> {
    // 本轮内自动放行：直接放行（不写规则、不建卡）
    if (turnApprovalMemory.isAllowed(session.sessionId)) return "once";

    // 从命令推导"放通此类"的前缀规则（灾难级命令不提供放通选项）
    const rule =
      params.allowRule === undefined ? deriveAllowRule(params.command) : params.allowRule;
    const isPath = params.allowRuleKind === "path";
    const ruleLabel = isPath ? `路径「${rule}」` : `「${rule}」`;
    const options = [
      { label: COMMAND_ALLOW_ONCE, description: "仅本次执行" },
      {
        label: COMMAND_ALLOW_TURN,
        description: "本轮后续所有审批直接通过（下一轮恢复询问）",
      },
      ...(rule
        ? [
            {
              label: COMMAND_ALLOW_PROJECT,
              description: isPath
                ? `把${ruleLabel}加入本项目的放行路径`
                : `把${ruleLabel}写入本项目 .guada/policy.yaml`,
            },
            {
              label: COMMAND_ALLOW_GLOBAL,
              description: isPath
                ? `把${ruleLabel}加入全局放行路径（对所有项目生效）`
                : `把${ruleLabel}写入全局 policy.yaml（对所有项目生效）`,
            },
          ]
        : []),
      {
        label: COMMAND_DENY,
        description: isPath
          ? "不放行（模型会继续用工作区内的方式完成）"
          : "不执行，并把拒绝反馈给模型",
      },
    ];

    const opText = { read: "读取", write: "写入", delete: "删除" } as const;
    const sensitive = params.pathDetail;
    const answers = await this.ask(
      session,
      {
        kind: "approval",
        cardKind: sensitive ? "sensitive-path" : "command-approval",
        title: sensitive ? "敏感文件访问" : "命令需要批准",
        toolCallId: params.toolCallId,
        toolName: "run_command",
        autoApprove: "turn",
        questions: [
          {
            id: "command-approval",
            question: sensitive ? "是否允许这次敏感文件访问？" : "是否允许执行这条命令？",
            detail: [
              sensitive ? `目标：${sensitive.target}（${opText[sensitive.op]}）` : undefined,
              params.reason,
              "",
              params.command,
            ]
              .filter((part) => part !== undefined)
              .join("\n"),
            options,
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
    if (answer.selected.includes(COMMAND_ALLOW_TURN)) {
      this.allowForTurn(session);
      return "once";
    }
    if (answer.selected.includes(COMMAND_ALLOW_PROJECT)) return { scope: "project" };
    if (answer.selected.includes(COMMAND_ALLOW_GLOBAL)) return { scope: "global" };
    if (answer.selected.includes(COMMAND_ALLOW_ONCE)) return "once";
    throw new AskDeniedError("用户拒绝执行该命令", "rejected");
  }

  /**
   * 文件写入审批（工作区外路径；命令策略在文件工具上的对偶）。
   *
   * 模型不能自我提权：越界写在 workspace-write 档由本审批询问用户，
   * read-only 档直接拒绝（不经此处）。「本会话内始终允许该路径」的记账在调用方
   * （write-approval-memory），这里只负责问。
   *
   * @throws AskDeniedError('rejected', feedback) 拒绝或自定义回复
   * @throws AskDeniedError('cancelled') 用户停止
   */
  async requestWriteApproval(
    session: AskSession,
    params: {
      toolCallId?: string;
      toolName: string;
      /** 解析后的绝对路径（卡片展示 + 调用方记账键） */
      resolvedPath: string;
      operation: "write" | "edit";
      /** 内容预览（截断片段，供用户判断写入内容） */
      preview?: string;
      abortSignal?: AbortSignal;
    },
  ): Promise<"once" | "session"> {
    // 本轮内自动放行：直接放行（不写会话记忆、不建卡）
    if (turnApprovalMemory.isAllowed(session.sessionId)) return "once";

    const detailParts = [
      `Path: ${params.resolvedPath}`,
      `Operation: ${params.operation}`,
    ];
    if (params.preview) {
      detailParts.push("", params.preview);
    }

    const answers = await this.ask(
      session,
      {
        kind: "approval",
        cardKind: "write-approval",
        title: "文件写入需要批准",
        toolCallId: params.toolCallId,
        toolName: params.toolName,
        autoApprove: "turn",
        questions: [
          {
            id: "write-approval",
            question: "是否允许写入工作区以外的这个路径？",
            detail: detailParts.join("\n"),
            options: [
              { label: WRITE_ALLOW_ONCE, description: "仅本次写入" },
              {
                label: WRITE_ALLOW_TURN,
                description: "本轮后续所有审批直接通过（下一轮恢复询问）",
              },
              {
                label: WRITE_ALLOW_SESSION,
                description: "本会话内遇到完全相同的路径不再询问",
              },
              { label: WRITE_DENY, description: "不写入，并把拒绝反馈给模型" },
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
    if (answer.selected.includes(WRITE_ALLOW_TURN)) {
      this.allowForTurn(session);
      return "once";
    }
    if (answer.selected.includes(WRITE_ALLOW_SESSION)) return "session";
    if (answer.selected.includes(WRITE_ALLOW_ONCE)) return "once";
    throw new AskDeniedError("用户拒绝写入该路径", "rejected");
  }

  /**
   * 打开"本轮内自动放行"，并把本轮已排队、还没回答的审批卡一并放行。
   *
   * 只影响 `AUTO_APPROVABLE_CARD_KINDS` 白名单内的挂起项（命令 / 敏感路径 / 写入）；
   * 计划审批、提问、通用审批不会被自动应答。
   */
  private allowForTurn(session: AskSession): void {
    turnApprovalMemory.allowForTurn(session.sessionId);
    this.wait.resolveAutoAllowable(session.sessionId);
  }
}
