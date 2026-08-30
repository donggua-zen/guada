/**
 * 会话 LLM 请求组装器（无状态纯组装）
 *
 * 收敛主循环 / 影子轮次 / 摘要的 LLM 参数组装（modelConfig/tools/thinkingEffort 一次提取）。
 * 返回 LLMCompletionParams，调用方直接交给 LLMService.completions（唯一 LLM seam）：
 * - 主循环：组装后交给 agent-engine 私有重试执行器（对齐 DSH retryPolicy 在 agent 层）
 * - 影子轮次 / 摘要：组装后单次 completions（无重试，对齐 DSH 辅助调用单次）
 */
import type { LLMCompletionParams } from "../llm-core/types/llm.types";
import type { Message } from "../../common/types/conversation.types";
import type { ISessionContext } from "./session-context";
import { ToolOrchestrator } from "../tools/tool-orchestrator.service";

export interface BuildCompletionParamsOptions {
  messages: Message[];
  abortSignal?: AbortSignal;
  /** 覆盖 maxOutputTokens（辅助调用：摘要 2000） */
  maxTokens?: number;
  /** 请求用途（对齐 DSH purpose）：adapter 可映射为传输元数据 */
  purpose?: string;
  stream?: boolean;
}

/** 无状态纯函数：一次组装会话 LLM 请求参数 */
export function buildSessionLlmParams(
  ctx: ISessionContext,
  opts: BuildCompletionParamsOptions,
): LLMCompletionParams {
  const modelConfig = ctx.getModelConfig();
  return {
    model: modelConfig.modelName,
    messages: opts.messages,
    tools: ToolOrchestrator.toFlatToolDefs(ctx.getResolvedPlugins()),
    temperature: modelConfig.config.temperature,
    topP: modelConfig.config.topP,
    frequencyPenalty: modelConfig.config.frequencyPenalty,
    maxTokens: opts.maxTokens ?? modelConfig.config.maxOutputTokens,
    providerConfig: modelConfig.provider,
    modelCapabilities: {
      supportsImageInput:
        modelConfig.config.inputCapabilities?.includes('image') ?? false,
    },
    stream: opts.stream ?? true,
    thinkingEffort: ctx.getThinkingEffort(),
    abortSignal: opts.abortSignal,
    ...(opts.purpose === undefined ? {} : { purpose: opts.purpose }),
  };
}

/** 会话 LLM 请求组装器（对象命名空间，语义同 buildSessionLlmParams） */
export const SessionLlmRequestBuilder = {
  buildCompletionParams: buildSessionLlmParams,
};