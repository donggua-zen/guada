/**
 * 会话 LLM 请求组装器（无状态纯组装）
 *
 * 收敛主循环 / 影子轮次 / 摘要的 LLM 参数组装（modelConfig/tools/thinkingEffort 一次提取）。
 * 返回 LLMCompletionParams，调用方直接交给 LLMService.completions（唯一 LLM seam）：
 * - 主循环：组装后交给 agent-engine 私有重试执行器（对齐 DSH retryPolicy 在 agent 层）
 * - 影子轮次 / 摘要：组装后单次 completions（无重试，对齐 DSH 辅助调用单次）
 */
import type {
  LLMCompletionParams,
  LLMUsageContext,
} from "../llm-core/types/llm.types";
import type { Message } from "../../common/types/conversation.types";
import type { ISessionContext } from "./session-context";
import { ToolExecutor } from "../tools/tool-executor.service";
import { ensureToolPairing } from "../llm-core/tool-pairing.guard";
import { expandToolResultImages } from "../llm-core/tool-image-expansion";

export interface BuildCompletionParamsOptions {
  messages: Message[];
  abortSignal?: AbortSignal;
  /** 覆盖 maxOutputTokens（辅助调用：摘要 2000） */
  maxTokens?: number;
  /** 请求用途（对齐 DSH purpose）：adapter 可映射为传输元数据 */
  purpose?: string;
  /**
   * 是否把 tool-result.images 派生为 wire 图片消息（默认 true）。
   * 纯文本辅助调用（如摘要）可关闭，避免图片进入其预算。
   */
  deriveToolResultImages?: boolean;
  /** 用量统计上下文（builder 自动补 sessionId） */
  usageContext?: LLMUsageContext;
  stream?: boolean;
}

/** 无状态纯函数：一次组装会话 LLM 请求参数 */
export function buildSessionLlmParams(
  ctx: ISessionContext,
  opts: BuildCompletionParamsOptions,
): LLMCompletionParams {
  const modelConfig = ctx.getModelConfig();
  const supportsImageInput =
    modelConfig.config.inputCapabilities?.includes('image') ?? false;
  // 出站前统一做工具配对兜底（主请求/摘要/记忆同步共用本组装器）：
  // 历史里残留的「有 tool_calls 无 tool 消息」脏形状不报送上游 400，而是补占位结果。
  const paired = ensureToolPairing(opts.messages, { sessionId: ctx.sessionId });
  // 工具图片派生：存储层把 FileRef 挂在 tool-result.images（归属可追溯），
  // wire 视图再展开为隐藏 user 消息——多模态协议不允许 tool 结果消息携带图片。
  // 与 ensureToolPairing 同层（只改本次请求，不写回存储）；L1 管线保持 1:1 不变量。
  const messages = (opts.deriveToolResultImages ?? true)
    ? expandToolResultImages(paired, {
        supportsImageInput,
        workspaceDir: ctx.getWorkspacePath?.() ?? null,
      })
    : paired;
  return {
    model: modelConfig.modelName,
    // envelope：system 提示词独立字段（协议槽位由 adapter 映射，对齐 DSH LlmCallConfig.system）
    system: ctx.getSystemText(),
    // surface：纯对话历史（调用方传 getHistory()，不含 system/插件提示）。
    messages,
    tools: ToolExecutor.toFlatToolDefs(ctx.getResolvedPlugins()),
    temperature: modelConfig.config.temperature,
    topP: modelConfig.config.topP,
    frequencyPenalty: modelConfig.config.frequencyPenalty,
    maxTokens: opts.maxTokens ?? modelConfig.config.maxOutputTokens,
    providerConfig: modelConfig.provider,
    modelCapabilities: {
      supportsImageInput,
    },
    stream: opts.stream ?? true,
    thinkingEffort: ctx.getThinkingEffort(),
    abortSignal: opts.abortSignal,
    ...(opts.purpose === undefined ? {} : { purpose: opts.purpose }),
    usageContext: {
      ...opts.usageContext,
      sessionId: opts.usageContext?.sessionId ?? ctx.sessionId,
    },
  };
}

/** 会话 LLM 请求组装器（对象命名空间，语义同 buildSessionLlmParams） */
export const SessionLlmRequestBuilder = {
  buildCompletionParams: buildSessionLlmParams,
};