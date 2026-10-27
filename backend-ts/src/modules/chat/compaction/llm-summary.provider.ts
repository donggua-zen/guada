/**
 * LLM 摘要提供器（SummaryProvider 的 LLM 实现）
 *
 * 对齐 deepseek-harness summarizer：
 * - COMPACTION_INSTRUCTION 作为**最后一条 user 消息**（非独立 system prompt）
 * - 前缀缓存可复用时（同模型、上一次主请求即当前模型）走 KV 缓存友好模式：
 *   `[...prelude, ...被压缩区域消息, 指令]` + 相同的工具定义，命中 warm prefix cache；
 *   模型刚切换 / 使用专用压缩模型时前缀缓存已失效，改走"序列化单 user 消息"分支
 *   （跳过思考、截断工具结果、图片/文件只留标记），显著缩小摘要请求。
 * - 流式传输 + BlockAssembler 累积（对齐 DSH ctx.llm.stream()），拿 usage/finishReason
 * - 增量合并旧 <compacted-summary> 检查点（从历史 compaction 事件提取）
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
import { serializeSummaryMessages } from './summary-serializer';

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
  /**
   * 摘要模型与会话模型不同（专用压缩模型）：buildParams 产出的是主请求模型/供应商，
   * 必须用摘要模型自身覆盖 model/provider/thinkingEffort/能力，否则摘要请求会发错端点。
   */
  overrideModel?: boolean;
}

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
    // 无稳定前缀（模型刚切换/专用压缩模型）→ 序列化拼接；只算一次，诊断与请求共用
    const serializedText = this.options.prefix
      ? undefined
      : serializeSummaryMessages(input.shadowed);
    const requestMessages = this.buildRequestMessages(
      previousSummary,
      input.shadowed,
      serializedText,
      input.instructions,
    );
    const maxSummaryTokens = this.options.maxSummaryTokens ?? 2000;

    this.logger.debug(
      `[summary] generating (model=${this.model.modelName}, shadowed=${input.shadowed.length} msgs, maxTokens=${maxSummaryTokens}, mode=${this.options.prefix ? 'prefixed' : 'serialized'})`,
    );

    // 摘要请求规模诊断（只读，调用前打印——失败时也有数）：
    // prefixed：前缀（system+tools）+ 遮蔽区原消息 + 指令；serialized：单条 user 消息 + 指令。
    {
      const shadowedChars = input.shadowed.reduce(
        (n, m) => n + JSON.stringify(m.content ?? '').length,
        0,
      );
      const instruction =
        requestMessages.messages[requestMessages.messages.length - 1];
      const instructionChars = JSON.stringify(instruction?.content ?? '').length;
      const customInstructionsChars = input.instructions?.length ?? 0;
      const prefixSystemChars = this.options.prefix?.system?.length ?? 0;
      const prefixTools = this.options.prefix?.tools?.length ?? 0;
      const approx = (chars: number) => Math.ceil(chars / 3.5);
      this.logger.log(
        `[compact.diag.summary] mode=${this.options.prefix ? 'prefixed' : 'serialized'}` +
          ` shadowedMsgs=${input.shadowed.length} shadowedChars=${shadowedChars}` +
          (serializedText === undefined
            ? ''
            : ` serializedChars=${serializedText.length}`) +
          ` prefixSystemChars=${prefixSystemChars} prefixTools=${prefixTools} instructionChars=${instructionChars}` +
          ` customInstructionsChars=${customInstructionsChars}` +
          ` approxPrefixTokens=${approx(prefixSystemChars)} approxShadowedTokens=${approx(serializedText?.length ?? shadowedChars)}` +
          ` maxTokens=${maxSummaryTokens}`,
      );
    }

    // 请求参数组装（复用 builder 时保持与主请求同源；序列化/专用模型分支做覆盖）
    let params: LLMCompletionParams;
    if (this.options.buildParams) {
      params = this.options.buildParams(requestMessages.messages);
      if (requestMessages.system !== undefined) params.system = requestMessages.system;
      if (requestMessages.tools !== undefined) params.tools = requestMessages.tools;
      if (this.options.prefix === undefined) {
        // 序列化分支没有"主请求前缀"可复用：不再携带主请求的 system/tools
        //（摘要指令自包含；也避免把主模型的工具 schema 发给专用压缩模型）。
        params.system = requestMessages.system;
        params.tools = requestMessages.tools;
        // 无缓存可保：摘要调用不需要思考模式（与手工组装分支一致）。
        params.thinkingEffort = resolveThinkingEffort(this.model, 'none');
      }
      if (this.options.overrideModel) {
        // 专用压缩模型：buildParams 的 model/provider/能力来自会话主模型，必须用摘要模型覆盖，
        // 否则摘要请求会发到主模型端点（预算按摘要模型窗口算、请求却走主模型）。
        params.model = this.model.modelName || params.model;
        params.providerConfig = this.model.provider ?? params.providerConfig;
        params.modelCapabilities = {
          supportsImageInput:
            this.model.config?.inputCapabilities?.includes('image') ?? false,
        };
        params.thinkingEffort = resolveThinkingEffort(this.model, 'none');
        params.temperature = this.model.config?.temperature ?? 0.4;
      }
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

    // 流式调用（对齐 DSH ctx.llm.stream() 单次调用语义）。仅对"空文本"做一次重试：
    // 实测同一请求曾返回 2000 token / finish_reason=length 但无文本（21:39），
    // 同参数下一次请求成功（21:53）——属于瞬时失败，直接抛错会把原始 400 暴露给用户。
    const MAX_EMPTY_SUMMARY_ATTEMPTS = 2;
    let summary = '';
    let usage: SummaryResult['usage'] | undefined;
    for (let attempt = 1; attempt <= MAX_EMPTY_SUMMARY_ATTEMPTS; attempt += 1) {
      const stream = (await this.llmService.completions(
        params,
      )) as AsyncGenerator<StreamChunk>;
      const assembler = new BlockAssembler();
      for await (const chunk of stream) {
        assembler.push(chunk);
      }
      const snapshot = assembler.snapshot();
      usage = snapshot.usage;
      summary = snapshot.blocks
        .filter(
          (b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text',
        )
        .map((b) => b.text)
        .join('')
        .trim();
      if (summary) break;
      this.logger.warn(
        `[summary] empty content (attempt ${attempt}/${MAX_EMPTY_SUMMARY_ATTEMPTS})` +
          `, finishReason=${(snapshot as any).finishReason ?? 'unknown'}; retrying`,
      );
    }
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
    serializedText?: string,
    instructions?: string,
  ): { system?: string; messages: Message[]; tools?: ToolDefinition[] } {
    const checkpointBlock = previousSummary
      ? `<compacted-summary>\n${previousSummary}\n</compacted-summary>\n\n`
      : '';
    // 手动命令的附加指令（/compact <instructions>）：只作为本次摘要请求的临时指令，
    // 不写用户消息、不落库、不进对话历史（对齐 zcode 的 Additional Instructions）。
    const additionalBlock = instructions?.trim()
      ? `\n\nAdditional Instructions:\n${instructions.trim()}`
      : '';
    // 指令以 <system_reminder> 标签包裹（GuaDa 系统级注入惯例）
    const instruction =
      `<system_reminder>\n${COMPACTION_INSTRUCTION}${additionalBlock}\n\n${checkpointBlock}Compression checkpoint:\n</system_reminder>`;

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
    const shadowedText = serializedText ?? serializeSummaryMessages(shadowed);
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