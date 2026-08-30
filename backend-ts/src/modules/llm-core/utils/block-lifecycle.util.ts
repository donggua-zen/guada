/**
 * StreamBlockTracker —— 无原生块边界协议的块生命周期合成器
 *
 * 参考 deepseek-harness 的 translate 模式：OpenAI / Gemini 等 wire 流没有
 * block start/end 边界事件，由本跟踪器负责：
 * - 首个增量到达前自动合成 block_start
 * - 按"通道首见顺序"分配输出 index（text / reasoning / tool:{wireIndex} 各一条通道）
 * - 收尾时为所有未闭合块按序补发 block_end（携带组装完成的权威块），
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
}

export class StreamBlockTracker {
  /** wire 工具 index → 通道键；文本/思考各占固定通道 */
  private lanes = new Map<string, OpenLane>();

  private ensure(key: string, type: OpenLane["type"]): OpenLane {
    let lane = this.lanes.get(key);
    if (!lane) {
      lane = { type, index: this.lanes.size };
      this.lanes.set(key, lane);
    }
    return lane;
  }

  /** 文本增量：必要时先产出 block_start，再产出 text_delta */
  textDelta(text: string): StreamChunk[] {
    if (!text) return [];
    const lane = this.ensure("text", "text");
    const chunks: StreamChunk[] = [];
    if (lane.text === undefined) {
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
    const lane = this.ensure("reasoning", "reasoning");
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
      // 首见该工具通道：开块。id/name 可能缺省（上游缓发），后续 delta 回填
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
   */
  closeAll(): StreamChunk[] {
    const chunks: StreamChunk[] = [];
    for (const lane of this.lanes.values()) {
      if (lane.type === "tool-call") {
        const block: ContentBlock = {
          type: "tool-call",
          contentId: "",
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
            ? { type: "text", contentId: "", text: lane.text }
            : { type: "reasoning", contentId: "", summary: lane.text },
      });
    }
    return chunks;
  }
}
