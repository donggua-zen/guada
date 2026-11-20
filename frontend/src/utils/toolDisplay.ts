import { ref, type Component } from "vue";
import {
  ToolGenericIcon,
  ToolReadIcon,
  ToolWriteIcon,
  ToolEditIcon,
  ToolSearchIcon,
  ToolTerminalIcon,
  ToolBrowserIcon,
  ToolComputerIcon,
  ToolVisionIcon,
  ToolTodoIcon,
  ToolBookIcon,
  ToolTimeIcon,
  ToolChatIcon,
  ToolCodeIcon,
  ToolWindowIcon,
} from "@/components/icons/toolIcons";
import { t } from "@/locales";
import { parse as partialParse } from "partial-json";
import { SUB_AGENT_SPAWN_TOOL } from "./subAgentTools";
import { WORKFLOW_RUN_TOOL } from "./workflowTools";
import { splitPathDisplay, type FilePathDisplay } from "./pathDisplay";

export interface ToolCall {
  /** 工具调用 id（= 后端 toolCallId），与 toolCallsResponse[].toolCallId 对应。
   *  运行时一直存在，仅类型未声明；并行调用的结果按它匹配，不能用数组下标（到达顺序不保证） */
  id?: string;
  name?: string;
  /** 原始 JSON 参数字符串（流式期间可能半截）或已解析的参数对象 */
  arguments?: string | Record<string, unknown>;
  args?: string | Record<string, unknown>;
  outcome?: 'success' | 'error' | 'rejected' | 'aborted' | 'skipped';
  metadata?: Record<string, unknown>;
  /** 子代理关联（由流事件 subagent_link 折叠写入）：工具结果落库前即可用，
   *  供工具行提供"打开子代理面板"入口 */
  subAgentLink?: { subSessionId: string; name?: string };
  /** 子代理终态（由流事件 subagent_status 折叠写入）：早于整批 tool_calls_response 到达 */
  subAgentStatus?: "completed" | "error";
  subAgentStopReason?: string;
  subAgentError?: string;
}

/** 定制渲染器配置（kind → 前端 tool-renderers 通用组件） */
export interface ToolRendererConfig {
  kind: "diff" | "content" | "terminal" | "plan";
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
  /**
   * 语义摘要字段名（如 run_command 的 description）：折叠行标题优先取它，
   * 比 argsKey（命令原文）更可读。展开详情仍由 renderer 从原文读取，不受影响。
   * 由后端 display.descriptionKey 下发。
   */
  descriptionKey?: string;
  /**
   * `argsKey` 指向**数组**时，项数后缀（如"个问题"）。
   * 由插件经 NLS 下发（%key%），前端渲染为「3 个问题」。
   */
  argsCountUnit?: string;
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
  file: ToolReadIcon,
  read: ToolReadIcon,
  write: ToolWriteIcon,
  search: ToolSearchIcon,
  edit: ToolEditIcon,
  browser: ToolBrowserIcon,
  computer: ToolComputerIcon,
  code: ToolCodeIcon,
  window: ToolWindowIcon,
  eye: ToolVisionIcon,
  vision: ToolVisionIcon,
  todo: ToolTodoIcon,
  book: ToolBookIcon,
  terminal: ToolTerminalIcon,
  console: ToolTerminalIcon,
  chat: ToolChatIcon,
  // 保留旧插件标识；未识别的工具也统一回退到星芒。
  wrench: ToolGenericIcon,
  time: ToolTimeIcon,
  generic: ToolGenericIcon,
  tool: ToolGenericIcon,
};

export const DEFAULT_CONFIG: ToolDisplayConfig = {
  text: { executing: "", completed: "" },
  aggregate: { executing: "", completed: "" },
  icon: "wrench",
};

/**
 * 获取带 i18n 翻译的默认工具展示配置（后端没给文案的工具走这里）
 *
 * 有工具名时文案带上工具名本身：注册表里没有它的工具（如 MCP 插件注册的 mcp__*，
 * 后端压根没声明 display）如果只说「已调用工具」，用户看不出调的是哪个工具；
 * 显示原始名字（保留 mcp__ 前缀）与其它无文案工具统一，后续要改成专属措辞再动这里。
 */
function getDefaultConfig(tool?: ToolCall): ToolDisplayConfig {
  const name = tool ? resolveToolName(tool) : "";
  return {
    text: {
      executing: name
        ? t("common.tool.callingNamed", { name })
        : t("common.tool.calling"),
      completed: name
        ? t("common.tool.calledNamed", { name })
        : t("common.tool.called"),
    },
    aggregate: {
      // 保留 {n} 占位符：聚合标题由调用方按实际数量替换。
      // 直接 t(key) 会让 vue-i18n 把缺失的 n 插成空串（「正在执行个步骤」）。
      executing: t("common.tool.executingSteps", { n: "{n}" }),
      completed: t("common.tool.executedSteps", { n: "{n}" }),
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
  // 丢弃"空配置"条目：后端对没声明 display 的工具也会下发一条 `{}`（字段全 undefined，
  // 如 MCP 插件的 mcp__* 工具）。留着会被 getArgsText 当成"已知工具"，从而抑制参数摘要兜底；
  // 过滤后"后端没给文案"与"注册表里没有它"语义一致，两条链路表现相同。
  pluginToolDisplays.value = Object.fromEntries(
    Object.entries(displays).filter(
      ([, cfg]) =>
        cfg &&
        (cfg.text || cfg.aggregate || cfg.argsKey || cfg.icon || cfg.renderer),
    ),
  );
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
  if (!custom) return getDefaultConfig(tool);
  // 防御性合并:插件注册的配置可能缺少 text/aggregate 等字段,补齐默认值避免渲染崩溃
  // （缺 text 的工具同样降级到"带工具名"的默认文案）
  const defaults = getDefaultConfig(tool);
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

/**
 * 工具是否**声明了**带 {n} 占位符的聚合模板（插件 display.aggregate.executing）。
 *
 * 未声明时 getToolConfig 会兜底成通用「正在执行{n}个步骤」——那不是有意义的
 * 聚合文案（如 job_read 的「正在读取作业输出」更具体）。调用方据此决定
 * 单个执行中工具是走聚合文案还是工具自己的动作文案。
 */
export function hasToolAggregate(tool: ToolCall): boolean {
  const template = pluginToolDisplays.value[resolveToolName(tool)]?.aggregate?.executing;
  return !!template?.includes("{n}");
}

export function getToolIcon(tool: ToolCall): Component {
  const config = getToolConfig(tool);
  if (config.icon) {
    return TOOL_ICON_MAP[config.icon] || TOOL_ICON_MAP[DEFAULT_CONFIG.icon!];
  }
  return TOOL_ICON_MAP[DEFAULT_CONFIG.icon!];
}

export function formatArgSummary(value: unknown): string {
  if (typeof value === "string") {
    return value.length > 60 ? value.substring(0, 260) : value;
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  // 数组/对象没有"一行摘要"的通用表示 → 返回空串（调用方按 falsy 不渲染）。
  // 此前是 String(value)，数组会打出 "[object Object],[object Object]"。
  return "";
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

/** 参数摘要的展示形态：纯文本，或拆成「文件名 + 目录」的文件路径 */
export interface ArgsDisplay {
  /** 通用一行摘要（数组计数 / pattern / 未知工具兜底等） */
  text?: string;
  /** argsKey 指向 file_path 时的路径拆分结果 */
  file?: FilePathDisplay;
}

/**
 * 从流式 JSON 原文中提取顶层字符串字段（只扫描目标字段，不解析整段）。
 *
 * 写入类工具的参数里带着整份文件内容，折叠行只需要 file_path；
 * 为显示文件名去 partial-json 全部 content，会让流式成本随已收内容平方增长。
 *
 * 字符串内部的引号必然转义，因此未转义的 `"key"` 只可能出现在键的位置，
 * content 里即使出现同样的文字也不会误匹配。值仍在传输中（无闭合引号）时
 * 返回 undefined，由调用方回退完整解析。
 */
export function extractStringFieldFromJsonText(
  raw: string,
  key: string,
): string | undefined {
  const needle = `"${key}"`;
  let from = 0;
  while (from < raw.length) {
    const keyIndex = raw.indexOf(needle, from);
    if (keyIndex === -1) return undefined;

    let i = keyIndex + needle.length;
    while (i < raw.length && isJsonWhitespace(raw.charCodeAt(i))) i++;
    if (raw[i] !== ":") {
      from = keyIndex + needle.length;
      continue;
    }
    i++;
    while (i < raw.length && isJsonWhitespace(raw.charCodeAt(i))) i++;
    if (raw[i] !== '"') return undefined;

    const valueStart = i;
    i++;
    while (i < raw.length) {
      const code = raw.charCodeAt(i);
      if (code === 92 /* \ */) {
        i += 2;
        continue;
      }
      if (code === 34 /* " */) {
        try {
          return JSON.parse(raw.slice(valueStart, i + 1)) as string;
        } catch {
          return undefined;
        }
      }
      i++;
    }
    return undefined;
  }
  return undefined;
}

function isJsonWhitespace(code: number): boolean {
  return code === 32 || code === 9 || code === 10 || code === 13;
}

/**
 * 参数摘要的结构化版本：文件类工具（argsKey = "file_path"）拆成
 * 文件名 + 目录两段（ZCode 同款交互），其余场景与 getArgsText 一致。
 */
/**
 * 从参数里读取语义摘要（模型现写的 description）。
 * 字符串形态走定点扫描，避免流式期间为一行标题对超长 command 做全量 partialParse。
 */
function readDescriptionSummary(
  params: string | Record<string, unknown>,
  key: string | undefined,
): string | undefined {
  if (!key) return undefined;
  const value =
    typeof params === "string"
      ? extractStringFieldFromJsonText(params, key)
      : params[key];
  if (typeof value !== "string" || !value.trim()) return undefined;
  return formatArgSummary(value);
}

export function getArgsDisplay(tool: ToolCall): ArgsDisplay | undefined {
  const params = getToolArgs(tool);
  if (!params) return undefined;

  const config = getToolConfig(tool);

  // 语义摘要优先（流式快速通道）：description 字段一旦流出就先显示，
  // 不必等整段参数 partialParse（command 可能很长）。
  if (typeof params === "string" && config.descriptionKey) {
    const summary = readDescriptionSummary(params, config.descriptionKey);
    if (summary) return { text: summary };
  }

  // 文件路径快速通道：缓存/流式参数里跟着整份文件内容时，
  // 只为行头文件名做一次全量 partialParse 不值得。
  if (typeof params === "string" && config.argsKey === "file_path") {
    const filePath = extractStringFieldFromJsonText(params, "file_path");
    if (filePath !== undefined) {
      if (!filePath.trim()) return undefined;
      const file = splitPathDisplay(filePath);
      return file ? { file } : undefined;
    }
    // 未命中（半截 JSON / 字段还没流出来）→ 回退完整解析
  }

  let parsedParams = params;
  if (typeof params === "string") {
    try {
      parsedParams = partialParse(params);
    } catch {
      return undefined;
    }
  }

  if (!parsedParams || typeof parsedParams !== "object") return undefined;

  const isKnownTool = resolveToolName(tool) in pluginToolDisplays.value;

  // 语义摘要优先：模型现写的 description 比 argsKey（命令原文）更适合当折叠行标题。
  // 取不到（模型没写 / 字段还没流出来）时自然回退到下面的 argsKey 逻辑。
  if (config.descriptionKey) {
    const summary = readDescriptionSummary(parsedParams, config.descriptionKey);
    if (summary) return { text: summary };
  }

  if (config.argsKey) {
    const value = parsedParams[config.argsKey];
    // 数组型参数（如 ask_user 的 questions）：渲染「项数 + 单位」，单位由插件 NLS 下发
    //（argsCountUnit）。用于"已询问用户 3 个问题"这类只报数量的行。
    if (Array.isArray(value)) {
      const unit = config.argsCountUnit ? ` ${config.argsCountUnit}` : "";
      return { text: `${value.length}${unit}` };
    }
    // 文件路径：拆成「文件名 + 目录」两段展示（行头布局由组件负责）。
    // file_path 声明即视为路径语义：空值不回落标量分支（否则会出 { text: "" } 空摘要）。
    if (config.argsKey === "file_path" && typeof value === "string") {
      if (!value.trim()) return undefined;
      const file = splitPathDisplay(value);
      return file ? { file } : undefined;
    }
    // argsKey 约定指向**标量**字段（file_path / pattern / action / q / plan …）；
    // 对象等非标量没有一行摘要的通用表示 → 不显示，绝不 String(value) 打出 [object Object]
    if (typeof value === "string" || typeof value === "number") {
      return { text: formatArgSummary(value) };
    }
  }

  if (isKnownTool) return undefined;

  for (const value of Object.values(parsedParams)) {
    if (typeof value === "string" && value.length > 0) {
      return { text: formatArgSummary(value) };
    }
  }
  return undefined;
}

export function getArgsText(tool: ToolCall): string | undefined {
  const display = getArgsDisplay(tool);
  if (!display) return undefined;
  if (display.text) return display.text;
  if (display.file) return display.file.fullPath;
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
  // ExitPlanMode 的计划正文：流式期间半截 JSON 也能提取，首段即渲染（对齐 ZCode）
  plan: { content: "plan" },
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
  // 计划提交：正文边流边渲染（不必等整份计划输出完才可见）
  ExitPlanMode: { kind: "plan", fields: DEFAULT_RENDERER_FIELDS.plan },
};

/** 校验并归一化后端下发的 renderer 声明（fields 缺省补默认映射） */
function normalizeRenderer(
  decl: ToolRendererConfig | null | undefined,
): ToolRendererConfig | null {
  if (!decl || typeof decl !== "object") return null;
  const kind: ToolRendererConfig["kind"] | undefined = decl.kind;
  if (kind !== "diff" && kind !== "content" && kind !== "terminal" && kind !== "plan") {
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

/**
 * 独立成块的 renderer kind：命中时该工具不并入「中间处理过程」分组，
 * 单独成组、不可折叠、直接渲染（分组消费方见 messageUtils.doGrouping）。
 *
 * plan：计划正文是待审阅的产物，折进"已执行 N 个步骤"标题后默认不可见，
 * 行级"默认展开"救不了被折叠的分组整体。后续若有同类产物（如问答卡），加进集合即可。
 */
const STANDALONE_RENDERER_KINDS: ReadonlySet<ToolRendererConfig["kind"]> = new Set(["plan"]);

/**
 * TODO 内置工具名（`todo`）。
 *
 * 放在 toolDisplay 而不是 todoTools：standalone 集合需要它，而 todoTools 的
 * 参数解析需要 toolDisplay 的 getToolArgs——反向导入会形成循环。
 * TODO 卡片组件从 todoTools 重新导出取用。
 */
export const TODO_TOOL_NAME = "todo";

/**
 * 按工具名独立成块：无 renderer、但要求整行独立渲染的工具。
 *
 * 与 kind 集合的分工：kind 集合给「以 renderer 定制卡面承载正文」的工具（plan）；
 * 名集合给「行内容由专用组件承担、不走走 kind → ToolCustomView 管线」的工具——
 * 子代理派生行（SubAgentToolRow）、工作流运行卡（WorkflowRunInlineCard）与
 * 待办卡（TodoToolRow）。
 * 同一工具不需要两处登记。
 */
const STANDALONE_TOOL_NAMES: ReadonlySet<string> = new Set([
  SUB_AGENT_SPAWN_TOOL,
  WORKFLOW_RUN_TOOL,
  TODO_TOOL_NAME,
]);

/** kind 是否独立成块渲染（分组与行级默认展开共用同一集合） */
export function isStandaloneRendererKind(kind: ToolRendererConfig["kind"]): boolean {
  return STANDALONE_RENDERER_KINDS.has(kind);
}

/** 工具是否独立成块（按工具名或 renderer kind 判定，与行级判定同一来源） */
export function isStandaloneTool(tool: ToolCall): boolean {
  if (STANDALONE_TOOL_NAMES.has(resolveToolName(tool))) return true;
  const kind = getToolRenderer(tool)?.kind;
  return kind !== undefined && isStandaloneRendererKind(kind);
}

/** 独立卡片（计划卡）的终态徽标：批准 / 拒绝 / 中断 / 失败 */
export type PlanCardStatus = "approved" | "rejected" | "aborted" | "error";

/**
 * 计划卡终态：undefined = 仍在执行（卡片走流式提示，不出徽标）。
 *
 * 批准/拒绝优先看结果 meta.planApproved——后端 ExitPlanMode 明确写入，是权威口径；
 * 其余才回落到 outcome：aborted 是用户中断，error 是没有 meta 的真失败
 * （例如不在计划态时误调 ExitPlanMode）。
 */
export function resolvePlanCardStatus(
  outcome: ToolCall["outcome"],
  planApproved: boolean | undefined,
): PlanCardStatus | undefined {
  if (!outcome) return undefined;
  if (outcome === "aborted") return "aborted";
  if (planApproved === true) return "approved";
  if (planApproved === false || outcome === "rejected") return "rejected";
  return outcome === "error" ? "error" : undefined;
}

/** 各 kind 至少要有一个语义字段可解析才值得定制渲染 */
const RENDERER_REQUIRED_KEYS: Record<
  ToolRendererConfig["kind"],
  string[]
> = {
  diff: ["oldValue", "newValue"],
  content: ["content"],
  terminal: ["command"],
  plan: ["content"],
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
