/**
 * StreamBlockTracker —— 无原生块边界协议的块生命周期合成器
 *
 * 参考 deepseek-harness 的 translate 模式：OpenAI / Gemini 等 wire 流没有
 * block start/end 边界事件，由本跟踪器负责：
 * - 首个增量到达前自动合成 block_start
 * - 按"通道首见顺序"分配输出 index（text:{itemId} / reasoning / tool:{wireIndex} 各一条通道）
 * - 通道切换时立即闭合前序通道（reasoning → text/tool 首见即补发其 block_end，
 *   对齐 Anthropic 原生 content_block_stop 时机，下游思考态即时翻转）
 * - 收尾时为剩余未闭合块按序补发 block_end（携带组装完成的权威块），
 *   保证下游拿到的协议形态与 Anthropic 原生 content_block 流一致
 *
 * 文本通道按上游 item_id 分道（对齐 ZCode 的 getOrCreateTextBlock）：
 * GPT6 类上游会先发一个只含空格的 message item（有时带 sub2api_placeholder，
 * 有时不带），随后才发 reasoning、最后才是真正的正文。若把所有文本塞进同一条
 * 通道，这个空格会先占住正文块，真正的正文被追加进去，最终顺序变成
 * 「正文 → 思考」（思考倒挂）。按 item_id 分道后，空格自成一块（内容原样保留），
 * 真正文块排在 reasoning 之后，顺序与上游到达顺序一致。
 *
 * 注意：参数修复不在本层做——BlockAssembler 是唯一的组装/修复权威。
 */

import type { ContentBlock } from "../../../common/types/conversation.types";
import type { StreamChunk } from "../../../common/types/stream-chunk.types";

/** 通道中间态 */
interface OpenLane {
  type: "text" | "reasoning" | "tool-call";
  /**
   * 输出 index（按块开启顺序分配）。
   * 只在发出 block_start 时分配；通道先建后开（如工具参数缓发）时不会提前占号。
   */
  index?: number;
  text?: string;
  toolCallId?: string;
  name?: string;
  arguments?: string;
  /** 已补发 block_end 闭合（通道切换时前置闭块；closeAll 跳过防止重复） */
  closed?: boolean;
  /**
   * 工具参数是否已确认收齐（收到协议终止事件后由 adapter 显式 finalize）。
   * false/undefined 表示流提前结束，closeAll 会写 argumentsComplete=false，
   * 下游恢复层据此拒绝执行半截工具。
   */
  finalized?: boolean;
}

export class StreamBlockTracker {
  /** wire 工具 index / 文本 item_id → 通道键；文本按 item_id 分道 */
  private lanes = new Map<string, OpenLane>();

  /** 交错重开时的通道键序号（避免 key 冲突） */
  private laneSeq = 0;

  /** 下一个块 index；只在块开启时递增（与 ZCode 的 blockIndex 语义一致） */
  private nextIndex = 0;

  private allocateIndex(): number {
    return this.nextIndex++;
  }

  private lastAllocatedIndex(): number | undefined {
    return this.nextIndex > 0 ? this.nextIndex - 1 : undefined;
  }

  private ensure(key: string, type: OpenLane["type"]): OpenLane {
    let lane = this.lanes.get(key);
    if (!lane) {
      lane = { type };
      this.lanes.set(key, lane);
    }
    return lane;
  }

  /**
   * 立即闭合指定类型的未闭通道并补发 block_end。
   *
   * 通道切换语义：reasoning → text/tool 首见即代表思考通道终结，与 Anthropic
   * 原生 content_block_stop 的闭块时机对齐（否则 block_end 延迟到流尾，
   * 下游"思考中"状态在整个正文输出期间无法翻转）。空 text/reasoning 只标记
   * 闭合不发块（与 closeAll 的空块规则一致）。
   */
  private closeOpenLanes(
    chunks: StreamChunk[],
    types: Array<"text" | "reasoning">,
  ): void {
    for (const lane of this.lanes.values()) {
      if (lane.closed || lane.index === undefined) continue;
      if (!types.includes(lane.type as "text" | "reasoning")) continue;
      lane.closed = true;
      if (lane.type === "text" && lane.text) {
        chunks.push({
          type: "block_end",
          index: lane.index,
          block: { type: "text", text: lane.text },
        });
      } else if (lane.type === "reasoning" && lane.text) {
        chunks.push({
          type: "block_end",
          index: lane.index,
          block: { type: "reasoning", summary: lane.text },
        });
      }
    }
  }

  /**
   * 文本增量：必要时先产出 block_start，再产出 text_delta。
   *
   * itemId 用于把上游不同的 message item 分成不同块。GPT6 类上游会先发一个
   * 只含空格的 message item（占位/前导），随后才是 reasoning 与真正文；
   * 若共用一条通道，空格会先占住正文块并把真正文并进去，导致思考倒挂。
   *
   * 纯空白内容也照常开块、原样保留（对齐 ZCode：开块时不看空白），
   * 避免模型真的只输出空白时内容被丢弃。
   */
  textDelta(text: string, itemId?: string): StreamChunk[] {
    if (!text) return [];
    const baseKey = `text:${itemId ?? ""}`;
    let key = baseKey;
    let lane = this.lanes.get(key);
    // 同一 item_id 在其它块之后再次出现（工具调用后复用 id）时新开通道，
    // 保持流顺序（对齐 ZCode 的 getOrCreateTextBlock 规则）。
    // 无 item_id 的协议（Chat/Gemini）不启用：它们没有 item 身份，
    // reasoning 与正文交替时按 chunk 拆块会把一段正文碎成多块。
    if (
      lane &&
      (lane.closed === true ||
        (itemId !== undefined &&
          lane.index !== undefined &&
          lane.index !== this.lastAllocatedIndex()))
    ) {
      key = `${baseKey}:${++this.laneSeq}`;
      lane = this.lanes.get(key);
    }
    if (!lane) {
      lane = { type: "text" };
      this.lanes.set(key, lane);
    }
    const chunks: StreamChunk[] = [];
    if (lane.text === undefined) lane.text = "";
    lane.text += text;

    if (lane.index === undefined) {
      this.closeOpenLanes(chunks, ["reasoning"]);
      lane.index = this.allocateIndex();
      chunks.push({ type: "block_start", index: lane.index, blockType: "text" });
    }
    chunks.push({ type: "text_delta", index: lane.index, text });
    return chunks;
  }

  /** 思考增量：必要时先产出 block_start，再产出 reasoning_delta */
  reasoningDelta(text: string): StreamChunk[] {
    if (!text) return [];
    // 已闭合的 reasoning 通道（text/tool 切换后再度思考）新开通道，
    // 避免向已发 block_end 的块追加增量；仍打开的通道直接追加
    // （Chat 协议的 reasoning_content 与 content 会交替出现，不能按类型切换拆块）。
    const existing = this.lanes.get("reasoning");
    const key = existing?.closed ? `reasoning:${++this.laneSeq}` : "reasoning";
    const lane = this.ensure(key, "reasoning");
    const chunks: StreamChunk[] = [];
    if (lane.text === undefined) {
      lane.text = "";
    }
    if (lane.index === undefined) {
      lane.index = this.allocateIndex();
      chunks.push({ type: "block_start", index: lane.index, blockType: "reasoning" });
    }
    lane.text += text;
    chunks.push({ type: "reasoning_delta", index: lane.index, text });
    return chunks;
  }

  /** 工具调用增量：按 wire index 分通道；toolCallId/name 首次或回填时携带 */
  toolCallDelta(
    wireIndex: number,
    delta: { toolCallId?: string; name?: string; argumentsDelta?: string },
  ): StreamChunk[] {
    const key = `tool:${wireIndex}`;
    const lane = this.ensure(key, "tool-call");
    const chunks: StreamChunk[] = [];
    if (lane.index === undefined) {
      // 首见该工具通道：先终结前序文本/思考通道，再开块。
      // id/name 可能缺省（上游缓发），后续 delta 回填
      this.closeOpenLanes(chunks, ["text", "reasoning"]);
      lane.index = this.allocateIndex();
      chunks.push({ type: "block_start", index: lane.index, blockType: "tool-call" });
      lane.arguments = "";
    }
    const first: Partial<Extract<StreamChunk, { type: "tool_call_delta" }>> = {};
    if (delta.toolCallId && !lane.toolCallId) {
      lane.toolCallId = delta.toolCallId;
      first.toolCallId = delta.toolCallId;
    }
    if (delta.name && !lane.name) {
      lane.name = delta.name;
      first.name = delta.name;
    }
    if (delta.argumentsDelta) lane.arguments = (lane.arguments || "") + delta.argumentsDelta;
    chunks.push({
      type: "tool_call_delta",
      index: lane.index,
      ...first,
      argumentsDelta: delta.argumentsDelta || "",
    });
    return chunks;
  }

  /**
   * 标记一个工具通道的参数已收齐（Anthropic content_block_stop /
   * Chat finish_reason / Gemini 完整 functionCall 等协议终止信号）。
   */
  finalizeToolCall(wireIndex: number): void {
    const lane = this.lanes.get(`tool:${wireIndex}`);
    if (lane?.type === "tool-call") lane.finalized = true;
  }

  /** 标记全部工具通道参数已收齐（流正常结束、收到协议终止事件后调用）。 */
  finalizeAllToolCalls(): void {
    for (const lane of this.lanes.values()) {
      if (lane.type === "tool-call") lane.finalized = true;
    }
  }

  /**
   * 流收尾：按通道创建顺序为所有未闭合块补发 block_end；
   * 空 text/reasoning 不发（与 BlockAssembler 组装规则一致），工具调用始终闭合。
   * 通道切换时已前置闭块的 lane 在此跳过（防重复 block_end）。
   * 纯空白文本照常成块（对齐 ZCode：开块与收尾都不看空白，内容原样保留）。
   *
   * 工具块显式携带 argumentsComplete：只有 adapter 在终止事件后 finalize 过的
   * 才算完整；流提前结束时未 finalize 的通道一律标记 false，恢复层据此丢弃。
   */
  closeAll(): StreamChunk[] {
    const chunks: StreamChunk[] = [];
    for (const lane of this.lanes.values()) {
      if (lane.closed || lane.index === undefined) continue;
      if (lane.type === "tool-call") {
        const block: ContentBlock = {
          type: "tool-call",
          toolCallId: lane.toolCallId || "",
          name: lane.name || "",
          arguments: lane.arguments || "",
          argumentsComplete: lane.finalized === true,
        };
        chunks.push({ type: "block_end", index: lane.index, block });
        continue;
      }
      if (!lane.text) continue;
      chunks.push({
        type: "block_end",
        index: lane.index,
        block:
          lane.type === "text"
            ? { type: "text", text: lane.text }
            : { type: "reasoning", summary: lane.text },
      });
    }
    return chunks;
  }
}
