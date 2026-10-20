import { app } from "electron";
import { ChildProcess, execFile, spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import log from "electron-log";

export interface ComputerSidecarStatus {
  available: boolean;
  binaryPath?: string;
  version?: string;
  protocol?: string;
  capabilities?: Record<string, unknown>;
  error?: string;
}

interface PendingRequest {
  method: string;
  resolve: (value: any) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const A11Y_TIMEOUT_MS = 20_000;
const START_TIMEOUT_MS = 10_000;
const MAX_CONSECUTIVE_FAILURES = 3;

/**
 * Resolve the sidecar binary. Packaged builds read the extraResources copy;
 * development builds prefer the build-resources copy, then the local Rust
 * output directory.
 */
export function resolveComputerSidecarBinary(): string | null {
  const binaryNames =
    process.platform === "win32"
      ? ["guada-computer.exe"]
      : [`guada-computer-${process.platform}-${process.arch}`, "guada-computer"];

  const directories = app.isPackaged
    ? [path.join(process.resourcesPath, "computer-sidecar")]
    : [
        path.join(__dirname, "..", "..", "build-resources", "computer-sidecar"),
        path.join(app.getAppPath(), "build-resources", "computer-sidecar"),
        path.join(__dirname, "..", "..", "guada-computer", "dist"),
        path.join(__dirname, "..", "..", "guada-computer", "target", "release"),
      ];

  for (const directory of directories) {
    for (const name of binaryNames) {
      const candidate = path.join(directory, name);
      try {
        if (process.platform === "win32") {
          fs.accessSync(candidate, fs.constants.F_OK);
        } else {
          fs.accessSync(candidate, fs.constants.X_OK);
        }
        return candidate;
      } catch {
        // Try the next candidate.
      }
    }
  }
  return null;
}

/**
 * Local JSON-RPC client for the computer sidecar. The sidecar is a child of the
 * Electron main process and speaks newline-delimited JSON over stdio.
 */
export class ComputerSidecarClient {
  private child: ChildProcess | null = null;
  private pending = new Map<string, PendingRequest>();
  private nextId = 1;
  private buffer = "";
  private status: ComputerSidecarStatus = { available: false };
  private starting: Promise<ComputerSidecarStatus> | null = null;
  private stopping = false;
  private consecutiveFailures = 0;

  async start(): Promise<ComputerSidecarStatus> {
    if (this.child && !this.child.killed && this.status.available) {
      return this.status;
    }
    if (this.starting) return this.starting;
    this.starting = this.startInternal().finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  private async startInternal(): Promise<ComputerSidecarStatus> {
    if (this.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      this.status = {
        available: false,
        error: `computer sidecar failed to start ${this.consecutiveFailures} times in a row`,
      };
      return this.status;
    }

    const binaryPath = resolveComputerSidecarBinary();
    if (!binaryPath) {
      this.status = {
        available: false,
        error:
          "computer sidecar binary was not found; build guada-computer or run scripts/verify-sidecar.js",
      };
      log.warn(`[ComputerSidecar] ${this.status.error}`);
      return this.status;
    }

    if (this.child && !this.child.killed) {
      try {
        this.child.kill();
      } catch {
        // ignore
      }
    }
    this.child = null;
    this.stopping = false;
    this.buffer = "";
    const child = spawn(binaryPath, ["--stdio"], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      cwd: app.getPath("userData"),
      env: sidecarEnv(),
    });
    this.child = child;
    this.status = { available: false, binaryPath };

    child.stdout?.on("data", (chunk: Buffer) => {
      this.consumeStdout(chunk.toString("utf8"));
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      const message = chunk.toString("utf8").trim();
      if (message) log.error(`[ComputerSidecar] ${message}`);
    });
    child.on("error", (error) => {
      log.error("[ComputerSidecar] process error:", error);
      this.rejectAll(new Error(`computer sidecar process error: ${error.message}`));
      this.status = { available: false, binaryPath, error: error.message };
    });
    child.on("exit", (code, signal) => {
      this.rejectAll(
        new Error(
          `computer sidecar exited (code=${code ?? "null"}, signal=${signal ?? "null"})`
        )
      );
      if (this.stopping) {
        this.status = { available: false, binaryPath };
        return;
      }
      this.consecutiveFailures += 1;
      this.status = {
        available: false,
        binaryPath,
        error: `computer sidecar exited unexpectedly (code=${code ?? "null"})`,
      };
      log.error(`[ComputerSidecar] ${this.status.error}`);
    });

    try {
      const ping = await this.send("ping", {}, START_TIMEOUT_MS);
      this.consecutiveFailures = 0;
      this.status = {
        available: true,
        binaryPath,
        version: ping?.version,
        protocol: ping?.protocol,
        capabilities: ping?.capabilities,
        error: ping?.a11y_error ?? undefined,
      };
      log.info(
        `[ComputerSidecar] ready version=${ping?.version} protocol=${ping?.protocol}`
      );
      return this.status;
    } catch (error: any) {
      this.status = {
        available: false,
        binaryPath,
        error: error?.message ?? String(error),
      };
      this.consecutiveFailures += 1;
      log.error(`[ComputerSidecar] handshake failed: ${this.status.error}`);
      try {
        child.kill();
      } catch {
        // ignore
      }
      return this.status;
    }
  }

  async request(
    method: string,
    params: Record<string, unknown> = {},
    options: { timeoutMs?: number; signal?: AbortSignal } = {}
  ): Promise<any> {
    const status = await this.start();
    if (!status.available) {
      throw new Error(status.error || "computer sidecar is unavailable");
    }
    if (options.signal?.aborted) {
      throw new Error("computer sidecar request aborted");
    }
    return this.send(method, params, options.timeoutMs ?? DEFAULT_TIMEOUT_MS, options.signal);
  }

  async dispatch(method: string, params: any): Promise<any> {
    switch (method) {
      case "computer_observe":
        return this.request("observe", params, { timeoutMs: 30_000 });
      case "computer_a11y_observe":
        return this.request("a11y.observe", params, { timeoutMs: A11Y_TIMEOUT_MS });
      case "computer_input":
        return this.request("input", params, { timeoutMs: 30_000 });
      case "computer_status":
        return this.start();
      case "computer_test":
        return this.test();
      default:
        throw new Error(`Unknown computer method: ${method}`);
    }
  }

  async test(): Promise<{
    ok: boolean;
    screenshotPath?: string;
    width?: number;
    height?: number;
    treeCount?: number;
    version?: string;
    error?: string;
  }> {
    try {
      const status = await this.start();
      if (!status.available) {
        return { ok: false, error: status.error || "computer sidecar is unavailable" };
      }
      const screenshotPath = path.join(
        app.getPath("temp"),
        `guada-computer-test-${Date.now()}.png`
      );
      const screenshot = await this.request(
        "observe",
        { action: "screenshot", output_path: screenshotPath },
        { timeoutMs: 30_000 }
      );
      let treeCount = 0;
      let treeError: string | undefined;
      try {
        const tree = await this.request("a11y.observe", {}, { timeoutMs: A11Y_TIMEOUT_MS });
        treeCount = Array.isArray(tree?.entries) ? tree.entries.length : 0;
      } catch (error: any) {
        treeError = error?.message ?? String(error);
      }
      return {
        ok: true,
        screenshotPath: screenshot?.image_path ?? screenshotPath,
        width: screenshot?.width,
        height: screenshot?.height,
        treeCount,
        version: status.version,
        error: treeError,
      };
    } catch (error: any) {
      return { ok: false, error: error?.message ?? String(error) };
    }
  }

  getStatus(): ComputerSidecarStatus {
    return this.status;
  }

  async stop(): Promise<void> {
    this.stopping = true;
    const child = this.child;
    if (!child || child.killed) {
      this.child = null;
      this.status = { available: false };
      return;
    }

    try {
      await this.send("shutdown", {}, 2_000);
    } catch {
      // The sidecar may already be gone.
    }
    this.child = null;
    try {
      child.stdin?.end();
    } catch {
      // ignore
    }

    const exited = await waitForExit(child, 3_000);
    if (!exited && child.pid) {
      log.warn(`[ComputerSidecar] forcing process tree ${child.pid} to stop`);
      if (process.platform === "win32") {
        await new Promise<void>((resolve) => {
          execFile("taskkill", ["/pid", String(child.pid), "/T", "/F"], () => resolve());
        });
      } else {
        child.kill("SIGKILL");
      }
    }
    this.rejectAll(new Error("computer sidecar stopped"));
    this.status = { available: false };
  }

  private send(
    method: string,
    params: Record<string, unknown>,
    timeoutMs: number,
    signal?: AbortSignal
  ): Promise<any> {
    return new Promise((resolve, reject) => {
      const child = this.child;
      if (!child || child.killed || !child.stdin) {
        reject(new Error("computer sidecar is not running"));
        return;
      }

      const id = String(this.nextId++);
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new Error(
            `computer sidecar request ${method} timed out after ${timeoutMs}ms; observe again before retrying`
          )
        );
      }, timeoutMs);

      const abortHandler = () => {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new Error("computer sidecar request aborted"));
      };
      if (signal) {
        signal.addEventListener("abort", abortHandler, { once: true });
      }

      this.pending.set(id, {
        method,
        timer,
        resolve: (value) => {
          if (signal) signal.removeEventListener("abort", abortHandler);
          resolve(value);
        },
        reject: (error) => {
          if (signal) signal.removeEventListener("abort", abortHandler);
          reject(error);
        },
      });

      try {
        child.stdin.write(JSON.stringify({ id, method, params }) + "\n");
      } catch (error: any) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new Error(`failed to write to computer sidecar: ${error?.message ?? error}`));
      }
    });
  }

  private consumeStdout(chunk: string): void {
    this.buffer += chunk;
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let message: any;
      try {
        message = JSON.parse(trimmed);
      } catch (error) {
        log.error(`[ComputerSidecar] invalid protocol line: ${trimmed}`);
        continue;
      }
      const pending = this.pending.get(String(message.id));
      if (!pending) {
        log.warn(`[ComputerSidecar] response for unknown request: ${trimmed}`);
        continue;
      }
      this.pending.delete(String(message.id));
      clearTimeout(pending.timer);
      if (message.error) {
        const error = new Error(
          `computer sidecar ${pending.method}: ${message.error.message}`
        ) as Error & { code?: string };
        error.code = message.error.code;
        pending.reject(error);
      } else {
        pending.resolve(message.result);
      }
    }
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}

/**
 * The sidecar is an MSVC Rust binary like the other native modules; on a clean
 * Windows machine it may need the bundled VC++ runtime. Mirror the backend's
 * PATH injection so packaged builds do not fail to load the CRT.
 */
function sidecarEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (process.platform === "win32") {
    const crtDir = path.join(process.resourcesPath, "vc-runtime");
    if (fs.existsSync(crtDir)) {
      const pathKey =
        Object.keys(env).find((key) => key.toUpperCase() === "PATH") || "PATH";
      env[pathKey] = `${crtDir}${path.delimiter}${env[pathKey] ?? ""}`;
    }
  }
  return env;
}

function waitForExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.removeListener("exit", onExit);
      resolve(false);
    }, timeoutMs);
    const onExit = () => {
      clearTimeout(timer);
      resolve(true);
    };
    child.once("exit", onExit);
  });
}
