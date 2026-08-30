/**
 * 领域事件类型（JSONL 存储事件 `BaseEvent` 的前端镜像）。
 *
 * 事件页端点直接返回后端 JSONL 领域事件（seq 序），前端折叠器（streamProjector）
 * 直接消费——不再要求后端转码为块级 SSE 事件。与 live SSE 的 WireStreamEvent
 * （块级增量协议）为两种独立输入形态，折叠器同时支持。
 */
import type { ContentBlock } from "./content-block.types";

/** 用户消息附件（MessageFile 前端镜像） */
export interface DomainFile {
  fileId: string;
  fileName?: string;
  displayName?: string;
  fileSize?: number;
  fileType?: string;
  url?: string;
  previewUrl?: string;
}

/** 领域事件（判别联合；type 为后端 EventType，含 '/'） */
export type DomainEvent =
  | {
      type: "turn/start";
      seq: number;
      data: { turnId: string; kind?: string; metadata?: Record<string, unknown> };
    }
  | { type: "turn/resume"; seq: number; data: { turnId: string } }
  | {
      type: "turn/finish";
      seq: number;
      data: {
        turnId: string;
        promptTokens?: number;
        completionTokens?: number;
        cachedTokens?: number;
        totalTokens?: number;
        finishReason?: string;
        totalDurationMs?: number;
        errorDetail?: unknown;
        modelName?: string;
      };
    }
  | {
      type: "user/message";
      seq: number;
      data: {
        messageId: string;
        kind?: "user" | "model";
        content?: string;
        files?: DomainFile[];
        metadata?: Record<string, unknown>;
      };
    }
  | {
      type: "assistant/message";
      seq: number;
      data: {
        messageId: string;
        content: ContentBlock[];
        files?: DomainFile[];
        metadata?: Record<string, unknown>;
      };
    }
  | {
      type: "tool/result";
      seq: number;
      data: {
        messageId: string;
        toolCallId: string;
        name?: string;
        content: string;
        isError?: boolean;
        metadata?: Record<string, unknown>;
      };
    }
  | { type: "turn/delete"; seq: number; data: { turnId: string } }
  | {
      type: "compaction/summary";
      seq: number;
      data: { shadowedMessageIds: string[]; summary: string; summaryMessageId?: string };
    }
  | { type: "message/prune"; seq: number; data: { messageId: string; newContent: string; strategy?: string; prunedBytes?: number } }
  | { type: "command/run"; seq: number; data: Record<string, unknown> }
  | { type: "command/done"; seq: number; data: Record<string, unknown> }
  | { type: "compaction/start"; seq: number; data: Record<string, unknown> }
  | { type: "compaction/end"; seq: number; data: Record<string, unknown> }
  | { type: "ask/asked"; seq: number; data: Record<string, unknown> }
  | { type: "ask/answered"; seq: number; data: Record<string, unknown> }
  | { type: "session/init"; seq: number; data: Record<string, unknown> }
  | { type: "session/rotate"; seq: number; data: Record<string, unknown> }
  | { type: "envelope"; seq: number; data: Record<string, unknown> };
