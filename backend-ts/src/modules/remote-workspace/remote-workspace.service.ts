import { Injectable, Logger } from "@nestjs/common";
import { SettingsStorage } from "../../common/utils/settings-storage.util";

export interface RemoteConnection {
  id: string;
  name: string;
  config: {
    host: string;
    port: number;
    username: string;
    authMethod: "password" | "privateKey";
    password?: string;
    privateKey?: string;
    path: string;
  };
}

const SETTINGS_GROUP = "remote-workspace";
const SETTINGS_KEY = "connections";

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
    return Array.isArray(data) ? data : [];
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
        if (config.authMethod === "privateKey" && config.privateKey) {
          sshConfig.privateKey = config.privateKey;
        }
        client.connect(sshConfig);
      });
    } catch (err: any) {
      return { success: false, error: err.message || String(err) };
    }
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
      if (config.authMethod === "privateKey" && config.privateKey) {
        sshConfig.privateKey = config.privateKey;
      }
      client.connect(sshConfig);
    });
  }

  private async save(connections: RemoteConnection[]): Promise<void> {
    await this.settingsStorage.updateSettings(SETTINGS_GROUP, {
      [SETTINGS_KEY]: connections,
    });
  }
}
