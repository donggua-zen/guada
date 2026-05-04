import { Global, Module } from "@nestjs/common";
import { LLMService } from "./llm.service";
import { OpenAIAdapter } from "./adapters/openai.adapter";
import { OpenAIResponseAdapter } from "./adapters/openai-response.adapter";
import { GeminiAdapter } from "./adapters/gemini.adapter";

/**
 * LLM 核心模块
 * 提供全局可用的 LLM 调用抽象服务
 */
@Global()
@Module({
  providers: [LLMService, OpenAIAdapter, OpenAIResponseAdapter, GeminiAdapter],
  exports: [LLMService],
})
export class LlmCoreModule {}
