/**
 * 子代理展示项构建测试（输入区胶囊「子代理」段与子代理列表面板共用）
 *
 * 覆盖：workflow 成员过滤、冻结拆分、运行状态映射（running/error/其余）、标题回落。
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

  it("closedAt 标记冻结；标题回落 fallbackTitle；头像取 agent.avatarUrl", () => {
    const items = buildSubagentItems(
      [
        sub({ id: "frozen", title: "", closedAt: "2026-10-14T00:00:00Z" }),
        sub({ id: "avatar", title: "有头像", agent: { avatarUrl: "https://x/a.png" } as Session["agent"] }),
      ],
      peekFrom({}),
      "子代理",
    );
    expect(items[0]).toMatchObject({ id: "frozen", frozen: true, title: "子代理" });
    expect(items[1]!.avatarUrl).toBe("https://x/a.png");
  });
});

describe("splitSubagents / countRunningSubagents", () => {
  it("活跃在前、冻结在后；运行中计数只统计未冻结项", () => {
    const items = buildSubagentItems(
      [
        sub({ id: "r1" }),
        sub({ id: "f1", closedAt: "2026-10-14T00:00:00Z" }),
        sub({ id: "r2" }),
      ],
      peekFrom({ r1: "running", r2: "running", f1: "running" }),
      "子代理",
    );
    const { active, frozen } = splitSubagents(items);
    expect(active.map((i) => i.id)).toEqual(["r1", "r2"]);
    expect(frozen.map((i) => i.id)).toEqual(["f1"]);
    // 冻结项即使 streamStatus 仍是 running 也不计入（胶囊只表达运行时状态）
    expect(countRunningSubagents(items)).toBe(2);
  });
});
