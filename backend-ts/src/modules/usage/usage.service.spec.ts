import { UsageService } from "./usage.service";
import type { UsageStore } from "./usage.store";
import type { UsageQueryRows } from "./usage.types";

const DAY = 86_400_000;

describe("UsageService", () => {
  const now = Date.UTC(2026, 9, 18, 12, 0, 0);
  const todayStart = Math.floor(now / DAY) * DAY;

  function buildRows(): UsageQueryRows {
    return {
      since: todayStart - 6 * DAY,
      until: now,
      totals: {
        totalTokens: 400,
        inputTokens: 300,
        outputTokens: 100,
        reasoningTokens: 0,
        cacheReadTokens: 150,
        cacheWriteTokens: 0,
        requestCount: 2,
        errorCount: 0,
        usageMissingCount: 0,
        avgTimeToFirstTokenMs: 123.4,
        avgDurationMs: 1000.6,
        sessionCount: 1,
        turnCount: 1,
      },
      daily: [
        {
          dayIndex: Math.floor((todayStart - 2 * DAY) / DAY),
          totalTokens: 100,
          inputTokens: 80,
          outputTokens: 20,
          requestCount: 1,
        },
        {
          dayIndex: Math.floor(todayStart / DAY),
          totalTokens: 300,
          inputTokens: 220,
          outputTokens: 80,
          requestCount: 1,
        },
      ],
      heatmapDaily: [
        {
          dayIndex: Math.floor((todayStart - 2 * DAY) / DAY),
          totalTokens: 100,
          inputTokens: 80,
          outputTokens: 20,
          requestCount: 1,
        },
        {
          dayIndex: Math.floor(todayStart / DAY),
          totalTokens: 300,
          inputTokens: 220,
          outputTokens: 80,
          requestCount: 1,
        },
      ],
      dayModels: [
        {
          dayIndex: Math.floor((todayStart - 2 * DAY) / DAY),
          providerId: "p1",
          modelId: "m1",
          totalTokens: 100,
        },
        {
          dayIndex: Math.floor(todayStart / DAY),
          providerId: "p1",
          modelId: "m1",
          totalTokens: 300,
        },
      ],
      models: [
        {
          providerId: "p1",
          modelId: "m1",
          totalTokens: 400,
          inputTokens: 300,
          outputTokens: 100,
          cacheReadTokens: 150,
          requestCount: 2,
        },
      ],
      sources: [
        { source: "main_turn", totalTokens: 320, requestCount: 1 },
        { source: "compaction", totalTokens: 80, requestCount: 1 },
      ],
      sessions: [
        {
          sessionId: "s1",
          title: "会话",
          sessionType: "web",
          totalTokens: 400,
          requestCount: 2,
          lastUsedAt: now,
        },
      ],
    };
  }

  function service(): UsageService {
    const store = { query: jest.fn(() => buildRows()) } as unknown as UsageStore;
    return new UsageService(store);
  }

  it("组装 7 天连续日序列、热力图与核心指标", () => {
    const snapshot = service().getSnapshot({
      range: "7d",
      tzOffsetMinutes: 0,
      now,
    });

    expect(snapshot.daily).toHaveLength(7);
    expect(snapshot.daily[snapshot.daily.length - 1]?.date).toBe("2026-10-18");
    expect(snapshot.daily[snapshot.daily.length - 1]?.totalTokens).toBe(300);
    expect(snapshot.daily[snapshot.daily.length - 2]?.totalTokens).toBe(0);
    expect(snapshot.summary.totalTokens).toBe(400);
    expect(snapshot.summary.cacheHitRate).toBeCloseTo(0.5);
    expect(snapshot.summary.activeDays).toBe(2);
    expect(snapshot.summary.currentStreakDays).toBe(1);
    expect(snapshot.summary.longestStreakDays).toBe(1);
    expect(snapshot.summary.peakDayTokens).toBe(300);
    expect(snapshot.summary.favoriteModel).toMatchObject({
      providerId: "p1",
      modelId: "m1",
      totalTokens: 400,
      share: 1,
    });
    // 热力图固定近一年（按周日对齐，53/54 周），与 7d 范围解耦
    expect(snapshot.heatmap.weeks.length).toBeGreaterThanOrEqual(53);
    expect(snapshot.heatmap.weeks.length).toBeLessThanOrEqual(54);
    expect(snapshot.heatmap.startDate).toBe("2025-10-12");
    const heatmapCells = snapshot.heatmap.weeks.flatMap((week) => week.days);
    expect(heatmapCells.filter(Boolean).length).toBeGreaterThanOrEqual(371);
    expect(
      heatmapCells.find((cell) => cell?.date === "2026-10-18"),
    ).toMatchObject({
      date: "2026-10-18",
      totalTokens: 300,
      level: 4,
    });
    expect(snapshot.models[0].share).toBe(1);
    expect(snapshot.sources.map((item) => item.source)).toEqual([
      "main_turn",
      "compaction",
    ]);
    expect(snapshot.sources[0].share).toBeCloseTo(0.8);
  });

  it("按 purpose / session 推导来源", () => {
    const usage = service();
    expect(usage.resolveSource({ purpose: "compaction" })).toBe("compaction");
    expect(usage.resolveSource({ purpose: "session_title" })).toBe(
      "session_title",
    );
    expect(usage.resolveSource({ sessionId: "s1" })).toBe("main_turn");
    expect(usage.resolveSource({})).toBe("other");
    expect(
      usage.resolveSource({ source: "subagent", purpose: "compaction" }),
    ).toBe("subagent");
  });

  it("all 范围图表窗口最多 366 天，但汇总仍取全量 rows", () => {
    const oldRows = buildRows();
    const oldDay = Math.floor((todayStart - 500 * DAY) / DAY);
    oldRows.daily.unshift({
      dayIndex: oldDay,
      totalTokens: 999,
      inputTokens: 999,
      outputTokens: 0,
      requestCount: 1,
    });
    oldRows.totals.totalTokens = 1399;
    const store = { query: jest.fn(() => oldRows) } as unknown as UsageStore;
    const snapshot = new UsageService(store).getSnapshot({
      range: "all",
      tzOffsetMinutes: 0,
      now,
    });

    expect(snapshot.summary.totalTokens).toBe(1399);
    expect(snapshot.daily.length).toBeLessThanOrEqual(366);
    // 500 天前的数据只影响汇总/连续天数，不挤进图表窗口
    expect(snapshot.daily[0].date > "2025-10-17").toBe(true);
  });
});
