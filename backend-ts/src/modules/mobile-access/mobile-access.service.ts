import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleInit,
} from "@nestjs/common";
import { HttpAdapterHost } from "@nestjs/core";
import * as os from "os";
import { SettingsStorage } from "../../common/utils/settings-storage.util";
import { AccountFileStore } from "../auth/account-file.store";
import { encryptSecret } from "../remote-workspace/secret-crypto.util";
import { SshTunnelService } from "./ssh-tunnel.service";
import {
  MOBILE_ACCESS_SETTINGS_GROUP,
  buildPublicAccessUrl,
  normalizeMobileAccessConfig,
  type MobileAccessConfig,
  type MobileAccessConfigInput,
  type MobileAccessStatus,
  type MobileAccessSshConfig,
} from "./mobile-access.types";

/**
 * 移动访问：局域网 + 公网（SSH 反向隧道）两类入口的统一配置与状态中心。
 *
 * 安全约束（产品要求）：
 * - 任一入口开启前必须已设置访问密码；
 * - 取消密码时若仍有入口开启，由 UserService 拦截（必须先关闭移动访问）；
 * - 后端启动时再兜底一次：配置开启但无密码 → 自动关闭（见 onModuleInit）。
 */
@Injectable()
export class MobileAccessService implements OnModuleInit {
  private readonly logger = new Logger(MobileAccessService.name);

  constructor(
    private readonly storage: SettingsStorage,
    private readonly accountStore: AccountFileStore,
    private readonly tunnel: SshTunnelService,
    private readonly httpAdapterHost: HttpAdapterHost,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      // 必须先等账户预热完成：gate 释放前读到空账户会把「已设密码」误判为免密，
      // 导致启动兜底错误地关闭移动访问
      await this.accountStore.ensureReady();
      const config = await this.getConfig();
      if ((config.lanEnabled || config.publicEnabled) && !this.accountStore.isPasswordSet()) {
        this.logger.warn("移动访问配置为开启但未设置访问密码，自动关闭全部入口");
        await this.storage.updateSettings(MOBILE_ACCESS_SETTINGS_GROUP, {
          ...config,
          lanEnabled: false,
          publicEnabled: false,
        });
        return;
      }
      // 密码强度只在设置/修改密码时用明文校验一次；启动期不再对存量密码做二次判断
      await this.tunnel.apply(config);
    } catch (err: any) {
      this.logger.warn(`初始化移动访问失败: ${err?.message || err}`);
    }
  }

  async getConfig(): Promise<MobileAccessConfig> {
    return normalizeMobileAccessConfig(
      await this.storage.getSettings(MOBILE_ACCESS_SETTINGS_GROUP),
    );
  }

  /** 是否有任意外部入口处于开启状态（密码清除门禁用） */
  async isAnyAccessEnabled(): Promise<boolean> {
    const config = await this.getConfig();
    return config.lanEnabled || config.publicEnabled;
  }

  /** 公网访问是否开启（设置密码时的强度要求据此提升） */
  async isPublicAccessEnabled(): Promise<boolean> {
    return (await this.getConfig()).publicEnabled;
  }

  /** 脱敏配置视图：不含 passwordEnc，只给 hasPassword */
  async getConfigView() {
    await this.accountStore.ensureReady();
    const config = await this.getConfig();
    return {
      ...this.sanitize(config),
      passwordSet: this.accountStore.isPasswordSet(),
      lanActive: this.isLanActive(),
      port: this.getPort(),
    };
  }

  async updateConfig(input: MobileAccessConfigInput) {
    await this.accountStore.ensureReady();
    const current = await this.getConfig();
    const next = this.mergeConfig(current, input);

    // 唯一的准入判断：必须有密码。强度只在设置/修改密码时用明文校验，
    // 这里不再对存量密码做二次判断（避免状态陈旧导致"改了密码仍然打不开"）。
    if ((next.lanEnabled || next.publicEnabled) && !this.accountStore.isPasswordSet()) {
      throw new BadRequestException("请先在「账户安全」中设置访问密码，再开启移动访问");
    }
    this.validatePublicConfig(next);

    await this.storage.updateSettings(MOBILE_ACCESS_SETTINGS_GROUP, next);
    await this.tunnel.apply(next);

    const lanActive = this.isLanActive();
    return {
      ...this.sanitize(next),
      passwordSet: this.accountStore.isPasswordSet(),
      lanActive,
      port: this.getPort(),
      // 局域网绑定地址在进程启动期决定；dev+Vite 下 Web 入口是始终监听所有
      // 网卡的 dev server，开关本身即时生效，无需重启
      restartRequired: this.hasWebPortOverride() ? false : next.lanEnabled !== lanActive,
    };
  }

  async getStatus(): Promise<MobileAccessStatus> {
    await this.accountStore.ensureReady();
    const config = await this.getConfig();
    const port = this.getPort();
    const lanActive = this.isLanActive();
    const webPort = this.getWebPort();
    const tunnel = this.tunnel.getSnapshot();
    const lanUrls: string[] = [];
    if (config.lanEnabled && lanActive && webPort) {
      for (const address of this.listLanIpv4()) {
        lanUrls.push(`http://${address}:${webPort}/`);
      }
    }
    return {
      passwordSet: this.accountStore.isPasswordSet(),
      port,
      lan: {
        enabled: config.lanEnabled,
        active: lanActive,
        urls: lanUrls,
      },
      public: {
        enabled: config.publicEnabled,
        status: tunnel.status,
        url: config.publicEnabled ? tunnel.url ?? buildPublicAccessUrl(config.ssh) : null,
        lastError: tunnel.lastError,
      },
    };
  }

  async reconnectTunnel(): Promise<{ success: boolean }> {
    await this.accountStore.ensureReady();
    const config = await this.getConfig();
    if (!config.publicEnabled) {
      throw new BadRequestException("公网访问未开启");
    }
    if (!this.accountStore.isPasswordSet()) {
      throw new BadRequestException("请先设置访问密码");
    }
    await this.tunnel.restart(config);
    return { success: true };
  }

  // ── 内部实现 ──

  private sanitize(config: MobileAccessConfig) {
    const { passwordEnc, ...ssh } = config.ssh;
    return {
      lanEnabled: config.lanEnabled,
      publicEnabled: config.publicEnabled,
      hasPassword: !!passwordEnc,
      ssh,
    };
  }

  private mergeConfig(
    current: MobileAccessConfig,
    input: MobileAccessConfigInput,
  ): MobileAccessConfig {
    const next: MobileAccessConfig = {
      lanEnabled: input.lanEnabled ?? current.lanEnabled,
      publicEnabled: input.publicEnabled ?? current.publicEnabled,
      ssh: { ...current.ssh },
    };
    const sshInput = input.ssh;
    if (sshInput) {
      this.assignString(next.ssh, "host", sshInput.host);
      this.assignString(next.ssh, "username", sshInput.username);
      this.assignPort(next.ssh, "port", sshInput.port);
      this.assignString(next.ssh, "privateKeyPath", sshInput.privateKeyPath);
      this.assignString(next.ssh, "publicUrl", sshInput.publicUrl);
      this.assignPort(next.ssh, "remotePort", sshInput.remotePort);
      if (sshInput.authMethod === "password" || sshInput.authMethod === "privateKey") {
        next.ssh.authMethod = sshInput.authMethod;
      }
      if (sshInput.remoteBindAddress === "0.0.0.0" || sshInput.remoteBindAddress === "127.0.0.1") {
        next.ssh.remoteBindAddress = sshInput.remoteBindAddress;
      }
      // 明文密码只进不出：有值才覆盖密文，留空表示保持原值
      if (typeof sshInput.password === "string" && sshInput.password) {
        next.ssh.passwordEnc = encryptSecret(sshInput.password);
      }
      if (sshInput.clearHostFingerprint) {
        next.ssh.hostFingerprint = "";
      } else if (typeof sshInput.hostFingerprint === "string" && sshInput.hostFingerprint) {
        next.ssh.hostFingerprint = sshInput.hostFingerprint.trim();
      }
      // 主机变了 → 旧指纹必然失效，自动清空重新 TOFU
      if (sshInput.host !== undefined && next.ssh.host !== current.ssh.host) {
        next.ssh.hostFingerprint = "";
      }
    }
    return next;
  }

  private assignString<K extends keyof MobileAccessSshConfig>(
    target: MobileAccessSshConfig,
    key: K,
    value: unknown,
  ): void {
    if (typeof value === "string") {
      (target[key] as unknown) = value.trim();
    }
  }

  private assignPort<K extends "port" | "remotePort">(
    target: MobileAccessSshConfig,
    key: K,
    value: unknown,
  ): void {
    if (value === undefined || value === null || value === "") return;
    const n = typeof value === "number" ? value : parseInt(String(value), 10);
    if (!Number.isFinite(n) || n < 1 || n > 65535) {
      throw new BadRequestException(key === "port" ? "SSH 端口必须在 1-65535 之间" : "远端端口必须在 1-65535 之间");
    }
    target[key] = Math.floor(n);
  }

  private validatePublicConfig(config: MobileAccessConfig): void {
    if (!config.publicEnabled) return;
    const ssh = config.ssh;
    if (!ssh.host) throw new BadRequestException("公网访问需要填写 SSH 服务器地址");
    if (!ssh.username) throw new BadRequestException("公网访问需要填写 SSH 用户名");
    if (ssh.authMethod === "password" && !ssh.passwordEnc) {
      throw new BadRequestException("请填写 SSH 密码");
    }
    if (ssh.authMethod === "privateKey" && !ssh.privateKeyPath) {
      throw new BadRequestException("请选择 SSH 私钥文件");
    }
    if (ssh.publicUrl && !/^https?:\/\//i.test(ssh.publicUrl)) {
      throw new BadRequestException("自定义公网地址必须以 http:// 或 https:// 开头");
    }
  }

  private isLanActive(): boolean {
    // dev + Vite：dev server host:true 已监听所有网卡，局域网入口始终可用
    if (this.hasWebPortOverride()) return true;
    // 后端启动时由 Electron 注入 LISTEN_HOST；非 Electron（docker 等）缺省绑所有网卡
    return (process.env.LISTEN_HOST || "0.0.0.0") === "0.0.0.0";
  }

  /** 是否存在 Web 入口端口覆盖（dev 下 Electron 指向 Vite dev server） */
  private hasWebPortOverride(): boolean {
    const override = parseInt(process.env.MOBILE_WEB_PORT || "", 10);
    return Number.isFinite(override) && override > 0;
  }

  /** 局域网地址使用 Web 入口端口：dev 为 Vite 5173，生产为后端实际端口 */
  private getWebPort(): number | null {
    const override = parseInt(process.env.MOBILE_WEB_PORT || "", 10);
    if (Number.isFinite(override) && override > 0) return override;
    return this.getPort();
  }

  private getPort(): number | null {
    try {
      const address = this.httpAdapterHost.httpAdapter?.getHttpServer()?.address();
      return address && typeof address === "object" ? address.port : null;
    } catch {
      return null;
    }
  }

  private listLanIpv4(): string[] {
    const result: string[] = [];
    try {
      for (const nets of Object.values(os.networkInterfaces())) {
        for (const net of nets ?? []) {
          if (net.family === "IPv4" && !net.internal) result.push(net.address);
        }
      }
    } catch {
      /* 取不到只影响展示 */
    }
    return result;
  }
}
