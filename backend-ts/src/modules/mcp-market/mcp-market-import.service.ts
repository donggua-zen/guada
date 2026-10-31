/**
 * 市场导入链路：把市场条目写成本地 MCP 服务器 YAML。
 *
 * 三条硬规则（都是安全约束，不是风格偏好）：
 *
 * 1. **绝不 spawn**。导入不能走 McpServerService.createServer —— 后者会
 *    `fetchToolsForCreate()` 起子进程跑 `tools/list`，等于「用户点一下市场卡片，
 *    本机就执行一条远端给的命令」。这里只做静态校验后落盘，进程启动留给用户显式
 *    点「启用 / 测试连接」。
 *
 * 2. **强制 disabled**。即使前端传 `enabled: true` 也覆盖为 false。市场配置是不
 *    可信远端输入，用户必须先看清 command 是什么才允许它具备执行能力。
 *
 * 3. **去重靠 origin.itemId，不靠 name**。name 用户随时能改，改完就永久失准；
 *    itemId 是市场侧稳定主键。命中 origin 就原地更新（保留本地 id 与 name），
 *    没命中再按归一化 name 兜底，仍冲突则加后缀新建 —— 绝不覆盖用户手工配置。
 */
import { Injectable, Logger } from "@nestjs/common";
import { PluginManager } from "../plugins";
import {
  McpFileStore,
  McpServerOrigin,
  McpServerRow,
} from "../mcp-servers/mcp-file.store";
import { ImportableMcpServer } from "./mcp-config.extract";

export interface ImportResult {
  /** 新建的服务器 */
  imported: McpServerRow[];
  /** 命中 origin 后原地更新的服务器 */
  updated: McpServerRow[];
  /** 逐条失败原因（不中断其余条目） */
  errors: Array<{ name: string; message: string }>;
}

/** 名称归一化：用于「没有 origin 时的兜底匹配」 */
export function normalizeName(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_]+/g, "-");
}

/** 归一化后的名字是否已存在（排除指定 id） */
function nameTaken(
  servers: readonly McpServerRow[],
  name: string,
  excludeId?: string,
): boolean {
  const target = normalizeName(name);
  return servers.some(
    (s) => s.id !== excludeId && normalizeName(s.name) === target,
  );
}

/** 生成不冲突的名字：`name (2)` / `name (3)` … */
function uniqueName(servers: readonly McpServerRow[], base: string, excludeId?: string): string {
  if (!nameTaken(servers, base, excludeId)) return base;
  for (let i = 2; i <= 50; i += 1) {
    const candidate = `${base} (${i})`;
    if (!nameTaken(servers, candidate, excludeId)) return candidate;
  }
  return `${base} (${Date.now()})`;
}

/** 静态校验：只查字段形态，不连、不 spawn */
function validateServer(server: ImportableMcpServer): string[] {
  const errors: string[] = [];

  if (!server.name || !server.name.trim()) {
    errors.push("缺少服务器名称");
  }

  if (server.type === "stdio") {
    if (!server.command || !server.command.trim()) {
      errors.push("stdio 协议缺少 command");
    }
  } else {
    if (!server.url) {
      errors.push("HTTP 协议缺少 url");
    } else {
      try {
        const parsed = new URL(server.url);
        if (!/^https?:$/.test(parsed.protocol)) {
          errors.push(`url 协议不支持：${parsed.protocol}`);
        }
      } catch {
        errors.push("url 格式非法");
      }
    }
    if (server.headers) {
      for (const [key, value] of Object.entries(server.headers)) {
        if (typeof value !== "string") {
          errors.push(`header "${key}" 的值必须是字符串`);
        }
      }
    }
  }

  if (server.args && !Array.isArray(server.args)) {
    errors.push("args 必须是字符串数组");
  }
  if (server.env && typeof server.env !== "object") {
    errors.push("env 必须是对象");
  }

  return errors;
}

/** 把 ImportableMcpServer 摊平成 store 需要的字段 */
function toConfigFields(server: ImportableMcpServer, origin: McpServerOrigin) {
  return {
    name: server.name,
    type: server.type,
    description: null,
    url: server.type === "stdio" ? null : server.url ?? null,
    headers: server.type === "stdio" ? null : server.headers ?? null,
    command: server.type === "stdio" ? server.command ?? null : null,
    args: server.type === "stdio" ? server.args ?? null : null,
    env: server.type === "stdio" ? server.env ?? null : null,
    cwd: null,
    timeoutMs: null,
    // 硬编码：市场导入一律禁用
    enabled: false,
    origin,
  };
}

@Injectable()
export class McpMarketImportService {
  private readonly logger = new Logger(McpMarketImportService.name);

  constructor(
    private readonly mcpStore: McpFileStore,
    private readonly pluginManager: PluginManager,
  ) {}

  /**
   * 导入一组市场服务器。
   *
   * @param source 来源标识（skillhub_mcp / mcpworld）
   * @param itemId 市场条目稳定 id
   */
  async importServers(
    source: string,
    itemId: string,
    servers: ImportableMcpServer[],
  ): Promise<ImportResult> {
    await this.mcpStore.initialize();

    const result: ImportResult = { imported: [], updated: [], errors: [] };
    if (!Array.isArray(servers) || servers.length === 0) {
      result.errors.push({ name: itemId, message: "没有可导入的服务器配置" });
      return result;
    }

    const existing = this.mcpStore.list();

    for (const server of servers) {
      try {
        const errors = validateServer(server);
        if (errors.length > 0) {
          result.errors.push({
            name: server.name || itemId,
            message: errors.join("；"),
          });
          continue;
        }

        const origin: McpServerOrigin = {
          market: source,
          itemId,
          version: 1,
          importedAt: new Date().toISOString(),
          ...(server.needsConfiguration
            ? {
                needsConfiguration: true,
                configurationFields: server.configurationFields,
              }
            : {}),
        };

        // ① 命中同一条目 → 原地更新（保留本地 id）
        //
        // 注意：一个市场条目可能包含多个服务器（`mcpServers` 里有多个 key），
        // 所以 itemId 本身不是唯一键，必须配合服务器名。
        // 但「单条目单服务器」是最常见形态，且用户可能改过名字 —— 那种情况下
        // 只按 itemId 匹配，否则改名后重导会生成重复条目。
        const sameItem = existing.filter((s) => s.origin?.itemId === itemId);
        const target =
          sameItem.length === 1 && servers.length === 1
            ? sameItem[0]
            : sameItem.find((s) => normalizeName(s.name) === normalizeName(server.name));

        if (target) {
          const updated = await this.mcpStore.update(target.id, {
            ...toConfigFields(server, origin),
            name: target.name, // 保留用户可能改过的名字
          });
          if (updated) {
            result.updated.push(updated);
            replaceInList(existing, updated);
            continue;
          }
        }

        // ② 新建；名字冲突则加后缀。
        //
        // 刻意不做「同名即覆盖」的兜底：手工创建的服务器和市场监管上没有任何关联，
        // 按名字合并等于用一个市场条目静默改写用户的本地配置。宁可多一条 `(2)`，
        // 也不能动用户自己写的东西。
        const finalName = uniqueName(existing, server.name);
        const created = await this.mcpStore.create({
          ...toConfigFields({ ...server, name: finalName }, origin),
        });
        result.imported.push(created);
        existing.push(created);
      } catch (error: any) {
        result.errors.push({
          name: server.name || itemId,
          message: error?.message ?? String(error),
        });
      }
    }

    // 有新条目或配置变更 → 让插件层重建工具包索引
    if (result.imported.length > 0 || result.updated.length > 0) {
      try {
        await this.pluginManager.reloadPlugin("mcp");
      } catch (error: any) {
        // 插件重载失败不该让「已落盘的导入」变成失败
        this.logger.warn(`reloadPlugin('mcp') 失败：${error?.message ?? error}`);
      }
    }

    this.logger.log(
      `市场导入完成 source=${source} item=${itemId} 新建=${result.imported.length} 更新=${result.updated.length} 失败=${result.errors.length}`,
    );
    return result;
  }
}

/** 用更新后的行替换列表里的旧行（保持后续判重的准确性） */
function replaceInList(list: McpServerRow[], row: McpServerRow): void {
  const index = list.findIndex((s) => s.id === row.id);
  if (index >= 0) list[index] = row;
  else list.push(row);
}
