/**
 * MCP 工具名的公共约定与冲突检测。
 *
 * 模型可见的工具名刻意**不含服务器命名空间**（`mcp__<rawName>`），以保持名字简短；
 * 代价是不同服务器暴露同名工具时会重名，而重复的 function 会让发给供应商的 tools
 * 数组非法（整轮请求被拒）。因此重名在两处处理：
 * - 添加服务器时：直接报错，不落盘（见 McpServerService.createServer）
 * - 注册工具包时：确定性地只保留一个并记 error（见 McpPlugin.onLoad）
 */

/** 模型可见的 MCP 工具名前缀 */
export const MCP_TOOL_PREFIX = "mcp__";

/** 原始工具名 → 模型可见的工具名 */
export function toPublicToolName(rawToolName: string): string {
  return `${MCP_TOOL_PREFIX}${rawToolName}`;
}

/** 冲突检测所需的最小服务器形状 */
export interface McpServerToolsLike {
  id: string;
  name?: string | null;
  /** ISO 时间串，用于判定同名工具的归属 */
  createdAt?: string;
  tools?: Record<string, any> | null;
}

export interface ToolNameConflict {
  /** 模型可见的工具名 */
  tool: string;
  /** 已占用该名字的服务器 id */
  ownerServerId: string;
}

/**
 * 找出 `selfTools` 中已被 `otherServers` 占用的工具名。
 * @param selfTools 待检查的工具表（原始工具名 → schema）
 * @param otherServers 其它服务器（应已排除自己）
 */
export function findToolNameConflicts(
  selfTools: Record<string, any> | null | undefined,
  otherServers: McpServerToolsLike[],
): ToolNameConflict[] {
  if (!selfTools) return [];
  const conflicts: ToolNameConflict[] = [];
  for (const raw of Object.keys(selfTools)) {
    const owner = otherServers.find(
      (s) => s.tools && Object.prototype.hasOwnProperty.call(s.tools, raw),
    );
    if (owner) {
      conflicts.push({ tool: toPublicToolName(raw), ownerServerId: owner.id });
    }
  }
  return conflicts;
}

/**
 * 逐个工具名判定归属：**创建更早的服务器拥有**。
 *
 * 显式比较 `createdAt` 而不是依赖入参顺序——`listEnabled()` 是给界面看的
 * createdAt 降序，不该顺带决定工具归属。让更早的拥有，可以避免"新加/新启用一个
 * 服务器就静默打断已有工具"。
 *
 * @returns 模型可见工具名 → 拥有它的服务器 id
 */
export function resolveToolOwners(
  servers: McpServerToolsLike[],
): Map<string, string> {
  const ownerOf = new Map<string, { serverId: string; createdAt: string }>();
  for (const server of servers) {
    if (!server.tools) continue;
    const createdAt = server.createdAt ?? "";
    for (const raw of Object.keys(server.tools)) {
      const publicName = toPublicToolName(raw);
      const prev = ownerOf.get(publicName);
      if (!prev || createdAt < prev.createdAt) {
        ownerOf.set(publicName, { serverId: server.id, createdAt });
      }
    }
  }
  return new Map(
    Array.from(ownerOf, ([name, v]) => [name, v.serverId] as const),
  );
}
