import { Injectable, Logger } from "@nestjs/common";
import * as fs from "fs";
import { SettingsStorage } from "../../common/utils/settings-storage.util";
import { verifyAndDeployAgent, type DeployResult } from "./agent-deploy";
import { encryptSecret, decryptSecret } from "./secret-crypto.util";
export interface RemoteConnection {
  id: string;
  name: string;
  config: {
    host: string;
    port: number;
    username: string;
    authMethod: "password" | "privateKey";
    password?: string;
    /** 私钥文件绝对路径(不再存储私钥内容明文) */
    privateKeyPath?: string;
    path: string;
    /** agent 权限模式:readonly | workspace | unrestricted(默认 workspace) */
    perm?: string;
  };
}

const SETTINGS_GROUP = "remote-workspace";
const SETTINGS_KEY = "connections";
/** agent 二进制下载地址模板(含 {os}/{arch}/{version} 占位符);未配置时走本地缓存/手动复制 */
const SETTINGS_KEY_AGENT_DOWNLOAD_URL = "agentDownloadUrl";
/** agent 最新版本接口(返回 {"version":"x.y.z"});配置后部署时自动检查并下载最新版 */
const SETTINGS_KEY_AGENT_LATEST_URL = "agentLatestVersionUrl";

@Injectable()
export class RemoteWorkspaceService {
  private readonly logger = new Logger(RemoteWorkspaceService.name);

  constructor(private readonly settingsStorage: SettingsStorage) {}

  async getConnections(): Promise<RemoteConnection[]> {
    const data = await this.settingsStorage.getSettingValue(
      SETTINGS_GROUP,
      SETTINGS_KEY,
      [],
    );
    const conns = Array.isArray(data) ? data : [];
    // 解密密码(磁盘上只存密文,内存/返回时解密)
    return conns.map((c: RemoteConnection) => ({
      ...c,
      config: c.config?.password
        ? { ...c.config, password: decryptSecret(c.config.password) }
        : c.config,
    }));
  }

  async createConnection(
    name: string,
    config: RemoteConnection["config"],
  ): Promise<RemoteConnection> {
    const conns = await this.getConnections();
    if (conns.some((c) => c.name === name)) {
      throw new Error(`Connection name '${name}' already exists`);
    }
    const conn: RemoteConnection = {
      id: `conn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name,
      config,
    };
    conns.push(conn);
    await this.save(conns);
    return conn;
  }

  async updateConnection(
    id: string,
    updates: { name?: string; config?: RemoteConnection["config"] },
  ): Promise<RemoteConnection | null> {
    const conns = await this.getConnections();
    const idx = conns.findIndex((c) => c.id === id);
    if (idx === -1) return null;
    if (updates.name && updates.name !== conns[idx].name) {
      if (conns.some((c) => c.id !== id && c.name === updates.name)) {
        throw new Error(`Connection name '${updates.name}' already exists`);
      }
      conns[idx].name = updates.name;
    }
    if (updates.config) {
      conns[idx].config = updates.config;
    }
    await this.save(conns);
    return conns[idx];
  }

  async deleteConnection(id: string): Promise<boolean> {
    const conns = await this.getConnections();
    const filtered = conns.filter((c) => c.id !== id);
    if (filtered.length === conns.length) return false;
    await this.save(filtered);
    return true;
  }

  async testConnection(
    config: RemoteConnection["config"],
  ): Promise<{ success: boolean; error?: string; log?: string }> {
    try {
      const { Client } = require("ssh2");
      const client = new Client();
      const log: string[] = [];

      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          client.end();
          resolve({ success: false, error: "Connection timeout (15s)", log: log.join("\n") });
        }, 15000);

        log.push(`Connecting to ${config.username}@${config.host}:${config.port || 22}...`);

        client.on("ready", () => {
          clearTimeout(timer);
          log.push("SSH connection established successfully.");
          log.push("Authentication OK.");
          // Run a simple command to verify shell access
          client.exec("echo CONNECTION_OK && uname -a", (err, stream) => {
            if (err) {
              client.end();
              log.push(`Exec failed: ${err.message}`);
              resolve({ success: true, log: log.join("\n") });
              return;
            }
            let output = "";
            stream.on("data", (data: Buffer) => { output += data.toString(); });
            stream.stderr.on("data", (data: Buffer) => { log.push("[stderr] " + data.toString()); });
            stream.on("close", () => {
              client.end();
              log.push(output.trim());
              resolve({ success: true, log: log.join("\n") });
            });
          });
        });

        client.on("error", (err: Error) => {
          clearTimeout(timer);
          log.push(`Error: ${err.message}`);
          resolve({ success: false, error: err.message, log: log.join("\n") });
        });

        client.on("close", () => {
          log.push("Connection closed.");
        });

        const sshConfig: any = {
          host: config.host,
          port: config.port || 22,
          username: config.username || "root",
        };
        if (config.authMethod === "password" && config.password) {
          sshConfig.password = config.password;
        }
        if (config.authMethod === "privateKey" && config.privateKeyPath) {
          sshConfig.privateKey = fs.readFileSync(config.privateKeyPath, "utf-8");
        }
        client.connect(sshConfig);
      });
    } catch (err: any) {
      return { success: false, error: err.message || String(err) };
    }
  }

  /**
   * 读取 agent 二进制下载地址模板(settings 可配置)。
   * 模板支持 {os}/{arch}/{version} 占位符,例如:
   *   https://example.com/releases/guada-agent-{os}-{arch}-v{version}
   * 未配置时返回空字符串,部署走本地缓存(调试阶段手动复制二进制)。
   */
  async getAgentDownloadUrl(): Promise<string> {
    const url = await this.settingsStorage.getSettingValue(
      SETTINGS_GROUP,
      SETTINGS_KEY_AGENT_DOWNLOAD_URL,
      "",
    );
    return typeof url === "string" ? url : "";
  }

  /**
   * 读取 agent 最新版本接口地址(settings 可配置)。
   * 该接口返回 {"version":"x.y.z"};部署时自动检查本地缓存是否落后,
   * 落后则用接口返回的下载地址模板拉取最新版 — 无需升级主程序即可更新 agent。
   * 未配置时使用官方默认地址 https://ai.dingd.cn/plugins/remote-agent/latest.json。
   */
  async getAgentLatestVersionUrl(): Promise<string> {
    const DEFAULT_AGENT_LATEST_URL =
      "https://ai.dingd.cn/plugins/remote-agent/latest.json";
    const url = await this.settingsStorage.getSettingValue(
      SETTINGS_GROUP,
      SETTINGS_KEY_AGENT_LATEST_URL,
      "",
    );
    return typeof url === "string" && url ? url : DEFAULT_AGENT_LATEST_URL;
  }

  /**
   * 部署任务状态(内存中保存,供前端轮询日志 + 取消)
   */
  private readonly deployJobs = new Map<
    string,
    { log: string[]; done: boolean; result?: DeployResult; controller?: AbortController }
  >();

  /**
   * Deploy/verify agent on the remote host — 后台执行,立即返回 jobId,
   * 前端通过 getDeployLog 轮询实时日志,避免部署期间无反馈。
   */
  async deployConnection(
    config: RemoteConnection["config"],
  ): Promise<{ jobId: string }> {
    const jobId = `deploy-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const job: { log: string[]; done: boolean; result?: DeployResult; controller?: AbortController } =
      { log: [], done: false };
    const controller = new AbortController();
    job.controller = controller;
    this.deployJobs.set(jobId, job);

    const params = new URLSearchParams();
    if (config.authMethod === "password" && config.password) {
      params.set("password", config.password);
    }
    if (config.authMethod === "privateKey" && config.privateKeyPath) {
      params.set("privateKeyPath", config.privateKeyPath);
    }
    const query = params.toString();

    // 异步执行,不阻塞响应
    void (async () => {
      try {
        const downloadUrl = await this.getAgentDownloadUrl();
        const latestVersionUrl = await this.getAgentLatestVersionUrl();
        const result = await verifyAndDeployAgent(
          {
            scheme: "ssh",
            host: config.host,
            port: config.port || 22,
            username: config.username || "root",
            password: config.password,
            path: config.path || "/",
            query: query ? Object.fromEntries(params) : undefined,
          },
          downloadUrl,
          latestVersionUrl,
          (line) => job.log.push(line),
          controller.signal,
        );
        job.result = result;
        job.done = true;
      } catch (err: any) {
        job.log.push(`Deployment failed: ${err?.message || err}`);
        job.result = { success: false, installed: false, version: "", log: job.log };
        job.done = true;
      }
    })();

    return { jobId };
  }

  /** 查询部署任务日志(前端轮询) */
  async getDeployLog(
    jobId: string,
  ): Promise<{ log: string[]; done: boolean; result?: DeployResult } | null> {
    const job = this.deployJobs.get(jobId);
    if (!job) return null;
    return { log: job.log, done: job.done, result: job.result };
  }

  /** 取消部署任务(窗口关闭/组件卸载时调用,立即中止下载/上传/SSH) */
  async cancelDeploy(jobId: string): Promise<{ cancelled: boolean }> {
    const job = this.deployJobs.get(jobId);
    if (!job || job.done) return { cancelled: false };
    job.controller?.abort();
    job.log.push("Deployment cancelled by client");
    job.result = { success: false, installed: false, version: "", log: job.log };
    job.done = true;
    return { cancelled: true };
  }

  /**
   * Browse remote directories via SSH — returns subdirectories of the given path.
   * Used by the frontend directory picker.
   */
  async browsePath(
    config: RemoteConnection["config"],
    dirPath: string,
  ): Promise<{ name: string; isDirectory: boolean; size: number }[]> {
    const { Client } = require("ssh2");
    const client = new Client();

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        client.end();
        reject(new Error("Connection timeout (15s)"));
      }, 15000);

      client.on("ready", () => {
        clearTimeout(timer);
        // List directories only (for path picker usability)
        // Output format: name/isDir/size per line
        const cmd = `ls -la --time-style=+0 "${dirPath}" 2>/dev/null | awk 'NR>1 {print $NF "/" ($1 ~ /^d/ ? "1" : "0") "/" $5}'`;
        client.exec(cmd, (err, stream) => {
          if (err) {
            client.end();
            reject(err);
            return;
          }
          let output = "";
          stream.on("data", (data: Buffer) => { output += data.toString(); });
          stream.stderr.on("data", (data: Buffer) => { /* ignore stderr */ });
          stream.on("close", () => {
            client.end();
            const entries: { name: string; isDirectory: boolean; size: number }[] = [];
            for (const line of output.trim().split("\n")) {
              if (!line) continue;
              const parts = line.split("/");
              if (parts.length < 3) continue;
              const name = parts.slice(0, -2).join("/");
              const isDir = parts[parts.length - 2] === "1";
              const size = parseInt(parts[parts.length - 1], 10) || 0;
              if (name === "." || name === "..") continue;
              entries.push({ name, isDirectory: isDir, size });
            }
            // Sort: directories first, then alphabetically
            entries.sort((a, b) => {
              if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
              return a.name.localeCompare(b.name);
            });
            resolve(entries);
          });
        });
      });

      client.on("error", (err: Error) => {
        clearTimeout(timer);
        reject(err);
      });

      const sshConfig: any = {
        host: config.host,
        port: config.port || 22,
        username: config.username || "root",
      };
      if (config.authMethod === "password" && config.password) {
        sshConfig.password = config.password;
      }
      if (config.authMethod === "privateKey" && config.privateKeyPath) {
        sshConfig.privateKey = fs.readFileSync(config.privateKeyPath, "utf-8");
      }
      client.connect(sshConfig);
    });
  }

  private async save(connections: RemoteConnection[]): Promise<void> {
    // 保存前加密密码(encryptSecret 对已是密文的值幂等:仅加密明文/旧数据)
    const encrypted = connections.map((c) => ({
      ...c,
      config: c.config?.password
        ? { ...c.config, password: encryptSecret(c.config.password) }
        : c.config,
    }));
    await this.settingsStorage.updateSettings(SETTINGS_GROUP, {
      [SETTINGS_KEY]: encrypted,
    });
  }
}
