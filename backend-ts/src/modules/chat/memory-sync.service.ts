/**
 * 记忆同步插件（对齐钩子插件化：压缩与记忆同步经同一事件机制接入）
 *
 * 订阅 compaction.before（HOOKS.BEFORE_COMPACTION）：压缩确认需要二级摘要前，
 * 按 summaryMode=MEMORY_SYNC 静默执行影子轮次——让 AI 用记忆工具把关键信息保存到文件，
 * 再执行 LLM 摘要。整个交互不入库、不 yield SSE 事件（fail-open，失败不阻断压缩）。
 *
 * 依赖 LLMService（单次请求不重试——失败容忍的辅助调用，重试退避会拖慢压缩，对齐 DSH 辅助调用单次）
 * + ToolExecutor。
 */
import { Injectable, Logger } from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";
import * as fs from "fs";
import * as path from "path";
import { ToolExecutor } from "../tools/tool-executor.service";
import { LLMService } from "../llm-core/llm.service";
import { BlockAssembler } from "./block-assembler";
import { SessionLlmRequestBuilder } from "./session-llm-request.builder";
import { SummaryMode } from "./compaction/compression-engine";
import {
  HOOKS,
  type BeforeCompactionPayload,
} from "./types/hooks.contract";
import type { ISessionContext } from "./session-context";
import type { Message, ContentBlock } from "../../common/types/conversation.types";

@Injectable()
export class MemorySyncService {
  private readonly logger = new Logger(MemorySyncService.name);

  constructor(
    private readonly llmService: LLMService,
    private readonly toolExecutor: ToolExecutor,
  ) {}

  /** 订阅压缩前钩子：仅 MEMORY_SYNC 模式执行记忆保存影子轮次 */
  @OnEvent(HOOKS.BEFORE_COMPACTION)
  async onBeforeCompaction(
    payload: BeforeCompactionPayload,
  ): Promise<void> {
    if (payload.summaryMode !== SummaryMode.MEMORY_SYNC) return;
    this.logger.debug("[memory-sync] run memory save shadow turn");
    try {
      await this.runShadowTurn(payload.sessionContext, payload.abortSignal);
      this.logger.debug("[memory-sync] memory save shadow turn done");
    } catch (e) {
      // fail-open：记忆保存失败不阻断压缩
      this.logger.warn(`[memory-sync] shadow turn failed: ${e}`);
    }
  }

  /**
   * 执行影子轮次：在压缩前静默调用 LLM 保存记忆。
   *
   * 使用对话模型 + 仅文件读写工具，让 AI 自行判断需要保存的内容。
   * 整个交互不入库，不 yield SSE 事件。
   * 最多 5 轮工具调用，无工具调用即提前结束。
   */
  async runShadowTurn(
    sessionContext: ISessionContext,
    abortSignal?: AbortSignal,
  ): Promise<void> {
    // 锁定工具范围到 memory 插件（瞬态，不入库；安全模式不受影响），
    // 确保影子轮次只能调用 memory 工具
    const originalScope = sessionContext.getToolScope();
    sessionContext.setToolScope("memory");
    try {
      // 跳过工具提示词注入（影子轮次只需要记忆和文件工具，不需要 skill 描述等）
      const messages = await sessionContext.getHistory();
      const shadowMessages: Message[] = [];

      const modelConfig = sessionContext.getModelConfig();

      // 组装指令消息（history 中不含系统提示词，此处自行注入）
      const instructionParts: string[] = [
        `<system>
[BEGIN SILENT SYSTEM PROCESS - MEMORY MAINTENANCE]
⚠️ CRITICAL MODE SWITCH: You are currently executing a background system routine. 
You are NOT in a conversation with the user. Do not attempt to answer the user's previous prompt in this specific turn.
Your output will be parsed by the system, not read by the user.

【OBJECTIVE】
The context is too long and will be compressed. The conversation history may be trimmed or discarded.
Scan the conversation history to see if there is any content that needs long-term memory. If there is, use the memory tool to save it.

【EVALUATION LOGIC】
Scan history. ONLY trigger an update if:
- New explicit long-term preferences/habits found.
- Critical factual corrections provided.
- Existing memory conflicts or is outdated.
(Note: If <factual-memory/> is already accurate, do nothing.)

【EXECUTION PROTOCOL】
1. IF NO update needed:
   - Output EXACTLY: DONE
   - STOP immediately.

2. IF update IS needed:
   - Use memory tool ('memory') to update memory.
   - Max 5 tool calls.
   - After tools finish, Output EXACTLY: DONE
   - STOP immediately.

【STRICT OUTPUT FORMAT】
- The ONLY valid output string is "DONE".
- Any other text (including explanations, apologies, or reasoning) will cause a system error.
- Do not worry about the user's pending questions; the system will return to normal mode after receiving "DONE".
[END SILENT SYSTEM PROCESS]
</system>`,
      ];

      const shadowUserMessageId = sessionContext.generateMessageId();
      shadowMessages.push({
        id: shadowUserMessageId,
        role: "user",
        kind: "user",
        source: { kind: "user" },
        metadata: {},
        content: [
          {
            type: "text",
            text: instructionParts.join("\n"),
          },
        ],
      });

      // 单次请求不重试（失败容忍的辅助调用；参数组装经 builder）
      const MAX_ROUNDS = 5;

      for (let round = 1; round <= MAX_ROUNDS; round++) {
        // 用户中止（手动压缩取消）：立即退出影子轮，不再调度剩余轮次
        // （不区分取消与普通失败的原因：本钩子 fail-open，取消穿透由引擎阶段检查点兜底）
        if (abortSignal?.aborted) {
          this.logger.log(`[memory-sync] shadow turns aborted at round ${round}`);
          break;
        }
        try {
          const streamResult = (await this.llmService.completions(
            SessionLlmRequestBuilder.buildCompletionParams(sessionContext, {
              messages: messages.concat(shadowMessages),
              abortSignal,
            }),
          )) as AsyncGenerator<import("../llm-core/types/llm.types").StreamChunk>;

          const shadowAssembler = new BlockAssembler();
          for await (const item of streamResult) {
            shadowAssembler.push(item);
          }
          const shadowBlocks = shadowAssembler.blocks();

          const shadowAssistantId = sessionContext.generateMessageId();
          shadowMessages.push({
            id: shadowAssistantId,
            role: "assistant",
            kind: "model",
            source: { kind: "model", provider: "", model: modelConfig.modelName || "" },
            metadata: {},
            content: shadowBlocks,
          });
          const shadowToolCalls = shadowBlocks.filter(
            (b): b is Extract<ContentBlock, { type: "tool-call" }> =>
              b.type === "tool-call",
          );
          if (shadowToolCalls.length === 0) break;

          const responses = await this.toolExecutor.executeBatch(
            shadowToolCalls.map((tc) => ({
              id: tc.toolCallId,
              name: tc.name,
              arguments: (() => {
                try {
                  return typeof tc.arguments === "string"
                    ? JSON.parse(tc.arguments)
                    : tc.arguments;
                } catch {
                  return {};
                }
              })(),
            })),
            sessionContext,
          );
          for (const r of responses) {
            const shadowToolResultId = sessionContext.generateMessageId();
            shadowMessages.push({
              id: shadowToolResultId,
              role: "tool",
              kind: "model",
              source: { kind: "tool", toolCallId: r.toolCallId },
              metadata: {},
              content: [
                {
                  type: "tool-result",
                  toolCallId: r.toolCallId,
                  name: r.name,
                  content: r.content,
                },
              ],
            });
          }
        } catch (error: any) {
          this.logger.error(`记忆保存第${round}轮失败: ${error.message}`);
          break;
        }
      }
      // 落盘原始交互记录
      try {
        const logDir = path.join(
          sessionContext.getWorkspacePath(),
          ".guada",
          "logs",
        );
        fs.mkdirSync(logDir, { recursive: true });
        fs.writeFileSync(
          path.join(logDir, "compression.jsonl"),
          JSON.stringify({
            time: new Date().toISOString(),
            sessionId: sessionContext.sessionId,
            records: [messages[0] || {}].concat(shadowMessages),
          }) + "\n",
        );
      } catch (e) {
        // 非关键
      }
      // 不入库，不 yield
    } finally {
      sessionContext.setToolScope(originalScope);
    }
  }
}
