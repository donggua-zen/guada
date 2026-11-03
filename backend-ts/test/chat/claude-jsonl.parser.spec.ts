import {
  derivePreviewTitle,
  parseClaudeHeadInfo,
  parseClaudeJsonlRecords,
  sanitizeClaudeVisibleText,
  toTimestampMs,
  type ClaudeJsonlRecord,
} from "../../src/modules/chat/claude-import/claude-jsonl.parser";

/** 造一条 Claude 源记录（缺省补常见字段） */
function rec(fields: Record<string, unknown>): ClaudeJsonlRecord {
  return fields as unknown as ClaudeJsonlRecord;
}

const T1 = 1730000000000; // 2024-10-27 附近
const T2 = 1730000060000;
const T3 = 1730000120000;

describe("toTimestampMs", () => {
  it("秒级数字 / 毫秒级数字 / 数字串 / ISO 串都归一为 ms", () => {
    expect(toTimestampMs(1730000000)).toBe(1730000000000);
    expect(toTimestampMs(1730000000000)).toBe(1730000000000);
    expect(toTimestampMs("1730000000")).toBe(1730000000000);
    expect(toTimestampMs("2026-11-01T00:00:00.000Z")).toBe(Date.parse("2026-11-01T00:00:00.000Z"));
  });

  it("非法输入返回 undefined", () => {
    expect(toTimestampMs("not-a-date")).toBeUndefined();
    expect(toTimestampMs(123)).toBeUndefined(); // 太小，既非秒也非毫秒
    expect(toTimestampMs(null)).toBeUndefined();
    expect(toTimestampMs({})).toBeUndefined();
  });
});

describe("sanitizeClaudeVisibleText", () => {
  it("剥掉 ide_opened_file / local-command / command 标签块并归一 CRLF", () => {
    const input = "<ide_opened_file>/a/b.ts</ide_opened_file>\r\n你好<local-command-stdout>x</local-command-stdout>世界<command-name>/foo</command-name><local-command-stdout>bar</local-command-stdout>";
    expect(sanitizeClaudeVisibleText(input)).toBe("你好世界");
  });
});

describe("derivePreviewTitle", () => {
  it("空白折叠并截前 50 字符", () => {
    expect(derivePreviewTitle("帮我写一个\n很长很长的\n标题")).toBe("帮我写一个 很长很长的 标题");
    expect(derivePreviewTitle("x".repeat(80)).length).toBe(50);
    expect(derivePreviewTitle("   ")).toBeUndefined();
  });
});

describe("parseClaudeJsonlRecords", () => {
  it("user 开回合、assistant 多记录聚合为一条消息、时间保留", () => {
    const records = [
      rec({ type: "user", cwd: "/repo", timestamp: T1, message: { role: "user", content: "帮我看看这个 bug" } }),
      rec({ type: "assistant", timestamp: T2, message: { model: "claude-5", content: [{ type: "text", text: "第一段" }] } }),
      rec({ type: "assistant", timestamp: T3, message: { model: "claude-5", content: [{ type: "text", text: "第二段" }] } }),
    ];
    const { turns, meta } = parseClaudeJsonlRecords(records);

    expect(turns).toHaveLength(1);
    expect(turns[0].messages).toHaveLength(2);
    expect(turns[0].messages[0].role).toBe("user");
    expect(turns[0].messages[0].source).toEqual({ kind: "user" });
    expect(turns[0].messages[0].createdAt).toBe(T1);
    // 两条 assistant 记录 → 一条消息、两个 text 块
    const assistant = turns[0].messages[1];
    expect(assistant.role).toBe("assistant");
    expect(assistant.createdAt).toBe(T2);
    expect(assistant.content.filter((b) => b.type === "text")).toHaveLength(2);
    expect(assistant.source).toMatchObject({ kind: "model", model: "claude-5" });
    expect(meta.cwd).toBe("/repo");
    expect(meta.createdAt).toBe(T1);
    expect(meta.updatedAt).toBe(T3);
    expect(meta.previewTitle).toBe("帮我看看这个 bug");
    expect(meta.model).toBe("claude-5");
  });

  it("tool_use + tool_result 转成 tool-call/tool-result 块并配对", () => {
    const records = [
      rec({ type: "user", timestamp: T1, message: { content: "跑一下测试" } }),
      rec({
        type: "assistant",
        timestamp: T2,
        message: {
          model: "claude-5",
          content: [
            { type: "tool_use", id: "call_1", name: "Bash", input: { command: "npm test" } },
          ],
        },
      }),
      rec({
        type: "user",
        timestamp: T3,
        message: {
          content: [{ type: "tool_result", tool_use_id: "call_1", content: "all passed", is_error: false }],
        },
      }),
    ];
    const { turns } = parseClaudeJsonlRecords(records);

    // tool_result 的 user 记录不新开回合（isMeta 语义之外的裸结果载体）
    expect(turns).toHaveLength(1);
    const assistant = turns[0].messages.find((m) => m.role === "assistant")!;
    expect(assistant.content.some((b) => b.type === "tool-call" && b.toolCallId === "call_1")).toBe(true);
    const toolMsg = turns[0].messages.find((m) => m.role === "tool")!;
    expect(toolMsg.source).toEqual({ kind: "tool", toolCallId: "call_1" });
    expect(toolMsg.content[0]).toMatchObject({ type: "tool-result", toolCallId: "call_1", content: "all passed" });
  });

  it("悬空 tool_result 补占位 tool-call 避免无配对", () => {
    const records = [
      rec({ type: "user", timestamp: T1, message: { content: "开始" } }),
      rec({
        type: "user",
        timestamp: T2,
        message: {
          content: [{ type: "tool_result", tool_use_id: "orphan_1", content: "result" }],
        },
      }),
    ];
    const { turns } = parseClaudeJsonlRecords(records);
    expect(turns).toHaveLength(1);
    const assistant = turns[0].messages.find((m) => m.role === "assistant")!;
    expect(assistant.content.some((b) => b.type === "tool-call" && b.toolCallId === "orphan_1")).toBe(true);
  });

  it("isMeta user 记录跳过（工具回执不产生回合）", () => {
    const records = [
      rec({ type: "user", timestamp: T1, isMeta: true, message: { content: [{ type: "tool_result", tool_use_id: "x", content: "r" }] } }),
      rec({ type: "user", timestamp: T2, message: { content: "真实输入" } }),
    ];
    const { turns } = parseClaudeJsonlRecords(records);
    expect(turns).toHaveLength(1);
    expect(turns[0].messages[0].content[0]).toMatchObject({ type: "text", text: "真实输入" });
  });

  it("synthetic 占位丢弃、API error 保留", () => {
    const records = [
      rec({ type: "user", timestamp: T1, message: { content: "hi" } }),
      rec({ type: "assistant", timestamp: T2, model: "<synthetic>", message: { model: "<synthetic>", content: [{ type: "text", text: "No response requested." }] } }),
      rec({ type: "assistant", timestamp: T3, isApiErrorMessage: true, message: { model: "claude-5", content: [{ type: "text", text: "API Error: 500" }] } }),
    ];
    const { turns } = parseClaudeJsonlRecords(records);
    const texts = turns[0].messages
      .filter((m) => m.role === "assistant")
      .flatMap((m) => m.content)
      .filter((b) => b.type === "text");
    expect(texts).toHaveLength(1);
    expect((texts[0] as any).text).toBe("API Error: 500");
  });

  it("sidechain 文件返回空 turns", () => {
    const records = [
      rec({ type: "user", isSidechain: true, timestamp: T1, message: { content: "subagent 内容" } }),
    ];
    const { turns, meta } = parseClaudeJsonlRecords(records);
    expect(turns).toHaveLength(0);
    expect(meta.turnCount).toBe(0);
  });

  it("assistant 首条（无 user 锚点）补空回合外壳", () => {
    const records = [
      rec({ type: "assistant", timestamp: T1, message: { model: "claude-5", content: [{ type: "text", text: "孤儿回复" }] } }),
    ];
    const { turns } = parseClaudeJsonlRecords(records);
    expect(turns).toHaveLength(1);
    expect(turns[0].messages[0].role).toBe("assistant");
  });

  it("未知 type 与坏字段宽容忽略", () => {
    const records = [
      rec({ type: "summary", timestamp: T1, summary: "ignored" }),
      rec({ type: "system", timestamp: T2, level: "warning", content: "warn" }),
      rec({ type: "user", timestamp: T3, message: { content: "ok" } }),
    ];
    const { turns } = parseClaudeJsonlRecords(records);
    expect(turns).toHaveLength(1);
  });
});

describe("parseClaudeHeadInfo", () => {
  it("头部记录足够时产出预览；sidechain 标记整体跳过", () => {
    const ok = parseClaudeHeadInfo([
      rec({ type: "user", cwd: "/repo", timestamp: T1, message: { content: "标题来源" } }),
    ]);
    expect(ok.isSidechain).toBe(false);
    expect(ok.previewTitle).toBe("标题来源");
    expect(ok.cwd).toBe("/repo");

    const side = parseClaudeHeadInfo([
      rec({ type: "user", isSidechain: true, message: { content: "x" } }),
    ]);
    expect(side.isSidechain).toBe(true);
  });
});
