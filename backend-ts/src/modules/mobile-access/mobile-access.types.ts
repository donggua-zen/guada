/**
 * 移动访问（局域网 / 公网 SSH 隧道）
 *
 * 配置存在 SETTINGS_DIR/mobile-access.json（SettingsStorage 组 "mobile-access"），
 * Electron 主进程在 spawn 后端前直接读同一文件决定监听地址与是否 serve 前端。
 * 凭据只以密文（passwordEnc）或路径（privateKeyPath）落盘，读取接口一律脱敏。
 */

export type MobileAccessSshAuthMethod = "password" | "privateKey";
/** 远端（公网服务器）隧道监听地址：0.0.0.0 需要服务器 GatewayPorts 允许 */
export type MobileAccessRemoteBindAddress = "127.0.0.1" | "0.0.0.0";

export interface MobileAccessSshConfig {
  host: string;
  port: number;
  username: string;
  authMethod: MobileAccessSshAuthMethod;
  /** 仅 authMethod=password 使用；AES-256-GCM 密文，见 secret-crypto.util */
  passwordEnc: string;
  /** 仅 authMethod=privateKey 使用；只存路径，不存私钥内容 */
  privateKeyPath: string;
  remoteBindAddress: MobileAccessRemoteBindAddress;
  remotePort: number;
  /** 可选：自定义公网访问地址（如 https://guada.example.com），空则按 host:remotePort 推导 */
  publicUrl: string;
  /** TOFU：首次连接记录的主机指纹（sha256:...），变化时拒绝连接 */
  hostFingerprint: string;
}

export interface MobileAccessConfig {
  lanEnabled: boolean;
  publicEnabled: boolean;
  ssh: MobileAccessSshConfig;
}

/** PUT /mobile-access/config 的请求体（password 为明文，仅写入，不回显） */
export interface MobileAccessConfigInput {
  lanEnabled?: boolean;
  publicEnabled?: boolean;
  ssh?: Partial<Omit<MobileAccessSshConfig, "passwordEnc">> & {
    password?: string;
    /** 显式清空主机指纹（用户确认服务器指纹变更后） */
    clearHostFingerprint?: boolean;
  };
}

export type TunnelState = "stopped" | "connecting" | "connected" | "error";

export interface MobileAccessStatus {
  passwordSet: boolean;
  port: number | null;
  lan: {
    enabled: boolean;
    /** 后端本次启动是否真的绑在 0.0.0.0（配置改了但未重启时为 false） */
    active: boolean;
    urls: string[];
  };
  public: {
    enabled: boolean;
    status: TunnelState;
    url: string | null;
    lastError: string | null;
  };
}

export const MOBILE_ACCESS_SETTINGS_GROUP = "mobile-access";
export const DEFAULT_REMOTE_PORT = 8787;

export function defaultMobileAccessConfig(): MobileAccessConfig {
  return {
    lanEnabled: false,
    publicEnabled: false,
    ssh: {
      host: "",
      port: 22,
      username: "",
      authMethod: "privateKey",
      passwordEnc: "",
      privateKeyPath: "",
      remoteBindAddress: "127.0.0.1",
      remotePort: DEFAULT_REMOTE_PORT,
      publicUrl: "",
      hostFingerprint: "",
    },
  };
}

function asBool(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asPort(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : parseInt(String(value ?? ""), 10);
  return Number.isFinite(n) && n >= 1 && n <= 65535 ? Math.floor(n) : fallback;
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

/** 把磁盘上的任意形态归一为完整配置（缺字段补默认值，非法值回落） */
export function normalizeMobileAccessConfig(raw: unknown): MobileAccessConfig {
  const defaults = defaultMobileAccessConfig();
  if (!raw || typeof raw !== "object") return defaults;
  const obj = raw as Record<string, any>;
  const sshRaw = obj.ssh && typeof obj.ssh === "object" ? obj.ssh : {};
  return {
    lanEnabled: asBool(obj.lanEnabled),
    publicEnabled: asBool(obj.publicEnabled),
    ssh: {
      host: asString(sshRaw.host).trim(),
      port: asPort(sshRaw.port, defaults.ssh.port),
      username: asString(sshRaw.username).trim(),
      authMethod: sshRaw.authMethod === "password" ? "password" : "privateKey",
      passwordEnc: asString(sshRaw.passwordEnc),
      privateKeyPath: asString(sshRaw.privateKeyPath).trim(),
      remoteBindAddress: sshRaw.remoteBindAddress === "0.0.0.0" ? "0.0.0.0" : "127.0.0.1",
      remotePort: asPort(sshRaw.remotePort, defaults.ssh.remotePort),
      publicUrl: asString(sshRaw.publicUrl).trim(),
      hostFingerprint: asString(sshRaw.hostFingerprint).trim(),
    },
  };
}

/** 公网访问地址：优先自定义 publicUrl，否则按 SSH 主机 + 远端端口推导 */
export function buildPublicAccessUrl(ssh: MobileAccessSshConfig): string | null {
  if (ssh.publicUrl) return ssh.publicUrl.replace(/\/+$/, "") + "/";
  if (!ssh.host || !ssh.remotePort) return null;
  const host = ssh.host.includes(":") && !ssh.host.startsWith("[") ? `[${ssh.host}]` : ssh.host;
  return `http://${host}:${ssh.remotePort}/`;
}
