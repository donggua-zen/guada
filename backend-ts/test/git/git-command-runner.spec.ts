import { runGitWithOutputCap } from "../../src/modules/git/git-command-runner";

/// <reference types="jest" />

const CWD = process.cwd();

function runNode(script: string, options: { timeoutMs?: number; maxOutputBytes?: number } = {}) {
  return runGitWithOutputCap({
    command: process.execPath,
    args: ["-e", script],
    cwd: CWD,
    ...options,
  });
}

describe("runGitWithOutputCap", () => {
  it("正常输出：返回 stdout 与 exitCode 0", async () => {
    const result = await runNode('process.stdout.write("hello")');

    expect(result.stdout).toBe("hello");
    expect(result.exitCode).toBe(0);
    expect(result.outputTruncated).toBe(false);
    expect(result.timedOut).toBe(false);
  });

  it("输出恰好等于上限：不标记截断", async () => {
    const cap = 4 * 1024;
    const result = await runNode(`process.stdout.write("x".repeat(${cap}))`, {
      maxOutputBytes: cap,
    });

    expect(result.outputTruncated).toBe(false);
    expect(result.stdout.length).toBe(cap);
  });

  it("输出超过上限：标记截断并 kill 子进程", async () => {
    const cap = 4 * 1024;
    const result = await runNode(`process.stdout.write("x".repeat(${cap + 1}))`, {
      maxOutputBytes: cap,
    });

    expect(result.outputTruncated).toBe(true);
    expect(result.stdout.length).toBeLessThanOrEqual(cap);
  });

  it("stderr 也受上限约束", async () => {
    const cap = 4 * 1024;
    const result = await runNode(`process.stderr.write("e".repeat(${cap + 1}))`, {
      maxOutputBytes: cap,
    });

    expect(result.outputTruncated).toBe(true);
    expect(result.stderr.length).toBeLessThanOrEqual(cap);
  });

  it("超时：标记 timedOut 并终止", async () => {
    const startedAt = Date.now();
    const result = await runNode("setTimeout(() => {}, 5000)", {
      timeoutMs: 100,
    });

    expect(result.timedOut).toBe(true);
    expect(Date.now() - startedAt).toBeLessThan(3000);
  }, 10_000);

  it("spawn 失败：降级为 exitCode -2，不抛出", async () => {
    const result = await runGitWithOutputCap({
      command: "definitely-not-a-real-binary-9f3c",
      args: [],
      cwd: CWD,
      timeoutMs: 1000,
    });

    expect(result.exitCode).toBe(-2);
    expect(result.outputTruncated).toBe(false);
  });
});
