/**
 * SessionService.searchSessions 聚合单测：两阶段游标协议
 *
 * 覆盖：title 阶段先行返回 + 扫描清单规模、content 阶段批扫描结果组装
 * （保持扫描顺序、排除标题命中）、游标推进与终止、archived 过滤、空关键词。
 *
 * 注：会话元信息权威来源已改为 sessions/<id>/meta.json（SessionFileStore），
 * 仓储兼容层已删除——本测试直接 mock SessionFileStore：
 * `query` 提供标题阶段命中、`listWebSessionIds` 提供扫描清单、
 * `getManyByIds` 提供内容命中行——与生产实现的索引访问点一一对应。
 */
import { SessionService } from "../../src/modules/chat/session.service";

function decodeCursor(cursor: string): { phase: string; offset: number } {
  return JSON.parse(Buffer.from(cursor, "base64").toString("utf-8"));
}

function buildService(overrides: {
  queryMock?: jest.Mock;
  scanIds?: string[];
  rows?: Record<string, any>[];
  scanBatch?: jest.Mock;
  hasActiveStream?: jest.Mock;
}) {
  const rows = overrides.rows ?? [];
  const sessionStore = {
    // 标题阶段：query 返回命中的 meta（此处只需 id），get 取回行
    query: overrides.queryMock ?? jest.fn().mockReturnValue([]),
    get: jest
      .fn()
      .mockImplementation((id: string) => rows.find((r) => r.id === id) ?? null),
    listWebSessionIds: jest.fn().mockReturnValue(overrides.scanIds ?? []),
    getManyByIds: jest.fn().mockImplementation((ids: string[]) => {
      const byId = new Map(rows.map((r) => [r.id, r]));
      return ids.map((id) => byId.get(id)).filter(Boolean);
    }),
  };
  const contentSearch = {
    scanBatch:
      overrides.scanBatch ??
      jest.fn().mockResolvedValue({ matches: new Map(), scanned: 0 }),
  };
  const streamManager = {
    hasActiveStream: overrides.hasActiveStream ?? jest.fn().mockReturnValue(false),
  };
  // 角色权威来源是 agents/<id>/AGENT.md：水合只取「按 id 查角色」，测试里返回空映射即可
  const agentStore = { findManyByIds: jest.fn().mockResolvedValue(new Map()) };

  const service = new SessionService(
    sessionStore as any, // 1 sessionStore
    agentStore as any, // 2 agentStore
    {} as any, // 3 modelStore
    {} as any, // 4 settingsStorage
    {} as any, // 5 llmService
    {} as any, // 6 contextManager
    {} as any, // 7 urlService
    {} as any, // 8 workspaceService
    {} as any, // 9 sessionContextFactory
    {} as any, // 10 workspaceWatcherService
    streamManager as any, // 11 streamManager
    {} as any, // 12 compactionCoordinator
    {} as any, // 13 eventBus
    {} as any, // 14 sessionReplayService
    contentSearch as any, // 15 contentSearch
    {} as any, // 16 sessionGroupService
  );
  return { service, sessionStore, contentSearch, streamManager };
}

describe("SessionService.searchSessions（渐进扫描游标协议）", () => {
  it("空关键词 → 空结果", async () => {
    const { service } = buildService({});
    const r = await service.searchSessions("   ");
    expect(r.items).toEqual([]);
    expect(r.hasMore).toBe(false);
    expect(r.nextCursor).toBeNull();
  });

  it("title 阶段：标题命中先行返回，游标指向 content offset=0，携带 progress.total", async () => {
    const queryMock = jest.fn().mockReturnValue([{ id: "s_title" }]);
    const { service } = buildService({
      queryMock,
      scanIds: ["s_title", "s_a", "s_b"],
      rows: [{ id: "s_title", title: "测试会话", sessionType: "web" }],
    });

    const r = await service.searchSessions("测试");
    expect(r.items).toHaveLength(1);
    expect(r.items[0]).toMatchObject({ id: "s_title", matchType: "title" });
    expect(r.hasMore).toBe(true);
    expect(r.progress).toEqual({ scanned: 0, total: 3 });
    expect(decodeCursor(r.nextCursor!)).toEqual({ phase: "content", offset: 0 });
  });

  it("content 阶段：命中组装保持扫描顺序、排除标题命中，游标推进", async () => {
    const queryMock = jest.fn().mockReturnValue([{ id: "s_title" }]);
    const scanBatch = jest.fn().mockResolvedValue({
      matches: new Map([
        ["s_a", "片段A【测试】"],
        ["s_b", "片段B"],
        ["s_title", "标题会话内容也命中"],
      ]),
      scanned: 3,
    });
    const { service } = buildService({
      queryMock,
      scanIds: ["s_title", "s_a", "s_b"],
      rows: [
        { id: "s_title", title: "测试", sessionType: "web" },
        { id: "s_b", title: "B", sessionType: "web" },
        { id: "s_a", title: "A", sessionType: "web" },
      ],
      scanBatch,
    });

    const cursor = Buffer.from(
      JSON.stringify({ phase: "content", offset: 0 }),
      "utf-8",
    ).toString("base64");
    const r = await service.searchSessions("测试", cursor, 25);

    // s_title 已作为标题命中返回过 → content 阶段不重复
    expect(r.items.map((i: any) => i.id)).toEqual(["s_a", "s_b"]);
    expect(r.items[0]).toMatchObject({
      matchType: "content",
      matchSnippet: "片段A【测试】",
    });
    expect(r.hasMore).toBe(false);
    expect(r.nextCursor).toBeNull();
    expect(r.progress).toEqual({ scanned: 3, total: 3 });
    // 扫描批参数正确
    expect(scanBatch).toHaveBeenCalledWith("测试", ["s_title", "s_a", "s_b"], 0, 25);
  });

  it("content 阶段未扫完：hasMore=true + nextCursor 指向下一批", async () => {
    const scanBatch = jest
      .fn()
      .mockResolvedValue({ matches: new Map([["s1", "x"]]), scanned: 2 });
    const { service } = buildService({
      scanIds: ["s1", "s2", "s3", "s4", "s5"],
      rows: [{ id: "s1", title: "S1", sessionType: "web" }],
      scanBatch,
    });

    const cursor = Buffer.from(
      JSON.stringify({ phase: "content", offset: 2 }),
      "utf-8",
    ).toString("base64");
    const r = await service.searchSessions("词", cursor, 2);

    expect(scanBatch).toHaveBeenCalledWith("词", ["s1", "s2", "s3", "s4", "s5"], 2, 2);
    expect(r.items.map((i: any) => i.id)).toEqual(["s1"]);
    expect(r.hasMore).toBe(true);
    expect(decodeCursor(r.nextCursor!)).toEqual({ phase: "content", offset: 4 });
    expect(r.progress).toEqual({ scanned: 4, total: 5 });
  });

  it("includeArchived 透传给扫描清单（归档过滤由索引层完成）", async () => {
    const { service, sessionStore } = buildService({ scanIds: [] });

    await service.searchSessions("词", undefined, 25, false);
    expect(sessionStore.listWebSessionIds).toHaveBeenLastCalledWith(false);

    await service.searchSessions("词", undefined, 25, true);
    expect(sessionStore.listWebSessionIds).toHaveBeenLastCalledWith(true);
  });
});
