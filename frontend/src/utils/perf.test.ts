import { describe, expect, it } from "vitest";
import { createPerfCollector, perfMeasure, perfSnapshot, perfStart } from "./perf";

describe("createPerfCollector", () => {
  it("聚合 count / total / avg / p50 / p95 / max", () => {
    const collector = createPerfCollector();
    collector.record("a", 1);
    collector.record("a", 3);
    collector.record("a", 5);

    const row = collector.rows().find((r) => r.name === "a")!;
    expect(row.count).toBe(3);
    expect(row.totalMs).toBe(9);
    expect(row.avgMs).toBe(3);
    expect(row.p50Ms).toBe(3);
    expect(row.p95Ms).toBe(5);
    expect(row.maxMs).toBe(5);
  });

  it("meta 数字累加、字符串保留最后值", () => {
    const collector = createPerfCollector();
    collector.record("a", 1, { events: 10, reason: "initial" });
    collector.record("a", 1, { events: 5, reason: "load-more" });

    const row = collector.rows().find((r) => r.name === "a")!;
    expect(row.meta).toEqual({ events: 15, reason: "load-more" });
  });

  it("count 以纯计数行输出（total/time 为 0）", () => {
    const collector = createPerfCollector();
    collector.count("watch", 2);

    const row = collector.rows().find((r) => r.name === "watch")!;
    expect(row.count).toBe(2);
    expect(row.totalMs).toBe(0);
    expect(row.avgMs).toBe(0);
  });

  it("reset 清空耗时与计数", () => {
    const collector = createPerfCollector();
    collector.record("a", 1);
    collector.count("b");
    collector.reset();
    expect(collector.rows()).toEqual([]);
  });

  it("样本超过上限后仍保留累计总数与最大值", () => {
    const collector = createPerfCollector();
    for (let i = 0; i < 1000; i++) collector.record("a", i);

    const row = collector.rows().find((r) => r.name === "a")!;
    expect(row.count).toBe(1000);
    expect(row.maxMs).toBe(999);
    expect(row.p95Ms).toBeGreaterThan(900);
  });

  it("忽略 NaN / 负数耗时", () => {
    const collector = createPerfCollector();
    collector.record("a", Number.NaN);
    collector.record("a", -1);
    expect(collector.rows()).toEqual([]);
  });
});

describe("禁用态", () => {
  it("perfStart 返回 null，perfMeasure 原样执行且不采集", () => {
    expect(perfStart("x")).toBeNull();
    expect(perfMeasure("x", () => 42)).toBe(42);
    expect(perfSnapshot().rows).toEqual([]);
  });
});
