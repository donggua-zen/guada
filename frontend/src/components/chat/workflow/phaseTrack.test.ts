/**
 * phaseTrack 纯函数投影测试：声明站归组、隐式「其他」站、状态折叠、
 * run 终态兜底着色、无 phases 返回 null（扁平树兜底条件）。
 * 纯函数无状态——同输入同输出即天然幂等（live 与回放共用）。
 */
import { describe, it, expect } from "vitest";
import {
  buildPhaseTrackModel,
  activePhaseNumber,
  phaseProgress,
  PHASE_DOT,
  PHASE_TEXT_COLOR,
  PHASE_STATUS_KEY,
} from "./phaseTrack";
import type { WorkflowAgentState, WorkflowPhaseMeta } from "@/types/stream/workflow.types";

const phases: WorkflowPhaseMeta[] = [
  { title: "情报", detail: "收集背景资料" },
  { title: "分析" },
  { title: "撰写" },
];

const agent = (over: Partial<WorkflowAgentState> & { callId: string }): WorkflowAgentState => ({
  label: `成员-${over.callId}`,
  phase: null,
  status: "running",
  ...over,
});

describe("buildPhaseTrackModel", () => {
  it("无 phases 声明 → 返回 null（卡片回退扁平树）", () => {
    expect(buildPhaseTrackModel(undefined, [agent({ callId: "a" })], "running")).toBeNull();
    expect(buildPhaseTrackModel([], [], "running")).toBeNull();
  });

  it("成员按 phase 归组到声明站；无成员站保持 pending", () => {
    const model = buildPhaseTrackModel(
      phases,
      [
        agent({ callId: "a", phase: "情报", status: "completed" }),
        agent({ callId: "b", phase: "分析" }),
      ],
      "running",
    );
    expect(model).not.toBeNull();
    expect(model!.stations.map((s) => s.title)).toEqual(["情报", "分析", "撰写"]);
    expect(model!.stations[0]).toMatchObject({ status: "done", settled: 1, observed: 1 });
    expect(model!.stations[1]).toMatchObject({ status: "active", settled: 0, observed: 1 });
    expect(model!.stations[2]).toMatchObject({ status: "pending", observed: 0 });
    expect(model!.activeIndex).toBe(1);
  });

  it("成员 phase 不在声明内 → 归入尾部隐式站（仅非空时出现）", () => {
    const model = buildPhaseTrackModel(
      phases,
      [agent({ callId: "x", phase: "别处" })],
      "running",
    );
    expect(model!.stations).toHaveLength(4);
    expect(model!.stations[3].title).toBe("");
    expect(model!.stations[3].observed).toBe(1);
  });

  it("所有成员都归属声明站 → 不出现隐式站", () => {
    const model = buildPhaseTrackModel(
      phases,
      [agent({ callId: "a", phase: "情报", status: "completed" })],
      "running",
    );
    expect(model!.stations).toHaveLength(3);
  });

  it("站状态折叠：failed 优先于部分完成；部分取消且有完成算 done", () => {
    const failed = buildPhaseTrackModel(
      phases,
      [
        agent({ callId: "a", phase: "情报", status: "completed" }),
        agent({ callId: "b", phase: "情报", status: "failed" }),
      ],
      "running",
    );
    expect(failed!.stations[0].status).toBe("failed");

    const partial = buildPhaseTrackModel(
      phases,
      [
        agent({ callId: "a", phase: "撰写", status: "completed" }),
        agent({ callId: "b", phase: "撰写", status: "cancelled" }),
      ],
      "running",
    );
    expect(partial!.stations[2].status).toBe("done");
  });

  it("run 终态兜底：终态后仍 pending 的空站按 run 终态着色", () => {
    const done = buildPhaseTrackModel(
      phases,
      [agent({ callId: "a", phase: "情报", status: "completed" })],
      "completed",
    );
    // 撰写站从未有成员 → completed run 视为已走过
    expect(done!.stations[2].status).toBe("done");
    expect(done!.activeIndex).toBeUndefined();

    const cancelled = buildPhaseTrackModel(phases, [], "cancelled");
    expect(cancelled!.stations.every((s) => s.status === "pending")).toBe(true);

    const failed = buildPhaseTrackModel(phases, [], "failed");
    expect(failed!.stations.every((s) => s.status === "failed")).toBe(true);
  });

  it("同 title 重复声明取首站；隐式站 running 也推进 activeIndex", () => {
    const model = buildPhaseTrackModel(
      [{ title: "x" }, { title: "x" }],
      [agent({ callId: "a", phase: "别处" })],
      "running",
    );
    expect(model!.stations[0].observed).toBe(0);
    expect(model!.stations[2].observed).toBe(1);
    expect(model!.activeIndex).toBe(2);
  });

  it("纯函数幂等：同输入两次调用产出等价模型", () => {
    const agents = [agent({ callId: "a", phase: "情报", status: "completed" })];
    const m1 = buildPhaseTrackModel(phases, agents, "running");
    const m2 = buildPhaseTrackModel(phases, agents, "running");
    expect(m1).toEqual(m2);
  });
});

describe("词汇表与计数 helper", () => {
  it("PHASE_* 词汇表覆盖四态且互为对应", () => {
    expect(Object.keys(PHASE_DOT)).toEqual(["pending", "active", "done", "failed"]);
    expect(PHASE_DOT.active).toBe("running");
    expect(PHASE_DOT.done).toBe("completed");
    expect(Object.keys(PHASE_TEXT_COLOR)).toEqual(Object.keys(PHASE_STATUS_KEY));
  });

  it("activePhaseNumber 为 1-based；无 active 时 undefined", () => {
    const model = buildPhaseTrackModel(
      phases,
      [agent({ callId: "b", phase: "分析" })],
      "running",
    );
    expect(activePhaseNumber(model!)).toBe(2);

    const done = buildPhaseTrackModel(phases, [], "completed");
    expect(activePhaseNumber(done!)).toBeUndefined();
  });

  it("phaseProgress 汇总各站 settled/observed（隐式站计入）", () => {
    const model = buildPhaseTrackModel(
      phases,
      [
        agent({ callId: "a", phase: "情报", status: "completed" }),
        agent({ callId: "x", phase: "别处", status: "completed" }),
        agent({ callId: "y", phase: "别处" }),
      ],
      "running",
    );
    expect(phaseProgress(model!)).toEqual({ settled: 2, observed: 3 });
  });
});
