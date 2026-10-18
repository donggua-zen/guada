/**
 * 统一 Ask 交互模型（审批 / 询问共用）
 *
 * 设计（docs/交互层统一Ask方案.md）：
 * - 审批是 ask 的特例：requestApproval = 预置单问题（同意/拒绝/自定义）+ 答案解释器
 * - 无超时：交互只有三种终结——用户应答、用户停止（abort）、重启丢表（404，不做兜底）
 * - 自定义回复 = 拒绝 + 反馈模型：文本以 isError tool-result 反馈给模型
 * - 类型对齐 DSH packages/interaction/user-questions/src/types.ts
 *   （AskUserQuestionItem/AnswerItem：多问题、选项列表、multiSelect、custom 自由文本）
 */

// ==================== 问答模型 ====================

/** 选项（label 即答案值；description 辅助说明） */
export interface AskOption {
  label: string;
  description?: string;
}

/** 单个问题：多问题批量提出，前端分页呈现 */
export interface AskQuestion {
  /** 稳定 id，答案按 id 回显 */
  id: string;
  /** 问题文本 */
  question: string;
  /** 支撑文本（审批场景 = 命令/理由详情） */
  detail?: string;
  /** 选项列表（A/B/C… 按序渲染） */
  options: AskOption[];
  /** 缺省单选；true = 多选 */
  multiSelect?: boolean;
}

/** 单个问题的答案：selected 为选中的 option label；custom = 自由文本（与单选互斥） */
export interface AskAnswerItem {
  id: string;
  selected: string[];
  custom?: string;
}

/**
 * ask 卡片分类（展示分支）：审批 / 询问。
 *
 * 曾有第三个取值 'continue'（最大工具轮次暂停确认），随轮次上限一并移除——
 * 注意与 TurnStoppingDecision 的 'continue' 无关，那是回合续跑钩子的词表。
 */
export type AskKind = "approval" | "ask";

/**
 * 卡片类型（显式分类，唯一事实源）。
 *
 * `kind` 只保留"审批 / 询问"的粗粒度（前端徽章、侧栏文案）；具体是哪一种审批
 * 由 cardKind 决定——不要再靠 title / toolName / 是否带 pathDetail 反推。
 */
export type AskCardKind =
  | "command-approval" // 命令策略（含 out-of-scope）
  | "sensitive-path" // 敏感文件访问（命令策略的路径命中）
  | "write-approval" // 工作区外文件写入
  | "plan-approval" // ExitPlanMode 计划审批
  | "generic-approval" // requestApproval（通用两选一）
  | "question"; // ask_user 提问

/**
 * 可以参与"本轮内自动放行"的卡片类型（白名单）。
 *
 * 按类型判定，而不是"调用方有没有传某个字段"——新增卡片类型默认不参与，
 * 想参与必须显式加进这里并给出对应的放行 label。
 */
export const AUTO_APPROVABLE_CARD_KINDS: ReadonlySet<AskCardKind> = new Set([
  "command-approval",
  "sensitive-path",
  "write-approval",
]);

/** 一次 ask 请求 */
export interface AskRequest {
  kind: AskKind;
  /** 卡片类型（显式分类；缺省时消费方回退到旧启发式，仅用于升级瞬间的在途帧） */
  cardKind?: AskCardKind;
  /** 卡片标题（如"进行文档处理"） */
  title?: string;
  /** 关联工具调用（"命令…"行展示 + 工具层定位） */
  toolCallId?: string;
  toolName?: string;
  /** 问题单（至少一个） */
  questions: AskQuestion[];
  /**
   * 本轮内自动放行能力（只有 AUTO_APPROVABLE_CARD_KINDS 里的类型会设置）。
   *
   * AskService 按 cardKind 选择"本轮内自动放行"选项的 label；资格由类型白名单
   * 决定，调用方不再直接传 label。
   */
  autoApprove?: "turn";
}

// ==================== wire 流帧（进 SessionStreamEvent 联合，由 chat/event-chunk 引用） ====================

/** 交互请求帧（入 eventBuffer 可重放 + SSE 直投，prevSeq 由发布面组装） */
export interface AskRequestedEvent {
  type: "ask_requested";
  /** 临时凭证（uuid），前端应答回传匹配等待者 */
  requestId: string;
  kind: AskKind;
  /** 卡片类型（显式分类；旧帧可能缺省） */
  cardKind?: AskCardKind;
  title?: string;
  toolCallId?: string;
  toolName?: string;
  questions: AskQuestion[];
}

/** 交互终结帧（纯通知，多窗口同步收卡；答案不广播） */
export interface AskResolvedEvent {
  type: "ask_resolved";
  requestId: string;
  outcome: "answered" | "cancelled";
}

// ==================== 错误（终局，工具层反馈模型） ====================

/**
 * 交互被拒/被取消（终局）。
 * - rejected：用户拒绝或自定义回复——feedback 携带用户文本，工具层以 isError tool-result 反馈模型
 * - cancelled：用户停止（abort 竞速胜出）
 */
export class AskDeniedError extends Error {
  constructor(
    message: string,
    readonly outcome: "rejected" | "cancelled",
    readonly feedback?: string,
  ) {
    super(message);
    this.name = "AskDeniedError";
  }
}

// ==================== 会话窄接口（避免 common → chat 依赖；ISessionContext 结构兼容满足） ====================

export interface AskSession {
  sessionId: string;
  /** 审计 ask/asked（持久事件，发起时写） */
  appendAskAsked(data: {
    requestId: string;
    kind: AskKind;
    /** 卡片类型（显式分类，审计/诊断用） */
    cardKind?: AskCardKind;
    title?: string;
    questions: AskQuestion[];
  }): Promise<void>;
  /** 审计 ask/answered（持久事件，每次 asked 必有 answered；cancelled 时标 cancelled） */
  appendAskAnswered(data: {
    requestId: string;
    answers?: AskAnswerItem[];
    cancelled?: boolean;
  }): Promise<void>;
  /**
   * 流事件直发（唯一发布面，对齐 DSH session.append 深层直发）：
   * 请求/终结帧经此进入会话活跃流（eventBuffer 可重放 + SSE 直投）。
   */
  publishStream(chunk: AskRequestedEvent | AskResolvedEvent): Promise<void>;
}
