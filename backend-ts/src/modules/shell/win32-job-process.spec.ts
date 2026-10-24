import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  buildCommandLine,
  buildEnvironmentBlock,
  closeNativeHandle,
  getProcessExitCode,
  isWin32JobAvailable,
  peekOutputPipeSync,
  quoteArg,
  readOutputPipeSync,
  spawnSuspendedInJob,
  terminateJob,
  waitForProcessExit,
  writeToProcessStdin,
} from "./win32-job-process";

const isWindows = process.platform === "win32";
const describeWin = isWindows ? describe : describe.skip;

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return predicate();
}

/** 收干输出管道直到 EOF；返回累计字节。 */
function drainUntilEof(handle: bigint, timeoutMs: number): Buffer {
  const chunks: Buffer[] = [];
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const available = peekOutputPipeSync(handle);
    if (available === null) break; // EOF
    if (available > 0) {
      const buffer = Buffer.allocUnsafe(Math.max(available, 1));
      const read = readOutputPipeSync(handle, buffer);
      if (read > 0) chunks.push(buffer.subarray(0, read));
      continue;
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
  }
  return Buffer.concat(chunks);
}

describe("win32-job-process helpers", () => {
  it("quotes argv entries using CommandLineToArgvW rules", () => {
    expect(quoteArg("")).toBe('""');
    expect(quoteArg("simple")).toBe("simple");
    expect(quoteArg("a b")).toBe('"a b"');
    expect(quoteArg('a"b')).toBe('"a\\"b"');
    expect(buildCommandLine("cmd.exe", ["/d", "/s", "/c", "echo hi"])).toBe(
      'cmd.exe /d /s /c "echo hi"',
    );
  });

  it("builds a sorted, double-NUL terminated UTF-16 environment block", () => {
    const buffer = buildEnvironmentBlock({
      ZED: "last",
      ALPHA: "first",
      EMPTY: "",
      MISSING: undefined,
    });
    const text = buffer.toString("utf16le");

    expect(text.endsWith("\0\0")).toBe(true);
    expect(text).toContain("ALPHA=first\0");
    expect(text).toContain("EMPTY=\0");
    expect(text).not.toContain("MISSING=");
    expect(text.indexOf("ALPHA=")).toBeLessThan(text.indexOf("ZED="));
  });
});

describeWin("win32-job-process native integration", () => {
  const comspec = process.env.ComSpec || "C:\\Windows\\System32\\cmd.exe";

  it("is available on Windows", async () => {
    await expect(isWin32JobAvailable()).resolves.toBe(true);
  });

  it("applies an explicit env block, pipes the output, and returns the exit code", async () => {
    let native = null;
    try {
      native = await spawnSuspendedInJob({
        program: comspec,
        args: [
          "/d",
          "/s",
          "/c",
          "echo TOKEN=%GUADA_JOB_TEST% & echo HELLO & exit /b 7",
        ],
        cwd: process.cwd(),
        env: { ...process.env, GUADA_JOB_TEST: "token-123" },
      });
      expect(native).not.toBeNull();

      expect(await waitForProcessExit(native!.process, 10_000)).toBe(true);
      expect(await getProcessExitCode(native!.process)).toBe(7);

      const output = drainUntilEof(native!.outputRead, 5_000).toString("utf8");
      expect(output).toContain("TOKEN=token-123");
      expect(output).toContain("HELLO");
    } finally {
      if (native) {
        await closeNativeHandle(native.job);
        await closeNativeHandle(native.process);
        if (native.stdinWrite) await closeNativeHandle(native.stdinWrite);
        await closeNativeHandle(native.outputRead);
      }
    }
  }, 30_000);

  it("writes to the child's stdin pipe and reads the echoed output", async () => {
    let native = null;
    try {
      native = await spawnSuspendedInJob({
        program: process.execPath,
        args: [
          "-e",
          "process.stdin.on('data', (d) => { console.log('GOT:' + d.toString().trim()); process.exit(0); });",
        ],
        cwd: process.cwd(),
        env: { ...process.env },
      });
      expect(native).not.toBeNull();
      expect(native!.stdinWrite).not.toBeNull();

      await writeToProcessStdin(native!.stdinWrite!, "hello-stdin\n");
      expect(await waitForProcessExit(native!.process, 10_000)).toBe(true);

      const output = drainUntilEof(native!.outputRead, 5_000).toString("utf8");
      expect(output).toContain("GOT:hello-stdin");
    } finally {
      if (native) {
        await closeNativeHandle(native.job);
        await closeNativeHandle(native.process);
        if (native.stdinWrite) await closeNativeHandle(native.stdinWrite);
        await closeNativeHandle(native.outputRead);
      }
    }
  }, 30_000);

  it("kills a detached descendant when the job is closed after the direct child exits", async () => {
    const pidFile = path.join(
      os.tmpdir(),
      `guada-job-test-${process.pid}-${Date.now()}-desc.pid`,
    );
    const childScript = path.join(
      os.tmpdir(),
      `guada-job-test-${process.pid}-${Date.now()}-desc-child.js`,
    );
    const parentScript = path.join(
      os.tmpdir(),
      `guada-job-test-${process.pid}-${Date.now()}-desc-parent.js`,
    );
    fs.writeFileSync(childScript, "setInterval(() => {}, 1000);");
    fs.writeFileSync(
      parentScript,
      [
        "const { spawn } = require('child_process');",
        `const child = spawn(process.execPath, [${JSON.stringify(childScript)}], { stdio: 'ignore', detached: true });`,
        "child.unref();",
        `require('fs').writeFileSync(${JSON.stringify(pidFile)}, String(child.pid));`,
      ].join("\n"),
    );

    let native = null;
    let descendantPid = 0;
    try {
      native = await spawnSuspendedInJob({
        program: process.execPath,
        args: [parentScript],
        cwd: process.cwd(),
        env: { ...process.env },
      });
      expect(native).not.toBeNull();

      expect(await waitForProcessExit(native!.process, 10_000)).toBe(true);
      expect(await waitFor(() => fs.existsSync(pidFile), 5_000)).toBe(true);
      descendantPid = Number(fs.readFileSync(pidFile, "utf8"));
      expect(descendantPid).toBeGreaterThan(0);
      expect(isAlive(descendantPid)).toBe(true);

      await closeNativeHandle(native!.job);
      native!.job = 0n;

      expect(await waitFor(() => !isAlive(descendantPid), 5_000)).toBe(true);
    } finally {
      if (native) {
        if (native.job) await closeNativeHandle(native.job);
        await closeNativeHandle(native.process);
        if (native.stdinWrite) await closeNativeHandle(native.stdinWrite);
        await closeNativeHandle(native.outputRead);
      }
      if (descendantPid > 0 && isAlive(descendantPid)) {
        try {
          process.kill(descendantPid, "SIGKILL");
        } catch {
          // already gone
        }
      }
      for (const file of [pidFile, childScript, parentScript]) {
        fs.rmSync(file, { force: true });
      }
    }
  }, 30_000);

  it("terminateJob kills the direct child", async () => {
    let native = null;
    try {
      native = await spawnSuspendedInJob({
        program: process.execPath,
        args: ["-e", "setInterval(() => {}, 1000);"],
        cwd: process.cwd(),
        env: { ...process.env },
      });
      expect(native).not.toBeNull();

      await terminateJob(native!.job, 1);
      expect(await waitForProcessExit(native!.process, 10_000)).toBe(true);
      expect(await getProcessExitCode(native!.process)).toBe(1);
    } finally {
      if (native) {
        await closeNativeHandle(native.job);
        await closeNativeHandle(native.process);
        if (native.stdinWrite) await closeNativeHandle(native.stdinWrite);
        await closeNativeHandle(native.outputRead);
      }
    }
  }, 30_000);

  it("reports EOF on the output pipe once the buffered bytes are drained", async () => {
    let native = null;
    try {
      native = await spawnSuspendedInJob({
        program: process.execPath,
        args: ["-e", "console.log('bye'); process.exit(0);"],
        cwd: process.cwd(),
        env: { ...process.env },
      });
      expect(native).not.toBeNull();

      expect(await waitForProcessExit(native!.process, 10_000)).toBe(true);
      // 子进程已退出且无后代：读干缓冲后 EOF 必达（数据不读走时 PeekNamedPipe
      // 会一直报告缓冲量，这与 Win32 语义一致）
      const output = drainUntilEof(native!.outputRead, 5_000).toString("utf8");
      expect(output).toContain("bye");
      expect(peekOutputPipeSync(native!.outputRead)).toBeNull();
    } finally {
      if (native) {
        await closeNativeHandle(native.job);
        await closeNativeHandle(native.process);
        if (native.stdinWrite) await closeNativeHandle(native.stdinWrite);
        await closeNativeHandle(native.outputRead);
      }
    }
  }, 30_000);
});
