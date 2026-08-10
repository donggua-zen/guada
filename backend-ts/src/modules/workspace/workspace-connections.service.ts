import { Injectable, Logger } from "@nestjs/common";
import { SettingsStorage } from "../../common/utils/settings-storage.util";
import { WorkspaceProviderResolver } from "../../common/workspace/workspace-provider.resolver";
import {
  WorkspaceProviderFactory,
  ParsedWorkspaceUri,
  parseWorkspacePath,
} from "../../common/workspace/workspace-provider.interface";

export interface SavedConnection {
  id: string;
  name: string;
  scheme: string;
  config: Record<string, any>;
  /** Resolved workspacePath URI, e.g. "ssh://root@192.168.1.100:22/home/user/proj" */
  workspacePath: string;
}

const SETTINGS_GROUP = "workspace";
const SETTINGS_KEY = "connections";

@Injectable()
export class WorkspaceConnectionsService {
  private readonly logger = new Logger(WorkspaceConnectionsService.name);

  constructor(
    private readonly settingsStorage: SettingsStorage,
    private readonly resolver: WorkspaceProviderResolver,
  ) {}

  async getProviders(): Promise<
    { scheme: string; label: string; configSchema: any[] }[]
  > {
    return this.resolver.getAllFactories().map((f) => ({
      scheme: f.scheme,
      label: f.label,
      configSchema: f.configSchema,
    }));
  }

  async getConnections(): Promise<SavedConnection[]> {
    const data = await this.settingsStorage.getSettingValue(
      SETTINGS_GROUP,
      SETTINGS_KEY,
      [],
    );
    return Array.isArray(data) ? data : [];
  }

  async createConnection(
    name: string,
    scheme: string,
    config: Record<string, any>,
  ): Promise<SavedConnection> {
    const connections = await this.getConnections();
    const id = `conn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const workspacePath = this.buildWorkspacePath(scheme, config);
    const conn: SavedConnection = { id, name, scheme, config, workspacePath };
    connections.push(conn);
    await this.save(connections);
    return conn;
  }

  async updateConnection(
    id: string,
    updates: { name?: string; config?: Record<string, any> },
  ): Promise<SavedConnection | null> {
    const connections = await this.getConnections();
    const idx = connections.findIndex((c) => c.id === id);
    if (idx === -1) return null;
    if (updates.name) connections[idx].name = updates.name;
    if (updates.config) {
      connections[idx].config = updates.config;
      connections[idx].workspacePath = this.buildWorkspacePath(
        connections[idx].scheme,
        updates.config,
      );
    }
    await this.save(connections);
    return connections[idx];
  }

  async deleteConnection(id: string): Promise<boolean> {
    const connections = await this.getConnections();
    const filtered = connections.filter((c) => c.id !== id);
    if (filtered.length === connections.length) return false;
    await this.save(filtered);
    return true;
  }

  async testConnection(
    scheme: string,
    config: Record<string, any>,
  ): Promise<{ success: boolean; error?: string }> {
    if (scheme === "local") {
      // Local: just check the path exists
      const localPath = config.path || "";
      try {
        const fs = await import("fs/promises");
        await fs.access(localPath);
        return { success: true };
      } catch {
        return { success: false, error: `Path not found: ${localPath}` };
      }
    }

    // Remote: SSH connect + stat the workspace dir (no agent deployment)
    const workspacePath = this.buildWorkspacePath(scheme, config);
    const uri = parseWorkspacePath(workspacePath);

    // Use ssh2 directly for a lightweight connectivity test
    // ssh2 is loaded from the remote-ssh plugin's node_modules via requireWithFallback
    const Module = require("module");
    const pluginNodeModules = require("path").resolve(
      process.cwd(),
      "..",
      "plugins",
      "remote-ssh",
      "node_modules",
    );
    const originalResolve = Module._resolveFilename;
    let ssh2Module: any;
    try {
      Module._resolveFilename = function (request: string, parent: any, ...args: any[]) {
        try {
          return originalResolve.call(this, request, parent, ...args);
        } catch {
          return originalResolve.call(
            this,
            request,
            { ...parent, paths: [...(parent?.paths || []), pluginNodeModules] },
            ...args,
          );
        }
      };
      ssh2Module = require("ssh2");
    } finally {
      Module._resolveFilename = originalResolve;
    }
    const client = new ssh2Module.Client();

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        client.end();
        resolve({ success: false, error: "Connection timeout (15s)" });
      }, 15000);

      client.on("ready", async () => {
        clearTimeout(timer);
        try {
          // Test: stat the workspace directory
          client.exec(`test -d ${uri.path} && echo OK || echo NOT_DIR`, (err, stream) => {
            if (err) {
              client.end();
              resolve({ success: false, error: err.message });
              return;
            }
            let output = "";
            stream.on("data", (data: Buffer) => { output += data.toString(); });
            stream.on("close", () => {
              client.end();
              if (output.trim() === "OK") {
                resolve({ success: true });
              } else {
                resolve({ success: false, error: `Directory not found: ${uri.path}` });
              }
            });
          });
        } catch (err: any) {
          client.end();
          resolve({ success: false, error: err.message || String(err) });
        }
      });

      client.on("error", (err) => {
        clearTimeout(timer);
        resolve({ success: false, error: err.message || String(err) });
      });

      // Build SSH config from URI
      const sshConfig: any = {
        host: uri.host,
        port: uri.port || 22,
        username: uri.username || "root",
      };
      const password = uri.password || uri.query?.password;
      if (password) sshConfig.password = decodeURIComponent(password);
      const privateKey = uri.query?.privateKey;
      if (privateKey) sshConfig.privateKey = decodeURIComponent(privateKey);

      client.connect(sshConfig);
    });
  }

  async browsePath(
    scheme: string,
    config: Record<string, any>,
    dirPath: string,
  ): Promise<{ name: string; isDirectory: boolean; size: number }[]> {
    const factory = this.resolver.getAllFactories().find((f) => f.scheme === scheme);
    if (!factory) {
      throw new Error(`No provider for scheme: ${scheme}`);
    }
    const workspacePath = this.buildWorkspacePath(scheme, config);
    const uri = parseWorkspacePath(workspacePath);
    const provider = factory.create(uri);
    try {
      await provider.connect();
      const entries = await provider.readdir(dirPath);
      return entries;
    } finally {
      await provider.disconnect().catch(() => {});
    }
  }

  /** Build a URI string from scheme + config fields */
  private buildWorkspacePath(
    scheme: string,
    config: Record<string, any>,
  ): string {
    if (scheme === "local") {
      return config.path || "";
    }
    // Generic URI builder for remote schemes
    // Encode password/privateKey in query params (not in URL userinfo —
    // URL password field has encoding issues with special chars)
    const host = config.host || "";
    const port = config.port ? `:${config.port}` : "";
    const username = config.username ? `${config.username}@` : "";
    const pathPart = config.path || "/";

    // Build query params for auth credentials
    const params = new URLSearchParams();
    if (config.authMethod === "password" && config.password) {
      params.set("password", config.password);
    }
    if (config.authMethod === "privateKey" && config.privateKey) {
      params.set("privateKey", config.privateKey);
    }
    const query = params.toString();
    return `${scheme}://${username}${host}${port}${pathPart}${query ? `?${query}` : ""}`;
  }

  private async save(connections: SavedConnection[]): Promise<void> {
    await this.settingsStorage.updateSettings(SETTINGS_GROUP, {
      [SETTINGS_KEY]: connections,
    });
  }
}
