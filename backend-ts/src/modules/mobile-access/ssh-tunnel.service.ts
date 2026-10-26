import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { HttpAdapterHost } from "@nestjs/core";
import { Client, type ConnectConfig } from "ssh2";
import * as crypto from "crypto";
import * as fs from "fs";
import * as net from "net";
import { SettingsStorage } from "../../common/utils/settings-storage.util";
import { decryptSecret } from "../remote-workspace/secret-crypto.util";
import {
  MOBILE_ACCESS_SETTINGS_GROUP,
  buildPublicAccessUrl,
  normalizeMobileAccessConfig,
  type MobileAccessConfig,
  type MobileAccessSshConfig,
  type TunnelState,
} from "./mobile-access.types";

/**
 * 公网访问的 SSH 反向隧道（等价 ssh -R remoteBind:remotePort:127.0.0.1:本地端口）。
 *
 * - 使用后端已有的 ssh2 依赖，不依赖用户机器安装 ssh 客户端；
 * - forwardIn 申请远端监听，收到 "tcp connection" 后桥接到本地后端端口；
 * - 断线指数退避重连（1s → 30s），配置类错误不重试（等用户修正）；
 * - 主机指纹 TOFU：首次连接记录，之后不一致直接拒绝（防中间人/服务器被换）。
 */
@Injectable()
export class SshTunnelService implements OnModuleDestroy {
  private readonly logger = new Logger("SshTunnel");

  private client: Client | null = null;
  private ssh: MobileAccessSshConfig | null = null;
  private signature = "";

  private status: TunnelState = "stopped";
  private lastError: string | null = null;
  private permanentFailure = false;

  private stopped = true;
  private retryTimer: NodeJS.Timeout | null = null;
  private retryDelayMs = 1000;
  private static readonly MAX_RETRY_DELAY_MS = 30_000;

  constructor(
    private readonly storage: SettingsStorage,
    private readonly httpAdapterHost: HttpAdapterHost,
  ) {}

  async onModuleDestroy(): Promise<void> {
    await this.stop();
  }

  /** 按最新配置收敛隧道：公网关闭则停，配置未变则不动，变化则重连 */
  async apply(config: MobileAccessConfig): Promise<void> {
    if (!config.publicEnabled) {
      await this.stop();
      return;
    }
    const nextSignature = this.signatureOf(config);
    if (!this.stopped && this.signature === nextSignature) return;
    await this.restart(config);
  }

  /** 强制重连（配置保存后或用户点击重连） */
  async restart(config: MobileAccessConfig): Promise<void> {
    await this.stop();
    if (!config.publicEnabled) return;
    this.stopped = false;
    this.permanentFailure = false;
    this.ssh = config.ssh;
    this.signature = this.signatureOf(config);
    this.retryDelayMs = 1000;
    this.connect();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.permanentFailure = false;
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    const client = this.client;
    this.client = null;
    if (client) {
      try {
        client.removeAllListeners();
        client.end();
        // 兜底：end 后仍未断开则强杀 socket
        setTimeout(() => {
          try {
            client.destroy();
          } catch {
            /* 已断开 */
          }
        }, 1000).unref?.();
      } catch {
        /* 已断开 */
      }
    }
    this.status = "stopped";
    this.lastError = null;
    this.signature = "";
  }

  getSnapshot(): { status: TunnelState; url: string | null; lastError: string | null } {
    return {
      status: this.status,
      url: this.ssh ? buildPublicAccessUrl(this.ssh) : null,
      lastError: this.lastError,
    };
  }

  // ── 内部实现 ──

  private signatureOf(config: MobileAccessConfig): string {
    return JSON.stringify([
      config.ssh.host,
      config.ssh.port,
      config.ssh.username,
      config.ssh.authMethod,
      config.ssh.passwordEnc,
      config.ssh.privateKeyPath,
      config.ssh.remoteBindAddress,
      config.ssh.remotePort,
    ]);
  }

  private connect(): void {
    if (this.stopped || !this.ssh) return;
    const ssh = this.ssh;

    const connectConfig: ConnectConfig = {
      host: ssh.host,
      port: ssh.port,
      username: ssh.username,
      readyTimeout: 20_000,
      keepaliveInterval: 15_000,
      keepaliveCountMax: 3,
      hostVerifier: (key: Buffer) => this.verifyHostKey(key),
    };

    if (ssh.authMethod === "password") {
      const password = decryptSecret(ssh.passwordEnc);
      if (!password) {
        this.failPermanent("SSH 密码缺失或无法解密，请重新填写");
        return;
      }
      connectConfig.password = password;
    } else {
      if (!ssh.privateKeyPath) {
        this.failPermanent("未配置 SSH 私钥文件");
        return;
      }
      try {
        connectConfig.privateKey = fs.readFileSync(ssh.privateKeyPath);
      } catch (err: any) {
        this.failPermanent(`读取私钥失败: ${err?.message || err}`);
        return;
      }
    }

    this.status = "connecting";
    this.lastError = null;

    const client = new Client();
    this.client = client;

    client.on("ready", () => {
      if (this.client !== client) return;
      client.forwardIn(ssh.remoteBindAddress, ssh.remotePort, (err) => {
        if (this.client !== client) return;
        if (err) {
          const hint =
            ssh.remoteBindAddress === "0.0.0.0"
              ? "（远端绑定 0.0.0.0 需要服务器 sshd 配置 GatewayPorts yes）"
              : "";
          this.failPermanent(`远端端口转发失败${hint}: ${err.message || err}`);
          return;
        }
        this.status = "connected";
        this.retryDelayMs = 1000;
        const target = this.getWebTarget();
        this.logger.log(
          `SSH 隧道已建立: ${ssh.host}:${ssh.remotePort} -> ${target?.host ?? "127.0.0.1"}:${target?.port ?? "?"}`,
        );
      });
    });

    client.on("tcp connection", (_info, accept) => {
      const target = this.getWebTarget();
      if (!target) {
        this.logger.warn("收到隧道连接但移动端 Web 入口未知，拒绝");
        try {
          accept().close();
        } catch {
          /* ignore */
        }
        return;
      }
      const channel = accept();
      const socket = net.connect(target.port, target.host);
      socket.on("connect", () => {
        channel.pipe(socket);
        socket.pipe(channel);
      });
      socket.on("error", () => {
        try {
          channel.close();
        } catch {
          /* ignore */
        }
        socket.destroy();
      });
      channel.on("error", () => socket.destroy());
      channel.on("close", () => socket.destroy());
      socket.on("close", () => {
        try {
          channel.close();
        } catch {
          /* ignore */
        }
      });
    });

    client.on("error", (err) => {
      if (this.client !== client) return;
      // 配置/主机指纹错误已标记为永久失败，不再当成可重试的网络错误
      if (this.permanentFailure) return;
      this.status = "error";
      this.lastError = err.message || String(err);
      this.logger.warn(`SSH 隧道连接失败: ${this.lastError}`);
      this.scheduleRetry();
    });

    client.on("close", () => {
      if (this.client !== client) return;
      this.client = null;
      if (this.permanentFailure || this.stopped) return;
      this.status = "error";
      this.lastError = this.lastError || "SSH 连接已断开";
      this.logger.warn(`SSH 隧道断开: ${this.lastError}，将自动重连`);
      this.scheduleRetry();
    });

    client.connect(connectConfig);
  }

  private verifyHostKey(key: Buffer): boolean {
    const fingerprint =
      "sha256:" + crypto.createHash("sha256").update(key).digest("base64").replace(/=+$/, "");
    const expected = this.ssh?.hostFingerprint || "";
    if (!expected) {
      // TOFU：首次连接自动记录
      void this.persistFingerprint(fingerprint);
      return true;
    }
    if (expected !== fingerprint) {
      this.failPermanent(
        `服务器主机指纹不匹配（服务器可能被重装或存在中间人）。当前: ${fingerprint}，已记录: ${expected}`,
      );
      return false;
    }
    return true;
  }

  private async persistFingerprint(fingerprint: string): Promise<void> {
    if (!this.ssh) return;
    this.ssh = { ...this.ssh, hostFingerprint: fingerprint };
    try {
      const raw = await this.storage.getSettings(MOBILE_ACCESS_SETTINGS_GROUP);
      const config = normalizeMobileAccessConfig(raw);
      await this.storage.updateSettings(MOBILE_ACCESS_SETTINGS_GROUP, {
        ...config,
        ssh: { ...config.ssh, hostFingerprint: fingerprint },
      });
      this.logger.log(`已记录 SSH 主机指纹: ${fingerprint}`);
    } catch (err: any) {
      this.logger.warn(`记录主机指纹失败: ${err?.message || err}`);
    }
  }

  private failPermanent(message: string): void {
    this.permanentFailure = true;
    this.status = "error";
    this.lastError = message;
    this.logger.error(message);
    const client = this.client;
    this.client = null;
    if (client) {
      try {
        client.end();
      } catch {
        /* ignore */
      }
    }
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }

  private scheduleRetry(): void {
    if (this.stopped || this.permanentFailure || this.retryTimer) return;
    const delay = this.retryDelayMs;
    this.retryDelayMs = Math.min(this.retryDelayMs * 2, SshTunnelService.MAX_RETRY_DELAY_MS);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.connect();
    }, delay);
    this.retryTimer.unref?.();
  }

  /**
   * 隧道转发的 Web 入口：
   * - dev（Electron 传 MOBILE_WEB_PORT=5173）→ 指向 Vite dev server，支持热重载；
   * - 生产（未传）→ 指向后端自身端口（后端 serve 编译产物）。
   */
  private getWebTarget(): { host: string; port: number } | null {
    const overridePort = parseInt(process.env.MOBILE_WEB_PORT || "", 10);
    if (Number.isFinite(overridePort) && overridePort > 0) {
      return { host: process.env.MOBILE_WEB_HOST || "127.0.0.1", port: overridePort };
    }
    try {
      const address = this.httpAdapterHost.httpAdapter?.getHttpServer()?.address();
      if (address && typeof address === "object") {
        return { host: "127.0.0.1", port: address.port };
      }
    } catch {
      /* 未监听 */
    }
    return null;
  }
}
