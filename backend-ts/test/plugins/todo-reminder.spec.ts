import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import {
  TODO_REMINDER_GAP_TURNS,
  TODO_REMINDER_TURNS,
  buildTodoReminderText,
  createTodoReminderProvider,
  getTodoReminderTurnCounts,
  hasUnfinishedTodos,
  isTodoToolAvailable,
} from "../../src/modules/plugins/builtins/todo-reminder";
import {
  writeTodoStore,
  type TodoStore,
} from "../../src/common/utils/todo-store.util";

let messageSeq = 0;

function assistantMessage(options: { toolName?: string } = {}): any {
  return {
    id: `a${++messageSeq}`,
    role: "assistant",
    content: options.toolName
      ? [{ type: "tool-call", name: options.toolName }]
      : [{ type: "text", text: "ok" }],
  };
}

function reminderMessage(): any {
  return {
    id: `r${++messageSeq}`,
    role: "user",
    kind: "model",
    metadata: { todoReminder: true },
    content: [{ type: "text", text: "<system_reminder>...</system_reminder>" }],
  };
}

function resolvedPlugin(
  options: { enabled?: boolean; tools?: string[] } = {},
): any {
  return {
    enabled: options.enabled ?? true,
    plugin: { id: "todo" },
    enabledTools: (options.tools ?? ["todo"]).map((name) => ({ name })),
  };
}

function makeSessionContext(
  workspaceDir: string,
  resolved: any[] = [resolvedPlugin()],
): any {
  return {
    sessionId: "s1",
    getWorkspacePath: () => workspaceDir,
    generateMessageId: () => `m${++messageSeq}`,
    getResolvedPlugins: () => resolved,
  };
}

function historyWithTurns(count: number): any[] {
  return Array.from({ length: count }, () => assistantMessage());
}

describe("todo reminder helpers", () => {
  it("没有 marker 时按总 assistant 轮次计数", () => {
    expect(getTodoReminderTurnCounts(historyWithTurns(4))).toEqual({
      turnsSinceLastTodoCall: 4,
      turnsSinceLastReminder: 4,
    });
  });

  it("识别最近一次 todo 调用与提醒", () => {
    const history = [
      assistantMessage({ toolName: "todo" }),
      assistantMessage(),
      reminderMessage(),
      assistantMessage(),
      assistantMessage(),
    ];
    expect(getTodoReminderTurnCounts(history)).toEqual({
      turnsSinceLastTodoCall: 3,
      turnsSinceLastReminder: 2,
    });
  });

  it("只把存在未完成项的列表视为需要提醒", () => {
    expect(hasUnfinishedTodos(null)).toBe(false);
    expect(hasUnfinishedTodos({ items: [] })).toBe(false);
    expect(
      hasUnfinishedTodos({ items: [{ content: "a", status: "completed" }] }),
    ).toBe(false);
    expect(
      hasUnfinishedTodos({ items: [{ content: "a", status: "pending" }] }),
    ).toBe(true);
    expect(
      hasUnfinishedTodos({ items: [{ content: "a", status: "in_progress" }] }),
    ).toBe(true);
  });

  it("提醒正文包含当前列表与推进指引", () => {
    const text = buildTodoReminderText({
      items: [
        { content: "step one", status: "in_progress" },
        { content: "step two", status: "pending" },
      ],
    });
    expect(text).toContain('action="next"');
    expect(text).toContain("[>] step one");
    expect(text).toContain("[ ] step two");
  });

  it("按实际解析出的工具面判断 todo 是否可用", () => {
    expect(isTodoToolAvailable([resolvedPlugin()])).toBe(true);
    expect(
      isTodoToolAvailable([resolvedPlugin({ enabled: false })]),
    ).toBe(false);
    expect(
      isTodoToolAvailable([resolvedPlugin({ tools: ["read"] })]),
    ).toBe(false);
  });
});

describe("createTodoReminderProvider", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "todo-reminder-test-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  async function writeStore(store: TodoStore): Promise<void> {
    await writeTodoStore(tmpDir, "s1", store);
  }

  it("cadence 未到期时不注入", async () => {
    await writeStore({ items: [{ content: "a", status: "pending" }] });
    const provider = createTodoReminderProvider();
    const result = await provider.build({
      sessionContext: makeSessionContext(tmpDir),
      iterationCount: 1,
      history: historyWithTurns(TODO_REMINDER_TURNS - 1),
    });
    expect(result).toEqual({});
  });

  it("到期且存在未完成项时注入一条带 marker 的隐藏消息", async () => {
    await writeStore({
      items: [
        { content: "step one", status: "in_progress" },
        { content: "step two", status: "pending" },
      ],
    });
    const provider = createTodoReminderProvider();
    const result = await provider.build({
      sessionContext: makeSessionContext(tmpDir),
      iterationCount: 1,
      history: historyWithTurns(TODO_REMINDER_TURNS),
    });

    expect(result.persist).toHaveLength(1);
    const message = result.persist![0];
    expect(message.role).toBe("user");
    expect(message.kind).toBe("model");
    expect(message.metadata).toMatchObject({
      hidden: true,
      todoReminder: true,
    });
    const text = (message.content[0] as any)?.text ?? "";
    expect(text).toContain("<system_reminder>");
    expect(text).toContain("[>] step one");
  });

  it("上一次提醒之后不足间隔时不重复注入", async () => {
    await writeStore({ items: [{ content: "a", status: "pending" }] });
    const provider = createTodoReminderProvider();
    const history = [
      ...historyWithTurns(TODO_REMINDER_TURNS),
      reminderMessage(),
      ...historyWithTurns(TODO_REMINDER_GAP_TURNS - 1),
    ];
    const result = await provider.build({
      sessionContext: makeSessionContext(tmpDir),
      iterationCount: 1,
      history,
    });
    expect(result).toEqual({});
  });

  it("全部完成或 todo 工具不可用时不注入", async () => {
    await writeStore({ items: [{ content: "a", status: "completed" }] });
    const provider = createTodoReminderProvider();
    const completed = await provider.build({
      sessionContext: makeSessionContext(tmpDir),
      iterationCount: 1,
      history: historyWithTurns(TODO_REMINDER_TURNS),
    });
    expect(completed).toEqual({});

    await writeStore({ items: [{ content: "a", status: "pending" }] });
    const unavailable = await provider.build({
      sessionContext: makeSessionContext(tmpDir, [
        resolvedPlugin({ tools: ["read"] }),
      ]),
      iterationCount: 1,
      history: historyWithTurns(TODO_REMINDER_TURNS),
    });
    expect(unavailable).toEqual({});
  });
});
