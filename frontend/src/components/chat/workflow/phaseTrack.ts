/**
 * 阶段站条模型：(phases, agents, runStatus) → PhaseTrackModel，纯函数、无 Vue/无 DOM/无时间。
 *
 * 数据已经现成：run-start 事件携带 phases 声明（WorkflowPhaseMeta[]），
 * agent-start/agent-end 事件的成员都带 phase 字符串（后端 workflow-engine.service.ts
 * launchAgent 透传脚本 agent({ phase }) 参数）。本文件只做前端归组投影——
 * 后端 reducer（services/modules/workflowRuns.ts）不动。
 *
 * 未声明 phases（旧脚本/叙述性脚本）→ buildPhaseTrackModel 返回 null，
 * 卡片回退现有 WorkflowMemberTree 扁平树（零风险兜底）。
 */
import type {
  WorkflowAgentState,
  WorkflowPhaseMeta,
  WorkflowRunStatus,
} from "@/types/stream/workflow.types";

/** 站状态（灯形四态词汇表；值即 WorkflowStatusDot 的形态类名后缀） */
export type PhaseStationStatus = "pending" | "active" | "done" | "failed";

export interface PhaseStation {
  /** 阶段标题（= 成员 agent.phase 的匹配键，原样保留） */
  title: string;
  detail?: string;
  status: PhaseStationStatus;
  /** 已完成成员数（observed 中 status 为 completed 的） */
  settled: number;
  /** 本站归到的成员数 */
  observed: number;
  /** 本站成员（保持启动顺序，站条展开时药丸渲染用） */
  agents: WorkflowAgentState[];
}

export interface PhaseTrackModel {
  /** 声明序的站（含尾部的隐式「其他」站——归不进任何声明 phase 的成员，仅非空时存在） */
  stations: PhaseStation[];
  /** 当前进行中的站下标（无进行中成员时为 undefined：run 终态/全静默） */
  activeIndex: number | undefined;
  /** run 终态（站色推导的兜底口径：终态后剩余 pending 站按 run 终态着色） */
  runStatus: WorkflowRunStatus;
}

/**
 * 把 (phases, agents) 折叠成站条模型。
 * 返回 null 的条件：phases 未声明/为空（扁平树兜底）。
 * 成员 phase 匹配不到任何声明站 → 归入尾部隐式站（title 为空串，渲染层给「其他」文案）。
 */
export function buildPhaseTrackModel(
  phases: WorkflowPhaseMeta[] | undefined,
  agents: WorkflowAgentState[],
  runStatus: WorkflowRunStatus,
): PhaseTrackModel | null {
  if (!phases || phases.length === 0) return null;

  // 声明站逐个归组（成员按 agent.phase === 站.title 匹配；同 title 声明取首站）
  const stations: PhaseStation[] = phases.map((p) => ({
    title: p.title,
    detail: p.detail,
    status: "pending",
    settled: 0,
    observed: 0,
    agents: [],
  }));
  const byTitle = new Map<string, PhaseStation>();
  for (const s of stations) {
    if (!byTitle.has(s.title)) byTitle.set(s.title, s);
  }
  const stray: PhaseStation = {
    title: "",
    status: "pending",
    settled: 0,
    observed: 0,
    agents: [],
  };

  for (const agent of agents) {
    const station =
      (agent.phase ? byTitle.get(agent.phase) : undefined) ?? stray;
    station.agents.push(agent);
    station.observed += 1;
    if (agent.status === "completed") station.settled += 1;
  }

  // 站状态推导：站内成员状态折叠
  let activeIndex: number | undefined;
  for (let i = 0; i < stations.length; i++) {
    const s = stations[i];
    if (s.observed === 0) continue; // 无成员 → pending 空环
    if (s.agents.some((a) => a.status === "running")) {
      s.status = "active";
      activeIndex = activeIndex ?? i;
    } else if (s.agents.every((a) => a.status === "completed")) {
      s.status = "done";
    } else if (s.agents.some((a) => a.status === "failed")) {
      s.status = "failed";
    } else {
      // 部分完成 + 部分取消：按已完成比例——有完成算 done，否则 pending
      s.status = s.settled > 0 ? "done" : "pending";
    }
  }

  // 隐式「其他」站：仅非空时保留（排最尾，不参与 activeIndex 竞争——
  // 除非它是唯一有 running 成员的站）
  if (stray.observed > 0) {
    if (stray.agents.some((a) => a.status === "running")) {
      stray.status = "active";
      activeIndex = activeIndex ?? stations.length;
    } else if (stray.agents.every((a) => a.status === "completed")) {
      stray.status = "done";
    } else if (stray.agents.some((a) => a.status === "failed")) {
      stray.status = "failed";
    } else {
      stray.status = stray.settled > 0 ? "done" : "pending";
    }
    stations.push(stray);
  }

  // run 终态兜底：run 已结束而站里还有 pending（成员事件缺失/旧归档），
  // pending 站按 run 终态着色——不假装还在等
  if (activeIndex === undefined && runStatus !== "running") {
    const fallback: PhaseStationStatus =
      runStatus === "failed" ? "failed" : runStatus === "cancelled" ? "pending" : "done";
    for (const s of stations) {
      if (s.status === "pending" && s.observed === 0) s.status = fallback;
    }
    // 终态但从未有成员的站：completed run → done（声明过的阶段视为已走过）；
    // failed/cancelled → failed/pending
  }
  return { stations, activeIndex, runStatus };
}

/** 词汇表：站状态 → 点形态类名后缀（WorkflowStatusDot 的 wf-dot--{x}），一处定义多处消费 */
export const PHASE_DOT: Record<PhaseStationStatus, string> = {
  pending: "pending",
  active: "running",
  done: "completed",
  failed: "failed",
};

/** 词汇表：站状态 → 主题变量色（成员药丸点/进度计数用） */
export const PHASE_TEXT_COLOR: Record<PhaseStationStatus, string> = {
  pending: "var(--gd-color-text-disabled)",
  active: "var(--gd-color-success, #22c55e)",
  done: "var(--gd-color-text-gray)",
  failed: "#ef4444",
};

/** 站状态 → i18n key（词汇表与文案解耦：组件层用 t(`...${key}`)） */
export const PHASE_STATUS_KEY: Record<PhaseStationStatus, string> = {
  pending: "pending",
  active: "active",
  done: "done",
  failed: "failed",
};

/** 当前进行中的阶段序号（1-based；无则 undefined）——头行 meta「第 n/m 阶段」用 */
export function activePhaseNumber(model: PhaseTrackModel): number | undefined {
  if (model.activeIndex === undefined) return undefined;
  return model.activeIndex + 1;
}

/** 全 run 完成度：各站 settled / observed 求和（隐式站计入） */
export function phaseProgress(model: PhaseTrackModel): { settled: number; observed: number } {
  let settled = 0;
  let observed = 0;
  for (const s of model.stations) {
    settled += s.settled;
    observed += s.observed;
  }
  return { settled, observed };
}
