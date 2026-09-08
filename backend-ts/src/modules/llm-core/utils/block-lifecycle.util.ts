/**
 * StreamBlockTracker —— 无原生块边界协议的块生命周期合成器
 *
 * 参考 deepseek-harness 的 translate 模式：OpenAI / Gemini 等 wire 流没有
 * block start/end 边界事件，由本跟踪器负责：
 * - 首个增量到达前自动合成 block_start
 * - 按"通道首见顺序"分配输出 index（text / reasoning / tool:{wireIndex} 各一条通道）
 * - 通道切换时立即闭合前序通道（reasoning → text/tool 首见即补发其 block_end，
 *   对齐 Anthropic 原生 content_block_stop 时机，下游思考态即时翻转）
 * - 收尾时为剩余未闭合块按序补发 block_end（携带组装完成的权威块），
 *   保证下游拿到的协议形态与 Anthropic 原生 content_block 流一致
 *
 * 注意：参数修复不在本层做——BlockAssembler 是唯一的组装/修复权威。
 */

import type { ContentBlock } from "../../../common/types/conversation.types";
import type { StreamChunk } from "../../../common/types/stream-chunk.types";

/** 通道中间态 */
interface OpenLane {
  type: "text" | "reasoning" | "tool-call";
  /** 输出 index（按全通道首见顺序分配） */
  index: number;
  text?: string;
  toolCallId?: string;
  name?: string;
  arguments?: string;
  /** 已补发 block_end 闭合（通道切换时前置闭块；closeAll 跳过防止重复） */
  closed?: boolean;
}

export class StreamBlockTracker {
  /** wire 工具 index → 通道键；文本/思考各占固定通道 */
  private lanes = new Map<string, OpenLane>();

  /** reasoning 交错重开时的通道键序号（避免 key 冲突） */
  private laneSeq = 0;

  private ensure(key: string, type: OpenLane["type"]): OpenLane {
    let lane = this.lanes.get(key);
    if (!lane) {
      lane = { type, index: this.lanes.size };
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
      if (lane.closed || !types.includes(lane.type as "text" | "reasoning")) {
        continue;
      }
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

  /** 文本增量：必要时先产出 block_start，再产出 text_delta */
  textDelta(text: string): StreamChunk[] {
    if (!text) return [];
    const lane = this.ensure("text", "text");
    const chunks: StreamChunk[] = [];
    if (lane.text === undefined) {
      // 正文通道首开：思考通道立即终结
      this.closeOpenLanes(chunks, ["reasoning"]);
      chunks.push({ type: "block_start", index: lane.index, blockType: "text" });
      lane.text = "";
    }
    lane.text += text;
    chunks.push({ type: "text_delta", index: lane.index, text });
    return chunks;
  }

  /** 思考增量：必要时先产出 block_start，再产出 reasoning_delta */
  reasoningDelta(text: string): StreamChunk[] {
    if (!text) return [];
    // 已闭合的 reasoning 通道（text/tool 切换后再度思考）新开通道，
    // 避免向已发 block_end 的块追加增量
    const existing = this.lanes.get("reasoning");
    const key = existing?.closed ? `reasoning:${++this.laneSeq}` : "reasoning";
    const lane = this.ensure(key, "reasoning");
    const chunks: StreamChunk[] = [];
    if (lane.text === undefined) {
      chunks.push({ type: "block_start", index: lane.index, blockType: "reasoning" });
      lane.text = "";
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
    if (lane.arguments === undefined && lane.toolCallId === undefined && lane.name === undefined) {
      // 首见该工具通道：先终结前序文本/思考通道，再开块。
      // id/name 可能缺省（上游缓发），后续 delta 回填
      this.closeOpenLanes(chunks, ["text", "reasoning"]);
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
    if (delta.argumentsDelta) lane.arguments += delta.argumentsDelta;
    chunks.push({
      type: "tool_call_delta",
      index: lane.index,
      ...first,
      argumentsDelta: delta.argumentsDelta || "",
    });
    return chunks;
  }

  /**
   * 流收尾：按通道创建顺序为所有未闭合块补发 block_end；
   * 空 text/reasoning 不发（与 BlockAssembler 组装规则一致），工具调用始终闭合。
   * 通道切换时已前置闭块的 lane 在此跳过（防重复 block_end）。
   */
  closeAll(): StreamChunk[] {
    const chunks: StreamChunk[] = [];
    for (const lane of this.lanes.values()) {
      if (lane.closed) continue;
      if (lane.type === "tool-call") {
        const block: ContentBlock = {
          type: "tool-call",
          toolCallId: lane.toolCallId || "",
          name: lane.name || "",
          arguments: lane.arguments || "",
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
