import { PluginAgentDef } from "../types/plugin.types";
import { PluginAgentRegistration } from "./plugin-agent.registry";

/**
 * 插件智能体能力合成（v4）
 *
 * 把 PluginAgentDef 合成为一份等效 AGENT.md settings（下游链路零改动）：
 * - systemPrompt：插件提供的正文（回填到 settings.systemPrompt，
 *   与 agent-file.mapper 的「正文即提示词」约定一致）
 * - plugins：工具包门控。__default 保持 true（不误伤 file/shell 等基础
 *   内建能力包——它们是 core 分类非 essential，白名单模式会把它们也拒掉），
 *   仅显式收口三类系统自治理包与 owner 插件条目：
 *   - skill / mcp / sub_agent 未列入 toolkits → deny_all（隔离不外溢）
 *   - owner 插件条目 = allow 白名单（列声明的包）
 * - skills：技能偏好白名单（settings.skills，skill.plugin.ts 消费）
 * - agents：子代理白名单恒 `{ __default: false }`（插件智能体不可派生子代理）
 *
 * 会话级覆盖由 JsonlSessionContext.buildEffectiveSettings 的 pluginId 锁定兜住，
 * 这里产出的值就是最终生效面。
 */

/** 收口为 deny_all 的系统自治理插件（工具包 id 见各插件注册） */
const SELF_GOVERNED_SYSTEM_PLUGINS = ["skill", "mcp", "sub_agent"] as const;

/** owner 插件条目里 skill/mcp/sub_agent 各自的工具包 id */
const SELF_GOVERNED_KIT_BY_PLUGIN: Record<string, string> = {
  skill: "skill",
  sub_agent: "subagent",
  // mcp 的工具包是动态的（每 server 一个 mcp_<serverId>），用 deny_all 收口
};

export function composePluginAgentSettings(
  registration: PluginAgentRegistration,
): Record<string, any> {
  const { def, pluginId, agentId } = registration;
  const settings: Record<string, any> = { ...(def.settings || {}) };

  // 提示词正文 → settings.systemPrompt（虚拟 AGENT.md body 等效形态）
  if (def.systemPrompt && def.systemPrompt.trim()) {
    settings.systemPrompt = def.systemPrompt;
  }

  // ── 工具包门控 ──
  // 跨插件引用（"pluginId:kitId"）与插件内引用（"kitId"）→ 归一为插件分组
  const kitsByPlugin = new Map<string, string[]>();
  for (const raw of def.toolkits ?? []) {
    const parsed = parseKitRef(raw, pluginId);
    if (!parsed) continue;
    const list = kitsByPlugin.get(parsed.pluginId) || [];
    if (!list.includes(parsed.kitId)) list.push(parsed.kitId);
    kitsByPlugin.set(parsed.pluginId, list);
  }

  const plugins: Record<string, any> = {};
  // 系统自治理包：未显式列入 → 整体关闭（不外溢到其他系统的能力面）
  for (const p of SELF_GOVERNED_SYSTEM_PLUGINS) {
    const allowedKits = kitsByPlugin.get(p) || [];
    const kitId = SELF_GOVERNED_KIT_BY_PLUGIN[p];
    if (kitId && allowedKits.includes(kitId)) {
      plugins[p] = { toolkits_filter: "allow", toolkits_allow: [kitId] };
    } else if (p === "mcp" && allowedKits.length > 0) {
      // mcp_<serverId> 动态包：显式列入才放行
      plugins[p] = { toolkits_filter: "allow", toolkits_allow: allowedKits };
    } else {
      plugins[p] = { toolkits_filter: "deny_all" };
    }
  }
  // owner 插件（及跨插件引用的其他插件）：allow 白名单
  for (const [ownerPlugin, kitIds] of kitsByPlugin) {
    if ((SELF_GOVERNED_SYSTEM_PLUGINS as readonly string[]).includes(ownerPlugin)) {
      continue; // 上面已处理
    }
    plugins[ownerPlugin] = {
      toolkits_filter: "allow",
      toolkits_allow: kitIds,
    };
  }
  settings.plugins = plugins;

  // ── 技能白名单 ──
  const requestedSkills = def.skills ?? [];
  settings.skills = {
    __default: false,
    ...Object.fromEntries(requestedSkills.map((s) => [s, true])),
  };

  // ── 子代理白名单 ──
  // 缺省不可派生子代理（{__default:false}）；`def.agents` 声明的执行角色逐项放行。
  // 不在此处做存在性校验：插件启用顺序不定（被引用方可能尚未加载），
  // 多一个不存在的 id 只会让它不在清单里、模型也不会派，无害。
  const agentRefs = normalizeAgentRefs(registration);
  settings.agents = {
    __default: false,
    ...Object.fromEntries(agentRefs.map((id) => [id, true])),
  };

  // 标记来源（调试与会话锁定识别）
  settings.__pluginAgent = agentId;

  return settings;
}

/**
 * 插件智能体头像的规范相对形式。
 *
 * 返回 `plugins/<pluginId>/assets/<file>`（UrlService.toResourceAbsoluteUrl
 * 据此转成 /api/v1/plugins/<pluginId>/assets/<file>）；http(s) URL 原样直通；
 * null = 无头像（列表回退首字母头像）。
 *
 * 刻意存相对形态而非完整 URL：agents 列表（AgentService.withAbsoluteAvatar）
 * 与会话水合（session.service）都会对 avatarUrl 再走一次 toResourceAbsoluteUrl，
 * 完整 API URL 会被误判为 uploads 兜底分支二次改写。
 */
export function composePluginAgentAvatarUrl(
  registration: PluginAgentRegistration,
): string | null {
  const avatar = registration.def.avatar;
  if (!avatar) return null;
  if (/^https?:\/\//i.test(avatar)) return avatar;
  return `plugins/${registration.pluginId}/assets/${String(avatar).replace(/^\/+/, "")}`;
}

/** 类型重导出（供 store 组装虚拟视图用） */
export type { PluginAgentDef };

// ── 用户覆盖层（v4.1：部分可编辑）──

/** 归一化的锁定工具包引用 */
export interface LockedKitRef {
  pluginId: string;
  kitId: string;
}

/** 用户覆盖定义（AgentService.updateAgent 提交；经字段白名单后落盘） */
export interface PluginAgentOverride {
  name?: string;
  description?: string | null;
  modelId?: string | null;
  settings?: Record<string, any>;
}

/**
 * 解析单个工具包引用：`"kitId"` 归 defaultPluginId，`"pluginId:kitId"` 跨插件。
 * 形态非法（空串、`":"`、`":kit"`、`"owner:"`）返回 null，调用方跳过。
 */
function parseKitRef(ref: string, defaultPluginId: string): LockedKitRef | null {
  const trimmed = String(ref || "").trim();
  if (!trimmed) return null;
  const sep = trimmed.indexOf(":");
  if (sep < 0) {
    return { pluginId: defaultPluginId, kitId: trimmed };
  }
  if (sep === 0 || sep === trimmed.length - 1) return null; // ":kit" / "owner:" / ":"
  return {
    pluginId: trimmed.substring(0, sep),
    kitId: trimmed.substring(sep + 1),
  };
}

/**
 * 归一化 def.toolkits（flush 时已定格）为锁定引用视图。
 * 顺序即注册声明顺序；"kitId" 归 owner 插件，"pluginId:kitId" 跨插件。
 */
export function normalizeKitRefs(registration: PluginAgentRegistration): LockedKitRef[] {
  const refs: LockedKitRef[] = [];
  for (const raw of registration.def.toolkits ?? []) {
    const parsed = parseKitRef(raw, registration.pluginId);
    if (!parsed) continue;
    if (!refs.some((r) => r.pluginId === parsed.pluginId && r.kitId === parsed.kitId)) {
      refs.push(parsed);
    }
  }
  return refs;
}

/**
 * 归一化 def.agents（允许派生的执行角色）为完整 agentId 列表。
 *
 * - `"generic"` 原样
 * - `"roleId"` → `plugin-<pluginId>-<roleId>`
 * - `"pluginId:roleId"` → `plugin-<pluginId>-<roleId>`
 *
 * 顺序即声明顺序，按完整 id 去重。
 */
export function normalizeAgentRefs(registration: PluginAgentRegistration): string[] {
  const { def, pluginId } = registration;
  const out: string[] = [];
  for (const raw of def.agents ?? []) {
    const trimmed = String(raw || "").trim();
    if (!trimmed) continue;
    let id: string;
    if (trimmed === "generic") {
      id = "generic";
    } else {
      const sep = trimmed.indexOf(":");
      id =
        sep > 0
          ? `plugin-${trimmed.slice(0, sep)}-${trimmed.slice(sep + 1)}`
          : `plugin-${pluginId}-${trimmed}`;
    }
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

/** settings 中用户不可覆盖的键（提示词与内部标记，权威在插件代码） */
const LOCKED_SETTINGS_KEYS = new Set(["systemPrompt", "__pluginAgent"]);

/**
 * 合成最终虚拟视图 settings：插件声明 → 用户 override 合并 → 锁定重申。
 *
 * 语义（与 docs/plugin-agents.md 的细粒度表一致）：
 * - override.name/description/modelId 浅覆盖 def 侧
 * - override.settings 与合成 settings 浅合并，但 systemPrompt/__pluginAgent 不可覆盖
 * - 锁定重申（用户配置不可关掉插件绑定能力）：
 *   - owner 插件条目 toolkits_allow = override 允许的 ∪ 锁定包（allow 白名单下锁定包必在）
 *   - plugins.skill 门控：锁定技能存在 → 强制 allow（压过用户的 deny_all）
 *   - settings.skills：锁定技能强制 true（白名单模式下也保留）
 *   - mcp/sub_agent 门控：override 可自由调整（这两个系统包从不作为锁定面——
 *     def.toolkits 缺省只含 owner 插件的包）
 *
 * @param registration 插件智能体声明（registry 视图）
 * @param override     用户覆盖（无则为 null/undefined）
 * @returns 合并后的 AgentDefinition 字段补丁 { name?, description?, modelId?, settings }
 */
export function mergePluginAgentOverrides(
  registration: PluginAgentRegistration,
  override: PluginAgentOverride | null | undefined,
): {
  name: string;
  description: string | null;
  modelId: string | null;
  settings: Record<string, any>;
} {
  const { def } = registration;
  const base = composePluginAgentSettings(registration);

  const name = override?.name?.trim() || def.name;
  const description =
    override?.description !== undefined ? override.description : def.description ?? null;
  const modelId = override?.modelId !== undefined ? override.modelId : def.modelId ?? null;

  const mergedSettings: Record<string, any> = { ...base };
  const overrideSettings = override?.settings;
  if (overrideSettings && typeof overrideSettings === "object") {
    for (const [k, v] of Object.entries(overrideSettings)) {
      if (LOCKED_SETTINGS_KEYS.has(k)) continue;
      mergedSettings[k] = v;
    }
  }

  // ── 锁定重申 ──
  const lockedRefs = normalizeKitRefs(registration);
  const lockedSelfKits = lockedRefs
    .filter((r) => r.pluginId === registration.pluginId)
    .map((r) => r.kitId);
  const lockedCrossPlugins = new Map<string, string[]>();
  for (const r of lockedRefs) {
    if (r.pluginId === registration.pluginId) continue;
    const list = lockedCrossPlugins.get(r.pluginId) || [];
    if (!list.includes(r.kitId)) list.push(r.kitId);
    lockedCrossPlugins.set(r.pluginId, list);
  }

  const plugins: Record<string, any> = { ...(mergedSettings.plugins || {}) };
  // owner 插件条目：allow 并集锁定包（无条目则补 allow 条目）
  if (lockedSelfKits.length > 0) {
    const entry = plugins[registration.pluginId];
    const allowed = new Set<string>([
      ...(entry?.toolkits_allow || []),
      ...lockedSelfKits,
    ]);
    plugins[registration.pluginId] = {
      ...(entry || {}),
      toolkits_filter: "allow",
      toolkits_allow: Array.from(allowed),
    };
  }
  // 跨插件锁定的包：同样保证其插件条目 allow 含锁定包
  for (const [p, kits] of lockedCrossPlugins) {
    const entry = plugins[p];
    const allowed = new Set<string>([...(entry?.toolkits_allow || []), ...kits]);
    plugins[p] = {
      ...(entry || {}),
      toolkits_filter: "allow",
      toolkits_allow: Array.from(allowed),
    };
  }

  // 插件绑定的技能：settings.skills 强制 true + plugins.skill 门控强制 allow
  const lockedSkills = (def.skills ?? []).map((s) => String(s).toLowerCase());
  const userSkills = mergedSettings.skills;
  if (lockedSkills.length > 0) {
    mergedSettings.skills = {
      ...(userSkills && typeof userSkills === "object" ? userSkills : {}),
      ...Object.fromEntries(lockedSkills.map((s) => [s, true])),
    };
    const skillEntry = plugins.skill;
    if (skillEntry?.toolkits_filter === "deny_all") {
      plugins.skill = { ...skillEntry, toolkits_filter: "allow", toolkits_allow: ["skill"] };
    }
  }

  mergedSettings.plugins = plugins;

  // 插件声明的执行角色：settings.agents 强制 true（用户可增删未声明的项）。
  // 语义与「锁定工具包」一致：插件绑定的派活能力不应被用户误关掉。
  const lockedAgents = normalizeAgentRefs(registration);
  if (lockedAgents.length > 0) {
    const userAgents = mergedSettings.agents;
    mergedSettings.agents = {
      ...(userAgents && typeof userAgents === "object" ? userAgents : {}),
      ...Object.fromEntries(lockedAgents.map((id) => [id, true])),
    };
  }

  return { name, description, modelId, settings: mergedSettings };
}
