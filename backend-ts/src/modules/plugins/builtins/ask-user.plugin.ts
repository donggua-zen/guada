import { Injectable, Logger } from "@nestjs/common";
import { z } from "zod";
import { PluginBase } from "../base-plugin";
import { PluginContext } from "../types/plugin.types";
import { PluginApi, ToolResultObject } from "../api/plugin-api";
import { AskService } from "../../../common/services/ask.service";
import type { AskAnswerItem, AskQuestion } from "../../../common/types/ask.types";

/** 一次调用允许的问题数上限（对齐 ZCode 的 AskUserQuestion：1–4 题） */
const MAX_QUESTIONS = 4;
/** 每题最少/最多选项（至少 2 个才有"选择"的意义） */
const MIN_OPTIONS = 2;
const MAX_OPTIONS = 4;
/** 问题短标签长度上限（对齐 ZCode header 的 12 字符 chip） */
const MAX_HEADER_CHARS = 12;

const TOOL_NAME = "ask_user";
/** 卡片标题 */
const CARD_TITLE = "需要你的确认";

/** 答案按稳定 id 回显（与 AskAnswerItem.id 对齐）：第 i 题的 id */
const questionIdOf = (index: number): string => `q${index + 1}`;

const ASK_USER_DESCRIPTION = [
  "Use this tool only when you are blocked on a decision that is genuinely the user's to make: one you cannot resolve from the request, the code, or sensible defaults.",
  "",
  "Usage notes:",
  "- Ask up to 4 questions in a SINGLE call — batch related questions together instead of calling this tool several times, since each call blocks the turn and the user answers one card at a time.",
  "- Users can always type a custom answer instead of picking one of the options.",
  "- Use multiSelect: true to allow multiple answers to be selected for a question.",
  '- If you recommend a specific option, make that the first option in the list and add "(Recommended)" at the end of the label.',
  "",
  'Plan mode note: To enter plan mode use EnterPlanMode (not this tool). Once in plan mode, use this tool to clarify requirements or choose between approaches BEFORE finalizing your plan. Do NOT use this tool to ask "Is my plan ready?", "Should I proceed?", or otherwise reference "the plan" in questions — the user cannot see the plan until you call ExitPlanMode for approval.',
  "",
  "Reserve this for decisions where the user's answer changes what you do next — not for choices with a conventional default, or facts you can verify in the codebase yourself. In those cases pick the obvious option, mention it in your response, and proceed.",
].join("\n");

/** 无任何答案时的反馈（不视为拒绝，也不许编造偏好） */
const NO_ANSWERS_FEEDBACK =
  "The user did not provide answers to these questions. Continue using your best judgment; " +
  "do not treat this as a rejection or invent a user preference.";

/** 提问工具入参（导出供测试直接校验 schema 边界） */
export const ASK_USER_INPUT_SCHEMA = z
  .object({
    questions: z
      .array(
        z.object({
          question: z
            .string()
            .min(1)
            .describe(
              'The complete question to ask the user. Should be clear, specific, and end with a question mark. Example: "Which library should we use for date formatting?" If multiSelect is true, phrase it accordingly.',
            ),
          header: z
            .string()
            .max(MAX_HEADER_CHARS)
            .optional()
            .describe(
              'Very short label shown above the question (max 12 chars). Examples: "Auth method", "Library", "Approach".',
            ),
          options: z
            .array(
              z.object({
                label: z
                  .string()
                  .min(1)
                  .describe(
                    "The display text for this option that the user will see and select. Should be concise (1-5 words) and clearly describe the choice.",
                  ),
                description: z
                  .string()
                  .optional()
                  .describe(
                    "Explanation of what this option means or what will happen if chosen. Useful for describing trade-offs.",
                  ),
              }),
            )
            .min(MIN_OPTIONS)
            .max(MAX_OPTIONS),
          multiSelect: z
            .boolean()
            .optional()
            .describe(
              "Allow the user to pick more than one option for this question. Defaults to single-select.",
            ),
        }),
      )
      .min(1)
      .max(MAX_QUESTIONS)
      .describe(`Questions to ask the user (1-${MAX_QUESTIONS} questions).`),
  })
  // 同一次调用内问题文本不许重复：答案按题序回显，重复文本会让模型分不清是哪一题的答案
  .superRefine((value, ctx) => {
    const texts = value.questions.map((q) => q.question);
    if (new Set(texts).size !== texts.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["questions"],
        message: "questions must be unique within a single call",
      });
    }
  });

export type AskUserInput = z.infer<typeof ASK_USER_INPUT_SCHEMA>;
export type AskUserInputQuestion = AskUserInput["questions"][number];

/**
 * 用户提问插件。
 *
 * 提供 `ask_user`：模型遇到"只有用户能定"的阻塞性决策时，向用户提出 1–4 道选择题并
 * **原地阻塞**等待答案，答案作为工具结果回流继续推理。
 *
 * 复用统一 Ask 交互层（`AskService.ask` + `kind:'ask'`）：卡片、应答端点、重连补拉、
 * 审计与流帧全部沿用既有链路，本插件只负责"发起 + 把答案组织回模型"。
 * 与审批的区别：审批（ExitPlanMode / 命令 / 写入）走 `kind:'approval'`，且"自定义回复"
 * 语义为**拒绝 + 反馈**；本工具是纯询问，用户的自定义文本就是**正常答案**。
 */
@Injectable()
export class AskUserPlugin extends PluginBase {
  private readonly logger = new Logger(AskUserPlugin.name);

  manifest = {
    id: "ask-user",
    name: "用户提问",
    description: "向用户提出选择题并等待回答后继续",
    version: "1.0.0",
    category: "core" as const,
  };

  constructor(private readonly askService: AskService) {
    super();
  }

  async onLoad(api: PluginApi): Promise<void> {
    const kit = api.registerToolKit({
      id: "ask-user",
      name: "用户提问",
      description: "向用户提出选择题并等待回答后继续",
      activator: "Ask the user clarifying questions and continue with their answers.",
      // 子代理不可见：交互卡按会话渲染，子会话的卡用户看不到 → 会永久卡死父回合。
      // （与 plan-mode 工具包同一手法；ZCode 是把子代理的提问路由回父会话，本项目暂无该路由。）
      handler: async (ctx) =>
        ctx.session.sessionType === "sub_agent"
          ? { loadMode: "none" as const }
          : {},
    });

    kit.registerTool({
      name: TOOL_NAME,
      description: ASK_USER_DESCRIPTION,
      inputSchema: ASK_USER_INPUT_SCHEMA,
      execute: async (args, ctx, signal) => this.handleAsk(args, ctx, signal),
      display: {
        actionType: "ask",
        text: { executing: "等待你的回答", completed: "已收到回答" },
        aggregate: { executing: "向用户提问", completed: "已收到回答" },
        argsKey: "questions",
        icon: "generic",
      },
      // 计划模式逃生舱：计划阶段"问清需求"正是本工具的主场，必须放行
      // （计划门只看声明式能力，不认"询问"这类交互语义）
      allowedInPlanMode: true,
      // 纯询问：不改代码、不改文件
      readOnly: true,
      // 会阻塞等待人类应答：子会话放行会把卡挂到用户看不见的子会话上、卡死父回合
      requiresUserInteraction: true,
    });
  }

  /**
   * 发起提问并原地等待答案。
   *
   * 无超时（沿用交互层语义）：三种终结——用户应答、用户停止（abortSignal 竞速胜出，
   * 由 AskService 抛 AskDeniedError 并被 ToolExecutor 转成 isError 回流）、后端重启丢表。
   */
  private async handleAsk(
    args: AskUserInput,
    ctx?: PluginContext,
    signal?: AbortSignal,
  ): Promise<ToolResultObject> {
    const session = ctx?.session;
    if (!session) {
      throw new Error("ask_user requires a session context");
    }

    const questions: AskQuestion[] = args.questions.map((q, i) => ({
      id: questionIdOf(i),
      question: q.question,
      // header 是短标签，落到卡片的 detail（纯文本支撑行）呈现
      ...(q.header ? { detail: q.header } : {}),
      options: q.options.map((opt) => ({
        label: opt.label,
        ...(opt.description ? { description: opt.description } : {}),
      })),
      ...(q.multiSelect ? { multiSelect: true } : {}),
    }));

    const answers = await this.askService.ask(
      session,
      {
        kind: "ask",
        title: CARD_TITLE,
        toolCallId: ctx?.toolCallId,
        toolName: TOOL_NAME,
        questions,
      },
      signal,
    );

    this.logger.debug(
      `ask_user answered: ${answers.length}/${questions.length} question(s)`,
    );

    return { content: formatAnswers(args.questions, answers) };
  }
}

/**
 * 把答案组织成给模型看的文本。
 *
 * 与审批不同：这里的自定义文本是**正常答案**（不是拒绝），因此它优先于选项参与回显；
 * 未作答的题目明确告知"跳过"，并禁止模型编造用户偏好。
 */
export function formatAnswers(
  questions: AskUserInputQuestion[],
  answers: AskAnswerItem[],
): string {
  const byId = new Map(answers.map((a) => [a.id, a]));
  const parts: string[] = [];
  let unanswered = 0;

  questions.forEach((q, i) => {
    const answer = byId.get(questionIdOf(i));
    const custom = answer?.custom?.trim();
    // 自定义文本优先（卡片允许"选项 + 附加说明"并存，多选时 custom 是附加）
    const value = custom || (answer?.selected ?? []).join(", ");
    if (!value) {
      unanswered += 1;
      return;
    }
    parts.push(`"${q.question}"="${value}"`);
  });

  if (parts.length === 0) return NO_ANSWERS_FEEDBACK;

  const answeredText = parts.join(", ");
  if (unanswered > 0) {
    return (
      `The user answered some questions and skipped ${unanswered}. ` +
      `Provided answers: ${answeredText}. Continue with the provided answers and use your ` +
      `best judgment for the unanswered questions; do not invent user preferences.`
    );
  }

  return `User has answered your questions: ${answeredText}. You can now continue with the user's answers in mind.`;
}
