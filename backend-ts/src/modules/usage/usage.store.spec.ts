import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { openMetaDb } from "../chat/session-meta.store";
import { UsageStore } from "./usage.store";

const DAY = 86_400_000;

describe("UsageStore", () => {
  let tempRoot: string;
  let previousSessionDir: string | undefined;
  let store: UsageStore;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "usage-store-"));
    previousSessionDir = process.env.SESSION_DATA_DIR;
    process.env.SESSION_DATA_DIR = tempRoot;

    const sessionsDb = openMetaDb(path.join(tempRoot, "sessions"));
    const now = new Date().toISOString();
    const insert = sessionsDb.prepare(
      `INSERT INTO sessions (id, title, session_type, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    );
    insert.run("s1", "会话一", "web", now, now);
    insert.run("s2", "会话二", "sub_agent", now, now);
    sessionsDb.close();

    store = new UsageStore();
  });

  afterEach(() => {
    store.onModuleDestroy();
    if (previousSessionDir === undefined) delete process.env.SESSION_DATA_DIR;
    else process.env.SESSION_DATA_DIR = previousSessionDir;
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it("按时间范围聚合总量/模型/来源/会话", () => {
    const now = Date.UTC(2026, 9, 18, 12, 0, 0);
    record(store, {
      sessionId: "s1",
      turnId: "t1",
      modelId: "m1",
      startedAt: now - 2 * DAY,
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
      cachedRead: 40,
    });
    record(store, {
      sessionId: "s1",
      turnId: "t1",
      modelId: "m1",
      startedAt: now - 3_600_000,
      promptTokens: 200,
      completionTokens: 100,
      totalTokens: 300,
      cachedRead: 100,
    });
    record(store, {
      sessionId: "s2",
      turnId: "t2",
      modelId: "m2",
      source: "compaction",
      startedAt: now - 1_800_000,
      promptTokens: 50,
      completionTokens: 20,
      totalTokens: 70,
    });

    const rows = store.query({ range: "7d", tzOffsetMinutes: 0, now });

    expect(rows.totals).toMatchObject({
      totalTokens: 520,
      inputTokens: 350,
      outputTokens: 170,
      cacheReadTokens: 140,
      requestCount: 3,
      errorCount: 0,
      sessionCount: 2,
      turnCount: 2,
    });
    expect(rows.models).toHaveLength(2);
    expect(rows.models[0]).toMatchObject({
      providerId: "",
      modelId: "m1",
      totalTokens: 450,
      requestCount: 2,
    });
    expect(rows.sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: "main_turn", totalTokens: 450 }),
        expect.objectContaining({ source: "compaction", totalTokens: 70 }),
      ]),
    );
    expect(rows.sessions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sessionId: "s1",
          title: "会话一",
          totalTokens: 450,
        }),
        expect.objectContaining({
          sessionId: "s2",
          sessionType: "sub_agent",
          totalTokens: 70,
        }),
      ]),
    );
  });

  it("回填模式遇到同一 message/attempt 时保留已有记录", () => {
    const first = record(store, {
      id: "live-1",
      assistantMessageId: "m-1",
      sessionId: "s1",
      turnId: "t1",
      modelId: "m1",
      startedAt: 1_000,
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
    });
    expect(first).toBe(true);

    const duplicate = record(store, {
      id: "backfill-1",
      assistantMessageId: "m-1",
      sessionId: "s1",
      turnId: "t1",
      modelId: "m1",
      startedAt: 1_000,
      promptTokens: 999,
      completionTokens: 999,
      totalTokens: 1998,
    }, { ignoreExisting: true });

    expect(duplicate).toBe(false);
    const rows = store.query({
      range: "all",
      tzOffsetMinutes: 0,
      now: 2_000,
    });
    expect(rows.totals.totalTokens).toBe(15);
    expect(rows.totals.requestCount).toBe(1);
  });

  it("删除会话时清理该会话的用量", () => {
    record(store, {
      sessionId: "s1",
      modelId: "m1",
      startedAt: 1_000,
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
    });
    record(store, {
      sessionId: "s2",
      modelId: "m1",
      startedAt: 1_000,
      promptTokens: 20,
      completionTokens: 10,
      totalTokens: 30,
    });

    expect(store.deleteBySession("s1")).toBe(1);
    const rows = store.query({ range: "all", tzOffsetMinutes: 0, now: 2_000 });
    expect(rows.totals.requestCount).toBe(1);
    expect(rows.sessions.map((row) => row.sessionId)).toEqual(["s2"]);
  });

  it("供应商未返回 usage 时仍记录请求并标记 usage_missing", () => {
    record(store, {
      sessionId: "s1",
      modelId: "m1",
      startedAt: 1_000,
      usageMissing: true,
    });
    const rows = store.query({ range: "all", tzOffsetMinutes: 0, now: 2_000 });
    expect(rows.totals.requestCount).toBe(1);
    expect(rows.totals.usageMissingCount).toBe(1);
    expect(rows.totals.totalTokens).toBe(0);
  });
});

function record(
  store: UsageStore,
  input: {
    id?: string;
    assistantMessageId?: string;
    sessionId?: string;
    turnId?: string;
    modelId: string;
    source?: "main_turn" | "subagent" | "compaction";
    startedAt: number;
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    cachedRead?: number;
    usageMissing?: boolean;
  },
  options: { ignoreExisting?: boolean } = {},
): boolean {
  return store.record(
    {
      id: input.id,
      assistantMessageId: input.assistantMessageId,
      sessionId: input.sessionId,
      turnId: input.turnId,
      source: input.source ?? "main_turn",
      providerId: "",
      modelId: input.modelId,
      status: "completed",
      startedAt: input.startedAt,
      completedAt: input.startedAt,
      usage: input.usageMissing
        ? null
        : {
            promptTokens: input.promptTokens ?? 0,
            completionTokens: input.completionTokens ?? 0,
            totalTokens: input.totalTokens ?? 0,
            cachedTokens:
              input.cachedRead == null ? undefined : { read: input.cachedRead },
          },
    },
    options,
  );
}
