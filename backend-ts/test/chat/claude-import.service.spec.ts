import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import Database from "better-sqlite3";
import { ClaudeImportService } from "../../src/modules/chat/claude-import/claude-import.service";

/** 造一条 Claude 源 jsonl 行 */
function line(fields: Record<string, unknown>): string {
  return JSON.stringify(fields);
}

const T1 = 1730000000000;
const T2 = 1730000600000;

/** 测试统一用同一份模型能力：窗口 200K、最大输出 64K → 有效窗口 200K - 21K = 179K */
const MODEL_CONFIG = { contextWindow: 200000, maxOutputTokens: 64000 };
const EXPECTED_EFFECTIVE_WINDOW = 179000;

describe("ClaudeImportService.importedSessionId", () => {
  it("同源恒同 id；不同源不同 id", () => {
    const a = ClaudeImportService.importedSessionId("C:\\Users\\x\\.claude\\projects\\p\\s1.jsonl", "s1");
    const a2 = ClaudeImportService.importedSessionId("c:/users/x/.claude/projects/p/s1.jsonl", "s1");
    const b = ClaudeImportService.importedSessionId("C:\\Users\\x\\.claude\\projects\\p\\s2.jsonl", "s1");
    expect(a).toBe(a2); // 路径分隔符与大小写归一
    expect(a).toMatch(/^claude-[0-9a-f]{20}$/);
    expect(a).not.toBe(b);
  });
});

describe("ClaudeImportService.scanClaudeSessions", () => {
  let tmpDir: string;
  let homeDir: string;
  let service: ClaudeImportService;
  let existingImportedId: string;
  let getManyByIds: jest.Mock;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "claude-import-"));
    homeDir = path.join(tmpDir, "home");
    // 伪 ~/.claude/projects 树：<escaped-project>/<sessionId>.jsonl
    const projectDir = path.join(homeDir, ".claude", "projects", "D--repo-demo");
    fs.mkdirSync(projectDir, { recursive: true });
    fs.writeFileSync(
      path.join(projectDir, "session-a.jsonl"),
      [
        line({ type: "user", cwd: "D:\\repo\\demo", timestamp: T1, message: { content: "第一个会话的问题" } }),
        line({ type: "assistant", timestamp: T2, message: { model: "claude-5", content: [{ type: "text", text: "回答" }] } }),
      ].join("\n"),
      "utf8",
    );
    fs.writeFileSync(
      path.join(projectDir, "session-side.jsonl"),
      line({ type: "user", isSidechain: true, timestamp: T1, message: { content: "subagent" } }),
      "utf8",
    );
    // subagents 目录整体跳过
    const subDir = path.join(projectDir, "subagents");
    fs.mkdirSync(subDir, { recursive: true });
    fs.writeFileSync(
      path.join(subDir, "session-sub.jsonl"),
      line({ type: "user", timestamp: T1, message: { content: "子代理" } }),
      "utf8",
    );
    // 第二个候选根（HOME 与 USERDATA_DIR 重定向不同目录时的覆盖场景）
    const userData = path.join(tmpDir, "userdata");
    const projectDir2 = path.join(userData, ".claude", "projects", "E--other");
    fs.mkdirSync(projectDir2, { recursive: true });
    fs.writeFileSync(
      path.join(projectDir2, "session-b.jsonl"),
      line({ type: "user", cwd: "E:\\other", timestamp: T2 + 600000, message: { content: "第二个会话" } }),
      "utf8",
    );
    // modifiedSince 按"文件 mtime"过滤（记录时间只用于排序/展示）：
    // 把 session-a 的 mtime 拨回旧时刻，session-b 保持刚写入的当前 mtime
    const oldDate = new Date(T2);
    fs.utimesSync(path.join(projectDir, "session-a.jsonl"), oldDate, oldDate);

    process.env.HOME = homeDir;
    process.env.USERDATA_DIR = userData;

    // 假装 session-a 已经导入过：会话表里存在它的幂等锚点
    existingImportedId = ClaudeImportService.importedSessionId(
      path.join(projectDir, "session-a.jsonl"),
      "session-a",
    );
    getManyByIds = jest.fn(async (ids: string[]) =>
      ids.includes(existingImportedId) ? [{ id: existingImportedId }] : [],
    );

    service = new ClaudeImportService(
      { getSessionById: jest.fn() } as any,
      { listAgents: jest.fn(async () => [{ id: "default-agent" }]) } as any,
      { findModel: jest.fn((id: string) => ({ id, config: MODEL_CONFIG })), listModels: jest.fn(() => [{ id: "fallback-model" }]) } as any,
      { importTurns: jest.fn() } as any,
      { getManyByIds } as any,
    );
  });

  afterEach(() => {
    delete process.env.HOME;
    delete process.env.USERDATA_DIR;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("扫描产出候选：sidechain 与 subagents 目录跳过，时间倒序", async () => {
    const { candidates } = await service.scanClaudeSessions();
    const ids = candidates.map((c) => c.sessionId);
    expect(ids).toContain("session-a");
    expect(ids).toContain("session-b");
    expect(ids).not.toContain("session-side");
    expect(ids).not.toContain("session-sub");
    // updatedAt 降序：session-b 更新
    expect(candidates[0].sessionId).toBe("session-b");
    const a = candidates.find((c) => c.sessionId === "session-a")!;
    expect(a.workspacePath).toBe("D:\\repo\\demo");
    expect(a.previewTitle).toBe("第一个会话的问题");
    expect(a.provider).toBe("claudeCode");
  });

  it("modifiedSince 过滤旧文件（按 mtime）", async () => {
    const { candidates } = await service.scanClaudeSessions({ modifiedSince: Date.now() - 60000 });
    expect(candidates.map((c) => c.sessionId)).toEqual(["session-b"]);
  });

  it("候选带源文件体积；命中幂等锚点的标 imported 并给出本地会话 id", async () => {
    const { candidates } = await service.scanClaudeSessions();
    const a = candidates.find((c) => c.sessionId === "session-a")!;
    const b = candidates.find((c) => c.sessionId === "session-b")!;
    expect(a.imported).toBe(true);
    expect(a.importedSessionId).toBe(existingImportedId);
    expect(b.imported).toBe(false);
    expect(b.importedSessionId).toBeUndefined();
    // 体积直接取 stat，不解析全文
    expect(a.sizeBytes).toBe(
      fs.statSync(path.join(homeDir, ".claude", "projects", "D--repo-demo", "session-a.jsonl")).size,
    );
  });

  it("withImported:false 不查会话表（导入路径内部复用扫描用）", async () => {
    const { candidates } = await service.scanClaudeSessions({ withImported: false });
    expect(getManyByIds).not.toHaveBeenCalled();
    expect(candidates.every((c) => c.imported === undefined)).toBe(true);
    // 体积仍然给，它是 stat 的副产品
    expect(candidates.every((c) => typeof c.sizeBytes === "number")).toBe(true);
  });
});

describe("ClaudeImportService.importClaudeSessions", () => {
  let tmpDir: string;
  let homeDir: string;
  let createSession: jest.Mock;
  let importTurns: jest.Mock;
  let getSessionById: jest.Mock;
  let service: ClaudeImportService;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "claude-import2-"));
    homeDir = path.join(tmpDir, "home");
    const projectDir = path.join(homeDir, ".claude", "projects", "D--repo");
    fs.mkdirSync(projectDir, { recursive: true });
    fs.writeFileSync(
      path.join(projectDir, "sess1.jsonl"),
      [
        line({ type: "user", cwd: tmpDir, timestamp: T1, message: { content: "问题" } }),
        line({ type: "assistant", timestamp: T2, message: { model: "claude-5", content: [{ type: "text", text: "回答" }] } }),
      ].join("\n"),
      "utf8",
    );
    process.env.HOME = homeDir;
    delete process.env.USERDATA_DIR;

    createSession = jest.fn(async (data: any) => ({ id: `new-${data.title}`, ...data }));
    importTurns = jest.fn(async () => ({ imported: 4 }));
    getSessionById = jest.fn(async () => null); // 未导入过
    service = new ClaudeImportService(
      { getSessionById, createSession, deleteSession: jest.fn(async () => ({})) } as any,
      { listAgents: jest.fn(async () => [{ id: "default-agent" }]) } as any,
      { findModel: jest.fn((id: string) => ({ id, config: MODEL_CONFIG })), listModels: jest.fn(() => [{ id: "fallback-model" }]) } as any,
      { importTurns } as any,
      { getManyByIds: jest.fn(async () => []) } as any,
    );
  });

  afterEach(() => {
    delete process.env.HOME;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("导入：createSession 带 migrationSource + importTurns 收到带原始时间的 turns", async () => {
    const result = await service.importClaudeSessions({ sessionIds: ["sess1"], agentId: "agent-1" });
    expect(result.imported).toHaveLength(1);
    expect(result.skipped).toHaveLength(0);
    expect(createSession).toHaveBeenCalledTimes(1);
    const arg = createSession.mock.calls[0][0];
    expect(arg.agentId).toBe("agent-1");
    expect(arg.title).toBe("问题");
    expect(arg.data.migrationSource).toBe("claudeCode");
    expect(arg.data.importedSessionId).toMatch(/^claude-/);
    expect(arg.workspacePath).toBe(tmpDir); // cwd 存在 → 复用
    // 模型不取来源端：助手默认（可解析时）→ 任一启用模型兜底
    expect(arg.modelId).toBeTruthy();
    expect(importTurns).toHaveBeenCalledTimes(1);
    const turns = importTurns.mock.calls[0][1];
    expect(turns[0].createdAt).toBe(T1);
    expect(turns[0].messages[0].createdAt).toBe(T1);
    // 上下文占用锚点：按本机模型窗口算出有效窗口，随 turn/finish 落库
    expect(importTurns.mock.calls[0][2]?.effectiveContextWindow).toBe(EXPECTED_EFFECTIVE_WINDOW);
  });

  it("未传 agentId → 回退默认助手", async () => {
    const result = await service.importClaudeSessions({ sessionIds: ["sess1"] });
    expect(result.imported).toHaveLength(1);
    expect(createSession.mock.calls[0][0].agentId).toBe("default-agent");
  });

  it("幂等：已导入过 → skipped already_imported，不再建会话", async () => {
    getSessionById.mockResolvedValue({ id: "claude-existing" });
    const result = await service.importClaudeSessions({ sessionIds: ["sess1"] });
    expect(result.skipped).toEqual([{ sessionId: "sess1", reason: "already_imported" }]);
    expect(createSession).not.toHaveBeenCalled();
  });

  it("导入消息失败 → 回滚删除半成品会话并记 failed", async () => {
    importTurns.mockRejectedValue(new Error("disk full"));
    const result = await service.importClaudeSessions({ sessionIds: ["sess1"] });
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].reason).toContain("disk full");
    expect(importTurns).toHaveBeenCalled();
  });

  it("未知 sessionId → skipped session_not_found", async () => {
    const result = await service.importClaudeSessions({ sessionIds: ["nope"] });
    expect(result.skipped).toEqual([{ sessionId: "nope", reason: "session_not_found" }]);
  });
});

describe("ClaudeImportService ZCode 来源", () => {
  let tmpDir: string;
  let createSession: jest.Mock;
  let importTurns: jest.Mock;
  let getSessionById: jest.Mock;
  let deleteSession: jest.Mock;
  let service: ClaudeImportService;

  beforeAll(() => {
    // 建微型 zcode 库（只含 reader 依赖的最小列集）
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "zcode-import-"));
    const dbPath = path.join(tmpDir, ".zcode", "cli", "db", "db.sqlite");
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    const db = new Database(dbPath);
    db.exec(`
      CREATE TABLE session (
        id TEXT PRIMARY KEY, title TEXT, directory TEXT, task_type TEXT,
        parent_id TEXT, time_deleted INTEGER, time_created INTEGER, time_updated INTEGER
      );
      CREATE TABLE message (
        id TEXT PRIMARY KEY, session_id TEXT, sequence INTEGER, time_created INTEGER, data TEXT
      );
      CREATE TABLE part (
        id TEXT PRIMARY KEY, message_id TEXT, session_id TEXT, sequence INTEGER, time_created INTEGER, data TEXT
      );
    `);
    db.prepare(
      "INSERT INTO session (id, title, directory, task_type, parent_id, time_deleted, time_created, time_updated) VALUES (?,?,?,?,?,?,?,?)",
    ).run("z-sess-1", "ZCode 里的会话", null, "interactive", null, null, T1, T2);
    db.prepare(
      "INSERT INTO message (id, session_id, sequence, time_created, data) VALUES (?,?,?,?,?)",
    ).run("z-m-u1", "z-sess-1", 1, T1, JSON.stringify({ role: "user", time: { created: T1 }, semantics: {} }));
    db.prepare(
      "INSERT INTO part (id, message_id, session_id, sequence, time_created, data) VALUES (?,?,?,?,?,?)",
    ).run("z-p-u1", "z-m-u1", "z-sess-1", 1, T1, JSON.stringify({ type: "text", text: "zcode 里的问题" }));
    db.prepare(
      "INSERT INTO message (id, session_id, sequence, time_created, data) VALUES (?,?,?,?,?)",
    ).run("z-m-a1", "z-sess-1", 2, T2, JSON.stringify({
      role: "assistant", time: { created: T2 }, parentID: "z-m-u1", modelId: "glm-5.3",
    }));
    db.prepare(
      "INSERT INTO part (id, message_id, session_id, sequence, time_created, data) VALUES (?,?,?,?,?,?)",
    ).run("z-p-a1", "z-m-a1", "z-sess-1", 1, T2, JSON.stringify({ type: "text", text: "zcode 里的回答" }));
    // 压缩摘要 + 压缩点（挂在第二回合 user 消息上）
    db.prepare(
      "INSERT INTO message (id, session_id, sequence, time_created, data) VALUES (?,?,?,?,?)",
    ).run("z-m-sum", "z-sess-1", 3, T2 + 1000, JSON.stringify({ role: "user", time: { created: T2 + 1000 }, semantics: { kind: "compact_summary" } }));
    db.prepare(
      "INSERT INTO part (id, message_id, session_id, sequence, time_created, data) VALUES (?,?,?,?,?,?)",
    ).run("z-p-sum", "z-m-sum", "z-sess-1", 1, T2 + 1000, JSON.stringify({ type: "text", text: "压缩摘要ABC" }));
    db.prepare(
      "INSERT INTO message (id, session_id, sequence, time_created, data) VALUES (?,?,?,?,?)",
    ).run("z-m-u2", "z-sess-1", 4, T2 + 2000, JSON.stringify({ role: "user", time: { created: T2 + 2000 }, semantics: {} }));
    db.prepare(
      "INSERT INTO part (id, message_id, session_id, sequence, time_created, data) VALUES (?,?,?,?,?,?)",
    ).run("z-p-u2", "z-m-u2", "z-sess-1", 1, T2 + 2000, JSON.stringify({ type: "text", text: "第二个问题" }));
    db.prepare(
      "INSERT INTO part (id, message_id, session_id, sequence, time_created, data) VALUES (?,?,?,?,?,?)",
    ).run("z-p-compact", "z-m-u2", "z-sess-1", 2, T2 + 1500, JSON.stringify({
      type: "compaction",
      summaryMessageId: "z-m-sum",
      time: { start: T2 + 1500 },
    }));
    db.close();

    process.env.HOME = tmpDir;
    delete process.env.USERDATA_DIR;
    delete process.env.ZCODE_DATA_BASE_DIR;
  });

  afterAll(() => {
    delete process.env.HOME;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    createSession = jest.fn(async (data: any) => ({ id: `new-z-${data.title}`, ...data }));
    importTurns = jest.fn(async () => ({ imported: 2 }));
    getSessionById = jest.fn(async () => null);
    deleteSession = jest.fn(async () => ({}));
    service = new ClaudeImportService(
      { getSessionById, createSession, deleteSession } as any,
      { listAgents: jest.fn(async () => [{ id: "default-agent" }]) } as any,
      { findModel: jest.fn((id: string) => ({ id, config: MODEL_CONFIG })), listModels: jest.fn(() => [{ id: "fallback-model" }]) } as any,
      { importTurns } as any,
      { getManyByIds: jest.fn(async () => []) } as any,
    );
  });

  it("扫描：候选来自 zcode 库，标题/时间/来源语义正确", async () => {
    const { candidates, roots } = await service.scanZcodeSessions();
    expect(roots.some((r) => r.includes(".zcode"))).toBe(true);
    const target = candidates.find((c) => c.sessionId === "z-sess-1");
    expect(target).toBeDefined();
    expect(target!.provider).toBe("zcode");
    expect(target!.previewTitle).toBe("ZCode 里的会话");
    expect(target!.updatedAt).toBe(T2);
    // 列表预览字段：消息数由 session 查询的相关子查询一次带出；库里没有同源导入记录 → 未标已导入
    expect(target!.messageCount).toBe(4);
    expect(target!.imported).toBe(false);
  });

  it("导入：migrationSource=zcode + importTurns 收到解析后的轮次", async () => {
    const result = await service.importZcodeSessions({ sessionIds: ["z-sess-1"], agentId: "agent-1" });
    expect(result.imported).toHaveLength(1);
    const arg = createSession.mock.calls[0][0];
    expect(arg.agentId).toBe("agent-1");
    expect(arg.title).toBe("ZCode 里的会话");
    // 模型不取来源端：用本机可解析的模型（助手默认/兜底），用户之后在对话框里自己选
    expect(arg.modelId).toBeTruthy();
    expect(arg.data.sourceModel).toBe("glm-5.3");
    expect(arg.data.migrationSource).toBe("zcode");
    expect(arg.data.importedSessionId).toMatch(/^zcode-/);
    const turns = importTurns.mock.calls[0][1];
    // 两轮：第一轮 + 压缩后的第二轮
    expect(turns).toHaveLength(2);
    expect((turns[0].messages[1].content[0] as any).text).toBe("zcode 里的回答");
    expect(turns[0].messages[1].createdAt).toBe(T2);
    // 压缩点换算：第一轮 2 条消息全部被摘要遮蔽，插在第二轮之前
    const opts = importTurns.mock.calls[0][2];
    expect(opts?.compactions).toHaveLength(1);
    expect(opts?.compactions[0]).toMatchObject({
      beforeTurnIndex: 1,
      summary: "压缩摘要ABC",
      shadowedCount: 2,
      shadowedEndId: turns[0].messages[1].id,
      time: T2 + 1500,
    });
    // 上下文占用锚点：按本机模型窗口算出的有效窗口一并传入
    expect(opts?.effectiveContextWindow).toBe(EXPECTED_EFFECTIVE_WINDOW);
  });

  it("幂等：getSessionById 命中 → skipped already_imported", async () => {
    getSessionById.mockResolvedValue({ id: "zcode-existing" });
    const result = await service.importZcodeSessions({ sessionIds: ["z-sess-1"] });
    expect(result.skipped).toEqual([{ sessionId: "z-sess-1", reason: "already_imported" }]);
    expect(createSession).not.toHaveBeenCalled();
  });

  it("导入消息失败 → 回滚删除半成品会话并记 failed", async () => {
    importTurns.mockRejectedValue(new Error("write failed"));
    const result = await service.importZcodeSessions({ sessionIds: ["z-sess-1"] });
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].reason).toContain("write failed");
    expect(deleteSession).toHaveBeenCalled();
  });

  it("库里不存在的 sessionId → skipped session_not_found", async () => {
    const result = await service.importZcodeSessions({ sessionIds: ["z-nope"] });
    expect(result.skipped).toEqual([{ sessionId: "z-nope", reason: "session_not_found" }]);
  });
});

describe("ClaudeImportService DSH 来源", () => {
  let tmpHome: string;
  let createSession: jest.Mock;
  let importTurns: jest.Mock;
  let getSessionById: jest.Mock;
  let deleteSession: jest.Mock;
  let service: ClaudeImportService;

  beforeAll(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-import-"));
    const sessionDir = path.join(tmpHome, "sessions", "--proj--", "session-dsh-1");
    fs.mkdirSync(sessionDir, { recursive: true });
    fs.writeFileSync(
      path.join(sessionDir, "session.jsonl"),
      [
        line({ type: "session", version: 0, id: "session-dsh-1", createdAt: T1, cwd: null, delegationDepth: 0 }),
        line({
          type: "user/message",
          seq: 1,
          time: T1,
          surfaceOp: "append",
          data: { id: "u1", role: "user", content: [{ type: "text", text: "DSH 问题" }], source: { kind: "user" } },
        }),
        line({
          type: "assistant/message",
          seq: 2,
          time: T2,
          surfaceOp: "append",
          data: {
            turn: 1,
            step: 1,
            message: {
              id: "a1",
              role: "assistant",
              content: [{ type: "text", text: "DSH 回答" }],
              source: { kind: "model", provider: "deepseek-official", model: "deepseek-v4-flash" },
            },
            usage: { inputTokens: 10, outputTokens: 5 },
          },
        }),
        line({ type: "session/title", seq: 3, time: T2, data: { title: "DSH 会话标题" } }),
      ].join("\n") + "\n",
      "utf8",
    );
    process.env.DSH_HOME = tmpHome;
  });

  afterAll(() => {
    delete process.env.DSH_HOME;
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  beforeEach(() => {
    createSession = jest.fn(async (data: any) => ({ id: `new-dsh-${data.title}`, ...data }));
    importTurns = jest.fn(async () => ({ imported: 2 }));
    getSessionById = jest.fn(async () => null);
    deleteSession = jest.fn(async () => ({}));
    service = new ClaudeImportService(
      { getSessionById, createSession, deleteSession } as any,
      { listAgents: jest.fn(async () => [{ id: "default-agent" }]) } as any,
      { findModel: jest.fn((id: string) => ({ id, config: MODEL_CONFIG })), listModels: jest.fn(() => [{ id: "fallback-model" }]) } as any,
      { importTurns } as any,
      { getManyByIds: jest.fn(async () => []) } as any,
    );
  });

  it("扫描：候选来自 ~/.dsh/sessions，标题/工作区/时间正确", async () => {
    const { candidates, roots } = await service.scanDshSessions();
    expect(roots).toHaveLength(1);
    expect(roots[0]).toContain("sessions");
    const target = candidates.find((c) => c.sessionId === "session-dsh-1");
    expect(target).toBeDefined();
    expect(target!.provider).toBe("dsh");
    // 扫描预览：无 projcache 时用首条真实 user 文本（session/title 事件在导入时才解析）
    expect(target!.previewTitle).toBe("DSH 问题");
    expect(target!.sizeBytes).toBeGreaterThan(0);
  });

  it("导入：migrationSource=dsh + 原始时间 + 有效窗口锚点", async () => {
    const result = await service.importDshSessions({ sessionIds: ["session-dsh-1"], agentId: "agent-1" });
    expect(result.imported).toHaveLength(1);
    const arg = createSession.mock.calls[0][0];
    expect(arg.agentId).toBe("agent-1");
    expect(arg.title).toBe("DSH 会话标题");
    expect(arg.data.migrationSource).toBe("dsh");
    expect(arg.data.sourceModel).toBe("deepseek-v4-flash");
    expect(arg.data.importedSessionId).toMatch(/^dsh-/);
    const turns = importTurns.mock.calls[0][1];
    expect(turns).toHaveLength(1);
    expect((turns[0].messages[1].content[0] as any).text).toBe("DSH 回答");
    expect(turns[0].messages[0].createdAt).toBe(T1);
    expect(importTurns.mock.calls[0][2]?.effectiveContextWindow).toBe(EXPECTED_EFFECTIVE_WINDOW);
  });

  it("幂等：getSessionById 命中 → skipped already_imported", async () => {
    getSessionById.mockResolvedValue({ id: "dsh-existing" });
    const result = await service.importDshSessions({ sessionIds: ["session-dsh-1"] });
    expect(result.skipped).toEqual([{ sessionId: "session-dsh-1", reason: "already_imported" }]);
    expect(createSession).not.toHaveBeenCalled();
  });

  it("导入消息失败 → 回滚删除半成品会话并记 failed", async () => {
    importTurns.mockRejectedValue(new Error("write failed"));
    const result = await service.importDshSessions({ sessionIds: ["session-dsh-1"] });
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].reason).toContain("write failed");
    expect(deleteSession).toHaveBeenCalled();
  });

  it("不存在的 sessionId → skipped session_not_found", async () => {
    const result = await service.importDshSessions({ sessionIds: ["nope"] });
    expect(result.skipped).toEqual([{ sessionId: "nope", reason: "session_not_found" }]);
  });
});

describe("ClaudeImportService Codex 来源", () => {
  const THREAD = "019f78e7-2a3b-7ee0-a88b-3c5701f87c18";
  let tmpHome: string;
  let createSession: jest.Mock;
  let importTurns: jest.Mock;
  let getSessionById: jest.Mock;
  let deleteSession: jest.Mock;
  let service: ClaudeImportService;

  beforeAll(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "codex-import-"));
    const dir = path.join(tmpHome, "sessions", "2026", "07", "19");
    fs.mkdirSync(dir, { recursive: true });
    const at = (i: number) => new Date(T1 + i * 1000).toISOString();
    const lines = [
      JSON.stringify({ timestamp: at(0), type: "session_meta", payload: { id: THREAD, cwd: null } }),
      JSON.stringify({
        timestamp: at(1),
        type: "response_item",
        payload: { type: "message", role: "user", content: [{ type: "input_text", text: "Codex 问题" }] },
      }),
      JSON.stringify({
        timestamp: at(2),
        type: "response_item",
        payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "Codex 回答" }] },
      }),
      JSON.stringify({
        timestamp: at(3),
        type: "event_msg",
        payload: {
          type: "token_count",
          info: { last_token_usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } },
        },
      }),
      JSON.stringify({ timestamp: at(4), type: "session/title", payload: { title: "不应使用（Codex 无此事件）" } }),
    ];
    fs.writeFileSync(
      path.join(dir, `rollout-2026-07-19T05-44-03-${THREAD}.jsonl`),
      lines.join("\n") + "\n",
      "utf8",
    );
    process.env.CODEX_HOME = tmpHome;
  });

  afterAll(() => {
    delete process.env.CODEX_HOME;
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  beforeEach(() => {
    createSession = jest.fn(async (data: any) => ({ id: `new-codex-${data.title}`, ...data }));
    importTurns = jest.fn(async () => ({ imported: 2 }));
    getSessionById = jest.fn(async () => null);
    deleteSession = jest.fn(async () => ({}));
    service = new ClaudeImportService(
      { getSessionById, createSession, deleteSession } as any,
      { listAgents: jest.fn(async () => [{ id: "default-agent" }]) } as any,
      { findModel: jest.fn((id: string) => ({ id, config: MODEL_CONFIG })), listModels: jest.fn(() => [{ id: "fallback-model" }]) } as any,
      { importTurns } as any,
      { getManyByIds: jest.fn(async () => []) } as any,
    );
  });

  it("扫描：候选来自 ~/.codex/sessions，首问作为标题", async () => {
    const { candidates, roots } = await service.scanCodexSessions();
    expect(roots.length).toBeGreaterThan(0);
    const target = candidates.find((c) => c.sessionId === THREAD);
    expect(target).toBeDefined();
    expect(target!.provider).toBe("codex");
    expect(target!.previewTitle).toBe("Codex 问题");
    expect(target!.sizeBytes).toBeGreaterThan(0);
  });

  it("导入：migrationSource=codex + 有效窗口锚点", async () => {
    const result = await service.importCodexSessions({ sessionIds: [THREAD], agentId: "agent-1" });
    expect(result.imported).toHaveLength(1);
    const arg = createSession.mock.calls[0][0];
    expect(arg.agentId).toBe("agent-1");
    expect(arg.title).toBe("Codex 问题");
    expect(arg.data.migrationSource).toBe("codex");
    expect(arg.data.importedSessionId).toMatch(/^codex-/);
    const turns = importTurns.mock.calls[0][1];
    expect(turns).toHaveLength(1);
    const assistant = turns[0].messages[1];
    expect((assistant.content[0] as any).text).toBe("Codex 回答");
    // token_count 的用量挂在 assistant 上
    expect(assistant.metadata.usage).toMatchObject({ promptTokens: 10, completionTokens: 5 });
    expect(importTurns.mock.calls[0][2]?.effectiveContextWindow).toBe(EXPECTED_EFFECTIVE_WINDOW);
  });

  it("幂等：getSessionById 命中 → skipped already_imported", async () => {
    getSessionById.mockResolvedValue({ id: "codex-existing" });
    const result = await service.importCodexSessions({ sessionIds: [THREAD] });
    expect(result.skipped).toEqual([{ sessionId: THREAD, reason: "already_imported" }]);
    expect(createSession).not.toHaveBeenCalled();
  });

  it("导入消息失败 → 回滚删除半成品会话并记 failed", async () => {
    importTurns.mockRejectedValue(new Error("write failed"));
    const result = await service.importCodexSessions({ sessionIds: [THREAD] });
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].reason).toContain("write failed");
    expect(deleteSession).toHaveBeenCalled();
  });

  it("不存在的 sessionId → skipped session_not_found", async () => {
    const result = await service.importCodexSessions({ sessionIds: ["nope"] });
    expect(result.skipped).toEqual([{ sessionId: "nope", reason: "session_not_found" }]);
  });
});
