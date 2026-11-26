/**
 * 子代理展示项构建测试（输入区胶囊「子代理」段与子代理列表面板共用）
 *
 * 覆盖：workflow 成员过滤、活跃/已结束拆分、运行状态映射（running/error/其余）、标题回落。
 */
import { describe, it, expect } from "vitest";
import { buildSubagentItems, splitSubagents, countRunningSubagents } from "./subagentDisplay";
import type { Session } from "@/types/session";

const sub = (over: Partial<Session>): Session =>
  ({ id: "sub_1", title: "子任务", ...over }) as Session;

const peekFrom = (map: Record<string, string>) => (id: string) => map[id];

describe("buildSubagentItems", () => {
  it("workflow 成员子代理被排除（进度/跳转由工作流卡片承载）", () => {
    const items = buildSubagentItems(
      [
        sub({ id: "plain" }),
        sub({ id: "wf_member", settings: { workflow: { runId: "wfr_1" } } as unknown as Session["settings"] }),
      ],
      peekFrom({}),
      "子代理",
    );
    expect(items.map((i) => i.id)).toEqual(["plain"]);
  });

  it("运行状态映射：running / error / 其余一律 completed", () => {
    const items = buildSubagentItems(
      [sub({ id: "a" }), sub({ id: "b" }), sub({ id: "c" })],
      peekFrom({ a: "running", b: "error" }),
      "子代理",
    );
    expect(items.map((i) => i.status)).toEqual(["running", "error", "completed"]);
  });

  it("无活跃流即已结束；标题回落 fallbackTitle；头像取 agent.avatarUrl", () => {
    const items = buildSubagentItems(
      [
        sub({ id: "ended", title: "", closedAt: "2026-10-14T00:00:00Z" }),
        sub({ id: "avatar", title: "有头像", agent: { avatarUrl: "https://x/a.png" } as Session["agent"] }),
      ],
      peekFrom({}),
      "子代理",
    );
    expect(items[0]).toMatchObject({ id: "ended", ended: true, title: "子代理" });
    expect(items[1]!.avatarUrl).toBe("https://x/a.png");
  });

  it("已结束的原因由 closeReason 还原失败态（刷新后流状态表为空时）", () => {
    const items = buildSubagentItems(
      [
        sub({ id: "ok", closeReason: "completed" }),
        sub({ id: "bad", closeReason: "error" }),
      ],
      peekFrom({}),
      "子代理",
    );
    expect(items.map((i) => i.status)).toEqual(["completed", "error"]);
  });

  it("closeReason=stopped 还原为中性的 stopped，不落进失败（主动停止不是出错）", () => {
    const items = buildSubagentItems(
      [
        sub({ id: "stopped", closeReason: "stopped" }),
        // 对照：其它非 completed 原因仍是失败
        sub({ id: "aborted", closeReason: "aborted" }),
      ],
      peekFrom({}),
      "子代理",
    );
    expect(items.map((i) => i.status)).toEqual(["stopped", "error"]);
    expect(items[0]!.ended).toBe(true);
  });
});

describe("splitSubagents / countRunningSubagents", () => {
  it("运行中在前、已结束在后；运行中计数只统计有活跃流的项", () => {
    const items = buildSubagentItems(
      [
        sub({ id: "r1" }),
        sub({ id: "f1", closedAt: "2026-10-14T00:00:00Z" }),
        sub({ id: "r2" }),
      ],
      peekFrom({ r1: "running", r2: "running" }),
      "子代理",
    );
    const { active, ended } = splitSubagents(items);
    expect(active.map((i) => i.id)).toEqual(["r1", "r2"]);
    expect(ended.map((i) => i.id)).toEqual(["f1"]);
    expect(countRunningSubagents(items)).toBe(2);
  });

  it("运行中的子代理即使带着上次的 closedAt 也归入活跃段", () => {
    const items = buildSubagentItems(
      [sub({ id: "rerun", closedAt: "2026-10-14T00:00:00Z" })],
      peekFrom({ rerun: "running" }),
      "子代理",
    );
    const { active, ended } = splitSubagents(items);
    expect(active.map((i) => i.id)).toEqual(["rerun"]);
    expect(ended).toHaveLength(0);
  });
});
