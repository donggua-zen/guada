/**
 * 轨迹视图 DTO（对齐 dsh RequestView 语义，REST 拉式投影）
 *
 * 台账 = 共享时间线（timeline，日志折叠 surface）+ step 卡片（steps，调用级记录）。
 * IN 区不重建 wire 视图：input 区间切片引用时间线 + transient/fullInput 补充
 * （媒体预算占位由 mediaOverlay 标注——日志即轨迹，见 docs/dsh-trajectory-migration.md）。
 */
import type { MessageNode } from '../../common/persistence/types';
import type { Envelope, StepMediaOverlayEntry } from '../../common/persistence/types';
import type { TokenUsage } from '../../common/types/conversation.types';

/** 调用状态（投影派生）：end 带 error = error；正常 end = complete；start 无 end = unclosed */
export type TrajectoryStepStatus = 'complete' | 'error' | 'unclosed';

/** IN 区输入：时间线 seq 区间切片 + 不可派生的请求侧载荷（verbatim） */
export interface TrajectoryStepInput {
  /** 时间线切片下界（含）：上一 step/end（或日志头）之后 */
  fromSeq: number;
  /** 时间线切片上界（含）：本 step/start 之前的最后一条 surface 消息 */
  toSeq: number;
  /** 主循环瞬态注入（不落 surface，verbatim 记录于 step/start） */
  transient?: import('../../common/types/conversation.types').Message[];
  /** 辅助调用全量输入（预算有界；compaction 不记录——输入可由日志派生） */
  fullInput?: import('../../common/types/conversation.types').Message[];
}

/** OUT 区输出：step 括号 seq 区间内的 assistant 块 + tool/result（共享时间线切片） */
export interface TrajectoryStepOutput {
  fromSeq: number;
  /** unclosed 步骤 = 最后一条事件 seq */
  toSeq: number;
  /** 本次调用产出的 assistant 消息 id（时间线定位锚点；空消息/失败路径缺省） */
  assistantMessageId?: string;
}

/** 一次模型调用的轨迹卡（step/start ~ step/end 配对展开） */
export interface TrajectoryStepView {
  turnId: string | null;
  /** 回合内第几次调用（agent-engine iterationCount；辅助调用为其自身序号） */
  step: number;
  source: string;
  model?: string;
  provider?: string;
  /** 同一次逻辑请求 id（重试归组） */
  requestId: string;
  status: TrajectoryStepStatus;
  /** step/start 事件时间（Unix ms） */
  startedAt: number;
  /** step/end 事件时间；unclosed 为 null */
  completedAt: number | null;
  /** step/end 携带的耗时；unclosed 为 null */
  durationMs: number | null;
  usage?: TokenUsage;
  finishReason?: string;
  /** 最终成功尝试序号（streamWithRetry 内部重试；无重试 = 0） */
  attemptIndex?: number;
  error?: { name: string; message: string };
  /** 媒体预算占位清单（本次请求被替换为文本占位的图片） */
  mediaOverlay?: StepMediaOverlayEntry[];
  startSeq: number;
  /** step/end 事件 seq；unclosed 为 null */
  endSeq: number | null;
  input: TrajectoryStepInput;
  output: TrajectoryStepOutput;
}

/** GET trajectory 响应体 */
export interface TrajectoryView {
  /** 当前生效 envelope（最后一次 envelope 事件；无 = null） */
  envelope: Envelope | null;
  /** 全部 envelope 快照（事件序；前端 SYSTEM 变更历史 / diff 展示用） */
  envelopes: Envelope[];
  /** 共享时间线（日志折叠 surface，MessageNode IS-A Message + seq/turnId） */
  timeline: MessageNode[];
  /** 调用卡（事件序）；limit 截取最近 N 个 */
  steps: TrajectoryStepView[];
  /** 会话日志里是否出现过 step 事件（false = 会话创建于轨迹功能上线前） */
  available: boolean;
  /** 全部 step 总数（limit 截断前的值，前端展示「最近 N / 共 M」） */
  totalSteps: number;
}
