import { Injectable, Logger } from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";
import { z } from "zod";
import { PluginBase } from "../base-plugin";
import { PluginContext } from "../types/plugin.types";
import { PluginApi, ToolResultObject } from "../api/plugin-api";
import { HOOKS } from "../../chat/types/hooks.contract";
import { AskService } from "../../../common/services/ask.service";
import {
  PlanFileService,
  PLAN_MAX_CHARS,
} from "../../../common/services/plan-file.service";

/** 审批问题的稳定 id（前端按 id 回显答案） */
const PLAN_QUESTION_ID = "plan";
const PLAN_APPROVE = "批准";
const PLAN_REJECT = "拒绝";

const NOT_IN_PLAN_MODE =
  "Not in plan mode. This tool is only for exiting plan mode after writing a plan. " +
  "If your plan was already approved, continue with implementation.";

/**
 * 两条拒绝路径共用同一工具结果文本：拒绝即终止当前轮（finishReason=plan_rejected），
 * 工具结果是回合最后一条消息；有无反馈的差别只在"是否随后开启一条真实用户消息的新轮次"，
 * 与工具结果本身无关。（原"不要立即重新提交"指令是给"轮次继续"场景写的，已随语义删除。）
 */
const REJECTED = "The plan was not approved by the user.";

/**
 * 计划模式插件。
 *
 * 提供 `ExitPlanMode`：模型在计划阶段写完方案后，用它请求用户批准。
 * 批准 → 计划落盘 + 退出计划模式（持久化 + 审计事件 + 流帧）；拒绝 → 保持只读。
 *
 * 为什么没有 `EnterPlanMode`：本期计划模式**只由用户开启**（界面开关写会话设置）。
 * 主动进入能力是刻意的预留——补一个 EnterPlanMode 工具 + 计划门放行转换类工具即可，
 * 状态/审批/落盘/注入/前端均无需改动。
 */
@Injectable()
export class PlanModePlugin extends PluginBase {
  private readonly logger = new Logger(PlanModePlugin.name);

  manifest = {
    id: "plan-mode",
    name: "计划模式",
    description: "计划模式：只读调研后产出方案，经用户批准再实施",
    version: "1.0.0",
    category: "core" as const,
  };

  constructor(
    private readonly askService: AskService,
    private readonly planFile: PlanFileService,
  ) {
    super();
  }

  /**
   * 压缩后重注入计划正文。
   *
   * 压缩会把头部消息遮蔽——已批准计划的 ExitPlanMode 工具调用可能已被压掉，
   * 模型随后就"忘了"计划内容。落盘文件是稳定来源，据此重新注入一条隐藏 user 消息。
   *
   * 注入条件只看"计划文件是否存在"，**不看计划模式开关**：批准后计划模式已关闭，
   * 但计划本身仍是后续实施的依据，恰恰最需要在压缩后存活。
   * 每次压缩都重新注入是刻意的——上一次注入的条目必然落在新的遮蔽范围内，不会叠加。
   */
  @OnEvent(HOOKS.MEMORY_COMPACTED)
  async handleCompacted(payload: {
    sessionId: string;
    sessionContext: import("../../chat/session-context").ISessionContext;
  }): Promise<void> {
    try {
      const ctx = payload.sessionContext;
      // 每份计划一个文件（planId = 当次 ExitPlanMode 的 toolCallId），重注入取最近一份
      const found = await this.planFile.readLatestPlan({
        workspacePath: ctx.getWorkspacePath(),
        sessionId: ctx.sessionId,
      });
      if (!found) return;

      const text = [
        `A plan file exists from plan mode at: ${found.path}`,
        "",
        "Plan contents:",
        "",
        found.content,
        "",
        "If this plan is relevant to the current work and not already complete, continue working on it.",
      ].join("\n");

      await ctx.injectUserPrompt(text, "plan-mode");
    } catch (error: any) {
      // 重注入是增强项，不是正确性依赖：失败只告警，不打断压缩后的回合
      this.logger.warn(`Failed to re-inject approved plan: ${error?.message}`);
    }
  }

  async onLoad(api: PluginApi): Promise<void> {
    const kit = api.registerToolKit({
      id: "plan-mode",
      name: "计划模式",
      description: "只读调研后产出方案，经用户批准再实施",
      activator: "Present an implementation plan for approval while in plan mode.",
    });

    kit.registerTool({
      name: "ExitPlanMode",
      description: `Use this tool when you are in plan mode and have finished writing your plan and are ready for user approval.

## How This Tool Works
- You should have already explored the codebase and finalized the plan you want the user to review.
- This tool takes the plan content as its required \`plan\` parameter.
- Pass the complete plan in the \`plan\` field; the user will review that content before approving implementation.
- The user will see the contents of the \`plan\` parameter when they review it.

## When to Use This Tool
Only use this tool when the task requires planning the implementation steps of a coding task. For pure research tasks — gathering information, searching files, reading files, or generally understanding the codebase — do NOT use this tool.

## Before Using This Tool
Ensure your plan is complete and unambiguous:
- If you have unresolved questions about requirements or approach, ask the user before finalizing your plan.
- Once your plan is finalized, use THIS tool to request approval.

## What Happens Next
- Approved → plan mode ends, the plan is saved to a file, and you may start implementing.
- Rejected → plan mode stays on. If the user left feedback, it arrives as their message; otherwise wait for them to explain.`,
      inputSchema: z.object({
        plan: z
          .string()
          .min(1)
          .max(PLAN_MAX_CHARS)
          .refine((value) => value.trim().length > 0, {
            message: "plan must not be blank",
          })
          .describe(
            "The implementation plan to present to the user for approval.",
          ),
      }),
      execute: async (args, ctx, signal) =>
        this.handleExitPlanMode(args, ctx, signal),
      display: {
        actionType: "plan",
        text: { executing: "提交计划待批准", completed: "计划已处理" },
        aggregate: { executing: "提交计划", completed: "计划已处理" },
        argsKey: "plan",
        icon: "generic",
      },
      // 计划模式逃生舱：本工具是计划阶段唯一的出口，不参与计划门的只读判定
      allowedInPlanMode: true,
      // 会阻塞等待人类应答：子会话放行会把审批卡挂到用户看不见的子会话上、卡死父回合
      requiresUserInteraction: true,
    });
  }

  private async handleExitPlanMode(
    args: { plan: string },
    ctx?: PluginContext,
    signal?: AbortSignal,
  ): Promise<ToolResultObject> {
    const session = ctx?.session;
    if (!session) {
      throw new Error("ExitPlanMode requires a session context");
    }
    if (!session.getPlanEnabled()) {
      return { content: NOT_IN_PLAN_MODE, isError: true };
    }

    // 先落盘、后翻转状态：写失败即中止本次退出（审批通过即代表计划已定稿，
    // 不能出现"已退出但没有计划文件"的半截状态）。
    // planId = 本次工具调用 id（计划身份与转录对齐；每份计划一个文件，历史计划互不覆盖）
    const planId = ctx?.toolCallId ?? `plan-${Date.now().toString(36)}`;
    const planPath = await this.planFile.writeApprovedPlan({
      workspacePath: session.getWorkspacePath(),
      sessionId: session.sessionId,
      planId,
      plan: args.plan,
    });

    // 复用统一 Ask：kind='approval' + detail 携带计划全文，前端审批卡零改动
    const answers = await this.askService.ask(
      session,
      {
        kind: "approval",
        title: "计划审批",
        toolCallId: ctx?.toolCallId,
        toolName: "ExitPlanMode",
        questions: [
          {
            id: PLAN_QUESTION_ID,
            question: "是否批准该计划并开始实施？",
            detail: args.plan,
            options: [
              { label: PLAN_APPROVE, description: "退出计划模式并开始实施。" },
              { label: PLAN_REJECT, description: "不批准，保持只读。" },
            ],
          },
        ],
      },
      signal,
    );

    const answer = answers[0];
    const approved = answer?.selected?.includes(PLAN_APPROVE) === true;
    // 自定义回复 = 拒绝 + 反馈（与 AskService.requestApproval 的既有语义一致：
    // 用户打字说明诉求时，无论是否同时点了选项，都按"不批准 + 这是我要的修改"处理）
    const feedback = answer?.custom?.trim();

    if (approved && !feedback) {
      await this.exitPlanMode(session, ctx?.toolCallId);
      return {
        content:
          "User has approved your plan. You can now start coding. " +
          "Start with updating your todo list if applicable.\n\n" +
          `## Approved Plan:\n${args.plan}\n\n` +
          `[Plan saved to: ${planPath}]`,
        meta: { planPath, planApproved: true },
      };
    }

    if (feedback) {
      // 反馈经 followUpUserInput 交回引擎 → 引擎终止本轮（finishReason=plan_rejected）→
      // chat-runner 把文字作为**真实用户消息**入队，开启新轮次。模型对 user 消息的权重
      // 高于工具错误，且反馈会随消息进入压缩输入、成为模式切换检测的新基准。
      return {
        content: REJECTED,
        isError: true,
        followUpUserInput: feedback,
        meta: { planPath, planApproved: false },
      };
    }

    // 无文字拒绝：同样终止当前轮（无新轮次），控制权直接交回用户
    return {
      content: REJECTED,
      isError: true,
      meta: { planPath, planApproved: false },
    };
  }

  /** 退出计划模式：持久化开关 + 写审计事件 + 发流帧（三处缺一不可） */
  private async exitPlanMode(
    session: PluginContext["session"],
    toolCallId?: string,
  ): Promise<void> {
    const previous = session.getPlanEnabled();
    if (!previous) return;

    await session.setPlanEnabled(false);
    await session.appendSessionModeChanged({
      planEnabled: false,
      previousPlanEnabled: previous,
      sandboxMode: session.getSandboxMode(),
      source: "tool",
      ...(toolCallId ? { toolCallId } : {}),
    });
    // 流帧：模型发起的退出是前端唯一的知情渠道（用户开关那条路径前端已自知）
    await session.publishStream({
      type: "plan_mode_changed",
      planEnabled: false,
      previousPlanEnabled: previous,
      source: "tool",
      ...(toolCallId ? { toolCallId } : {}),
    });
  }
}
