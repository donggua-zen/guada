/**
 * 规范流式词汇表（StreamChunk 判别联合）
 *
 * 与后端 backend-ts/src/common/types/stream-chunk.types.ts 逐字段同构
 * （命名/判别字面量/字段结构一致）——SSE 流协议消息级事件的正文字段。
 * 一套词表贯穿 adapter → agent 循环 → SSE 广播 → 前端 reducer：
 * - 块生命周期三段式：block_start 开块 → *_delta 增量 → block_end 闭块（携带组装完成的权威块）
 * - index 为一次 LLM 调用内的块序号；同一 index 的 start/delta/end 归属同一个块
 * - usage 固定先于 finish；finish 是终端事件，之后不得再有 chunk
 * - 失败不抛异常穿越流：统一折叠为终端 finish（finishReason='error' | 'aborted' 等）
 *
 * 迁移说明：将来做前后端共享包时，本文件整体搬入 packages/shared/src/stream/。
 */

import type { ContentBlock, ContentBlockType } from "./content-block.types";

/** 流式 usage（各供应商缓存明细为私有扩展，非所有供应商都有） */
export interface StreamUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cachedTokens?: {
    /** 从缓存读取的 token 数（缓存命中） */
    read?: number;
    /** 写入缓存的 token 数（首次创建缓存，Anthropic 特有） */
    written?: number;
    /** 缓存未命中的 token 数（DeepSeek 特有） */
    missed?: number;
  };
}

/**
 * LLM 流式 chunk 判别联合
 *
 * LLM 输出只会产生 text / reasoning / tool-call 三种块；
 * block_end 携带的 ContentBlock 为该块的权威终态，下游可直接采用而无需自行拼接。
 */
export type StreamChunk =
  | { type: "block_start"; index: number; blockType: ContentBlockType }
  | { type: "text_delta"; index: number; text: string }
  | { type: "reasoning_delta"; index: number; text: string }
  /** 工具参数增量分片：argumentsDelta 为模型产出的原始 JSON 字符串片段；toolCallId/name 首块携带（或后续回填） */
  | {
      type: "tool_call_delta";
      index: number;
      toolCallId?: string;
      name?: string;
      argumentsDelta: string;
    }
  | { type: "block_end"; index: number; block: ContentBlock }
  | { type: "usage"; usage: StreamUsage }
  | {
      type: "finish";
      finishReason: string;
      /** Anthropic extended thinking signature，用于多轮思考连续性回传 */
      signature?: string;
      /** Anthropic redacted thinking data（display=omitted 时的加密思考内容） */
      redactedData?: string;
    };

export type StreamChunkType = StreamChunk["type"];