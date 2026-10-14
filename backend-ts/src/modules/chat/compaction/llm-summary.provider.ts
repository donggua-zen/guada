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
import { randomUUID } from 'crypto';
import { LLMService } from '../../llm-core/llm.service';
import { resolveThinkingEffort } from '../../llm-core/utils/model-config.helper';
import type { RuntimeProviderConfig } from '../../llm-core/utils/provider-runtime.util';
import { BlockAssembler } from '../block-assembler';
import type { Message } from '../../../common/types/conversation.types';
import type { StreamChunk } from '../../../common/types/stream-chunk.types';
import type {
  ToolDefinition,
} from '../../tools/interfaces/tool-provider.interface';
import type { LLMCompletionParams } from '../../llm-core/types/llm.types';
import type { SummaryInput, SummaryProvider, SummaryResult } from './compression-engine';
import { kbRefsToText } from '../../../common/utils/kb-ref.util';

/** 摘要模型引用（模型名 + provider 运行时配置 + 能力配置 + 档位菜单） */
export interface SummaryModelRef {
  modelName: string;
  /** 运行时供应商配置（normalize 后的形态，见 toRuntimeProviderConfig） */
  provider?: RuntimeProviderConfig;
  config?: any;
  /** 档位菜单（能力判据；空 = 不能思考，回退路径不发思考参数） */
  thinkingEfforts?: string[];
}

export interface LLMSummaryProviderOptions {
  /** 摘要输出 token 上限（默认 2000） */
  maxSummaryTokens?: number;
  abortSignal?: AbortSignal;
  /**
   * KV 缓存友好前缀（对齐 DSH SummarizationInput：system/tools 独立字段）：
   * 与会话真实请求一致的 system 提示词与工具定义。提供后摘要调用复用主请求的前缀缓存。
   * shadowed 消息由引擎直接传入（即请求消息列表前缀，与主请求逐字节一致）。
   */
  prefix?: {
    system: string;
    tools?: ToolDefinition[];
  };
  /**
   * 请求参数组装器（复用 session-llm-request.builder，与主请求同源：
   * thinkingEffort/temperature/modelCapabilities/providerConfig 一致 → 前缀缓存最大命中）。
   * 传入后 generate 用它组装 completions 参数，仅 override system/tools（前缀一致）与 maxTokens。
   */
  buildParams?: (messages: Message[]) => LLMCompletionParams;
}

/** 单条 tool-result 入摘要的最大长度（回退序列化方案用） */
const MAX_TOOL_RESULT_CHARS = 2000;

/** KV 前缀模式下 shadowed 消息为空时的占位兜底 */
const EMPTY_REGION_PLACEHOLDER =
  '[compacted region empty — see previous checkpoint]';

/**
 * 结构化压缩检查点指令（对齐 DSH COMPACTION_INSTRUCTION：英文 + Markdown 分节 + 规则）。
 *
 * 作为摘要调用的最后一条 user 消息，外层用 `<system_reminder>` 标签包裹
 * （GuaDa 系统级注入惯例，同 agent-engine:615 / process-manager:167）。
 */
export const COMPACTION_INSTRUCTION = [
  'You are now acting as a compaction engine for this AI coding assistant. Condense the conversation ABOVE into a structured checkpoint that lets another model resume the work with no loss of essential context.',
  '',
  'Output EXACTLY the Markdown structure below: keep every section, in order. Use terse bullets, not prose paragraphs. Write "(none)" for an empty section — never drop a section.',
  '',
  '## Primary Request and Intent',
  '- [the user\'s original and evolving goals; quote verbatim where the exact wording matters]',
  '',
  '## Key Technical Concepts',
  '- [technologies, frameworks, patterns, and conventions in play]',
  '',
  '## Files and Code',
  '- [exact path: why it matters, key changes or snippets]',
  '',
  '## Errors and Fixes',
  '- [error: how it was resolved, plus any related user feedback]',
  '',
  '## Pending Jobs',
  '- [explicitly requested work not yet completed]',
  '',
  '## Current Work',
  '- [precisely what was in progress at this checkpoint]',
  '',
  '## Next Step',
  '- [the single next action, directly in line with the most recent request, or "(none)"]',
  '',
  '## Critical Context',
  '- [decisions and their rationale, constraints, user preferences, open questions, data needed to continue]',
  '',
  'Rules:',
  '- Write concise English engineering prose. Preserve exact file paths, commands, error strings, identifiers, numeric values, function signatures, and syntax fragments.',
  '- Capture user feedback and explicit instructions faithfully, especially corrections.',
  '- Do NOT mention this summarization request or that the context was compacted.',
  '- Do NOT call any tool or take any other action.',
  '- If the conversation already contains a <compacted-summary> block, it is a PRIOR checkpoint. Do not copy it forward verbatim: preserve still-true facts, drop stale ones, and merge newer information into a single consolidated summary under the same structure.',
  '- Output the checkpoint text directly, without any preamble, explanation, or meta-commentary.',
].join('\n');

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

    // 摘要请求规模诊断（只读，调用前打印——失败时也有数）：
    // 摘要请求 = 前缀（system+tools） + 遮蔽区 + 指令；字符量按 ~3.5 字符/token 粗估。
    {
      const shadowedChars = input.shadowed.reduce(
        (n, m) => n + JSON.stringify(m.content ?? '').length,
        0,
      );
      const instruction =
        requestMessages.messages[requestMessages.messages.length - 1];
      const instructionChars = JSON.stringify(instruction?.content ?? '').length;
      const prefixSystemChars = this.options.prefix?.system?.length ?? 0;
      const prefixTools = this.options.prefix?.tools?.length ?? 0;
      const approx = (chars: number) => Math.ceil(chars / 3.5);
      this.logger.log(
        `[compact.diag.summary] shadowedMsgs=${input.shadowed.length} shadowedChars=${shadowedChars}` +
          ` prefixSystemChars=${prefixSystemChars} prefixTools=${prefixTools} instructionChars=${instructionChars}` +
          ` approxPrefixTokens=${approx(prefixSystemChars)} approxShadowedTokens=${approx(shadowedChars)}` +
          ` maxTokens=${maxSummaryTokens}`,
      );
    }

    // 流式调用（对齐 DSH ctx.llm.stream() 单次、无重试）：BlockAssembler 累积并捕获 usage。
    // 优先复用 builder（buildParams）——thinkingEffort/temperature 等与主请求同源，前缀缓存最大命中；
    // 仅 override system/tools（前缀一致）与 maxTokens。未注入 buildParams 时回退手工组装（兼容）。
    let params: LLMCompletionParams;
    if (this.options.buildParams) {
      params = this.options.buildParams(requestMessages.messages);
      if (requestMessages.system !== undefined) params.system = requestMessages.system;
      if (requestMessages.tools !== undefined) params.tools = requestMessages.tools;
      params.maxTokens = maxSummaryTokens;
    } else {
      params = {
        model: this.model.modelName || 'gpt-4o',
        system: requestMessages.system,
        messages: requestMessages.messages,
        ...(requestMessages.tools === undefined ? {} : { tools: requestMessages.tools }),
        temperature: 0.4,
        maxTokens: maxSummaryTokens,
        thinkingEffort: resolveThinkingEffort(this.model, 'none'),
        stream: true,
        providerConfig: this.model.provider,
        abortSignal: this.options.abortSignal,
        // 请求用途标记（对齐 DSH purpose：adapter 可映射传输元数据）
        purpose: 'compaction',
      };
    }
    const stream = (await this.llmService.completions(params)) as AsyncGenerator<StreamChunk>;

    const assembler = new BlockAssembler();
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
    // 摘要调用成功：记录 provider 侧 usage（口径对照的地面真值；缺失即代表 provider 不返回）
    this.logger.log(
      `[compact.diag.summary.result] summaryChars=${summary.length} usage=${
        usage === undefined
          ? 'none'
          : JSON.stringify({
              promptTokens: (usage as any).promptTokens,
              completionTokens: (usage as any).completionTokens,
              cachedTokens: (usage as any).cachedTokens,
            })
      }`,
    );
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
  ): { system?: string; messages: Message[]; tools?: ToolDefinition[] } {
    const checkpointBlock = previousSummary
      ? `<compacted-summary>\n${previousSummary}\n</compacted-summary>\n\n`
      : '';
    // 指令以 <system_reminder> 标签包裹（GuaDa 系统级注入惯例）
    const instruction =
      `<system_reminder>\n${COMPACTION_INSTRUCTION}\n\n${checkpointBlock}Compression checkpoint:\n</system_reminder>`;

    if (this.options.prefix) {
      // KV 前缀模式：system 走 envelope 独立字段（对齐 DSH SummarizationInput），
      // 区域消息 = 引擎传入的遮蔽消息**原样**（含 compact 检查点 user 消息，无过滤）——
      // 与主请求前缀逐字节一致 → 命中 provider warm prefix cache（缓存只认前缀一致，后缀可不同）
      return {
        system: this.options.prefix.system,
        messages: [
          ...(shadowed.length > 0
            ? shadowed
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
    // 请求内临时占位（不落盘）：保留 __summary_ 哨兵前缀便于日志辨识，唯一性交给 uuid
    return {
      id: `__summary_${randomUUID()}`,
      role: 'user',
      kind: 'user',
      source: { kind: 'user' },
      metadata: {},
      content: [{ type: 'text', text }],
    };
  }

  private placeholderMessage(text: string): Message {
    return {
      id: `__summary_placeholder_${randomUUID()}`,
      role: 'user',
      kind: 'user',
      source: { kind: 'user' },
      metadata: {},
      content: [{ type: 'text', text }],
    };
  }
}

/** 从可见消息中提取上一次压缩检查点（最近的 compact 检查点消息，source.plugin='compact'） */
function extractPreviousSummary(messages: Message[]): string | undefined {
  // 倒序遍历，取最近一次 compact 检查点消息的 compactInfo.summary
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.source?.kind !== 'plugin' || msg.source.plugin !== 'compact') continue;
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
    // 消息角色已无 event（检查点是 user + source.plugin='compact'，自然进入序列化——模型看到旧摘要做增量合并）
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
        case 'kb-ref':
          // 与请求视图投影口径一致（kbRefProjectionStep）：引用清单进摘要
          parts.push(kbRefsToText(block.kbRefs));
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