import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  codexUserPrompt,
  readCodexSession,
  scanCodexSessions,
} from "../../src/modules/chat/claude-import/codex-session.reader";

const THREAD = "019f78e7-2a3b-7ee0-a88b-3c5701f87c18";
const T0 = Date.parse("2026-07-19T05:44:03.861Z");

function line(fields: Record<string, unknown>): string {
  return JSON.stringify(fields);
}

function rolloutLine(index: number, type: string, payload: Record<string, unknown>, timestampMs = T0 + index * 1000): string {
  return line({ timestamp: new Date(timestampMs).toISOString(), ordinal: index, type, payload });
}

function metaLine(overrides: Record<string, unknown> = {}): string {
  return rolloutLine(0, "session_meta", {
    id: THREAD,
    cwd: "D:\\repo",
    timestamp: new Date(T0).toISOString(),
    ...overrides,
  });
}

/** 写入 rollout 文件：<home>/sessions/YYYY/MM/DD/<name> */
function writeRollout(home: string, dateParts: [string, string, string], name: string, body: string[]): string {
  const dir = path.join(home, "sessions", ...dateParts);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  fs.writeFileSync(file, body.join("\n") + "\n", "utf8");
  return file;
}

let tmpHome: string;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "codex-reader-"));
  process.env.CODEX_HOME = tmpHome;
});

afterEach(() => {
  delete process.env.CODEX_HOME;
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

describe("codexUserPrompt（注入过滤）", () => {
  it("过滤环境块 / AGENTS.md / 页面上下文，保留真实提问", () => {
    expect(
      codexUserPrompt([
        { type: "input_text", text: "<environment_context>\n  <cwd>C:\\x</cwd>\n</environment_context>" },
        { type: "input_text", text: "# AGENTS.md instructions for D:\\repo\n<INSTRUCTIONS>..." },
        { type: "input_text", text: "帮我看看这个 bug" },
        {
          type: "input_text",
          text:
            "<external_codex_apps_open_page>{\"page\":\"x\"}</external_codex_apps_open_page>\n真实问题",
        },
      ]),
    ).toBe("帮我看看这个 bug\n真实问题");
  });

  it("纯注入消息返回空", () => {
    expect(
      codexUserPrompt([{ type: "input_text", text: "<environment_context>x</environment_context>" }]),
    ).toBe("");
  });
});

describe("readCodexSession", () => {
  it("解析用户/助手/工具/推理/用量，过滤注入与重复事件", () => {
    const file = writeRollout(tmpHome, ["2026", "07", "19"], `rollout-2026-07-19T05-44-03-${THREAD}.jsonl`, [
      metaLine(),
      rolloutLine(1, "event_msg", { type: "task_started", model_context_window: 258400 }),
      rolloutLine(2, "response_item", {
        type: "message",
        role: "developer",
        content: [{ type: "input_text", text: "<permissions instructions>..." }],
      }),
      rolloutLine(3, "response_item", {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "<environment_context>...</environment_context>" }],
      }),
      rolloutLine(4, "world_state", { full: true, state: {} }),
      rolloutLine(5, "turn_context", { model: "gpt-5.2-codex", cwd: "D:\\repo" }),
      rolloutLine(6, "response_item", {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "帮我跑一下测试" }],
      }),
      rolloutLine(7, "response_item", {
        type: "reasoning",
        summary: [{ type: "summary_text", text: "先想一下" }],
        encrypted_content: "opaque",
      }),
      rolloutLine(8, "response_item", {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "我来执行命令" }],
      }),
      rolloutLine(9, "response_item", {
        type: "function_call",
        call_id: "call_1",
        name: "shell",
        arguments: '{"cmd":"npm test"}',
      }),
      rolloutLine(10, "event_msg", { type: "agent_message", message: "重复内容，应忽略" }),
      rolloutLine(11, "event_msg", {
        type: "token_count",
        info: {
          total_token_usage: { total_tokens: 999 },
          last_token_usage: {
            input_tokens: 100,
            cached_input_tokens: 20,
            cache_write_input_tokens: 5,
            output_tokens: 50,
            reasoning_output_tokens: 10,
            total_tokens: 175,
          },
          model_context_window: 258400,
        },
      }),
      rolloutLine(12, "response_item", {
        type: "function_call_output",
        call_id: "call_1",
        output: [{ type: "input_text", text: "all passed" }],
      }),
      rolloutLine(13, "response_item", {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "再跑一次 lint" }],
      }),
      rolloutLine(14, "response_item", {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "好的" }],
      }),
      rolloutLine(15, "event_msg", { type: "turn_aborted", reason: "interrupted" }),
    ]);

    const parsed = readCodexSession([{ filePath: file }]);
    expect(parsed.turns).toHaveLength(2);

    const turn1 = parsed.turns[0];
    expect((turn1.messages[0].content[0] as any).text).toBe("帮我跑一下测试");
    const assistant = turn1.messages[1];
    expect(assistant.role).toBe("assistant");
    // reasoning + text + tool-call
    expect(assistant.content.map((b) => b.type)).toEqual(["reasoning", "text", "tool-call"]);
    expect(assistant.content[2]).toMatchObject({ type: "tool-call", toolCallId: "call_1", name: "shell" });
    expect(assistant.source).toMatchObject({ kind: "model", model: "gpt-5.2-codex" });
    // token_count 挂到最近 assistant：prompt = 100 + 20 + 5
    expect(assistant.metadata.usage).toMatchObject({
      promptTokens: 125,
      completionTokens: 50,
      totalTokens: 175,
      cachedTokens: { read: 20, written: 5 },
      reasoningTokens: 10,
    });

    const toolMsg = turn1.messages[2];
    expect(toolMsg.source).toEqual({ kind: "tool", toolCallId: "call_1" });
    expect(toolMsg.content[0]).toMatchObject({ type: "tool-result", content: "all passed" });

    expect((parsed.turns[1].messages[0].content[0] as any).text).toBe("再跑一次 lint");
    expect(parsed.meta.model).toBe("gpt-5.2-codex");
    expect(parsed.meta.contextWindow).toBe(258400);
    expect(parsed.meta.title).toBe("帮我跑一下测试");
    expect(parsed.compactions).toHaveLength(0);
  });

  it("compacted：合成压缩点，边界后开新回合", () => {
    const file = writeRollout(tmpHome, ["2026", "08", "01"], `rollout-2026-08-01T13-32-46-${THREAD}.jsonl`, [
      metaLine(),
      rolloutLine(1, "response_item", {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "第一个问题" }],
      }),
      rolloutLine(2, "response_item", {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "第一个回答" }],
      }),
      rolloutLine(3, "compacted", { message: "这是交接摘要" }),
      rolloutLine(4, "response_item", {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "压缩之后的问题" }],
      }),
      rolloutLine(5, "response_item", {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "压缩之后的回答" }],
      }),
    ]);

    const parsed = readCodexSession([{ filePath: file }]);
    expect(parsed.turns).toHaveLength(2);
    expect(parsed.compactions).toHaveLength(1);
    expect(parsed.compactions[0]).toMatchObject({
      beforeTurnIndex: 1,
      summary: "这是交接摘要",
      rawBeforeMessages: 2,
    });
  });

  it("compacted 重试（同位置多条）→ 保留最新一条摘要", () => {
    const file = writeRollout(tmpHome, ["2026", "08", "03"], `rollout-2026-08-03T00-00-00-${THREAD}.jsonl`, [
      metaLine(),
      rolloutLine(1, "response_item", {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "问题" }],
      }),
      rolloutLine(2, "response_item", {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "回答" }],
      }),
      rolloutLine(3, "compacted", { message: "第一次摘要" }),
      rolloutLine(4, "compacted", { message: "重试后的摘要" }),
      rolloutLine(5, "response_item", {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "后续问题" }],
      }),
    ]);
    const parsed = readCodexSession([{ filePath: file }]);
    expect(parsed.compactions).toHaveLength(1);
    expect(parsed.compactions[0]).toMatchObject({
      summary: "重试后的摘要",
      rawBeforeMessages: 2,
    });
  });

  it("custom_tool_call / output 也能配对", () => {
    const file = writeRollout(tmpHome, ["2026", "08", "02"], `rollout-2026-08-02T00-00-00-${THREAD}.jsonl`, [
      metaLine(),
      rolloutLine(1, "response_item", {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "改个文件" }],
      }),
      rolloutLine(2, "response_item", {
        type: "custom_tool_call",
        call_id: "call_apply",
        name: "apply_patch",
        input: "*** Begin Patch\n*** End Patch",
      }),
      rolloutLine(3, "response_item", {
        type: "custom_tool_call_output",
        call_id: "call_apply",
        output: "Done",
      }),
    ]);
    const parsed = readCodexSession([{ filePath: file }]);
    expect(parsed.turns).toHaveLength(1);
    const assistant = parsed.turns[0].messages.find((m) => m.role === "assistant")!;
    expect(assistant.content[0]).toMatchObject({ type: "tool-call", toolCallId: "call_apply", name: "apply_patch" });
    const tool = parsed.turns[0].messages.find((m) => m.role === "tool")!;
    expect(tool.content[0]).toMatchObject({ type: "tool-result", content: "Done" });
  });
});

describe("scanCodexSessions", () => {
  it("分页按 thread 聚合并按文件名时间戳排序；子代理跳过；标题索引优先", () => {
    writeRollout(tmpHome, ["2026", "07", "19"], `rollout-2026-07-19T05-44-03-${THREAD}.jsonl`, [
      metaLine(),
      rolloutLine(1, "response_item", {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "第一页提问" }],
      }),
    ]);
    writeRollout(tmpHome, ["2026", "07", "20"], `rollout-2026-07-20T05-44-03-${THREAD}_page2.jsonl`, [
      metaLine(),
      rolloutLine(1, "response_item", {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "第二页提问" }],
      }),
    ]);
    // 子代理 rollout：应被过滤
    writeRollout(tmpHome, ["2026", "07", "21"], "rollout-2026-07-21T00-00-00-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jsonl", [
      rolloutLine(0, "session_meta", { id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", thread_source: "subagent" }),
      rolloutLine(1, "response_item", {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "子代理消息" }],
      }),
    ]);
    // 标题索引
    fs.writeFileSync(
      path.join(tmpHome, "session_index.jsonl"),
      line({ id: THREAD, thread_name: "索引标题" }) + "\n",
      "utf8",
    );

    const summaries = scanCodexSessions();
    expect(summaries).toHaveLength(1);
    expect(summaries[0].id).toBe(THREAD);
    expect(summaries[0].pages).toHaveLength(2);
    expect(summaries[0].previewTitle).toBe("索引标题");
    expect(summaries[0].cwd).toBe("D:\\repo");

    // 两页拼接后两轮都在（页间换行拼接不能丢内容）
    const parsed = readCodexSession(summaries[0].pages);
    expect(parsed.turns).toHaveLength(2);
    expect((parsed.turns[0].messages[0].content[0] as any).text).toBe("第一页提问");
    expect((parsed.turns[1].messages[0].content[0] as any).text).toBe("第二页提问");
  });

  it("无标题索引时用首问兜底", () => {
    writeRollout(tmpHome, ["2026", "07", "22"], `rollout-2026-07-22T00-00-00-${THREAD}.jsonl`, [
      metaLine(),
      rolloutLine(1, "response_item", {
        type: "message",
        role: "user",
        content: [
          { type: "input_text", text: "<environment_context>x</environment_context>" },
          { type: "input_text", text: "真实首问" },
        ],
      }),
    ]);
    const summaries = scanCodexSessions();
    expect(summaries).toHaveLength(1);
    // 无索引时用首条真实 user 文本（注入块已过滤）
    expect(summaries[0].previewTitle).toBe("真实首问");
  });
});
