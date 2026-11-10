import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  extractWorkbuddyUserQuery,
  readWorkbuddySession,
  scanWorkbuddySessions,
} from "../../src/modules/chat/claude-import/workbuddy-session.reader";

const T0 = 1789960357576;
const SESSION_ID = "2f46c25b-1ff9-4ebb-8d71-06215972650d";

/** 事件行 */
function line(fields: Record<string, unknown>): string {
  return JSON.stringify(fields);
}

/** 写入会话文件：<root>/<projectDir>/<sessionId>.jsonl */
function writeWorkbuddySession(
  root: string,
  sessionId: string,
  records: Array<Record<string, unknown>>,
): string {
  const dir = path.join(root, "c-Users-test-WorkBuddy");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${sessionId}.jsonl`);
  fs.writeFileSync(file, records.map((r) => line(r)).join("\n") + "\n", "utf8");
  return file;
}

function userMessage(seq: number, content: unknown, id?: string): Record<string, unknown> {
  return {
    id: id ?? `u-${seq}`,
    timestamp: T0 + seq * 1000,
    type: "message",
    role: "user",
    content,
    sessionId: SESSION_ID,
    cwd: "d:\\repo",
  };
}

function assistantMessage(seq: number, text: string, model = "deepseek-v4.1-flash"): Record<string, unknown> {
  return {
    id: `a-${seq}`,
    timestamp: T0 + seq * 1000,
    type: "message",
    role: "assistant",
    status: "completed",
    content: [{ type: "output_text", text }],
    providerData: {
      model,
      usage: {
        requests: 1,
        inputTokens: 37280,
        outputTokens: 682,
        totalTokens: 37962,
        inputTokensDetails: [{ cached_tokens: 32256 }],
        outputTokensDetails: [{ reasoning_tokens: 251 }],
      },
    },
    sessionId: SESSION_ID,
    cwd: "d:\\repo",
  };
}

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "workbuddy-reader-"));
  process.env.WORKBUDDY_TEST_ROOT = tmpRoot;
});

afterEach(() => {
  delete process.env.WORKBUDDY_TEST_ROOT;
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe("extractWorkbuddyUserQuery", () => {
  it("优先取 <user_query> 包住的正文", () => {
    const content = [
      { type: "input_text", text: "<system-reminder>注入</system-reminder>\n<user_query>测试并发问题\n多行正文</user_query>" },
    ];
    expect(extractWorkbuddyUserQuery(content)).toBe("测试并发问题\n多行正文");
  });

  it("无 user_query 时剥掉 system-reminder / task-notification 后取纯文本", () => {
    const content = [
      {
        type: "input_text",
        text: "<task-notification>后台任务</task-notification>\n请检查这个文件\n<system-reminder>身份上下文</system-reminder>",
      },
    ];
    expect(extractWorkbuddyUserQuery(content)).toBe("请检查这个文件");
  });

  it("纯注入内容返回空", () => {
    const content = [{ type: "input_text", text: "<system-reminder>只有注入</system-reminder>" }];
    expect(extractWorkbuddyUserQuery(content)).toBe("");
  });

  it("非数组 content 返回空", () => {
    expect(extractWorkbuddyUserQuery(undefined)).toBe("");
  });
});

describe("readWorkbuddySession", () => {
  it("轮次聚合：user_query 开轮、reasoning 前插、工具按 callId 配对、usage 双形态换算", () => {
    const records = [
      userMessage(1, [
        { type: "input_text", text: "<system-reminder>注入</system-reminder>" },
        { type: "input_text", text: "<user_query>调查 shell 工具报告</user_query>" },
      ]),
      // reasoning 先于 assistant 到达
      {
        id: "r-1",
        parentId: "u-1",
        timestamp: T0 + 1500,
        type: "reasoning",
        providerData: { model: "deepseek-v4.1-flash" },
        rawContent: [{ type: "reasoning_text", text: "先理解任务" }],
      },
      assistantMessage(2, "我来调查"),
      {
        id: "fc-1",
        parentId: "a-2",
        timestamp: T0 + 2500,
        type: "function_call",
        callId: "call_1",
        name: "read_file",
        arguments: { path: "a.txt" },
        providerData: { model: "deepseek-v4.1-flash" },
      },
      {
        id: "fcr-1",
        parentId: "fc-1",
        timestamp: T0 + 3000,
        type: "function_call_result",
        callId: "call_1",
        name: "read_file",
        status: "completed",
        output: { type: "text", text: "文件内容" },
        providerData: { messageId: "a-2" },
      },
      {
        id: "title-1",
        timestamp: T0 + 3500,
        type: "ai-title",
        aiTitle: "调查 shell 工具报告问题",
        sessionId: SESSION_ID,
      },
      // 第二轮
      userMessage(4, [
        { type: "input_text", text: "<user_query>第二个问题</user_query>" },
      ]),
      assistantMessage(5, "第二个回答", "deepseek-v4.1-flash"),
    ];
    const file = writeWorkbuddySession(tmpRoot, SESSION_ID, records);

    const { turns, meta } = readWorkbuddySession(file);
    expect(turns).toHaveLength(2);

    const turn1 = turns[0];
    expect((turn1.messages[0].content[0] as any).text).toBe("调查 shell 工具报告");
    // reasoning 前插到 assistant 内容头部；function_call 挂到同一条 assistant
    const assistant = turn1.messages[1];
    expect(assistant.role).toBe("assistant");
    expect(assistant.content.map((b) => b.type)).toEqual(["reasoning", "text", "tool-call"]);
    expect((assistant.content[1] as any).text).toBe("我来调查");
    expect(assistant.content[2]).toMatchObject({ type: "tool-call", toolCallId: "call_1", name: "read_file" });
    // camelCase usage：inputTokens 已含缓存
    expect(assistant.metadata.usage).toMatchObject({
      promptTokens: 37280,
      completionTokens: 682,
      totalTokens: 37962,
      cachedTokens: { read: 32256 },
      reasoningTokens: 251,
    });
    const toolMsg = turn1.messages[2];
    expect(toolMsg.role).toBe("tool");
    expect(toolMsg.source).toEqual({ kind: "tool", toolCallId: "call_1" });
    expect(toolMsg.content[0]).toMatchObject({ type: "tool-result", content: "文件内容" });

    expect((turns[1].messages[0].content[0] as any).text).toBe("第二个问题");
    // ai-title 显式标题优先
    expect(meta.title).toBe("调查 shell 工具报告问题");
    expect(meta.model).toBe("deepseek-v4.1-flash");
    expect(meta.turnCount).toBe(2);
  });

  it("编辑重发（resend-fork-notice）：旧版提问被过滤", () => {
    const records = [
      // 旧版提问（被编辑替换）
      userMessage(1, [{ type: "input_text", text: "<user_query>原始问题</user_query>" }], "edited-item"),
      assistantMessage(2, "原始回答"),
      {
        id: "notice-1",
        timestamp: T0 + 2500,
        type: "resend-fork-notice",
        editedUserItemId: "edited-item",
      },
      // 编辑后重新发送的提问
      userMessage(3, [{ type: "input_text", text: "<user_query>编辑后的问题</user_query>" }], "new-item"),
      assistantMessage(4, "编辑后的回答"),
    ];
    const file = writeWorkbuddySession(tmpRoot, "session-edit", records);

    const { turns } = readWorkbuddySession(file);
    // 旧轮次整体被过滤（旧 user 消息 + 其后的 assistant）
    expect(turns).toHaveLength(1);
    expect((turns[0].messages[0].content[0] as any).text).toBe("编辑后的问题");
    expect(turns[0].messages[1].role).toBe("assistant");
    const allTexts = turns.flatMap((t) =>
      t.messages.flatMap((m) => m.content.flatMap((b) => (b.type === "text" ? [b.text] : []))),
    );
    expect(allTexts).not.toContain("原始问题");
    expect(allTexts).not.toContain("原始回答");
  });

  it("function_call_result 孤儿（无前置调用）丢弃", () => {
    const records = [
      userMessage(1, [{ type: "input_text", text: "<user_query>问题</user_query>" }]),
      {
        id: "fcr-orphan",
        timestamp: T0 + 1000,
        type: "function_call_result",
        callId: "call_missing",
        name: "x",
        status: "completed",
        output: { type: "text", text: "孤儿结果" },
      },
      assistantMessage(2, "回答"),
    ];
    const file = writeWorkbuddySession(tmpRoot, "session-orphan", records);
    const { turns } = readWorkbuddySession(file);
    expect(turns).toHaveLength(1);
    expect(turns[0].messages.map((m) => m.role)).toEqual(["user", "assistant"]);
  });

  it("function_call 无 callId 丢弃；providerData.discard/isPartialAborted 跳过", () => {
    const records = [
      userMessage(1, [{ type: "input_text", text: "<user_query>问题</user_query>" }]),
      { id: "fc-nocall", timestamp: T0 + 1000, type: "function_call", name: "x" },
      {
        id: "fc-abort",
        timestamp: T0 + 1100,
        type: "function_call",
        callId: "call_abort",
        name: "y",
        providerData: { isPartialAborted: true },
      },
      {
        id: "fc-discard",
        timestamp: T0 + 1200,
        type: "function_call",
        callId: "call_discard",
        name: "z",
        providerData: { discard: true },
      },
      assistantMessage(2, "回答"),
    ];
    const file = writeWorkbuddySession(tmpRoot, "session-skip", records);
    const { turns } = readWorkbuddySession(file);
    expect(turns).toHaveLength(1);
    expect(turns[0].messages.map((m) => m.role)).toEqual(["user", "assistant"]);
  });

  it("function_call_result 非完成状态不落盘", () => {
    const records = [
      userMessage(1, [{ type: "input_text", text: "<user_query>问题</user_query>" }]),
      {
        id: "fc-1",
        timestamp: T0 + 500,
        type: "function_call",
        callId: "call_err",
        name: "x",
        providerData: { model: "m" },
      },
      {
        id: "fcr-1",
        timestamp: T0 + 1000,
        type: "function_call_result",
        callId: "call_err",
        name: "x",
        status: "incomplete",
        output: { type: "text", text: "半截" },
      },
      assistantMessage(2, "回答"),
    ];
    const file = writeWorkbuddySession(tmpRoot, "session-status", records);
    const { turns } = readWorkbuddySession(file);
    expect(turns[0].messages.map((m) => m.role)).toEqual(["user", "assistant"]);
  });
});

describe("scanWorkbuddySessions", () => {
  it("扫描双根（.workbuddy 与 .workbuddy-ai），按 mtime 降序", () => {
    const rootOld = path.join(tmpRoot, ".workbuddy", "projects");
    const rootNew = path.join(tmpRoot, ".workbuddy-ai", "projects");
    fs.mkdirSync(rootOld, { recursive: true });
    fs.mkdirSync(rootNew, { recursive: true });
    process.env.WORKBUDDY_TEST_ROOT = tmpRoot;
    // 手动写两个根的文件
    const writeAt = (root: string, sessionId: string, text: string, mtimeMs: number) => {
      const dir = path.join(root, "proj");
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `${sessionId}.jsonl`);
      fs.writeFileSync(file, text, "utf8");
      fs.utimesSync(file, new Date(mtimeMs), new Date(mtimeMs));
    };
    writeAt(
      rootOld,
      "old-session",
      line({
        id: "old-1",
        timestamp: T0,
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "<user_query>旧根会话</user_query>" }],
        sessionId: "old-session",
      }),
      T0,
    );
    writeAt(
      rootNew,
      SESSION_ID,
      line({
        id: "new-1",
        timestamp: T0 + 100000,
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "<user_query>新根会话</user_query>" }],
        sessionId: SESSION_ID,
        cwd: "d:\\repo",
      }),
      T0 + 100000,
    );

    const summaries = scanWorkbuddySessions([rootOld, rootNew]);
    const ids = summaries.map((s) => s.id);
    expect(ids).toContain("old-session");
    expect(ids).toContain(SESSION_ID);
    expect(summaries[0].id).toBe(SESSION_ID); // mtime 降序
    expect(summaries.find((s) => s.id === SESSION_ID)!.cwd).toBe("d:\\repo");
    // 根（.workbuddy）非 projects 的目录不应误收
  });
});
