/**
 * LLM 摘要提供器（SummaryProvider 的 LLM 实现）
 *
 * 对齐 deepseek-harness summarizer：
 * - COMPACTION_INSTRUCTION 作为**最后一条 user 消息**（非独立 system prompt）
 * - KV 缓存友好（buildSummarizationInput 语义）：请求复用会话真实前缀——
 *   `[...prelude, ...被压缩区域消息, 指令]` + 相同的工具定义，使该调用是
 *   "压缩前最后一次主请求"的真前缀（head-anchored 压缩保证区域=请求前导），
 *   命中 provider 的 warm prefix cache；指令是唯一 novel 输入
 * - 流式传输 + BlockAssembler 累积（对齐 DSH ctx.llm.stream()），拿 usage/finishReason
 * - 增量合并旧 <compacted-summary> 检查点（从历史 compaction 事件提取）
 * - 无 prefix / 无主请求消息时可回退为"序列化单 user 消息"方案（不破坏现有路径）
 */
import { Logger } from '@nestjs/common';
import { LLMService } from '../llm-core/llm.service';
import { resolveThinkingEffort } from '../llm-core/utils/model-config.helper';
import { BlockAssembler } from './block-assembler';
import type { Message } from '../../common/types/conversation.types';
import type { StreamChunk } from '../../common/types/stream-chunk.types';
import type {
  ToolDefinition,
} from '../tools/interfaces/tool-provider.interface';
import type { SummaryInput, SummaryProvider, SummaryResult } from './compression-engine';

/** 摘要模型引用（模型名 + provider 配置 + 能力配置） */
export interface SummaryModelRef {
  modelName: string;
  provider?: any;
  config?: any;
}

export interface LLMSummaryProviderOptions {
  /** 摘要输出 token 上限（默认 2000） */
  maxSummaryTokens?: number;
  abortSignal?: AbortSignal;
  /**
   * KV 缓存友好前缀（对齐 DSH requestHeader 重放）：与会话真实请求一致的
   * prelude 消息与工具定义。提供后摘要调用复用最后一次主请求的前缀缓存。
   * shadowed 消息由引擎直接传入（即请求消息列表前缀，与主请求逐字节一致）。
   */
  prefix?: {
    prelude: Message[];
    tools?: ToolDefinition[];
  };
}

/** 单条 tool-result 入摘要的最大长度（回退序列化方案用） */
const MAX_TOOL_RESULT_CHARS = 2000;

/** KV 前缀模式下 shadowed 消息为空时的占位兜底 */
const EMPTY_REGION_PLACEHOLDER =
  '[compacted region empty — see previous checkpoint]';

/**
 * 结构化压缩检查点指令（对齐 DSH COMPACTION_INSTRUCTION，中文适配）。
 *
 * 作为摘要调用的最后一条 user 消息（非独立 system prompt）。
 */
export const COMPACTION_INSTRUCTION = `你是一个对话摘要专家。请基于上方对话生成一份结构化的压缩检查点，供模型在后续对话中继续工作。

要求：
- 使用精炼的要点（bullet），不要长篇复述
- 严格基于给出的对话内容，不要臆测或补充事实
- 保留精确的文件路径、命令、错误消息、关键数据、版本号
- 没有内容的章节写 "none"
- 输出语言与对话语言一致
- 直接输出摘要内容，不要任何前言、解释或元评论（例如"以下是摘要"）

结构（Markdown）：
## Primary Request and Intent
用户最初的需求、目标与意图
## Key Technical Concepts
对话中涉及的关键技术概念、约定、偏好
## Files and Code
涉及的文件路径与关键代码片段（只保留关键部分）
## Errors and Fixes
遇到过的错误与对应的修复
## Pending Jobs
尚未完成的任务
## To Do
明确列出的未开始任务（若 Pending 已覆盖则写 none）
## Current Work
当前正在进行的步骤与进度
## Next Step
下一步应该做什么
## Critical Context
必须记住的关键信息（环境、限制、约定、用户偏好等）

<compacted-summary> 标签内是先前已有的压缩检查点（如果有）。请把旧检查点作为既定背景，增量合并新对话内容：
- 保留旧检查点中仍然有效的全部信息
- 根据新对话更新任务状态（已完成 → 移出 Pending）
- 合并冗余信息，但不要遗漏任何事实`;

export class LLMSummaryProvider implements SummaryProvider {
  private readonly logger = new Logger(LLMSummaryProvider.name);

  constructor(
    private readonly llmService: LLMService,
    private readonly model: SummaryModelRef,
    private readonly options: LLMSummaryProviderOptions = {},
  ) {}

  /**
   * 生成摘要（流式累积，返回 summary + usage）。
   *
   * @param input 摘要输入（allMessages 提取旧检查点；shadowed/shadowsedMessageIds 组装请求）
   */
  async generate(input: SummaryInput): Promise<SummaryResult> {
    const previousSummary = extractPreviousSummary(input.allMessages);

    const requestMessages = this.buildRequestMessages(
      previousSummary,
      input.shadowed,
    );
    const maxSummaryTokens = this.options.maxSummaryTokens ?? 2000;

    this.logger.debug(
      `[summary] generating (model=${this.model.modelName}, shadowed=${input.shadowed.length} msgs, maxTokens=${maxSummaryTokens}, kvPrefix=${this.options.prefix ? 'yes' : 'no'})`,
    );

    // 流式调用（对齐 DSH ctx.llm.stream() 单次、无重试）：BlockAssembler 累积并捕获 usage
    const assembler = new BlockAssembler();
    const stream = (await this.llmService.completions({
      model: this.model.modelName || 'gpt-4o',
      messages: requestMessages.messages,
      ...requestMessages.tools === undefined ? {} : { tools: requestMessages.tools },
      temperature: 0.4,
      maxTokens: maxSummaryTokens,
      thinkingEffort: resolveThinkingEffort(this.model, 'none'),
      stream: true,
      providerConfig: this.model.provider,
      abortSignal: this.options.abortSignal,
      // 请求用途标记（对齐 DSH purpose：adapter 可映射传输元数据）
      purpose: 'compaction',
    })) as AsyncGenerator<StreamChunk>;

    for await (const chunk of stream) {
      assembler.push(chunk);
    }
    const { blocks, usage } = assembler.snapshot();

    const summary = blocks
      .filter((b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();
    if (!summary) {
      throw new Error('LLM summary provider returned empty content');
    }
    return { summary, ...(usage === undefined ? {} : { usage }) };
  }

  /**
   * 组装摘要请求消息。
   * - KV 前缀模式：`[...prelude, ...被压缩区域(请求消息本身), 指令]`，与最后一次主请求共享前缀
   * - 回退模式：单条 user 消息（指令 + 旧检查点 + 序列化对话）
   */
  private buildRequestMessages(
    previousSummary: string | undefined,
    shadowed: Message[],
  ): { messages: Message[]; tools?: ToolDefinition[] } {
    const checkpointBlock = previousSummary
      ? `<compacted-summary>\n${previousSummary}\n</compacted-summary>\n\n`
      : '';
    const instruction = `${COMPACTION_INSTRUCTION}\n\n${checkpointBlock}压缩检查点：`;

    if (this.options.prefix) {
      // KV 前缀模式：区域消息 = 引擎传入的遮蔽消息（即请求消息列表前缀，逐字节一致 → 前缀命中）
      // 事件类消息不入请求（与主请求 loadContext 过滤一致）
      const cleanRegion = shadowed.filter((m) => m.role !== 'event');

      return {
        messages: [
          ...this.options.prefix.prelude,
          ...(cleanRegion.length > 0
            ? cleanRegion
            : [this.placeholderMessage(EMPTY_REGION_PLACEHOLDER)]),
          this.instructionMessage(instruction),
        ],
        tools: this.options.prefix.tools,
      };
    }

    // 回退模式：序列化对话为单条 user 消息
    const shadowedText = serializeMessages(shadowed);
    return {
      messages: [
        this.instructionMessage(
          `${instruction}\n\n待压缩对话：\n"""\n${shadowedText || '(空)'}\n"""\n\n压缩检查点：`,
        ),
      ],
    };
  }

  private instructionMessage(text: string): Message {
    return {
      id: `__summary_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      role: 'user',
      kind: 'user',
      source: { kind: 'user' },
      metadata: {},
      content: [{ type: 'text', contentId: '', text }],
    };
  }

  private placeholderMessage(text: string): Message {
    return {
      id: `__summary_placeholder_${Date.now()}`,
      role: 'user',
      kind: 'user',
      source: { kind: 'user' },
      metadata: {},
      content: [{ type: 'text', contentId: '', text }],
    };
  }
}

/** 从可见消息中提取上一次压缩检查点（最近的 compaction 事件摘要） */
function extractPreviousSummary(messages: Message[]): string | undefined {
  // 倒序遍历，取最近一次 compaction 事件的 summary
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== 'event') continue;
    const compactInfo = msg.metadata?.compactInfo as
      | { summary?: string }
      | undefined;
    if (compactInfo?.summary) return compactInfo.summary;
  }
  return undefined;
}

/** 将待遮蔽消息序列化为摘要输入的紧凑文本（回退模式） */
function serializeMessages(messages: Message[]): string {
  const lines: string[] = [];
  for (const msg of messages) {
    if (msg.role === 'event') continue; // 事件类消息不入摘要
    const parts: string[] = [];
    for (const block of msg.content) {
      switch (block.type) {
        case 'text':
          parts.push(block.text);
          break;
        case 'reasoning':
          break; // 思考块不入摘要（体积大且非事实）
        case 'tool-call':
          parts.push(`[tool_call ${block.name}(${block.arguments})]`);
          break;
        case 'tool-result': {
          const content = block.isError
            ? `[error] ${block.content}`
            : block.content;
          parts.push(
            `[tool_result ${block.name}] ${truncate(content, MAX_TOOL_RESULT_CHARS)}`,
          );
          break;
        }
        case 'image':
          parts.push(`[image ${block.attachment.name ?? '(attachment)'}]`);
          break;
        case 'file':
          parts.push(`[file ${block.attachment.name ?? '(attachment)'}]`);
          break;
      }
    }
    const text = parts.join('\n').replace(/\n\s*\n/g, '\n').trim();
    if (text) lines.push(`${msg.role}: ${text}`);
  }
  return lines.join('\n');
}

function truncate(str: string, max: number): string {
  if (str.length <= max) return str;
  return `${str.slice(0, Math.floor(max / 2))}...[omitted ${str.length - max} chars]...${str.slice(-Math.floor(max / 2))}`;
}