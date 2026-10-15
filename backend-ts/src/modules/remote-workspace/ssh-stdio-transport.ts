/**
 * SshStdioTransport — ssh2 exec channel 上的 RPC 传输（NDJSON）。
 *
 * 用于 SSH 工作区（agent ≥ 0.6.0）：`client.exec('<agent> --stdio --root <path> --perm <mode>')`
 * 打开一条长驻 exec 通道，协议（与 WebSocket 完全相同的 JSON-RPC）经通道直连。
 *
 * 相对"端口转发 + WebSocket"的收益（实测见 docs/docker容器工作区方案.md 同源对比脚本）：
 * - 不再要求远端 sshd 允许端口转发（AllowTcpForwarding / PermitOpen / Match 限制）；
 *   实测 Alpine 的 openssh 默认配置即 `AllowTcpForwarding no`；
 * - 远端无需监听任何 TCP 端口，也不需要 nohup 后台化与解析 "listening on"；
 * - 连接建立少一次转发探测 + 转发建立（本机 loopback 实测省 ~35ms），失败模式更少。
 * 代价：读取方向吞吐略低于直通转发（stdout 是管道、sshd 需搬字节进通道），
 * 故工具层保持 1MB 分块读（readFileRange / READ_CHUNK_MAX_BYTES，已是现状）。
 *
 * 语义要点（与 StreamRpcTransport 对齐）：
 * - 一行一条消息（NDJSON），分帧与 stderr 尾部窗口复用 rpc-stream-transport 的实现；
 * - 通道关闭 / SSH 连接断开 = 传输关闭：触发 onClose，挂起请求被 reject，上层清理缓存；
 * - 关闭：先 end(channel) 让 agent 读到 EOF 自行退出，随后关闭本条连接专用的 SSH client
 *   （连接由 provision 新建、只服务本会话，不与其他用途共享）；
 * - **不得请求 PTY**（`exec` 默认不开 pty）：pty 会做 CRLF 转换并缓冲，破坏二进制安全与实时性。
 */
import { Client, ClientChannel } from "ssh2";
import { Logger } from "@nestjs/common";
import type { RpcTransport } from "./rpc";
import { createNdjsonSplitter, StderrTail } from "./rpc-stream-transport";

/** 远端 shell 单引号包裹（内嵌单引号按 POSIX 规则转义：'\'' ） */
export function shQuote(value: string): string {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

/** 通道 end 后等待 agent 自行退出的上限（ms），超时则直接关闭 SSH 连接 */
const CLOSE_GRACE_MS = 2000;

export interface SshStdioTransportOptions {
  /** 命令描述（日志与诊断用），如 `agent --stdio --root /srv` */
  describeCommand: string;
  label?: string;
  onExit?: (code: number | null, signal: string | null) => void;
}

export class SshStdioTransport implements RpcTransport {
  readonly label: string;
  private readonly logger = new Logger(SshStdioTransport.name);
  private readonly messageHandlers: Array<(raw: string) => void> = [];
  private readonly closeHandlers: Array<() => void> = [];
  private readonly stderrTail = new StderrTail();
  private readonly feed: (chunk: Buffer | string) => void;
  private closed = false;
  private closeNotified = false;
  private closeTimer: ReturnType<typeof setTimeout> | null = null;

  private constructor(
    private readonly client: Client,
    private readonly channel: ClientChannel,
    private readonly describeCommand: string,
    opts?: SshStdioTransportOptions,
  ) {
    this.label = opts?.label || "ssh stdio";
    this.feed = createNdjsonSplitter((line) => this.dispatchLine(line));

    this.channel.on("data", (chunk: Buffer) => this.feed(chunk));
    // stderr 不属于协议通道：保留尾部供诊断（如 --root 不存在、权限拒绝等启动失败原因）
    this.channel.stderr?.on("data", (chunk: Buffer) => this.stderrTail.append(chunk));
    let exitCode: number | null = null;
    let exitSignal: string | null = null;
    this.channel.on("exit", (code: number | null, signal?: string) => {
      exitCode = code ?? null;
      exitSignal = signal ?? null;
    });
    this.channel.on("close", () => {
      this.handleClose(exitCode, exitSignal);
      opts?.onExit?.(exitCode, exitSignal);
    });
    // SSH 连接本身断开（网络中断 / 对端关闭）：同样视为传输关闭
    this.client.on("close", () => this.handleClose(exitCode, exitSignal));
  }

  /**
   * 在既有 SSH 连接上打开 stdio 通道并返回传输。
   * 不请求 PTY（ssh2 exec 默认即为无 pty）。
   */
  static open(
    client: Client,
    command: string,
    opts: SshStdioTransportOptions,
  ): Promise<SshStdioTransport> {
    return new Promise((resolve, reject) => {
      client.exec(command, (err: Error | undefined, channel: ClientChannel) => {
        if (err) {
          reject(
            new Error(
              `SSH exec 失败: ${err.message || err} [command: ${opts.describeCommand}]`,
            ),
          );
          return;
        }
        resolve(new SshStdioTransport(client, channel, opts.describeCommand, opts));
      });
    });
  }

  /**
   * 以远端 agent 二进制启动 stdio 通道：`<bin> --stdio --root '<path>' [--perm <mode>]`。
   * `--perm` 缺省为 workspace（与 legacy 起点一致，仅在非默认时显式传递）。
   */
  static openAgent(
    client: Client,
    opts: {
      binaryPath: string;
      rootPath?: string;
      perm?: string;
      onExit?: (code: number | null, signal: string | null) => void;
    },
  ): Promise<SshStdioTransport> {
    const permArg = opts.perm && opts.perm !== "workspace" ? ` --perm ${opts.perm}` : "";
    const rootArg = opts.rootPath ? ` --root ${shQuote(opts.rootPath)}` : "";
    const command = `${shQuote(opts.binaryPath)} --stdio${rootArg}${permArg}`;
    return SshStdioTransport.open(client, command, {
      describeCommand: command,
      onExit: opts.onExit,
    });
  }

  send(data: string, cb?: (err?: Error) => void): void {
    if (!this.isOpen()) {
      cb?.(new Error(`${this.label} closed`));
      return;
    }
    // 整行原子写入（NDJSON 帧）；背压由 ssh2 通道排队，回调在冲刷后触发
    this.channel.write(data + "\n", (err?: Error) => cb?.(err ?? undefined));
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    // 1) 关通道：agent 读到 stdin EOF 即自行退出（等价容器链路的 docker exec 断开）
    try {
      this.channel.end();
    } catch {}
    // 2) 兜底：通道/连接未在宽限期内关闭则强制结束（本连接专用，直接 end 即可）
    this.closeTimer = setTimeout(() => {
      try {
        this.client.end();
      } catch {}
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
    return !this.closed;
  }

  /** stderr 尾部（启动失败 / 运行期崩溃原因，供错误文案拼接） */
  getStderrTail(): string {
    return this.stderrTail.get();
  }

  private dispatchLine(line: string): void {
    for (const h of this.messageHandlers) {
      try {
        h(line);
      } catch (err: any) {
        this.logger.warn(`message handler failed: ${err?.message || err}`);
      }
    }
  }

  private handleClose(code: number | null, signal: string | null): void {
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
    // 通道结束即回收本条连接专用的 SSH client（避免残留空连接）
    try {
      this.client.end();
    } catch {}
    for (const h of this.closeHandlers) {
      try {
        h();
      } catch {}
    }
  }
}
