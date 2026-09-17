/**
 * 智能体配置 `settings.plugins` 的解析与构建（纯函数）。
 *
 * 单独成模块的原因有二：
 * 1. 组件内逻辑无法单测，而这段逻辑的**往返等价性**是 MCP / Skills / 子代理智能体门控
 *    能否可靠工作的前提——保存一次丢条目就等于门控静默变化；
 * 2. 它必须镜像后端 `applyRoleLayer` 的条目语义，集中在一处才好对照。
 *
 * 两个批量姿态（`__strategy` / `__default`）只作用于通用工具包网格。
 * `mcp` / `skill` / `sub_agent` 由各自管理页写条目，不参与网格重建。
 */

/** 由各自管理页写入条目、不走通用工具包网格的插件 */
export const DEDICATED_PLUGIN_IDS = ['mcp', 'skill', 'sub_agent'] as const

/** 单个插件的智能体层条目（规范化形态） */
export interface RoleToolkitEntry {
  filter: 'deny' | 'allow'
  deny: string[]
  allow: string[]
}

export interface ParsedPluginConfig {
  /** `__strategy === 'deny_nonsystem'` */
  allDisabled: boolean
  /** `__default === false`：未显式配置的插件默认拒绝 */
  allowlistMode: boolean
  perPlugin: Record<string, RoleToolkitEntry>
}

/**
 * UI 渲染不到的已保存条目。
 * - `whole`：插件完全不在当前工具列表中（已删除 / 全局停用）→ 整条原样保留
 * - `partial`：插件在列表中但部分 id 渲染不到（工具包已删除改名）→ 按种类合并
 */
export interface UnrenderedRefs {
  whole: Record<string, RoleToolkitEntry>
  partial: Record<string, { deny: string[]; allow: string[] }>
}

export interface BuildPluginConfigInput {
  allDisabled: boolean
  allowlistMode: boolean
  /** 可渲染的工具包及其当前 UI 开关状态 */
  renderableKits: Record<string, Array<{ kitId: string; enabled: boolean }>>
  unrendered: UnrenderedRefs
  mcp: {
    allDisabled: boolean
    allowlistMode: boolean
    /** 不含 `mcp_` 前缀的服务器 id */
    deniedServers: string[]
    allowlistServers: string[]
  }
  allSkillsDisabled: boolean
  allAgentsDisabled: boolean
}

/** 解析 `settings.plugins` */
export function parsePluginConfig(raw: unknown): ParsedPluginConfig {
  const perPlugin: Record<string, RoleToolkitEntry> = {}
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { allDisabled: false, allowlistMode: false, perPlugin }
  }
  const cfg = raw as Record<string, any>
  for (const [pluginId, entry] of Object.entries(cfg)) {
    if (pluginId.startsWith('__')) continue
    if (typeof entry !== 'object' || entry === null) continue

    const filter = entry.toolkits_filter
    const deny = Array.isArray(entry.toolkits_deny) ? [...entry.toolkits_deny] : []
    const allow = Array.isArray(entry.toolkits_allow) ? [...entry.toolkits_allow] : []

    // 只接受真正的工具包条目：显式 filter，或非空列表。
    // 遗留的插件级开关（{ enabled: false } / 裸布尔）既无 filter 也无列表 → 忽略，
    // 既不参与裁决也不在保存时被改写成别的形状。
    if (filter !== 'allow' && filter !== 'deny' && !deny.length && !allow.length) {
      continue
    }

    perPlugin[pluginId] = {
      filter: filter === 'allow' ? 'allow' : 'deny',
      deny,
      allow,
    }
  }
  return {
    allDisabled: cfg.__strategy === 'deny_nonsystem',
    allowlistMode: cfg.__default === false,
    perPlugin,
  }
}

/**
 * 某工具包的生效状态——镜像后端 `applyRoleLayer` 的条目分支。
 *
 * 注意这与 `tk.enabled` 不同：`tk.enabled` 来自用「当前 UI 状态」构造的查询，
 * 首屏为空时它只是插件默认值，用它当默认来源会形成循环依赖。
 */
export function effectiveKitEnabled(
  parsed: ParsedPluginConfig,
  pluginId: string,
  kitId: string,
): boolean {
  const entry = parsed.perPlugin[pluginId]
  // 无条目 → 由 __default 决定（黑名单默认放行，白名单默认拒绝）
  if (!entry) return !parsed.allowlistMode
  return entry.filter === 'allow'
    ? entry.allow.includes(kitId)
    : !entry.deny.includes(kitId)
}

/** 把已保存条目切成「渲染不到需透传」的部分 */
export function splitUnrendered(
  parsed: ParsedPluginConfig,
  renderableKitsByPlugin: Record<string, string[]>,
): UnrenderedRefs {
  const whole: Record<string, RoleToolkitEntry> = {}
  const partial: Record<string, { deny: string[]; allow: string[] }> = {}

  for (const [pluginId, entry] of Object.entries(parsed.perPlugin)) {
    if ((DEDICATED_PLUGIN_IDS as readonly string[]).includes(pluginId)) continue

    const renderable = renderableKitsByPlugin[pluginId]
    if (!renderable || renderable.length === 0) {
      whole[pluginId] = {
        filter: entry.filter,
        deny: [...entry.deny],
        allow: [...entry.allow],
      }
      continue
    }

    const set = new Set(renderable)
    const deny = entry.deny.filter((id) => !set.has(id))
    const allow = entry.allow.filter((id) => !set.has(id))
    if (deny.length || allow.length) partial[pluginId] = { deny, allow }
  }

  return { whole, partial }
}

/** 组装最终的 `settings.plugins` */
export function buildPluginConfig(
  input: BuildPluginConfigInput,
): Record<string, unknown> {
  const result: Record<string, unknown> = {}

  // 1) 通用工具包网格：可渲染工具包按当前模式重建。
  //    反种类的失效 id 可以安全丢弃——黑名单下"允许"等于模式默认，白名单下"拒绝"亦然。
  for (const [pluginId, kits] of Object.entries(input.renderableKits)) {
    if ((DEDICATED_PLUGIN_IDS as readonly string[]).includes(pluginId)) continue
    const partial = input.unrendered.partial[pluginId]

    if (input.allowlistMode) {
      const allow = kits.filter((k) => k.enabled).map((k) => k.kitId)
      if (partial) allow.push(...partial.allow)
      if (allow.length) {
        result[pluginId] = { toolkits_filter: 'allow', toolkits_allow: allow }
      }
    } else {
      const deny = kits.filter((k) => !k.enabled).map((k) => k.kitId)
      if (partial) deny.push(...partial.deny)
      if (deny.length) result[pluginId] = { toolkits_deny: deny }
    }
  }

  // 2) 完全渲染不到的插件：整条原样保留（不能丢，否则等于静默改变门控）
  for (const [pluginId, entry] of Object.entries(input.unrendered.whole)) {
    if (pluginId in result) continue
    result[pluginId] =
      entry.filter === 'allow'
        ? {
            toolkits_filter: 'allow',
            ...(entry.allow.length ? { toolkits_allow: entry.allow } : {}),
          }
        : { toolkits_deny: entry.deny }
  }

  // 3) MCP：三态显式，永远写条目。
  //    `deny_all` 压过列表但**不改动**它们——这就是"关掉整个能力包、配置原样保留"；
  //    模式（白名单/黑名单）靠"哪个列表键存在"记住，因为 toolkits_filter 被 deny_all 占用了。
  const mcpAllow = input.mcp.allowlistServers.map((id) => `mcp_${id}`);
  const mcpDeny = input.mcp.deniedServers.map((id) => `mcp_${id}`);
  if (input.mcp.allDisabled) {
    result.mcp = input.mcp.allowlistMode
      ? { toolkits_filter: 'deny_all', toolkits_allow: mcpAllow }
      : { toolkits_filter: 'deny_all', toolkits_deny: mcpDeny };
  } else if (input.mcp.allowlistMode) {
    // 白名单即使列表为空也显式写键：键的存在本身就是"白名单模式"的标记
    result.mcp = { toolkits_filter: 'allow', toolkits_allow: mcpAllow };
  } else {
    result.mcp = { toolkits_deny: mcpDeny };
  }

  // 4) Skills / 子代理：固定白名单语义（禁用 = 空允许列表）
  result.skill = input.allSkillsDisabled
    ? { toolkits_filter: 'allow' }
    : { toolkits_filter: 'allow', toolkits_allow: ['skill'] }
  result.sub_agent = input.allAgentsDisabled
    ? { toolkits_filter: 'allow' }
    : { toolkits_filter: 'allow', toolkits_allow: ['subagent'] }

  // 5) 顶层姿态
  const out: Record<string, unknown> = {
    __strategy: input.allDisabled ? 'deny_nonsystem' : 'custom',
  }
  if (input.allowlistMode) out.__default = false
  return { ...out, ...result }
}

// ── 各管理页的条目解析（与上面同源，集中在此以便单测）──

const stripMcpPrefix = (id: unknown) => String(id).replace(/^mcp_/, '')

export interface McpGateState {
  allDisabled: boolean
  allowlistMode: boolean
  deniedServers: string[]
  allowlistServers: string[]
}

/**
 * 解析 MCP 管理页的三态。
 *
 * `deny_all` 表示当前全部禁用（压过列表），两个列表原样保留供解除时恢复；
 * 因此模式不能再从 `toolkits_filter` 读，改由**哪个列表键存在**判定：
 * 有 `toolkits_allow` 键即白名单模式（白名单即使空列表也会显式写这个键）。
 *
 * 兼容旧写法：`{ toolkits_filter: 'allow' }`（无 allow 键）在旧版本里同时表示
 * "全部禁用"与"白名单+空列表"，这里按前者解读，避免升级后"全部禁用"开关莫名显示为开。
 */
export function parseMcpGate(raw: unknown): McpGateState {
  const cfg = (raw as any)?.mcp;
  const rawFilter = cfg?.toolkits_filter;
  const hasAllowKey =
    !!cfg && Object.prototype.hasOwnProperty.call(cfg, 'toolkits_allow');

  const allDisabled =
    rawFilter === 'deny_all' || (rawFilter === 'allow' && !hasAllowKey);

  return {
    allDisabled,
    allowlistMode: hasAllowKey || rawFilter === 'allow',
    deniedServers: Array.isArray(cfg?.toolkits_deny)
      ? cfg.toolkits_deny.map(stripMcpPrefix)
      : [],
    allowlistServers: Array.isArray(cfg?.toolkits_allow)
      ? cfg.toolkits_allow.map(stripMcpPrefix)
      : [],
  };
}

/** Skills 管理页：能力包是否整体被禁用（禁用 = allow 过滤 + 空允许列表） */
export function parseAllSkillsDisabled(raw: unknown): boolean {
  const cfg = (raw as any)?.skill
  return cfg?.toolkits_filter === 'allow' && !(cfg?.toolkits_allow?.length > 0)
}

/** 子代理管理页：能力包是否未放行（固定白名单语义，未配置即视为禁用） */
export function parseAllAgentsDisabled(raw: unknown): boolean {
  const cfg = (raw as any)?.sub_agent
  return !(cfg?.toolkits_filter === 'allow' && cfg?.toolkits_allow?.includes('subagent'))
}
