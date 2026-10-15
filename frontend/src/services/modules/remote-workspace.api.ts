import type { ApiContext } from "./api-context";

/**
 * 连接配置（提交给后端的 DTO）。
 *
 * 后端以判别字段 kind 区分两种连接类型的严格联合类型；前端此处用宽松形状
 * （两组字段均可选）以便向导内单一 editConfig 引用在类型间切换，无需到处窄化。
 * kind 缺省（旧数据）由后端归一为 'ssh'。
 */
export interface RemoteConnectionConfig {
  kind?: "ssh" | "docker";

  // ── SSH ──
  host?: string;
  port?: number;
  username?: string;
  authMethod?: "password" | "privateKey";
  password?: string;
  /** 私钥文件绝对路径(不再存储私钥内容明文) */
  privateKeyPath?: string;

  // ── Docker ──
  /** 容器名或 ID（运行中；GuaDa 不创建/不销毁容器） */
  container?: string;
  /** Docker 主机（docker -H，如 tcp://host:2375 / ssh://user@host）；缺省本机 */
  dockerHost?: string;

  // ── 公共 ──
  /** 工作目录（SSH: 远端绝对路径；Docker: 容器内绝对路径；缺省用容器 WorkingDir） */
  path: string;
  /** agent 权限模式:readonly | workspace | unrestricted(默认 workspace) */
  perm?: string;
}

export interface RemoteConnection {
  id: string;
  name: string;
  config: RemoteConnectionConfig;
}

/** 连接类型（旧数据无 kind → 视为 ssh） */
export function connectionKind(conn: Pick<RemoteConnection, "config"> | { config: RemoteConnectionConfig }): "ssh" | "docker" {
  return conn.config?.kind === "docker" ? "docker" : "ssh";
}

/** 连接档摘要文案（列表卡片 / 信息卡共用） */
export function connectionTargetLine(config: RemoteConnectionConfig): string {
  if (config.kind === "docker") {
    return `容器 ${config.container || "?"}${config.dockerHost ? ` @ ${config.dockerHost}` : ""}`;
  }
  return `${config.username || "root"}@${config.host || "?"}:${config.port || 22}`;
}

/** 运行中的 Docker 容器（连接向导的容器选择器） */
export interface DockerContainerInfo {
  name: string;
  image: string;
  status: string;
}

export interface DirEntry {
  name: string;
  isDirectory: boolean;
  size: number;
}

export interface BrowseResult {
  /** 实际浏览的目录（空路径由后端解析为主目录后回传） */
  path: string;
  /** 该路径是否为存在的目录 */
  exists: boolean;
  entries: DirEntry[];
}

export interface DeployResult {
  success: boolean;
  installed: boolean;
  version: string;
  log: string[];
}

export interface DeployJob {
  jobId: string;
}

export interface DeployLogState {
  log: string[];
  done: boolean;
  result?: DeployResult;
}

export interface RemoteWorkspaceApi {
  getConnections(): Promise<RemoteConnection[]>;
  createConnection(name: string, config: RemoteConnectionConfig): Promise<RemoteConnection>;
  updateConnection(id: string, data: { name?: string; config?: RemoteConnectionConfig }): Promise<RemoteConnection>;
  deleteConnection(id: string): Promise<{ success: boolean }>;
  testConnection(config: RemoteConnectionConfig): Promise<{ success: boolean; error?: string; log?: string }>;
  deployConnection(config: RemoteConnectionConfig): Promise<DeployJob>;
  getDeployLog(jobId: string): Promise<DeployLogState>;
  cancelDeploy(jobId: string): Promise<{ cancelled: boolean }>;
  browsePath(config: RemoteConnectionConfig, path: string): Promise<BrowseResult>;
  /** 运行中的 Docker 容器列表（向导容器选择器；dockerHost 为空 = 本机） */
  listDockerContainers(dockerHost?: string): Promise<{ containers: DockerContainerInfo[]; error?: string }>;
}

export const remoteWorkspaceApi: RemoteWorkspaceApi = {
  async getConnections(this: ApiContext) {
    return await this._request("/remote-workspace/connections");
  },

  async createConnection(this: ApiContext, name: string, config: RemoteConnectionConfig) {
    return await this._request("/remote-workspace/connections", {
      method: "POST",
      data: { name, config },
    });
  },

  async updateConnection(this: ApiContext, id: string, data: { name?: string; config?: RemoteConnectionConfig }) {
    return await this._request(`/remote-workspace/connections/${id}`, {
      method: "PUT",
      data,
    });
  },

  async deleteConnection(this: ApiContext, id: string) {
    return await this._request(`/remote-workspace/connections/${id}`, {
      method: "DELETE",
    });
  },

  async testConnection(this: ApiContext, config: RemoteConnectionConfig) {
    return await this._request("/remote-workspace/connections/test", {
      method: "POST",
      data: { config },
    });
  },

  async deployConnection(this: ApiContext, config: RemoteConnectionConfig) {
    return await this._request("/remote-workspace/connections/deploy", {
      method: "POST",
      data: { config },
    });
  },

  async getDeployLog(this: ApiContext, jobId: string) {
    return await this._request(`/remote-workspace/connections/deploy-log/${jobId}`);
  },

  async cancelDeploy(this: ApiContext, jobId: string) {
    return await this._request(`/remote-workspace/connections/deploy-cancel/${jobId}`, {
      method: "POST",
    });
  },

  async browsePath(this: ApiContext, config: RemoteConnectionConfig, path: string) {
    return await this._request("/remote-workspace/connections/browse", {
      method: "POST",
      data: { config, path },
    });
  },

  async listDockerContainers(this: ApiContext, dockerHost?: string) {
    const query = dockerHost ? `?dockerHost=${encodeURIComponent(dockerHost)}` : "";
    return await this._request(`/remote-workspace/docker/containers${query}`);
  },
};
