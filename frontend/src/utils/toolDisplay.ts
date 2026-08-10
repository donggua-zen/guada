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
import Terminal from "@/components/icons/Terminal.vue";
import { t } from "@/locales";
import { parse as partialParse } from "partial-json";

export interface ToolCall {
  name?: string;
  arguments?: any;
  args?: any;
  outcome?: "success" | "error" | "rejected" | "aborted";
  metadata?: { [key: string]: any };
}

export interface InlineContentConfig {
  key: string;
  mode: "text" | "code";
  language?: string;
}

export interface ToolDisplayConfig {
  text: { executing: string; completed: string };
  /** 聚合展示文案，{n} 为数量占位符 */
  aggregate?: { executing: string; completed: string };
  argsKey?: string;
  /** 图标标识（TOOL_ICON_MAP 的 key） */
  icon?: string;
  inlineContent?: InlineContentConfig;
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
  return pluginToolDisplays.value[name] || getDefaultConfig();
}

export function getToolIcon(tool: ToolCall): Component {
  const config = getToolConfig(tool);
  if (config.icon) {
    return TOOL_ICON_MAP[config.icon] || TOOL_ICON_MAP[DEFAULT_CONFIG.icon!];
  }
  return TOOL_ICON_MAP[DEFAULT_CONFIG.icon!];
}

export function formatArgSummary(value: any): string {
  if (typeof value !== "string") return String(value);
  return value.length > 60 ? value.substring(0, 260) : value;
}

export function getToolArgs(tool: ToolCall): any {
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

export function getInlineContent(tool: ToolCall): string | undefined {
  const config = getToolConfig(tool);
  if (!config.inlineContent) return undefined;

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

  const value = parsedParams[config.inlineContent.key];
  if (typeof value !== "string" || value.length === 0) return undefined;

  return value;
}

export function countSteps(items: any[]): number {
  return items.reduce((sum, item) => {
    if (item.type === "tool" && item.toolCalls?.length) {
      return sum + item.toolCalls.length;
    }
    return sum + 1;
  }, 0);
}
