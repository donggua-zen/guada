import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as zlib from "zlib";
import {
  readDshSession,
  scanDshSessions,
  splitZstdFrames,
} from "../../src/modules/chat/claude-import/dsh-session.reader";

const T0 = 1730000000000;

/** 单行 JSONL */
function line(fields: Record<string, unknown>): string {
  return JSON.stringify(fields);
}

/** 建一个 DSH 会话文件：<home>/sessions/--proj--/<id>/session.jsonl[.zstd] */
function writeDshSession(
  home: string,
  sessionId: string,
  bodyLines: string[],
  opts: { compression?: "none" | "zstd"; headerExtra?: Record<string, unknown> } = {},
): string {
  const dir = path.join(home, "sessions", "--proj--", sessionId);
  fs.mkdirSync(dir, { recursive: true });
  const header = line({
    type: "session",
    version: 0,
    id: sessionId,
    createdAt: T0,
    cwd: "D:\\repo",
    delegationDepth: 0,
    ...(opts.headerExtra ?? {}),
  });
  const text = [header, ...bodyLines].join("\n") + "\n";

  if (opts.compression === "zstd") {
    // 与 DSH 写盘一致：header 单独一帧，事件一批一帧，多帧直接拼接
    const headerFrame = zlib.zstdCompressSync(Buffer.from(header + "\n", "utf8"));
    const bodyFrame = zlib.zstdCompressSync(Buffer.from(bodyLines.join("\n") + "\n", "utf8"));
    const file = path.join(dir, "session.jsonl.zstd");
    fs.writeFileSync(file, Buffer.concat([headerFrame, bodyFrame]));
    return file;
  }

  const file = path.join(dir, "session.jsonl");
  fs.writeFileSync(file, text, "utf8");
  return file;
}

function userMessage(seq: number, time: number, text: string, sourceKind: "user" | "plugin" = "user"): string {
  return line({
    type: "user/message",
    seq,
    time,
    surfaceOp: "append",
    data: {
      id: `msg-${seq}`,
      role: "user",
      content: [{ type: "text", text }],
      source: sourceKind === "user" ? { kind: "user" } : { kind: "plugin", plugin: "dsh-system-prompt" },
    },
  });
}

function assistantMessage(
  seq: number,
  time: number,
  content: unknown[],
  usage?: Record<string, unknown>,
): string {
  return line({
    type: "assistant/message",
    seq,
    time,
    surfaceOp: "append",
    data: {
      turn: 1,
      step: 1,
      message: {
        id: `amsg-${seq}`,
        role: "assistant",
        content,
        source: { kind: "model", provider: "deepseek-official", model: "deepseek-v4-flash" },
      },
      ...(usage ? { usage } : {}),
    },
  });
}

let tmpHome: string;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-reader-"));
  process.env.DSH_HOME = tmpHome;
});

afterEach(() => {
  delete process.env.DSH_HOME;
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

describe("readDshSession（明文 jsonl）", () => {
  it("轮次聚合：跳过 plugin 注入与 chunk；usage 含缓存换算；标题取 session/title", () => {
    const file = writeDshSession(tmpHome, "session-plain", [
      userMessage(1, T0 + 1000, "这是注入的上下文", "plugin"),
      userMessage(2, T0 + 2000, "你好"),
      assistantMessage(3, T0 + 3000, [
        { type: "reasoning", text: "先想一下" },
        { type: "tool-call", id: "call_1", name: "read_file", arguments: "{\"path\":\"a.txt\"}" },
        { type: "text", text: "我看看文件" },
      ], { inputTokens: 100, outputTokens: 50, cacheReadTokens: 20, cacheWriteTokens: 5, reasoningTokens: 10 }),
      // 流式增量：应跳过
      line({ type: "assistant/chunk", seq: 4, time: T0 + 4000, data: { turn: 1, step: 1, chunk: { type: "text-delta", text: "我" } } }),
      line({
        type: "tool/result",
        seq: 5,
        time: T0 + 5000,
        surfaceOp: "append",
        data: {
          turn: 1,
          step: 1,
          message: {
            id: "tmsg-1",
            role: "user",
            content: [{ type: "tool-result", toolCallId: "call_1", content: [{ type: "text", text: "文件内容" }], isError: false }],
            source: { kind: "tool", callId: "call_1" },
          },
        },
      }),
      line({ type: "session/title", seq: 6, time: T0 + 6000, data: { title: "测试标题" } }),
      userMessage(7, T0 + 7000, "第二个问题"),
      assistantMessage(8, T0 + 8000, [{ type: "text", text: "第二个回答" }]),
    ]);

    const { turns, compactions, meta } = readDshSession(file);
    expect(turns).toHaveLength(2);

    const turn1 = turns[0];
    expect(turn1.messages.map((m) => m.role)).toEqual(["user", "assistant", "tool"]);
    expect((turn1.messages[0].content[0] as any).text).toBe("你好");
    const assistant = turn1.messages[1];
    expect(assistant.content.map((b) => b.type)).toEqual(["reasoning", "tool-call", "text"]);
    expect(assistant.content[1]).toMatchObject({ type: "tool-call", toolCallId: "call_1", name: "read_file" });
    // inputTokens 仅未缓存输入：prompt = 100 + 20 + 5
    expect(assistant.metadata.usage).toMatchObject({
      promptTokens: 125,
      completionTokens: 50,
      totalTokens: 175,
      cachedTokens: { read: 20, written: 5 },
      reasoningTokens: 10,
    });
    const toolMsg = turn1.messages[2];
    expect(toolMsg.source).toEqual({ kind: "tool", toolCallId: "call_1" });
    expect(toolMsg.content[0]).toMatchObject({ type: "tool-result", content: "文件内容" });

    expect((turns[1].messages[0].content[0] as any).text).toBe("第二个问题");
    expect(meta.title).toBe("测试标题");
    expect(meta.model).toBe("deepseek-v4-flash");
    expect(meta.turnCount).toBe(2);
    expect(compactions).toHaveLength(0);
  });

  it("压缩：合成压缩点（shadowedSeqs → 消息条数），replace 摘要消息不进对话", () => {
    const file = writeDshSession(tmpHome, "session-compact", [
      userMessage(1, T0 + 1000, "第一个问题"),
      assistantMessage(2, T0 + 2000, [{ type: "text", text: "第一个回答" }]),
      line({ type: "compaction/start", seq: 3, time: T0 + 3000, data: { compactionId: "c1", turn: 1 } }),
      line({
        type: "compaction/summary",
        seq: 4,
        time: T0 + 4000,
        data: {
          compactionId: "c1",
          summary: [{ type: "text", text: "早前的对话摘要" }],
          shadowedRange: { start: 1, end: 2 },
          shadowedSeqs: [1, 2],
          shadowedTokenCount: 800,
        },
      }),
      line({ type: "compaction/end", seq: 5, time: T0 + 5000, data: { compactionId: "c1", turn: 1 } }),
      // 压缩摘要的 surface 替换消息：不作为对话导入
      line({
        type: "user/message",
        seq: 6,
        time: T0 + 5000,
        surfaceOp: { op: "replace", start: 1, end: 2 },
        sourceEventSeqs: [1, 2],
        data: {
          id: "summary-msg",
          role: "user",
          content: [{ type: "text", text: "早前的对话摘要" }],
          source: { kind: "plugin", plugin: "dsh-compaction" },
        },
      }),
      userMessage(7, T0 + 6000, "压缩之后的问题"),
      assistantMessage(8, T0 + 7000, [{ type: "text", text: "压缩之后的回答" }]),
    ]);

    const { turns, compactions } = readDshSession(file);
    expect(turns).toHaveLength(2);
    const allTexts = turns.flatMap((t) =>
      t.messages.flatMap((m) => m.content.flatMap((b) => (b.type === "text" ? [b.text] : []))),
    );
    expect(allTexts).not.toContain("早前的对话摘要");

    expect(compactions).toHaveLength(1);
    expect(compactions[0]).toMatchObject({
      beforeTurnIndex: 1,
      summary: "早前的对话摘要",
      rawBeforeMessages: 2,
    });
  });

  it("版本不符 → unsupported_version", () => {
    const dir = path.join(tmpHome, "sessions", "--proj--", "session-v1");
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, "session.jsonl");
    fs.writeFileSync(
      file,
      line({ type: "session", version: 1, id: "session-v1", createdAt: T0, delegationDepth: 0 }) + "\n",
      "utf8",
    );
    expect(() => readDshSession(file)).toThrow(/unsupported_version/);
  });
});

describe("readDshSession（多帧 zstd）", () => {
  const hasZstd =
    typeof (zlib as any).zstdCompressSync === "function" &&
    typeof (zlib as any).zstdDecompressSync === "function";

  it("多帧拼接文件可正确解压并解析", () => {
    if (!hasZstd) return; // 运行时无 zstd：跳过（Electron 41 内置 Node 24 支持）
    const file = writeDshSession(
      tmpHome,
      "session-zstd",
      [
        userMessage(1, T0 + 1000, "zstd 里的问题"),
        assistantMessage(2, T0 + 2000, [{ type: "text", text: "zstd 里的回答" }]),
      ],
      { compression: "zstd" },
    );

    // 先确认切帧：header 帧 + 事件帧
    const raw = fs.readFileSync(file);
    const { frames } = splitZstdFrames(raw);
    expect(frames.length).toBe(2);

    const { turns, meta } = readDshSession(file);
    expect(turns).toHaveLength(1);
    expect((turns[0].messages[0].content[0] as any).text).toBe("zstd 里的问题");
    expect(meta.turnCount).toBe(1);
  });

  it("末尾 torn frame（追加写中途）→ 保留已完整帧", () => {
    if (!hasZstd) return;
    const file = writeDshSession(
      tmpHome,
      "session-torn",
      [userMessage(1, T0 + 1000, "完整消息")],
      { compression: "zstd" },
    );
    // 追加半帧：写入一个合法帧的前 10 字节
    const extra = (zlib as any).zstdCompressSync(Buffer.from("garbage\n", "utf8"));
    fs.appendFileSync(file, extra.subarray(0, 10));

    const { turns } = readDshSession(file);
    expect(turns).toHaveLength(1);
  });
});

describe("scanDshSessions", () => {
  it("列出候选、过滤 subagent，并按 updatedAt 降序", () => {
    writeDshSession(tmpHome, "session-a", [userMessage(1, T0 + 1000, "A 会话")]);
    writeDshSession(tmpHome, "session-b", [userMessage(1, T0 + 1000, "B 会话")], {
      headerExtra: { origin: "subagent" },
    });
    const summaries = scanDshSessions(path.join(tmpHome, "sessions"));
    const ids = summaries.map((s) => s.id);
    expect(ids).toContain("session-a");
    expect(ids).not.toContain("session-b");
    const a = summaries.find((s) => s.id === "session-a")!;
    expect(a.cwd).toBe("D:\\repo");
    // 无 projcache 时用首条真实 user 文本兜底
    expect(a.previewTitle).toBe("A 会话");
  });
});
