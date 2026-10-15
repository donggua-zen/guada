/**
 * StreamRpcTransport — 子进程 stdio 管道上的 RPC 传输（NDJSON）。
 *
 * 用于容器工作区：后端在宿主侧以 `docker exec -i <container> <agent> --stdio`
 * 拉起容器内 agent，协议（与 WebSocket 完全相同的 JSON-RPC）经管道直连，
 * 不依赖容器端口映射 / sshd / token（管道仅宿主侧 docker 客户端可达）。
 *
 * 语义要点（与 WsRpcTransport 对齐）：
 * - 一行一条消息（NDJSON）；读侧按 \n 分帧，不设行长上限（readFile/writeFile 可达数 MB）；
 * - 子进程退出 = 传输关闭：触发 onClose，让挂起请求被 reject、上层清理缓存并自动重建；
 * - 关闭顺序：先 end(stdin) 让 agent 读取 EOF 自行退出（实测 docker 守护进程在客户端
 *   断开时也会关闭 exec 流），超时未退出则 kill 本地客户端进程兜底；
 * - stderr 不属于协议通道，只保留尾部窗口供诊断（如 "docker: Error response from daemon"）。
 */
import { ChildProcess, spawn } from "child_process";
import { Logger } from "@nestjs/common";
import type { RpcTransport } from "./rpc";

/** stderr 保留窗口（字节）：只留尾部，用于错误诊断提示 */
const STDERR_TAIL_LIMIT = 8 * 1024;
/** 关闭时等待子进程自行退出的上限（ms），超时则 kill 本地 docker 客户端 */
const CLOSE_GRACE_MS = 3000;

/**
 * NDJSON 行分帧器（stdio 类传输共用：容器 docker exec 子进程 / SSH exec channel）。
 *
 * 一行一条消息；跨 chunk 的行在内部缓冲拼接；不设行长上限（readFile/writeFile
 * 的请求与响应可达数 MB）。调用方只需把每个数据块喂进来。
 */
export function createNdjsonSplitter(onLine: (line: string) => void): (chunk: Buffer | string) => void {
  let buf = "";
  return (chunk: Buffer | string) => {
    buf += chunk.toString();
    let idx: number;
    while ((idx = buf.indexOf("\n")) >= 0) {
      // 行尾 \r 容错（正常情况下 stdio 两侧都是纯 \n）
      const line = buf.slice(0, idx).replace(/\r$/, "");
      buf = buf.slice(idx + 1);
      if (line) onLine(line);
    }
  };
}

/** stderr 尾部窗口（容器子进程与 SSH channel 共用） */
export class StderrTail {
  private tail = "";

  append(chunk: Buffer | string): void {
    this.tail += chunk.toString();
    if (this.tail.length > STDERR_TAIL_LIMIT) {
      this.tail = this.tail.slice(-STDERR_TAIL_LIMIT);
    }
  }

  get(): string {
    return this.tail.trim();
  }
}

export interface StreamRpcTransportOptions {
  /** 子进程退出回调（code / signal），用于日志与诊断 */
  onExit?: (code: number | null, signal: NodeJS.Signals | null) => void;
  /** 传输标签（错误文案用），缺省 "stdio pipe" */
  label?: string;
}

export class StreamRpcTransport implements RpcTransport {
  readonly label: string;
  private readonly logger = new Logger(StreamRpcTransport.name);
  private readonly messageHandlers: Array<(raw: string) => void> = [];
  private readonly closeHandlers: Array<() => void> = [];
  /** 独占的 stderr 尾部缓冲（诊断用；标准 stderr 不落日志，避免刷屏） */
  private readonly stderrTail = new StderrTail();
  /** NDJSON 分帧（跨 chunk 拼接；与 SSH channel 传输共用同一实现） */
  private readonly feed: (chunk: Buffer | string) => void;
  private closed = false;
  private closeNotified = false;
  private closeTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly child: ChildProcess,
    private readonly describeCommand: string,
    opts?: StreamRpcTransportOptions,
  ) {
    this.label = opts?.label || "stdio pipe";
    this.feed = createNdjsonSplitter((line) => this.dispatchLine(line));

    this.child.stdout?.on("data", (chunk: Buffer) => this.feed(chunk));
    this.child.stderr?.on("data", (chunk: Buffer) => this.stderrTail.append(chunk));
    this.child.on("error", (err) => {
      // spawn 失败（命令不存在等）：记录后按传输关闭处理
      this.logger.warn(`transport ${this.describeCommand} spawn error: ${err.message}`);
      this.handleClose(null, null);
    });
    this.child.on("close", (code, signal) => {
      this.handleClose(code, signal);
      opts?.onExit?.(code, signal);
    });
  }

  /** 启动子进程并返回 stdio 传输（args 直传，不经 shell；Windows 下管道为二进制安全） */
  static spawn(
    command: string,
    args: string[],
    opts?: StreamRpcTransportOptions,
  ): StreamRpcTransport {
    const child = spawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    return new StreamRpcTransport(child, [command, ...args].join(" "), opts);
  }

  send(data: string, cb?: (err?: Error) => void): void {
    const stdin = this.child.stdin;
    if (!this.isOpen() || !stdin) {
      cb?.(new Error(`${this.label} closed`));
      return;
    }
    // 整行原子写入（NDJSON 帧）；背压由 Node 流排队，回调在冲刷后触发
    stdin.write(data + "\n", (err) => cb?.(err ?? undefined));
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    // 1) 关 stdin：agent 读到 EOF 即自行退出（等价 WS 的"断开即退出"）
    try {
      this.child.stdin?.end();
    } catch {}
    // 2) 兜底：超时未退出则强制结束本地客户端进程（容器内 agent 会因流关闭随之退出）
    this.closeTimer = setTimeout(() => {
      if (this.child.exitCode === null && !this.child.killed) {
        this.logger.warn(
          `transport ${this.describeCommand} did not exit within ${CLOSE_GRACE_MS}ms, killing client process`,
        );
        try {
          this.child.kill("SIGKILL");
        } catch {}
      }
    }, CLOSE_GRACE_MS);
    this.closeTimer.unref?.();
  }

  onMessage(handler: (raw: string) => void): void {
    this.messageHandlers.push(handler);
  }

  onClose(handler: () => void): void {
    this.closeHandlers.push(handler);
  }

  isOpen(): boolean {
    if (this.closed || this.child.exitCode !== null) return false;
    const stdin = this.child.stdin;
    return !!stdin && stdin.writable && !stdin.destroyed;
  }

  /** stderr 尾部（错误诊断：docker daemon 报错、agent 启动失败原因等） */
  getStderrTail(): string {
    return this.stderrTail.get();
  }

  /** 单行消息分发给已注册的处理器（分帧器回调） */
  private dispatchLine(line: string): void {
    for (const h of this.messageHandlers) {
      try {
        h(line);
      } catch (err: any) {
        this.logger.warn(`message handler failed: ${err?.message || err}`);
      }
    }
  }

  private handleClose(code: number | null, signal: NodeJS.Signals | null): void {
    if (this.closeTimer) {
      clearTimeout(this.closeTimer);
      this.closeTimer = null;
    }
    this.closed = true;
    if (this.closeNotified) return;
    this.closeNotified = true;
    if (code !== 0 && code !== null) {
      const tail = this.stderrTail.get();
      this.logger.warn(
        `transport ${this.describeCommand} exited with code=${code} signal=${signal || "-"}` +
          (tail ? ` stderr: ${tail.slice(-500)}` : ""),
      );
    }
    for (const h of this.closeHandlers) {
      try {
        h();
      } catch {}
    }
  }
}
