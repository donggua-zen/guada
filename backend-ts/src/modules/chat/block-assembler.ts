/**
 * BlockAssembler —— 全仓唯一的 StreamChunk → ContentBlock[] 组装器
 *
 * 参考 deepseek-harness 的同名设计：
 * - agent 循环与测试共用这一个实现，杜绝多处各写一遍参数累加
 * - block_end 携带的权威终态优先（first close wins，闭合后忽略迟到 delta）
 * - 中断/截断语义：文本保留非空前缀，工具调用参数经 partialParse 修复，
 *   保证"存储的内容永远被元数据如实描述"
 * - seed() 支持断点续传：以历史 Message 的既有块预置，新流块的 index 自动接续偏移
 */

import { Logger } from "@nestjs/common";
import { partialParse } from "partial-json-parser";
import { logPreview } from "../../common/utils/log-preview.util";
import type {
  BlockTiming,
  ContentBlock,
  Message,
} from "../../common/types/conversation.types";
import type { StreamChunk, StreamUsage } from "../../common/types/stream-chunk.types";

/** 流中未闭合块的中间态 */
interface PartialBlock {
  index: number;
  type: "text" | "reasoning" | "tool-call";
  /** text/reasoning 增量累积 */
  text: string;
  /** tool-call 字段 */
  toolCallId?: string;
  name?: string;
  arguments?: string;
  /** 块生命周期计时：ensure 首见打点，闭合/组装时收口 */
  startedAt?: number;
  finishedAt?: number;
  /** block_end 冻结的权威终态（首个 block_end 生效） */
  block?: ContentBlock;
}

export interface AssembledResult {
  blocks: ContentBlock[];
  usage?: StreamUsage;
  finishReason?: string;
  signature?: string;
  redactedData?: string;
}

export class BlockAssembler {
  private readonly logger = new Logger(BlockAssembler.name);
  private partials = new Map<number, PartialBlock>();
  /** 块出现顺序（按首见 index） */
  private order: number[] = [];
  /** 断点续传偏移：seed 后新流块的 wire index 映射为 wireIndex + offset */
  private indexOffset = 0;
  /** 最近一次 push 的到达时间（中断/截断块的收口时间） */
  private lastPushAt?: number;
  /** seed 的既有块快照（reset 时恢复到 seed 后初始态） */
  private seededBlocks: ContentBlock[] | null = null;
  private usage?: StreamUsage;
  private finishReason?: string;
  private signature?: string;
  private redactedData?: string;

  /**
   * 重试场景：清空当前尝试的累积，恢复到 seed 后的初始态。
   * 续传前缀（seededBlocks）保留——重试不丢历史消息内容。
   */
  reset(): void {
    this.partials.clear();
    this.order = [];
    this.indexOffset = 0;
    this.lastPushAt = undefined;
    this.usage = undefined;
    this.finishReason = undefined;
    this.signature = undefined;
    this.redactedData = undefined;
    if (this.seededBlocks) {
      this.seed(this.seededBlocks);
    }
  }

  /**
   * 断点续传预置：以历史 Message 的既有块作为前缀，后续流块 index 接续。
   * 取代旧的 Message→MessageRecord 平铺还原（messageToFlat + Object.assign）。
   */
  seed(blocks: ContentBlock[]): void {
    for (const block of blocks) {
      const index = this.order.length;
      this.order.push(index);
      this.partials.set(index, {
        index,
        type: block.type as PartialBlock["type"],
        text: "",
        block,
      });
    }
    this.indexOffset = blocks.length;
    this.seededBlocks = [...blocks];
  }

  /** 流内 wire index → 组装 index（seed 偏移后） */
  private mapIndex(wireIndex: number): number {
    return wireIndex + this.indexOffset;
  }

  private ensure(index: number, type: PartialBlock["type"]): PartialBlock {
    let partial = this.partials.get(index);
    if (!partial) {
      // 块首见即打点（startedAt），后续闭合/组装时收口 finishedAt
      partial = { index, type, text: "", startedAt: Date.now() };
      this.partials.set(index, partial);
      this.order.push(index);
    }
    return partial;
  }

  push(chunk: StreamChunk): void {
    this.lastPushAt = Date.now();
    switch (chunk.type) {
      case "block_start":
        // 仅记录块类型；字段在首个 delta 到达时补齐
        this.ensure(this.mapIndex(chunk.index), this.partialTypeOf(chunk.blockType));
        return;

      case "text_delta":
      case "reasoning_delta": {
        const partial = this.ensure(
          this.mapIndex(chunk.index),
          chunk.type === "text_delta" ? "text" : "reasoning",
        );
        if (partial.block) return; // 已被 block_end 闭合，忽略迟到 delta
        partial.text += chunk.text;
        return;
      }

      case "tool_call_delta": {
        const partial = this.ensure(this.mapIndex(chunk.index), "tool-call");
        if (partial.block) return;
        if (chunk.toolCallId && !partial.toolCallId) partial.toolCallId = chunk.toolCallId;
        if (chunk.name && !partial.name) partial.name = chunk.name;
        partial.arguments = (partial.arguments || "") + chunk.argumentsDelta;
        return;
      }

      case "block_end": {
        const index = this.mapIndex(chunk.index);
        const partial = this.ensure(index, this.partialTypeOf(chunk.block.type));
        if (partial.block) return; // first close wins
        partial.finishedAt = Date.now();
        partial.block = this.withTiming(
          this.normalizeBlock(chunk.block),
          partial,
        );
        return;
      }

      case "usage":
        this.usage = chunk.usage;
        return;

      case "finish":
        this.finishReason = chunk.finishReason;
        if (chunk.signature) this.signature = chunk.signature;
        if (chunk.redactedData) this.redactedData = chunk.redactedData;
        return;
    }
  }

  private partialTypeOf(blockType: string): PartialBlock["type"] {
    if (blockType === "reasoning") return "reasoning";
    if (blockType === "tool-call") return "tool-call";
    return "text";
  }

  /** 把块生命周期计时写入块（assembler 是 timing 的唯一权威来源） */
  private withTiming<T extends ContentBlock>(block: T, partial: PartialBlock): T {
    if (!partial.startedAt) return block;
    const timing: BlockTiming = { startedAt: partial.startedAt };
    if (partial.finishedAt !== undefined) timing.finishedAt = partial.finishedAt;
    return { ...block, timing };
  }

  /**
   * 取已组装（含 timing 打点）的权威块。
   * 供广播层在 block_end 直通前回填计时后的块，保证广播与持久化内容一致。
   */
  getTimedBlock(wireIndex: number): ContentBlock | undefined {
    const partial = this.partials.get(this.mapIndex(wireIndex));
    return partial?.block;
  }

  /**
   * 采纳 block_end 权威块前的归一化：
   * - tool-call 参数统一过 repairArguments（正常完成也可能有无效 JSON，与未闭合块同规则）
   * - 保留 argumentsComplete 标记：false 时下游拒绝执行（半截 JSON 不能拿去跑工具）
   * （P6c：原 contentId 回填逻辑已随 contentId 字段一并删除）
   */
  private normalizeBlock(block: ContentBlock): ContentBlock {
    if (block.type === "tool-call") {
      return {
        ...block,
        arguments: this.repairArguments(block.arguments, {
          toolCallId: block.toolCallId,
          name: block.name,
        }),
      };
    }
    return block;
  }

  /** 是否已有任何可见内容（用于"干净提前断流"检测） */
  hasContent(): boolean {
    for (const index of this.order) {
      const partial = this.partials.get(index);
      if (!partial) continue;
      if (partial.block) return true;
      if ((partial.type === "text" || partial.type === "reasoning") && partial.text) return true;
      if (partial.type === "tool-call") return true;
    }
    return false;
  }

  /** 按出现顺序组装权威块列表（未闭合块从增量组装；空 text/reasoning 丢弃） */
  blocks(opts?: { preserveRawArguments?: boolean }): ContentBlock[] {
    const preserveRaw = opts?.preserveRawArguments === true;
    const result: ContentBlock[] = [];
    for (const index of this.order) {
      const partial = this.partials.get(index);
      if (!partial) continue;

      // block_end 权威终态优先
      if (partial.block) {
        if (preserveRaw && partial.block.type === "tool-call") {
          // 审计路径：保留模型原始输出（可能是半截 JSON），不做修复。
          // 这类消息一律 excludedFromContext，非法 JSON 不会发给上游。
          result.push({
            ...partial.block,
            arguments: partial.arguments || partial.block.arguments,
            argumentsComplete: partial.block.argumentsComplete,
          });
        } else {
          result.push(partial.block);
        }
        continue;
      }

      if (partial.type === "tool-call") {
        const raw = partial.arguments || "";
        result.push(
          this.withTiming(
            {
              type: "tool-call",
              toolCallId: partial.toolCallId || "",
              name: partial.name || "",
              arguments: preserveRaw
                ? raw
                : this.repairArguments(raw, {
                    toolCallId: partial.toolCallId,
                    name: partial.name,
                  }),
              // 未闭合块不主动标 false：Chat/Anthropic 适配器本来就不发参数完整性
              // 标记，若这里默认 false 会把正常工具调用全部判成截断。
              // 只有 Responses 适配器在断流时显式发 block_end(argumentsComplete=false)
              // 才会命中该分支。
            },
            partial,
          ),
        );
        continue;
      }

      // text / reasoning：空内容不成块（与旧 flatToMessage 行为一致）
      if (!partial.text) continue;
      // 中止/截断的未闭合块：以最近一次流活动时间收口，时长仍完整
      partial.finishedAt = partial.finishedAt ?? this.lastPushAt;
      result.push(
        this.withTiming(
          partial.type === "text"
            ? { type: "text", text: partial.text }
            : { type: "reasoning", summary: partial.text },
          partial,
        ),
      );
    }
    return result;
  }

  /** 累积结果快照（块 + 回合级元数据） */
  snapshot(): AssembledResult {
    return {
      blocks: this.blocks(),
      usage: this.usage,
      finishReason: this.finishReason,
      signature: this.signature,
      redactedData: this.redactedData,
    };
  }

  /**
   * 组装为三层 assistant Message。
   *
   * 【DSH 对齐（agent.ts:354-390）】空内容（assembler 未累加任何有效 chunk）返回 null——
   * 立即报错/中止无任何产出时不应落库空 assistant 消息；业务错误归拢 turn 级（finalizeTurn）。
   * 调用方以 null 判定"无有效消息"，跳过落库与一切消息后处理（工具注入等）。
   *
   * @param opts.id 消息 id（与落库/SSE 一致）
   * @param opts.extraMetadata 额外元数据（modelName 等），浅合并
   * @returns 组装后的 Message；无有效内容返回 null
   */
  toMessage(opts: {
    id: string;
    provider?: string;
    model?: string;
    extraMetadata?: Message["metadata"];
    /**
     * 审计路径：工具参数保留模型原始输出（可能是半截 JSON），不做 partialParse 修复。
     * 用于被丢弃的截断消息——它们一律 excludedFromContext，非法 JSON 不会发给上游。
     */
    preserveRawArguments?: boolean;
  }): Message | null {
    if (!this.hasContent()) return null;

    const metadata: Message["metadata"] = { ...opts.extraMetadata };
    if (this.usage) metadata.usage = this.usage;
    if (this.signature) metadata.signature = this.signature;
    if (this.redactedData) metadata.redactedData = this.redactedData;
    if (this.finishReason) metadata.finishReason = this.finishReason;

    return {
      id: opts.id,
      role: "assistant",
      kind: "model",
      source: { kind: "model", provider: opts.provider || "", model: opts.model || "" },
      metadata,
      content: this.blocks({
        preserveRawArguments: opts.preserveRawArguments === true,
      }),
    };
  }

  /**
   * 修复不完整的工具调用参数 JSON
   *
   * 用户中止或 max-tokens 截断时 arguments 可能是残缺 JSON；
   * 用 partialParse 解析后重新序列化为合法 JSON，
   * 确保下游消费方（LLM 回传、持久化）不报错。正常完成时模型也可能输出无效 JSON。
   */
  repairArguments(
    args: string,
    context?: { toolCallId?: string; name?: string },
  ): string {
    const tool = context?.name || "(no-name)";
    const id = context?.toolCallId || "(no-id)";
    if (!args || typeof args !== "string") {
      // 这里是“空参数 → {}”的第一现场。必须把原始值和工具元信息打出来，
      // 否则后续 Zod 只会看到 {}，无法判断是模型没写还是采集/组装丢了。
      this.logger.warn(
        `[tool-args] empty/non-string arguments -> {} tool=${tool} id=${id} rawType=${typeof args} raw=${logPreview(args)}`,
      );
      return "{}";
    }
    try {
      JSON.parse(args);
      return args;
    } catch (parseError) {
      try {
        const parsed = partialParse(args);
        const repaired = JSON.stringify(parsed);
        this.logger.warn(
          `[tool-args] invalid JSON repaired tool=${tool} id=${id} rawLen=${args.length} raw=${logPreview(args)} repaired=${logPreview(repaired)} error=${parseError instanceof Error ? parseError.message : String(parseError)}`,
        );
        return repaired;
      } catch {
        this.logger.warn(
          `[tool-args] invalid JSON -> {} tool=${tool} id=${id} rawLen=${args.length} raw=${logPreview(args)} error=${parseError instanceof Error ? parseError.message : String(parseError)}`,
        );
        return "{}";
      }
    }
  }
}
