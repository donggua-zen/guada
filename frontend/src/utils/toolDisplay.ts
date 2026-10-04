import { ref, type Component } from "vue";
import {
  Wrench24Filled,
  Edit32Filled,
  Search16Filled,
  CalendarAgenda20Regular,
  BookSearch24Regular,
  Code24Regular,
  WindowWrench16Regular,
  TaskListSquareLtr20Regular,
  EyeTracking16Filled,
  Window16Regular,
  WindowConsole20Filled,
} from "@vicons/fluent";
import { t } from "@/locales";
import { parse as partialParse } from "partial-json";

export interface ToolCall {
  /** 工具调用 id（= 后端 toolCallId），与 toolCallsResponse[].toolCallId 对应。
   *  运行时一直存在，仅类型未声明；并行调用的结果按它匹配，不能用数组下标（到达顺序不保证） */
  id?: string;
  name?: string;
  /** 原始 JSON 参数字符串（流式期间可能半截）或已解析的参数对象 */
  arguments?: string | Record<string, unknown>;
  args?: string | Record<string, unknown>;
  outcome?: "success" | "error" | "rejected" | "aborted";
  metadata?: Record<string, unknown>;
  /** 子代理关联（由流事件 subagent_link 折叠写入）：工具结果落库前即可用，
   *  供工具行提供"打开子代理面板"入口 */
  subAgentLink?: { subSessionId: string; name?: string };
}

/** 定制渲染器配置（kind → 前端 tool-renderers 通用组件） */
export interface ToolRendererConfig {
  kind: "diff" | "content" | "terminal";
  /** 语义字段 → arguments 字段名映射 */
  fields: {
    file?: string;
    oldValue?: string;
    newValue?: string;
    content?: string;
    command?: string;
  };
}

/** 解析后的渲染器信息（getToolRenderer + getRendererArgs 的产物，供 ToolCustomView 分发） */
export interface ToolRendererInfo {
  kind: ToolRendererConfig["kind"];
  args: Record<string, string>;
  /** diff kind 的增删行数统计（折叠行徽章用） */
  stat?: { added: number; removed: number };
}

export interface ToolDisplayConfig {
  text: { executing: string; completed: string };
  /** 聚合展示文案，{n} 为数量占位符 */
  aggregate?: { executing: string; completed: string };
  argsKey?: string;
  /** 图标标识（TOOL_ICON_MAP 的 key） */
  icon?: string;
  /** 定制渲染器声明（后端插件 display.renderer 下发） */
  renderer?: ToolRendererConfig;
}

/**
 * 图标标识 → Vue 组件映射
 *
 * 插件通过 display.icon 声明字符串标识，前端在此映射为实际图标组件。
 * 纯前端渲染资源，不随语言包变化。
 */
export const TOOL_ICON_MAP: Record<string, Component> = {
  file: CalendarAgenda20Regular,
  read: CalendarAgenda20Regular,
  search: Search16Filled,
  edit: Edit32Filled,
  browser: WindowWrench16Regular,
  code: Code24Regular,
  window: Window16Regular,
  eye: EyeTracking16Filled,
  vision: EyeTracking16Filled,
  todo: TaskListSquareLtr20Regular,
  book: BookSearch24Regular,
  terminal: WindowConsole20Filled,
  console: WindowConsole20Filled,
  wrench: Wrench24Filled,
  time: Wrench24Filled,
  generic: Wrench24Filled,
  tool: Wrench24Filled,
};

export const DEFAULT_CONFIG: ToolDisplayConfig = {
  text: { executing: "", completed: "" },
  aggregate: { executing: "", completed: "" },
  icon: "wrench",
};

/** 获取带 i18n 翻译的默认工具展示配置 */
function getDefaultConfig(): ToolDisplayConfig {
  return {
    text: {
      executing: t("common.tool.calling"),
      completed: t("common.tool.called"),
    },
    aggregate: {
      executing: t("common.tool.executingSteps"),
      completed: t("common.tool.executedSteps"),
    },
    icon: "wrench",
  };
}

/**
 * 插件工具展示文案注册表
 *
 * 由后端 queryPlugins 返回，启动时加载。
 * key = 工具名, value = 后端已解析的最终文案（%key% 已替换为当前 locale 字符串）。
 */
const pluginToolDisplays = ref<Record<string, ToolDisplayConfig>>({});

/** 设置插件工具展示文案注册表 */
export function setPluginToolDisplays(
  displays: Record<string, ToolDisplayConfig>,
) {
  pluginToolDisplays.value = displays;
}

export function resolveToolName(tool: ToolCall): string {
  if (tool.name === "tool_use") {
    try {
      const parsed =
        typeof tool.arguments === "string"
          ? partialParse(tool.arguments)
          : tool.arguments;
      if (parsed?.tool_name) return parsed.tool_name;
    } catch {}
  }
  return tool.name || "";
}

export function getToolConfig(tool: ToolCall): ToolDisplayConfig {
  const name = resolveToolName(tool);
  const custom = pluginToolDisplays.value[name];
  if (!custom) return getDefaultConfig();
  // 防御性合并:插件注册的配置可能缺少 text/aggregate 等字段,补齐默认值避免渲染崩溃
  const defaults = getDefaultConfig();
  return {
    ...custom,
    text: {
      executing: custom.text?.executing ?? defaults.text.executing,
      completed: custom.text?.completed ?? defaults.text.completed,
    },
    aggregate: {
      executing: custom.aggregate?.executing ?? defaults.aggregate!.executing,
      completed: custom.aggregate?.completed ?? defaults.aggregate!.completed,
    },
  };
}

export function getToolIcon(tool: ToolCall): Component {
  const config = getToolConfig(tool);
  if (config.icon) {
    return TOOL_ICON_MAP[config.icon] || TOOL_ICON_MAP[DEFAULT_CONFIG.icon!];
  }
  return TOOL_ICON_MAP[DEFAULT_CONFIG.icon!];
}

export function formatArgSummary(value: unknown): string {
  if (typeof value !== "string") return String(value);
  return value.length > 60 ? value.substring(0, 260) : value;
}

export function getToolArgs(
  tool: ToolCall,
): string | Record<string, unknown> | undefined {
  if (tool.name === "tool_use") {
    try {
      const parsed =
        typeof tool.arguments === "string"
          ? partialParse(tool.arguments)
          : tool.arguments;
      if (parsed?.arguments) return parsed.arguments;
    } catch {}
  }
  return tool.arguments ?? tool.args;
}

export function getArgsText(tool: ToolCall): string | undefined {
  const params = getToolArgs(tool);
  if (!params) return undefined;

  let parsedParams = params;
  if (typeof params === "string") {
    try {
      parsedParams = partialParse(params);
    } catch {
      return undefined;
    }
  }

  if (!parsedParams || typeof parsedParams !== "object") return undefined;

  const config = getToolConfig(tool);
  const isKnownTool = resolveToolName(tool) in pluginToolDisplays.value;

  if (config.argsKey && parsedParams[config.argsKey]) {
    return formatArgSummary(parsedParams[config.argsKey]);
  }

  if (isKnownTool) return undefined;

  for (const value of Object.values(parsedParams)) {
    if (typeof value === "string" && value.length > 0) {
      return formatArgSummary(value);
    }
  }
  return undefined;
}

// ── 定制渲染器声明 ──

/** 各 kind 的语义字段默认映射（args 字段名，与内置工具 zod schema 对齐） */
const DEFAULT_RENDERER_FIELDS: Record<
  ToolRendererConfig["kind"],
  ToolRendererConfig["fields"]
> = {
  diff: { file: "file_path", oldValue: "old_text", newValue: "new_text" },
  content: { file: "file_path", content: "content" },
  terminal: { command: "command" },
};

/**
 * 内置渲染器映射（兜底）
 *
 * 后端未升级 / 历史会话（legacy remote_* 工具调用块）时仍按原样定制渲染。
 */
const BUILTIN_RENDERERS: Record<string, ToolRendererConfig> = {
  edit: { kind: "diff", fields: DEFAULT_RENDERER_FIELDS.diff },
  remote_edit: { kind: "diff", fields: DEFAULT_RENDERER_FIELDS.diff },
  write: { kind: "content", fields: DEFAULT_RENDERER_FIELDS.content },
  remote_write: { kind: "content", fields: DEFAULT_RENDERER_FIELDS.content },
  run_command: { kind: "terminal", fields: DEFAULT_RENDERER_FIELDS.terminal },
  remote_bash: { kind: "terminal", fields: DEFAULT_RENDERER_FIELDS.terminal },
};

/** 校验并归一化后端下发的 renderer 声明（fields 缺省补默认映射） */
function normalizeRenderer(
  decl: ToolRendererConfig | null | undefined,
): ToolRendererConfig | null {
  if (!decl || typeof decl !== "object") return null;
  const kind: ToolRendererConfig["kind"] | undefined = decl.kind;
  if (kind !== "diff" && kind !== "content" && kind !== "terminal") {
    return null;
  }
  return {
    kind,
    fields: {
      ...DEFAULT_RENDERER_FIELDS[kind],
      ...(decl.fields && typeof decl.fields === "object" ? decl.fields : {}),
    },
  };
}

/**
 * 获取工具的定制渲染器配置。
 * 优先级：后端声明（display.renderer）> 内置映射；均无返回 null（走通用结果渲染）。
 */
export function getToolRenderer(tool: ToolCall): ToolRendererConfig | null {
  const name = resolveToolName(tool);
  const backendDecl = pluginToolDisplays.value[name]?.renderer;
  return normalizeRenderer(backendDecl) ?? BUILTIN_RENDERERS[name] ?? null;
}

/** 各 kind 至少要有一个语义字段可解析才值得定制渲染 */
const RENDERER_REQUIRED_KEYS: Record<
  ToolRendererConfig["kind"],
  string[]
> = {
  diff: ["oldValue", "newValue"],
  content: ["content"],
  terminal: ["command"],
};

/**
 * 从 arguments 中按 renderer.fields 提取语义字段（file/oldValue/newValue/content/command）。
 * arguments 为流式 JSON 分片，用 partial-json 容错解析；无有效字段返回 null。
 */
export function getRendererArgs(
  tool: ToolCall,
  renderer: ToolRendererConfig,
): Record<string, string> | null {
  const params = getToolArgs(tool);
  if (!params) return null;

  let parsed = params;
  if (typeof params === "string") {
    try {
      parsed = partialParse(params);
    } catch {
      return null;
    }
  }
  if (!parsed || typeof parsed !== "object") return null;

  const out: Record<string, string> = {};
  for (const [semantic, key] of Object.entries(renderer.fields)) {
    const value = (parsed as Record<string, unknown>)[key];
    if (typeof value === "string") out[semantic] = value;
  }
  const hasRequired = RENDERER_REQUIRED_KEYS[renderer.kind].some(
    (k) => typeof out[k] === "string",
  );
  return hasRequired ? out : null;
}

/** 展示项最小结构（与 messageUtils.DisplayItem 同构，避免反向类型依赖） */
export function countSteps(
  items: ReadonlyArray<{ type: string; toolCalls?: ReadonlyArray<unknown> }>,
): number {
  return items.reduce((sum, item) => {
    if (item.type === "tool" && item.toolCalls?.length) {
      return sum + item.toolCalls.length;
    }
    return sum + 1;
  }, 0);
}
