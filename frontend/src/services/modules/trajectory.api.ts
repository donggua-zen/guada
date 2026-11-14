/**
 * 模型调用轨迹 API（GET /sessions/:sessionId/trajectory）
 *
 * 台账 = 共享时间线（timeline）+ 调用卡（steps）。类型与后端
 * backend-ts/src/modules/trajectory/trajectory.types.ts 逐字段同构。
 */
import type { ApiContext } from "./api-context";
import type { ContentBlock } from "@/types/stream/content-block.types";

// ─── 与后端 DTO 同构的视图类型 ───

/** 时间线节点（后端 MessageNode IS-A Message + seq/turnId） */
export interface TrajectoryMessageNode {
  id: string;
  role: "user" | "assistant" | "tool" | "event";
  kind: string;
  source: Record<string, unknown>;
  metadata: Record<string, unknown> & {
    usage?: TrajectoryTokenUsage;
    finishReason?: string;
    [key: string]: unknown;
  };
  content: ContentBlock[];
  createdAt?: number;
  seq: number;
  turnId: string | null;
}

export interface TrajectoryTokenUsage {
  promptTokens: number;
  completionTokens: number;
  cachedTokens?: { read?: number; written?: number; missed?: number };
  totalTokens: number;
  reasoningTokens?: number;
}

export interface TrajectoryMediaOverlayEntry {
  messageId: string;
  blockIndex: number;
  placeholder: string;
}

export interface TrajectoryStepInput {
  fromSeq: number;
  toSeq: number;
  transient?: TrajectoryMessageNode[];
  fullInput?: TrajectoryMessageNode[];
}

export interface TrajectoryStepOutput {
  fromSeq: number;
  toSeq: number;
  assistantMessageId?: string;
}

export type TrajectoryStepStatus = "complete" | "error" | "unclosed";

/** 一次模型调用的轨迹卡 */
export interface TrajectoryStepView {
  turnId: string | null;
  step: number;
  source: string;
  model?: string;
  provider?: string;
  requestId: string;
  status: TrajectoryStepStatus;
  startedAt: number;
  completedAt: number | null;
  durationMs: number | null;
  usage?: TrajectoryTokenUsage;
  finishReason?: string;
  attemptIndex?: number;
  error?: { name: string; message: string };
  mediaOverlay?: TrajectoryMediaOverlayEntry[];
  startSeq: number;
  endSeq: number | null;
  input: TrajectoryStepInput;
  output: TrajectoryStepOutput;
}

/** envelope 载荷（请求侧快照） */
export interface TrajectoryEnvelope {
  reason: string;
  system?: string;
  tools?: Array<{ name: string; description: string; parameters: Record<string, unknown> }>;
  model?: string;
  provider?: string;
}

/** envelope 快照 + 落盘位置（SYSTEM 行按 seq 插进台账流，对齐 dsh request/header 行） */
export interface TrajectoryEnvelopeSnapshot extends TrajectoryEnvelope {
  seq: number;
  time: number;
}

export interface TrajectoryView {
  envelope: TrajectoryEnvelope | null;
  /** 全部 envelope 快照（事件序；SYSTEM 行按 seq 插进台账流，变更行带 diff） */
  envelopes: TrajectoryEnvelopeSnapshot[];
  timeline: TrajectoryMessageNode[];
  steps: TrajectoryStepView[];
  /** false = 会话创建于轨迹功能上线前（无 step 事件），不伪造空卡 */
  available: boolean;
  totalSteps: number;
}

// ─── API ───

export interface TrajectoryApi {
  /** 拉取会话轨迹（limit 截取最近 N 个调用卡，后端缺省 200） */
  fetchTrajectory(
    this: ApiContext,
    sessionId: string,
    options?: { limit?: number },
  ): Promise<TrajectoryView>;
}

export const trajectoryApi: TrajectoryApi = {
  async fetchTrajectory(this: ApiContext, sessionId, options) {
    const query = options?.limit !== undefined ? `?limit=${options.limit}` : "";
    return await this._request<TrajectoryView>(`/sessions/${sessionId}/trajectory${query}`);
  },
};
