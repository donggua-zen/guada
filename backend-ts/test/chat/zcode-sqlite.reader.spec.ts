import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import Database from "better-sqlite3";
import {
  listZcodeSessions,
  readZcodeSession,
  selectActiveBranch,
  zcodeDbPaths,
} from "../../src/modules/chat/claude-import/zcode-sqlite.reader";

const T0 = 1730000000000;

/** 建微型 zcode 会话库（只含 reader 依赖的最小列集） */
function buildFixtureDb(dbPath: string): void {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE session (
      id TEXT PRIMARY KEY,
      title TEXT,
      directory TEXT,
      task_type TEXT,
      parent_id TEXT,
      time_deleted INTEGER,
      time_created INTEGER,
      time_updated INTEGER,
      revert TEXT
    );
    CREATE TABLE message (
      id TEXT PRIMARY KEY,
      session_id TEXT,
      sequence INTEGER,
      time_created INTEGER,
      data TEXT
    );
    CREATE TABLE part (
      id TEXT PRIMARY KEY,
      message_id TEXT,
      session_id TEXT,
      sequence INTEGER,
      time_created INTEGER,
      data TEXT
    );
  `);

  const insSession = db.prepare(
    "INSERT INTO session (id, title, directory, task_type, parent_id, time_deleted, time_created, time_updated) VALUES (?,?,?,?,?,?,?,?)",
  );
  const insMessage = db.prepare(
    "INSERT INTO message (id, session_id, sequence, time_created, data) VALUES (?,?,?,?,?)",
  );
  const insPart = db.prepare(
    "INSERT INTO part (id, message_id, session_id, sequence, time_created, data) VALUES (?,?,?,?,?,?)",
  );

  // ── 会话 1：两轮对话，含 tool 调用 + reasoning + usage ──
  insSession.run("sess1", "修复登录 bug", "D:\\repo\\app", "interactive", null, null, T0, T0 + 120000);

  // 第 1 轮 user + assistant(text + tool_use) + tool 结果
  insMessage.run("m-u1", "sess1", 1, T0, JSON.stringify({ role: "user", time: { created: T0 }, semantics: {} }));
  insPart.run("p-u1a", "m-u1", "sess1", 1, T0, JSON.stringify({ type: "text", text: "帮我跑一下测试" }));
  // synthetic 提醒 part：应被跳过
  insPart.run("p-u1b", "m-u1", "sess1", 2, T0, JSON.stringify({ type: "text", text: "system reminder", synthetic: true }));

  insMessage.run("m-a1", "sess1", 2, T0 + 30000, JSON.stringify({
    role: "assistant",
    time: { created: T0 + 30000, completed: T0 + 60000 },
    parentID: "m-u1",
    modelId: "claude-5",
    tokens: { input: 100, output: 50, cache: { read: 10, write: 5 } },
  }));
  insPart.run("p-a1a", "m-a1", "sess1", 1, T0 + 30000, JSON.stringify({ type: "reasoning", text: "先想一下" }));
  insPart.run("p-a1b", "m-a1", "sess1", 2, T0 + 31000, JSON.stringify({
    type: "tool", callID: "call_1", tool: "Bash",
    state: { status: "completed", input: { command: "npm test" }, output: "all passed", time: { start: T0 + 31000, end: T0 + 50000 } },
  }));
  insPart.run("p-a1c", "m-a1", "sess1", 3, T0 + 55000, JSON.stringify({ type: "text", text: "测试通过了" }));
  // timeline part：非对话内容，应跳过
  insPart.run("p-a1d", "m-a1", "sess1", 4, T0 + 56000, JSON.stringify({ type: "timeline", timelineType: "model_change" }));

  // 第 2 轮：pending tool（跳过）+ sequence 为 NULL 的消息（排序兜底）
  insMessage.run("m-u2", "sess1", 3, T0 + 70000, JSON.stringify({ role: "user", time: { created: T0 + 70000 }, semantics: { kind: "system_reminder" } }));
  // 压缩摘要消息（不进对话，文本作为压缩点摘要）——排在 system_reminder 之后、第二回合之前
  insMessage.run("m-sum1", "sess1", 3, T0 + 75000, JSON.stringify({ role: "user", time: { created: T0 + 75000 }, semantics: { kind: "compact_summary" } }));
  insPart.run("p-sum1", "m-sum1", "sess1", 1, T0 + 75000, JSON.stringify({ type: "text", text: "早前的对话已压缩成摘要" }));
  insMessage.run("m-u3", "sess1", 4, T0 + 80000, JSON.stringify({ role: "user", time: { created: T0 + 80000 }, semantics: {} }));
  insPart.run("p-u3", "m-u3", "sess1", 1, T0 + 80000, JSON.stringify({ type: "text", text: "再跑一次 lint" }));
  // compaction part 挂在第二回合的 user 消息上：压缩点 = 第二回合之前
  insPart.run("p-compact1", "m-u3", "sess1", 2, T0 + 79000, JSON.stringify({
    type: "compaction",
    auto: true,
    summaryMessageId: "m-sum1",
    compactBoundary: { summaryMessageIds: ["m-sum1"], lastSummarizedMessageId: "m-a1" },
    time: { start: T0 + 79000 },
  }));
  insMessage.run("m-a2", "sess1", null, T0 + 90000, JSON.stringify({
    role: "assistant", time: { created: T0 + 90000 }, parentID: "m-u3", modelId: "claude-5",
  }));
  insPart.run("p-a2a", "m-a2", "sess1", 1, T0 + 90000, JSON.stringify({
    type: "tool", callID: "call_2", tool: "Bash",
    state: { status: "pending", input: {} },
  }));
  insPart.run("p-a2b", "m-a2", "sess1", 2, T0 + 91000, JSON.stringify({
    type: "tool", callID: "call_3", tool: "Bash",
    state: { status: "error", input: {}, error: "command failed", time: { end: T0 + 95000 } },
  }));

  // ── 会话 2：附属会话（task_type=subagent_child）应被 list 过滤 ──
  insSession.run("sess-sub", "子代理", null, "subagent_child", "sess1", null, T0, T0);
  insMessage.run("m-s1", "sess-sub", 1, T0, JSON.stringify({ role: "user", time: { created: T0 } }));
  insPart.run("p-s1", "m-s1", "sess-sub", 1, T0, JSON.stringify({ type: "text", text: "子代理输入" }));

  // ── 会话 3：软删除，应被过滤 ──
  insSession.run("sess-del", "已删除", null, "interactive", null, T0 + 999999, T0, T0);

  // ── 会话 4：assistant 开头（无 user 锚点）补空回合外壳 ──
  insSession.run("sess-orphan", "孤儿", null, "interactive", null, null, T0, T0);
  insMessage.run("m-o1", "sess-orphan", 1, T0, JSON.stringify({ role: "assistant", time: { created: T0 } }));
  insPart.run("p-o1", "m-o1", "sess-orphan", 1, T0, JSON.stringify({ type: "text", text: "孤儿回复" }));

  // ── 会话 5：编辑/重试（rewind）——旧分支应被 session.revert 排除 ──
  // active = kept(m-r1,m-r2) + branchCutAfter(m-r4) 之后的新消息(m-r5,m-r6)
  db.prepare(
    "INSERT INTO session (id, title, directory, task_type, parent_id, time_deleted, time_created, time_updated, revert) VALUES (?,?,?,?,?,?,?,?,?)",
  ).run(
    "sess-revert",
    "编辑过的会话",
    null,
    "interactive",
    null,
    null,
    T0,
    T0 + 600000,
    JSON.stringify({
      targetMessageID: "m-r3",
      keptMessageIDs: ["m-r1", "m-r2"],
      branchCutAfterMessageID: "m-r4",
      createdMessageID: "m-r5",
      kind: "conversation_rewind",
      scope: "conversation",
    }),
  );
  insMessage.run("m-r1", "sess-revert", 1, T0, JSON.stringify({ role: "user", time: { created: T0 }, semantics: {} }));
  insPart.run("p-r1", "m-r1", "sess-revert", 1, T0, JSON.stringify({ type: "text", text: "第一个问题" }));
  insMessage.run("m-r2", "sess-revert", 2, T0 + 1000, JSON.stringify({ role: "assistant", time: { created: T0 + 1000 }, parentID: "m-r1", modelId: "glm-5.3" }));
  insPart.run("p-r2", "m-r2", "sess-revert", 1, T0 + 1000, JSON.stringify({ type: "text", text: "第一个回答" }));
  // 旧分支（被编辑掉的原问题/原回答）
  insMessage.run("m-r3", "sess-revert", 3, T0 + 2000, JSON.stringify({ role: "user", time: { created: T0 + 2000 }, semantics: {} }));
  insPart.run("p-r3", "m-r3", "sess-revert", 1, T0 + 2000, JSON.stringify({ type: "text", text: "原始问题（已被编辑）" }));
  insMessage.run("m-r4", "sess-revert", 4, T0 + 3000, JSON.stringify({ role: "assistant", time: { created: T0 + 3000 }, parentID: "m-r3", modelId: "glm-5.3" }));
  insPart.run("p-r4", "m-r4", "sess-revert", 1, T0 + 3000, JSON.stringify({ type: "text", text: "原始回答（编辑前）" }));
  // 新分支（rewind 之后追加）
  insMessage.run("m-r5", "sess-revert", 5, T0 + 4000, JSON.stringify({ role: "user", time: { created: T0 + 4000 }, semantics: {} }));
  insPart.run("p-r5", "m-r5", "sess-revert", 1, T0 + 4000, JSON.stringify({ type: "text", text: "编辑后的问题" }));
  insMessage.run("m-r6", "sess-revert", 6, T0 + 5000, JSON.stringify({ role: "assistant", time: { created: T0 + 5000 }, parentID: "m-r5", modelId: "glm-5.3" }));
  insPart.run("p-r6", "m-r6", "sess-revert", 1, T0 + 5000, JSON.stringify({ type: "text", text: "编辑后的回答" }));

  db.close();
}

describe("zcodeDbPaths", () => {
  it("HOME 指向含库的目录时包含该路径（本机真实 home 可能另有库，用 toContain）", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "zcode-paths-"));
    const dbPath = path.join(tmp, ".zcode", "cli", "db", "db.sqlite");
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    fs.writeFileSync(dbPath, "");
    process.env.HOME = tmp;
    delete process.env.USERDATA_DIR;
    delete process.env.ZCODE_DATA_BASE_DIR;
    try {
      expect(zcodeDbPaths()).toContain(dbPath);
    } finally {
      delete process.env.HOME;
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("无任何候选根时返回空数组", () => {
    delete process.env.HOME;
    delete process.env.USERDATA_DIR;
    delete process.env.ZCODE_DATA_BASE_DIR;
    // os.homedir() 仍指向真实 home——只断言函数不抛出
    expect(Array.isArray(zcodeDbPaths())).toBe(true);
  });
});

describe("listZcodeSessions", () => {
  let dbPath: string;

  beforeAll(() => {
    dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "zcode-list-")), "db.sqlite");
    buildFixtureDb(dbPath);
  });

  afterAll(() => {
    fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
  });

  it("只列 interactive|fork 且未软删除的顶层会话", () => {
    const sessions = listZcodeSessions(dbPath);
    const ids = sessions.map((s) => s.id);
    expect(ids).toContain("sess1");
    expect(ids).toContain("sess-orphan");
    expect(ids).not.toContain("sess-sub");
    expect(ids).not.toContain("sess-del");
    expect(sessions[0].id).toBe("sess-revert"); // time_updated 降序（该 fixture 最新）
  });
});

describe("readZcodeSession", () => {
  let dbPath: string;

  beforeAll(() => {
    dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "zcode-read-")), "db.sqlite");
    buildFixtureDb(dbPath);
  });

  afterAll(() => {
    fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
  });

  it("轮次聚合：user 锚点 + parentID 归属；synthetic/系统提醒跳过", () => {
    const { turns, meta, compactions } = readZcodeSession(dbPath, "sess1");
    // m-u1（真实输入）与 m-u3 两个回合；m-u2 是 system_reminder 跳过
    expect(turns).toHaveLength(2);

    const turn1 = turns[0];
    expect(turn1.messages[0]).toMatchObject({ role: "user", createdAt: T0 });
    expect((turn1.messages[0].content[0] as any).text).toBe("帮我跑一下测试");
    // assistant + tool（call_1）两条消息
    const roles1 = turn1.messages.map((m) => m.role);
    expect(roles1).toEqual(["user", "assistant", "tool"]);
    const assistant = turn1.messages[1];
    // reasoning + tool-call + text 块；timeline 块跳过
    expect(assistant.content.map((b) => b.type)).toEqual(["reasoning", "tool-call", "text"]);
    expect(assistant.source).toMatchObject({ kind: "model", model: "claude-5" });
    expect(assistant.metadata.usage).toMatchObject({ promptTokens: 100, completionTokens: 50 });
    const toolMsg = turn1.messages[2];
    expect(toolMsg.source).toEqual({ kind: "tool", toolCallId: "call_1" });
    expect(toolMsg.content[0]).toMatchObject({ type: "tool-result", content: "all passed" });

    const turn2 = turns[1];
    expect((turn2.messages[0].content[0] as any).text).toBe("再跑一次 lint");
    // pending tool 跳过、error tool 保留
    const tool2 = turn2.messages.find((m) => m.role === "tool")!;
    expect(tool2.source).toEqual({ kind: "tool", toolCallId: "call_3" });
    expect(tool2.content[0]).toMatchObject({ isError: true, content: "command failed" });
    // turn/finish 用 modelName
    expect(turn2.metadata.modelName).toBe("claude-5");

    expect(meta.title).toBe("修复登录 bug");
    expect(meta.model).toBe("claude-5");
    expect(meta.createdAt).toBe(T0);
    expect(meta.turnCount).toBe(2);

    // 压缩点：挂在第二回合 user 消息上 → beforeTurnIndex=1；摘要取 compact_summary 消息正文
    expect(compactions).toHaveLength(1);
    expect(compactions[0]).toMatchObject({
      beforeTurnIndex: 1,
      summary: "早前的对话已压缩成摘要",
      time: T0 + 79000,
    });
    // 摘要消息本身不进对话（turns 里没有它）
    const allTexts = turns.flatMap((t) =>
      t.messages.flatMap((m) => m.content.flatMap((b) => (b.type === "text" ? [b.text] : []))),
    );
    expect(allTexts).not.toContain("早前的对话已压缩成摘要");
  });

  it("assistant 开头（无 user 锚点）补空回合外壳", () => {
    const { turns } = readZcodeSession(dbPath, "sess-orphan");
    expect(turns).toHaveLength(1);
    expect(turns[0].messages[0].role).toBe("assistant");
    expect((turns[0].messages[0].content[0] as any).text).toBe("孤儿回复");
  });

  it("不存在的会话返回空 turns", () => {
    const { turns } = readZcodeSession(dbPath, "nope");
    expect(turns).toHaveLength(0);
  });

  it("编辑/重试（rewind）：只导入活跃分支，旧分支消息被排除", () => {
    const { turns } = readZcodeSession(dbPath, "sess-revert");
    // active = kept(m-r1,m-r2) + cut 之后(m-r5,m-r6) → 两轮
    expect(turns).toHaveLength(2);
    const userTexts = turns.map((t) => (t.messages[0].content[0] as any).text);
    expect(userTexts).toEqual(["第一个问题", "编辑后的问题"]);
    const assistantTexts = turns.map(
      (t) => (t.messages.find((m) => m.role === "assistant")!.content[0] as any).text,
    );
    expect(assistantTexts).toEqual(["第一个回答", "编辑后的回答"]);

    const allTexts = turns.flatMap((t) =>
      t.messages.flatMap((m) => m.content.flatMap((b) => (b.type === "text" ? [b.text] : []))),
    );
    // 旧分支（被编辑掉的原问题/原回答）不出现
    expect(allTexts).not.toContain("原始问题（已被编辑）");
    expect(allTexts).not.toContain("原始回答（编辑前）");
  });
});

describe("selectActiveBranch", () => {
  const msgs = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }, { id: "e" }];
  const ids = (list: { id: string }[]) => list.map((m) => m.id);

  it("无 revert → 原样返回", () => {
    expect(ids(selectActiveBranch(msgs, null))).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("kept + branchCut → 旧分支被排除", () => {
    // 编辑 c：kept=[a,b]，cut=d（提交前尾部），之后追加 e
    expect(
      ids(
        selectActiveBranch(msgs, {
          targetMessageID: "c",
          keptMessageIDs: ["a", "b"],
          branchCutAfterMessageID: "d",
          createdMessageID: "e",
        }),
      ),
    ).toEqual(["a", "b", "e"]);
  });

  it("kept 为空数组 → 只保留 cut 之后的新消息", () => {
    expect(
      ids(
        selectActiveBranch(msgs, {
          targetMessageID: "a",
          keptMessageIDs: [],
          branchCutAfterMessageID: "d",
        }),
      ),
    ).toEqual(["e"]);
  });

  it("无 keptMessageIDs → 用 target 之前的消息兜底", () => {
    expect(
      ids(
        selectActiveBranch(msgs, {
          targetMessageID: "c",
          branchCutAfterMessageID: "d",
        }),
      ),
    ).toEqual(["a", "b", "e"]);
  });

  it("旧格式（仅 createdMessageID，无 cut）→ kept + created 起", () => {
    expect(
      ids(
        selectActiveBranch(msgs, {
          targetMessageID: "c",
          keptMessageIDs: ["a", "b"],
          createdMessageID: "d",
        }),
      ),
    ).toEqual(["a", "b", "d", "e"]);
  });
});
