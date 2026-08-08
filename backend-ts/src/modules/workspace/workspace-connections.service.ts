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
    const factory = this.resolver.getAllFactories().find((f) => f.scheme === scheme);
    if (!factory) {
      return { success: false, error: `No provider for scheme: ${scheme}` };
    }
    const workspacePath = this.buildWorkspacePath(scheme, config);
    const uri = parseWorkspacePath(workspacePath);
    const provider = factory.create(uri);
    try {
      await provider.connect();
      // Test by stating the workspace path
      await provider.stat(uri.path);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message || String(err) };
    } finally {
      await provider.disconnect().catch(() => {});
    }
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
    const host = config.host || "";
    const port = config.port ? `:${config.port}` : "";
    const username = config.username ? `${config.username}@` : "";
    const pathPart = config.path || "/";
    return `${scheme}://${username}${host}${port}${pathPart}`;
  }

  private async save(connections: SavedConnection[]): Promise<void> {
    await this.settingsStorage.updateSettings(SETTINGS_GROUP, {
      [SETTINGS_KEY]: connections,
    });
  }
}
