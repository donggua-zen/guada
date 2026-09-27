/**
 * 思考档位中立词表
 *
 * 规范档位 8 档，结构对齐 pi-ai 的 ModelThinkingLevel（DSH 词表），
 * 禁用档保留本项目历史拼写 `none`（pi-ai 为 `off`，YAML 加载时归一）。
 *
 * `on`（"思考模式"）是正典档位：表达"纯开关承载"的思考——开启但不指定
 * 强度。它只对**有真开关字段**的 thinkingFormat 有意义（deepseek/zai/qwen/
 * together 等，wire 上是 enable 侧字段）；openai/openrouter/ant-ling 这类
 * "关闭靠不发或发值"的格式配 on 菜单无法上 wire，由 catalog-lint 拦截。
 * 布尔开关模型声明 `[none, on]`，强制思考模型声明 `[on]`。
 */

/** 规范思考档位（升级/删减此联合类型时同步更新 THINKING_EFFORT_GATE） */
export type ThinkingEffort =
  | 'none'
  | 'on'
  | 'minimal'
  | 'low'
  | 'medium'
  | 'high'
  | 'xhigh'
  | 'max';

/** 全部可识别档位（= 规范档位；`on` 已入正典，别名仅保留 `off` 归一） */
export type AnyThinkingEffort = ThinkingEffort;

/**
 * 漂移门控（对齐 DSH THINKING_LEVEL_GATE 模式）：
 * 词表增删时此处编译报错，强制同步顺序表与派生类型。
 */
const THINKING_EFFORT_GATE: Record<ThinkingEffort, true> = {
  none: true,
  on: true,
  minimal: true,
  low: true,
  medium: true,
  high: true,
  xhigh: true,
  max: true,
};

/** 规范档位顺序表（升序排列，供 UI 菜单与合法值校验使用） */
export const THINKING_EFFORTS = Object.keys(
  THINKING_EFFORT_GATE,
) as ThinkingEffort[];

/** 全部档位（与规范档位同集；保留导出名兼容既有引用） */
export const ALL_THINKING_EFFORTS: readonly ThinkingEffort[] = [
  ...THINKING_EFFORTS,
];

/** 禁用档位（wire 语义：关闭思考） */
export const THINKING_EFFORT_NONE: ThinkingEffort = 'none';

/** 输入宽容归一：`off`（pi-ai 拼写）→ `none`；其余原样通过 */
export function normalizeThinkingEffort(
  value: string,
): ThinkingEffort | undefined {
  const lowered = value.toLowerCase();
  if (lowered === 'off') return 'none';
  return ALL_THINKING_EFFORTS.find((e) => e === lowered);
}

/**
 * 逐模型档位→wire 值映射（对齐 pi-ai thinkingLevelMap）。
 * 键为规范档位；值为 wire 侧字面量，null 表示该档不支持。
 * 完整语义与归一规则见文件下方 `ThinkingEffortMap` 的文档与 normalizeEffortMap。
 */

/**
 * thinkingFormat：开关字段的 wire 拼法（逐字对齐 DSH/pi-ai 的
 * `compat.thinkingFormat`，行为见 openai.adapter 的分派表）。
 *
 * 只编码「关闭/开启写到哪个字段」；强度值一律走 reasoning_effort（是否上
 * wire 由 supportsReasoningEffort 门控），档位命名差异一律由
 * thinkingEffortsMap 承担——三者正交。
 */
export type ThinkingFormat =
  | 'openai' // 默认：强度直传 reasoning_effort；关闭仅在映射给值时才发
  | 'deepseek' // thinking:{type:enabled|disabled} + 可选 reasoning_effort（DeepSeek/Moonshot K2）
  | 'zai' // thinking:{type:enabled, clear_thinking:false}（智谱；只认开关）
  | 'qwen' // enable_thinking: boolean + 可选 reasoning_effort（百炼/硅基/千帆）
  | 'openrouter' // 嵌套 reasoning:{effort}（关闭也是 effort 值）
  | 'together' // reasoning:{enabled} + 可选扁平 reasoning_effort
  | 'baseten' // chat_template_args + reasoning_effort
  | 'ant-ling' // 仅嵌套 reasoning:{effort}，无映射不发
  | 'string-thinking' // thinking: "<字符串>"（不是对象）
  | 'qwen-chat-template' // chat_template_kwargs:{enable_thinking, preserve_thinking}
  | 'chat-template'; // chat_template_kwargs: <声明值>

/** 漂移门控（对齐 DSH THINKING_FORMAT_GATE）：词汇增删在此编译报错 */
const THINKING_FORMAT_GATE: Record<ThinkingFormat, true> = {
  openai: true,
  deepseek: true,
  zai: true,
  qwen: true,
  openrouter: true,
  together: true,
  baseten: true,
  'ant-ling': true,
  'string-thinking': true,
  'qwen-chat-template': true,
  'chat-template': true,
};

/** thinkingFormat 全集（声明顺序 = 下拉呈现顺序，无语义） */
export const THINKING_FORMATS = Object.keys(
  THINKING_FORMAT_GATE,
) as ThinkingFormat[];

/**
 * legacy style 别名：旧的 `thinking.style` 三值归一到 format。
 * 语义等价（旧值是 format 的子集），保留只为读旧文件不炸。
 */
const LEGACY_STYLE_FORMAT_ALIASES: Record<string, ThinkingFormat> = {
  'reasoning-effort': 'openai',
  'thinking-toggle': 'deepseek',
  'enable-thinking': 'qwen',
};

/** 归一 thinkingFormat：未知值返回 undefined（回退默认 openai） */
export function normalizeThinkingFormat(
  value: unknown,
): ThinkingFormat | undefined {
  if (typeof value !== 'string') return undefined;
  return (
    THINKING_FORMATS.find((f) => f === value) ??
    LEGACY_STYLE_FORMAT_ALIASES[value]
  );
}

/**
 * format 级的 supportsReasoningEffort 默认（对齐 DSH detectCompat 的厂商默认：
 * grok/zai/moonshot/together/cloudflare/nvidia/ant-ling 不发强度值）。
 * 我们按 format 归类：纯开关型与"未知厂家"归 false，其余 true；实例/模型可覆盖。
 */
const FORMAT_SUPPORTS_REASONING_EFFORT: Record<ThinkingFormat, boolean> = {
  openai: true,
  deepseek: true,
  zai: false,
  qwen: true,
  openrouter: true,
  together: false,
  baseten: true,
  'ant-ling': false,
  'string-thinking': true,
  'qwen-chat-template': true,
  'chat-template': true,
};

/** 该 format 默认是否发送强度值 */
export function defaultSupportsReasoningEffort(format: ThinkingFormat): boolean {
  return FORMAT_SUPPORTS_REASONING_EFFORT[format];
}

/**
 * wire 兼容开关（对齐 DSH `compat` 块；provider 级与模型条目级均可声明，
 * 模型条目 > 实例 provider > 类型卡）。只收思考域开关，非思考 compat
 * （maxTokensField/supportsStore 等）不在此列。
 */
export interface ThinkingCompatConfig {
  /** 开关字段的 wire 拼法；缺省 = openai */
  thinkingFormat?: ThinkingFormat;
  /** 强度值是否上 wire；缺省 = 该 format 的默认 */
  supportsReasoningEffort?: boolean;
  /**
   * 助手消息必须携带 reasoning_content（缺则补空串）。
   * 对齐 DSH 的 requiresReasoningContentOnAssistantMessages（DeepSeek 系跨轮回传）。
   */
  requiresReasoningContentOnAssistantMessages?: boolean;
  /** baseten 的 chat_template_args（原样写入请求体） */
  chatTemplateArgs?: Record<string, unknown>;
  /** chat-template 的 chat_template_kwargs（原样写入请求体） */
  chatTemplateKwargs?: Record<string, unknown>;
  /**
   * Responses 协议是否请求 `include: ['reasoning.encrypted_content']`
   * （对齐 DSH 的无条件 include；默认关，OpenAI 官方系开启，第三方
   * responses 端点可能不认该字段）。
   */
  includeEncryptedReasoning?: boolean;
}

/** 合并后的生效 compat（resolveThinkingCompat 的输出） */
export interface ResolvedThinkingCompat extends ThinkingCompatConfig {
  /** 必填：合并链末端回退 openai */
  thinkingFormat: ThinkingFormat;
  /** 必填：合并链末端回退 format 默认 */
  supportsReasoningEffort: boolean;
}

/** 归一 compat 块（输入宽容）：未知 format / 非布尔开关丢弃；模板参数须为非空平面对象 */
export function parseThinkingCompat(
  raw: unknown,
): ThinkingCompatConfig | undefined {
  if (raw === null || raw === undefined || typeof raw !== 'object' || Array.isArray(raw)) {
    return undefined;
  }
  const src = raw as Record<string, unknown>;
  const thinkingFormat = normalizeThinkingFormat(src.thinkingFormat);
  const supportsReasoningEffort =
    typeof src.supportsReasoningEffort === 'boolean'
      ? src.supportsReasoningEffort
      : undefined;
  const requiresReasoningContentOnAssistantMessages =
    typeof src.requiresReasoningContentOnAssistantMessages === 'boolean'
      ? src.requiresReasoningContentOnAssistantMessages
      : undefined;
  const chatTemplateKwargs = parseTemplateValues(src.chatTemplateKwargs);
  const chatTemplateArgs = parseTemplateValues(src.chatTemplateArgs);
  const includeEncryptedReasoning =
    typeof src.includeEncryptedReasoning === 'boolean'
      ? src.includeEncryptedReasoning
      : undefined;
  if (
    thinkingFormat === undefined &&
    supportsReasoningEffort === undefined &&
    requiresReasoningContentOnAssistantMessages === undefined &&
    chatTemplateKwargs === undefined &&
    chatTemplateArgs === undefined &&
    includeEncryptedReasoning === undefined
  ) {
    return undefined;
  }
  return {
    ...(thinkingFormat !== undefined ? { thinkingFormat } : {}),
    ...(supportsReasoningEffort !== undefined
      ? { supportsReasoningEffort }
      : {}),
    ...(requiresReasoningContentOnAssistantMessages !== undefined
      ? { requiresReasoningContentOnAssistantMessages }
      : {}),
    ...(chatTemplateKwargs !== undefined ? { chatTemplateKwargs } : {}),
    ...(chatTemplateArgs !== undefined ? { chatTemplateArgs } : {}),
    ...(includeEncryptedReasoning !== undefined
      ? { includeEncryptedReasoning }
      : {}),
  };
}

function parseTemplateValues(raw: unknown): Record<string, unknown> | undefined {
  if (raw === null || raw === undefined || typeof raw !== 'object' || Array.isArray(raw)) {
    return undefined;
  }
  const entries = Object.entries(raw);
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

/** 字段级合并 compat（后者优先，仅覆盖已定义字段）；全空返回 undefined */
export function mergeThinkingCompat(
  ...sources: (ThinkingCompatConfig | undefined)[]
): ThinkingCompatConfig | undefined {
  const out: Record<string, unknown> = {};
  let changed = false;
  for (const src of sources) {
    if (!src) continue;
    for (const [key, value] of Object.entries(src)) {
      if (value !== undefined) {
        out[key] = value;
        changed = true;
      }
    }
  }
  return changed ? (out as ThinkingCompatConfig) : undefined;
}

/**
 * 模型条目 thinking 声明（legacy `thinkingEfforts` 字段的形态；
 * 新声明用 `supportsThinking` 布尔表达能力，本字段只表达档位菜单）：
 * - false：legacy 写法的"不能思考"（解析时折叠为 supportsThinking: false）
 * - 数组：该模型支持的档位菜单（可含正典 `on`），wire 值恒等于档位名
 * - 缺省：回退类型默认（defaultEfforts）/ preset / 默认 [none, on]
 */
export type ModelThinkingDeclaration = boolean | AnyThinkingEffort[];

/**
 * 档位 → wire 值映射（对齐 DSH thinkingLevelMap）
 *
 * 前端菜单只显示中立档位，本表决定实际发给网关的字符串：
 * - 值 = 非空字符串：该档可选，wire 写该字符串（改名/钳制）
 * - 值 = null 或键缺失：该档不支持（菜单隐藏）
 * - 仅规范档位作键；`off` 归一为 `none`，legacy `on` 不允许
 * - `none` 的值 = 关闭时发送的 wire 值（缺省/null → 用 format 的原生关闭；
 *   仅 openai/openrouter/string-thinking/baseten 消费该值）
 * - 其余档位的值只对非 none/on 档生效（开启态的字段形状由 format 决定）
 */
export type ThinkingEffortMap = Partial<Record<ThinkingEffort, string | null>>;

/**
 * 归一映射表（输入宽容）：
 * - `off` 键 → `none`；未知键、legacy `on`、空串值丢弃
 * - 保留 null（显式不支持）与非空字符串值
 * @returns 归一后的映射；无有效条目时返回 undefined
 */
export function normalizeEffortMap(
  raw: unknown,
): ThinkingEffortMap | undefined {
  if (raw === null || raw === undefined || typeof raw !== 'object' || Array.isArray(raw)) {
    return undefined;
  }
  const out: ThinkingEffortMap = {};
  let kept = 0;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const effort = normalizeThinkingEffort(key);
    if (effort === undefined || effort === 'on') continue;
    if (value === null) {
      out[effort] = null;
      kept += 1;
      continue;
    }
    if (typeof value === 'string' && value.trim()) {
      out[effort] = value.trim();
      kept += 1;
    }
  }
  return kept > 0 ? out : undefined;
}

/**
 * 供应商文件 thinking 块（YAML 顶层 thinking: 字段）。
 * 只管档位声明；wire 兼容开关在 `compat` 块（见 ThinkingCompatConfig）。
 */
export interface ProviderThinkingConfig {
  /** 未知模型档位兜底菜单（仅实例文件可声明） */
  defaultEfforts?: AnyThinkingEffort[];
}

/**
 * 模型条目 legacy `thinking` 块：仅剩历史 `style` 需要读取归一
 * （写入侧一律走 compat.thinkingFormat）。
 */
export interface ModelThinkingConfig {
  /** @deprecated 读取时归一到 compat.thinkingFormat */
  style?: string;
}

/**
 * 档位 → JSON merge patch 映射（对齐 ZCode 的 option map 思路，取其子集）：
 *
 * 值是一个 JSON merge patch 对象（RFC 7386 语义：null 删键、对象递归合并、
 * 数组整体替换），在该档位生效时整体打到最后装配完成的请求体上。与平面
 * `ThinkingEffortMap`（档位→字符串，只改 effort 值）正交：
 * - patch 只表达"这个档位要额外写/删哪些请求字段"，能覆盖任意字段形状
 *   （自定义网关的非标 thinking 参数、多家字段并存的超集写法等）；
 * - 同档位同时有字符串映射与 patch 时 patch 优先（见 resolveThinkingMenu）；
 * - 菜单推导不受 patch 影响（仍由 thinkingEfforts 数组 / map 键 / 兜底链决定）。
 *
 * 键为规范档位（off 归一为 none；on 不能作键——on 的开关行为由 thinkingFormat
 * 承载，与 ThinkingEffortMap 同规则）。
 */
export type ThinkingEffortPatch = Partial<Record<ThinkingEffort, Record<string, unknown>>>;

/** JSON-safe 校验：仅允许 plain object / 数组 / string / number / boolean / null */
function isJsonSafe(value: unknown): boolean {
  if (value === null || typeof value === 'string') return true;
  if (typeof value === 'number' || typeof value === 'boolean') return true;
  if (Array.isArray(value)) return value.every(isJsonSafe);
  if (typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).every(isJsonSafe);
  }
  return false;
}

/**
 * 归一 patch 映射（输入宽容，读取侧用）：
 * - `off` 键 → `none`；未知键、legacy `on`、非对象值丢弃
 * - 值须为非数组 plain object（空对象无补丁语义，丢弃）
 * - 值深度 JSON-safe 校验（含 undefined 值的键丢弃）
 * @returns 归一后的映射；无有效条目时返回 undefined
 */
export function normalizeEffortPatch(
  raw: unknown,
): ThinkingEffortPatch | undefined {
  if (raw === null || raw === undefined || typeof raw !== 'object' || Array.isArray(raw)) {
    return undefined;
  }
  const out: ThinkingEffortPatch = {};
  let kept = 0;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const effort = normalizeThinkingEffort(key);
    if (effort === undefined || effort === 'on') continue;
    if (value === null || typeof value !== 'object' || Array.isArray(value)) continue;
    if (!isJsonSafe(value)) continue;
    const patch: Record<string, unknown> = {};
    for (const [patchKey, patchValue] of Object.entries(value)) {
      if (patchValue !== undefined) patch[patchKey] = patchValue;
    }
    if (Object.keys(patch).length === 0) continue;
    out[effort] = patch;
    kept += 1;
  }
  return kept > 0 ? out : undefined;
}

