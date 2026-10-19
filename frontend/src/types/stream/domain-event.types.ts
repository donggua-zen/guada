/**
 * 领域事件类型（JSONL 存储事件 `BaseEvent` 的前端镜像）。
 *
 * 事件页端点直接返回后端 JSONL 领域事件（seq 序），前端折叠器（streamProjector）
 * 直接消费——不再要求后端转码为块级 SSE 事件。与 live SSE 的 WireStreamEvent
 * （块级增量协议）为两种独立输入形态，折叠器同时支持。
 */
import type { ContentBlock } from "./content-block.types";

/**
 * 用户消息附件（FileRef 前端镜像，self-contained 契约）。
 * 新事件 blocks 内嵌完整元数据；files 平铺仅旧数据读取兼容。
 */
export interface DomainFile {
  /** MIME 类型 */
  mediaType: string;
  /** 字节数 */
  bytes: number;
  name?: string;
  /** 相对存储路径（uploads/...） */
  url?: string;
  previewUrl?: string;
  fileExtension?: string;
  /** @deprecated 旧数据标识 */
  fileId?: string;
  /** @deprecated 旧数据字段 */
  fileName?: string;
  /** @deprecated 旧数据字段 */
  displayName?: string;
  /** @deprecated 旧数据字段 */
  fileSize?: number;
  /** @deprecated 旧数据字段 */
  fileType?: string;
}

/** 领域事件（判别联合；type 为后端 EventType，含 '/'） */
export type DomainEvent =
  | {
      type: "turn/start";
      seq: number;
      data: {
        turnId: string;
        kind?: string;
        metadata?: Record<string, unknown>;
        /** 随事件自包含的回合模型名（旧事件无此字段，向后兼容） */
        modelName?: string;
      };
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
        errorDetail?: string;
        modelName?: string;
        /** 回合后完整请求 token（envelope + 可见视图；前端上下文占用锚点） */
        usedTokens?: number;
        /** 有效上下文窗口（与 usedTokens 配套） */
        effectiveContextWindow?: number;
      };
    }
  | {
      type: "user/message";
      seq: number;
      data: {
        messageId: string;
        kind?: "user" | "model";
        /** P6：事件格式统一为 blocks（content/files 平铺已废弃） */
        blocks?: ContentBlock[];
        /** live 广播透传（user_message 事件携带完整三层 userMessage，含 source/metadata） */
        userMessage?: {
          source?: { kind: string; [key: string]: unknown };
          metadata?: Record<string, unknown>;
        };
        source?: { kind: string; [key: string]: unknown };
        /** @deprecated 旧格式平铺字段（读取兼容） */
        content?: string;
        /** @deprecated 旧格式平铺字段（读取兼容） */
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
        /** @deprecated 旧格式平铺字段（读取兼容） */
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
        /** UI 渲染元数据（仅前端消费，不进 LLM 上下文） */
        meta?: Record<string, unknown>;
        metadata?: Record<string, unknown>;
      };
    }
  | { type: "turn/delete"; seq: number; data: { turnId: string } }
  | {
      type: "compaction/summary";
      seq: number;
      data: {
        /** 遮蔽末位（分界点）消息 id——前端标记"已压缩"的唯一依据 */
        shadowedEndId?: string;
        /** 遮蔽消息条数 */
        shadowedCount?: number;
        /** 旧格式：被遮蔽消息的离散 id 清单（防御回退） */
        shadowedMessageIds?: string[];
        summary: string;
        summaryMessageId?: string;
      };
    }
  | { type: "message/prune"; seq: number; data: { messageId: string; newContent: string; strategy?: string; prunedBytes?: number } }
  | { type: "command/run"; seq: number; data: Record<string, unknown> }
  | { type: "command/done"; seq: number; data: Record<string, unknown> }
  | { type: "compaction/start"; seq: number; data: Record<string, unknown> }
  | {
      type: "compaction/end";
      seq: number;
      data: {
        sourceCommandId?: string;
        /** 压缩后完整请求 token（compacted 路径由 appendCompact 括号闭携带；prune-only 路径为独立锚点） */
        usedTokens?: number;
        /** 有效上下文窗口（与 usedTokens 配套） */
        effectiveContextWindow?: number;
      };
    }
  | { type: "ask/asked"; seq: number; data: Record<string, unknown> }
  | { type: "ask/answered"; seq: number; data: Record<string, unknown> }
  | {
      type: "context/stats";
      seq: number;
      data: {
        /** 所属回合（重答/删除回合过滤用） */
        turnId: string;
        /** 当前完整请求 token（与 turn/finish 同口径） */
        usedTokens: number;
        /** 有效上下文窗口 */
        effectiveContextWindow: number;
        /** 可见视图消息数 */
        messageCount?: number;
        /** 细分 token */
        breakdown?: {
          systemPrompt: number;
          history: number;
          tools: number;
        };
      };
    }
  | { type: "workflow/event"; seq: number; data: import("./workflow.types").WorkflowEventData }
  | { type: "session/init"; seq: number; data: Record<string, unknown> }
  | { type: "session/rotate"; seq: number; data: Record<string, unknown> }
  | { type: "envelope"; seq: number; data: Record<string, unknown> };
