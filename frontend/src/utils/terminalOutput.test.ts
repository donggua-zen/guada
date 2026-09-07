import { describe, it, expect } from "vitest";
import { parseTerminalResult } from "./terminalOutput";

/**
 * 终端结果解析器测试
 *
 * 覆盖：新契约（run_command/process 本地+远程）、旧格式（Latest output 包装，
 * 截断/提权提示在 exit 标记之后的历史布局）、末行锚定防误判、无标记回退。
 */
describe("parseTerminalResult", () => {
  it("新契约：run_command 成功（exit 0 恒有标记行）", () => {
    const info = parseTerminalResult("hello world\n[exit code: 0, uptime: 1s]");
    expect(info).not.toBeNull();
    expect(info!.body).toBe("hello world");
    expect(info!.exitCode).toBe(0);
    expect(info!.uptimeText).toBe("1s");
    expect(info!.backgrounded).toBe(false);
    expect(info!.recognized).toBe(true);
  });

  it("新契约：非零退出 + 沙盒提权 hint（hint 位于 exit 标记之前，被丢弃）", () => {
    const text = [
      "cat: /etc/shadow: Permission denied",
      "[sandbox: escalation available — retry this exact command once with sandbox_permissions]",
      "[exit code: 1, uptime: 2s]",
    ].join("\n");
    const info = parseTerminalResult(text);
    expect(info!.body).toBe("cat: /etc/shadow: Permission denied");
    expect(info!.exitCode).toBe(1);
    expect(info!.body).not.toContain("escalation");
  });

  it("新契约：空输出 → (no output) 归一为空 body", () => {
    const info = parseTerminalResult("(no output)\n[exit code: 0, uptime: 300ms]");
    expect(info!.body).toBe("");
    expect(info!.exitCode).toBe(0);
  });

  it("新契约：转后台（processId 提取）", () => {
    const text =
      'node server.js\n[Command exceeded 60s, switched to background. processId: 12345, uptime: 1m 2s. Use the process tool to manage.]';
    const info = parseTerminalResult(text);
    expect(info!.backgrounded).toBe(true);
    expect(info!.processId).toBe("12345");
    expect(info!.uptimeText).toBe("1m 2s");
    expect(info!.body).toBe("node server.js");
  });

  it("新契约：截断提示剥出日志路径", () => {
    const text = [
      "line1",
      "line2",
      "[Note: Output was truncated. The complete log is saved at: C:\\logs\\out.log. You can read it using the read tool if needed.]",
      "[exit code: 0, uptime: 5s]",
    ].join("\n");
    const info = parseTerminalResult(text);
    expect(info!.body).toBe("line1\nline2");
    expect(info!.truncated).toBe(true);
    expect(info!.logFilePath).toBe("C:\\logs\\out.log");
  });

  it("新契约：沙盒说明首行剥离", () => {
    const text = [
      "Sandbox mode enabled, read-only outside workspace (commands run in Windows PowerShell)",
      "",
      "done",
      "[exit code: 0, uptime: 1s]",
    ].join("\n");
    const info = parseTerminalResult(text);
    expect(info!.sandboxNote).toContain("Sandbox mode enabled");
    expect(info!.body).toBe("done");
  });

  it("新契约：process poll 运行中（无 exit code，backgrounded=true）", () => {
    const text = "partial out\n[status: running, uptime: 30s, waited: 30s]";
    const info = parseTerminalResult(text);
    expect(info!.processStatus).toBe("running");
    expect(info!.backgrounded).toBe(true);
    expect(info!.exitCode).toBeUndefined();
    expect(info!.body).toBe("partial out");
  });

  it("新契约：process poll 完成（status 行含 exit code）", () => {
    const text = "out\n[status: completed, exit code: 2, uptime: 1m, waited: 1m]";
    const info = parseTerminalResult(text);
    expect(info!.processStatus).toBe("completed");
    expect(info!.exitCode).toBe(2);
    expect(info!.backgrounded).toBe(false);
  });

  it("旧格式：Latest output 包装 + 标记", () => {
    const text = [
      "Latest output:",
      "---",
      "old output here",
      "---",
      "",
      "[exit code: 0, uptime: 1s]",
    ].join("\n");
    const info = parseTerminalResult(text);
    expect(info!.body).toBe("old output here");
    expect(info!.exitCode).toBe(0);
  });

  it("旧格式：截断与提权提示排在 exit 标记之后（历史布局）", () => {
    const text = [
      "Latest output:",
      "---",
      "data",
      "---",
      "",
      "[exit code: 3, uptime: 4s]",
      "",
      "[sandbox: escalation available — retry this exact command once]",
      "",
      "[Note: Output was truncated. The complete log is saved at: /tmp/x.log. You can read it using the read tool if needed.]",
    ].join("\n");
    const info = parseTerminalResult(text);
    expect(info!.body).toBe("data");
    expect(info!.exitCode).toBe(3);
    expect(info!.truncated).toBe(true);
    expect(info!.logFilePath).toBe("/tmp/x.log");
    expect(info!.body).not.toContain("escalation");
  });

  it("末行锚定：正文恰好以标记样式结尾不误判（无前导换行的标记不是末行标记）", () => {
    // 正文里嵌有 [exit code: 5] 但后面还有真实输出与真实标记
    const text = "found [exit code: 5] in text\nreal output\n[exit code: 0, uptime: 1s]";
    const info = parseTerminalResult(text);
    expect(info!.exitCode).toBe(0);
    expect(info!.body).toContain("found [exit code: 5] in text");
  });

  it("无任何已知标记 → 返回 null（调用方回退原样展示）", () => {
    expect(parseTerminalResult("plain tool result text")).toBeNull();
    expect(parseTerminalResult("")).toBeNull();
  });
});
