/**
 * jobNotice 纯函数测试：source.kind → 通知卡分流的唯一真相。
 *
 * 跨层契约（后端 JobNotifier.buildSource ↔ 前端 TurnItem/EventCard）此前无测试，
 * 词表一改 UI 会静默退化成"用户气泡里一段 <system_reminder> 原文"。
 */
import { describe, it, expect } from "vitest";
import {
  JOB_NOTICE_SOURCE_KINDS,
  isJobNoticeSource,
  resolveNoticeEventType,
} from "./jobNotice";

describe("isJobNoticeSource", () => {
  it("process_monitor / sub_agent 命中（后端 buildSource 的两个 kind）", () => {
    expect(isJobNoticeSource("process_monitor")).toBe(true);
    expect(isJobNoticeSource("sub_agent")).toBe(true);
  });

  it("人类输入与其它 source.kind 不命中", () => {
    expect(isJobNoticeSource("user")).toBe(false);
    expect(isJobNoticeSource("plugin")).toBe(false);
    expect(isJobNoticeSource("plan_feedback")).toBe(false);
    expect(isJobNoticeSource("")).toBe(false);
    expect(isJobNoticeSource(undefined)).toBe(false);
    expect(isJobNoticeSource(null)).toBe(false);
    expect(isJobNoticeSource(42)).toBe(false);
  });

  it("词表与后端契约一致（新增 kind 必须同步这里与 buildSource）", () => {
    expect([...JOB_NOTICE_SOURCE_KINDS]).toEqual(["process_monitor", "sub_agent"]);
  });
});

describe("resolveNoticeEventType", () => {
  it("metadata.eventType 优先（event 外壳/压缩卡）", () => {
    expect(
      resolveNoticeEventType({ declared: "command", sourceKind: "sub_agent" }),
    ).toBe("command");
  });

  it("通知类消息兜底成 job-notice", () => {
    expect(resolveNoticeEventType({ sourceKind: "process_monitor" })).toBe(
      "job-notice",
    );
    expect(resolveNoticeEventType({ sourceKind: "sub_agent" })).toBe("job-notice");
  });

  it("普通消息不是事件卡", () => {
    expect(resolveNoticeEventType({ sourceKind: "user" })).toBe("");
    expect(resolveNoticeEventType({})).toBe("");
    expect(resolveNoticeEventType({ declared: "", sourceKind: "" })).toBe("");
  });
});
