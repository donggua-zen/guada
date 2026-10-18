/**
 * 记忆同步插件（对齐钩子插件化：压缩与记忆同步经同一事件机制接入）
 *
 * 订阅 compaction.before（HOOKS.BEFORE_COMPACTION）：压缩确认需要二级摘要前，
 * 按 summaryMode=MEMORY_SYNC 静默执行影子轮次——让 AI 用文件工具把关键信息写进
 * 记忆目录（MEMORY.md 索引 + 明细文件，见 common/utils/memory-path.util.ts），
 * 再执行 LLM 摘要。整个交互不入库、不 yield SSE 事件（fail-open，失败不阻断压缩）。
 *
 * 子智能体会话跳过影子轮次（短任务，记忆产出无人再读）。
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
import { resolveMemoryDir } from "../../common/utils/memory-path.util";
import {
  HOOKS,
  type BeforeCompactionPayload,
} from "./types/hooks.contract";
import type { ISessionContext } from "./session-context";
import type { Message, ContentBlock } from "../../common/types/conversation.types";

@Injectable()
export class MemorySyncService {
  private readonly logger = new Logger(MemorySyncService.name);

  /** 影子轮次日志体积上限（超出轮转一代，保留 compression.jsonl.1） */
  private static readonly SHADOW_LOG_MAX_BYTES = 5 * 1024 * 1024;

  constructor(
    private readonly llmService: LLMService,
    private readonly toolExecutor: ToolExecutor,
  ) {}

  /**
   * 订阅压缩前钩子：仅 MEMORY_SYNC 模式执行记忆维护影子轮次。
   *
   * 子智能体跳过：子代理的定位是短任务，一次 run 的记忆产出无人再读（其隔离目录在 run 结束后
   * 成为孤儿），强制整理只烧 token 没有收益。注意这并不解除隔离——子代理的索引注入与文件工具
   * 仍走它自己的 .guada/subagents/<id>/memory/，只是不再有那次强制整理。
   */
  @OnEvent(HOOKS.BEFORE_COMPACTION)
  async onBeforeCompaction(
    payload: BeforeCompactionPayload,
  ): Promise<void> {
    if (payload.summaryMode !== SummaryMode.MEMORY_SYNC) return;
    if (payload.sessionContext.sessionType === "sub_agent") {
      this.logger.debug(
        "[memory-sync] skip shadow turn for sub-agent session " +
          payload.sessionContext.sessionId,
      );
      return;
    }
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
   * 执行影子轮次：在压缩前静默调用 LLM 维护长期记忆。
   *
   * 记忆自 v1.5 起没有专用工具：AI 用文件工具维护 MEMORY.md 索引与明细文件，
   * 而影子轮次把文件工具收窄到记忆目录内（工具范围 + 路径牢笼双重锁定），
   * 因此影子轮次只能读写记忆文件，碰不到工作区其它内容。
   * 整个交互不入库，不 yield SSE 事件。
   * 最多 5 轮工具调用，无工具调用即提前结束。
   */
  async runShadowTurn(
    sessionContext: ISessionContext,
    abortSignal?: AbortSignal,
  ): Promise<void> {
    const memoryDir = resolveMemoryDir({
      workspacePath: sessionContext.getWorkspacePath(),
      sessionId: sessionContext.sessionId,
      sessionType: sessionContext.sessionType,
    });

    // 锁定工具范围到 file 插件，并把可访问路径收窄到记忆目录（牢笼优先于只读安全模式）；
    // 两者都是瞬态、不入库，退出时原样恢复。
    const originalScope = sessionContext.getToolScope();
    const originalJail = sessionContext.getPathJail();
    sessionContext.setToolScope("file");
    sessionContext.setPathJail(memoryDir);
    try {
      const messages = await sessionContext.getHistory();
      const shadowMessages: Message[] = [];

      const modelConfig = sessionContext.getModelConfig();

      // 组装指令消息（system 提示词由 builder 从上下文注入，含当前记忆索引与维护指南）
      const instructionParts: string[] = [
        `<system>
[BEGIN SILENT SYSTEM PROCESS - MEMORY MAINTENANCE]
⚠️ CRITICAL MODE SWITCH: You are currently executing a background system routine. 
You are NOT in a conversation with the user. Do not attempt to answer the user's previous prompt in this specific turn.
Your output will be parsed by the system, not read by the user.

【OBJECTIVE】
The context is too long and will be compressed. The conversation history may be trimmed or discarded.
Scan the conversation history to see if there is any content that needs long-term memory. If there is, update the memory files.

【MEMORY FILES】
Memory directory: ${memoryDir}
Index: ${memoryDir}/MEMORY.md — its current content is the <memory-index> block of your system prompt.
Format, ordering and pruning rules are in the "Memory Maintenance" section of your system prompt. Follow them exactly.
While this routine runs, file tools are restricted to the memory directory above. Use ABSOLUTE paths
(relative paths resolve against the working directory, which is outside the memory directory).

【EVALUATION LOGIC】
Scan history. ONLY trigger an update if:
- New explicit long-term preferences/habits found.
- Critical factual corrections provided.
- Existing memory conflicts or is outdated.
(Note: if the index already covers everything worth keeping, do nothing.)

【EXECUTION PROTOCOL】
1. IF NO update needed:
   - Output EXACTLY: DONE
   - STOP immediately.

2. IF update IS needed:
   - Use the file tools (read/write/edit) to update the index and/or detail files under the memory directory.
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
              purpose: "memory_sync",
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
      // 落盘原始交互记录（追加式 JSONL，见 appendShadowLog）
      try {
        this.appendShadowLog(sessionContext, messages, shadowMessages);
      } catch (e) {
        // 非关键
      }
      // 不入库，不 yield
    } finally {
      sessionContext.setToolScope(originalScope);
      sessionContext.setPathJail(originalJail);
    }
  }

  /**
   * 追加一条影子轮次记录（真 JSONL：每次运行一行 JSON 对象）。
   *
   * 影子轮次不入库、不发 SSE、模型输出在别处丢弃，本文件是它唯一的观测面：
   * 一行 = {time, sessionId, records: [抽样上下文消息, ...影子消息（指令/模型输出/工具调用与结果）]}。
   * 追加写而非覆盖——同工作区多会话的历史运行记录因此得以保留（此前覆盖写只剩最后一次，
   * 且共用一个文件路径的会话会互相抹掉记录）。
   *
   * 超过体积上限时轮转一代到 compression.jsonl.1（覆盖上一代），
   * 避免长生命周期工作区无限增长。
   */
  private appendShadowLog(
    sessionContext: ISessionContext,
    messages: Message[],
    shadowMessages: Message[],
  ): void {
    const logDir = path.join(
      sessionContext.getWorkspacePath(),
      ".guada",
      "logs",
    );
    fs.mkdirSync(logDir, { recursive: true });
    const logPath = path.join(logDir, "compression.jsonl");

    try {
      if (fs.statSync(logPath).size >= MemorySyncService.SHADOW_LOG_MAX_BYTES) {
        fs.renameSync(logPath, logPath + ".1");
      }
    } catch {
      /* 文件不存在 → 无需轮转 */
    }

    // 单行写入：JSON.stringify 会把字符串内换行转义，故一行即一条完整记录
    fs.appendFileSync(
      logPath,
      JSON.stringify({
        time: new Date().toISOString(),
        sessionId: sessionContext.sessionId,
        records: [messages[0] || {}].concat(shadowMessages),
      }) + "\n",
    );
  }
}
