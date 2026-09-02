/**
 * 全局钩子契约（对齐 deepseek-harness runtime-types.ts 扩展点清单）
 *
 * 项目所有"钩子"（生命周期拦截扩展点）统一登记于此：
 * - 事件名：单一常量来源（领域事件不再散落字符串字面量）
 * - 载荷/决策：每事件配类型化 payload 与返回 Decision 联合
 * - 调度模式：serial（全部执行，返回 undefined 放行）/ parallel（并发等全部）/ emit（fire-and-forget）
 *
 * 注册方式统一：@OnEvent 装饰器订阅（对齐 DSH ctx.on）；
 * 发射方式统一：EventBusService（emit / parallel / serial，对齐 DSH dispatch modes）。
 *
 * 决策语义（对齐 DSH 类型化 Decision）：
 * - serial 钩子：订阅者做副作用后返回 undefined 放行（全部依次执行）；返回"非 undefined"即接管（短路）
 * - parallel 钩子：收集全部订阅者返回值的并集（任一决定即生效）
 * - emit 钩子：只通知，不可阻断
 *
 * 副作用管线（对齐 DSH）：PRE_STEP 订阅者（压缩等）直接改写会话存储（store 写即更新），
 * 返回 undefined 放行；agent-engine 在钩子后重读 getMessages() 派生请求消息。
 * 流内事件发布：订阅者经 sessionContext.publishStream 直发（对齐 DSH session.append 深层直发），
 * 无回调注入、无缓冲中转。
 */
import type { ISessionContext } from '../session-context';

/** 钩子事件名（项目扩展点清单） */
export const HOOKS = {
  // ── agent 生命周期钩子 ──
  /** 每步请求派生前（副作用管线：压缩等订阅者原地改写会话存储后放行） */
  PRE_STEP: 'agent.pre_step',
  /** 模型请求失败后（决策：返回 { kind:'retry' } 重试，undefined 保留错误） */
  REQUEST_ERROR: 'agent.request_error',
  // ── 回合生命周期钩子（parallel 收集：全部订阅者续跑消息并集）──
  /** 回合自然关闭前最后机会续跑（原 TurnInterceptor） */
  TURN_STOPPING: 'turn.stopping',
  // ── 压缩钩子（parallel 等待全部订阅者完成）──
  /** 确认需要二级压缩（摘要/丢弃）后（记忆同步触发点，须先于摘要完成） */
  BEFORE_COMPACTION: 'compaction.before',
  // ── 领域事件（emit 通知，不可阻断）──
  /** 压缩即将开始（历史即将被处理） */
  MEMORY_PRE_COMPACT: 'memory.pre_compact',
  /** 压缩完成（缓存失效/审计） */
  MEMORY_COMPACTED: 'memory.compacted',
  /** 待办更新（前端刷新） */
  TODO_UPDATED: 'todo.updated',
} as const;

export type HookName = (typeof HOOKS)[keyof typeof HOOKS];

// ─── PRE_STEP ───

export interface PreStepPayload {
  sessionContext: ISessionContext;
  abortSignal?: AbortSignal;
}

// ─── REQUEST_ERROR ───

export interface RequestErrorPayload {
  sessionContext: ISessionContext;
  error: unknown;
  abortSignal?: AbortSignal;
}

/** 模型请求恢复动作：订阅者返回 { kind: 'retry' } 让循环重试，undefined 保留原始错误 */
export type RequestErrorAction = { kind: 'retry' } | undefined;

// ─── TURN_STOPPING ───

export interface TurnStoppingPayload {
  sessionContext: ISessionContext;
}

/**
 * 回合关闭前续跑决策：订阅者返回 { kind: 'continue', messages } 时，
 * 消息作为 hidden user 注入并触发新一轮 LLM 调用（对齐 DSH agent/turn-stopping + steer）。
 * undefined = 不续跑，回合正常关闭。
 */
export type TurnStoppingDecision =
  | { kind: 'continue'; messages: string[] }
  | undefined;

// ─── BEFORE_COMPACTION ───

export interface BeforeCompactionPayload {
  sessionContext: ISessionContext;
  abortSignal?: AbortSignal;
  /** 摘要模式（memory_sync 触发记忆同步） */
  summaryMode: string;
}
