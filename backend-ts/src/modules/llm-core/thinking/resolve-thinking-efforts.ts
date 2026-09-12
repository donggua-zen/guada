import { findModelPreset } from '../model-preset-library';
import {
  ModelThinkingDeclaration,
  ProviderThinkingConfig,
  THINKING_EFFORTS,
  ThinkingEffort,
  ThinkingEffortMap,
  normalizeEffortMap,
  normalizeThinkingEffort,
} from './thinking-vocabulary';

/** 模型条目形状（ProviderFileStore 的 models[] 条目，只取 thinking 相关字段） */
export interface ThinkingAwareModelEntry {
  modelName: string;
  modelType?: string;
  /**
   * 能力声明：能不能思考（与档位菜单正交，对齐 DSH `reasoning` 布尔）。
   * - false → 不能思考（菜单强制空）
   * - true → 能思考；档位来自 thinkingEfforts 声明，未声明时走通用兜底
   * - undefined → 未声明（由通用兜底决定，见 resolveEfforts）
   */
  supportsThinking?: boolean;
  /** 模型条目显式档位声明（false=legacy 不能思考，数组=菜单，缺省=回退） */
  thinkingEfforts?: ModelThinkingDeclaration;
  /** 档位 → wire 值映射（非 null 键派生菜单，值作为 wire 字符串） */
  thinkingEffortsMap?: ThinkingEffortMap;
}

const EMPTY_EFFORTS: ThinkingEffort[] = [];
/** 开关型格式（supportsReasoningEffort=false）的兜底：最小诚实开关 */
const DEFAULT_SWITCH_MENU: ThinkingEffort[] = ['none', 'on'];

/**
 * 档位未知、且格式能承载强度值时的通用兜底：OpenAI 官方 6 档
 * （none/low/medium/high/xhigh/max，见 docs/openai官方支持的思考档位.md）。
 *
 * 不含 `on`——它是"纯开关"档，只对**有开关字段**的 thinkingFormat 有意义；
 * openai 这类"关闭靠不发或发值"的格式配 on 会上不了 wire（catalog-lint 同规则）。
 */
export const GENERIC_EFFORT_MENU: ThinkingEffort[] = [
  'none',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
];

/** 兜底策略选项（由 store 按生效 compat 传入） */
export interface ThinkingFallbackOptions {
  /**
   * 该 provider 生效的 `supportsReasoningEffort`（format 默认 + compat 覆盖）。
   * - false → 开关型格式（zai/together/ant-ling/chat-template 等）无法把强度值
   *   写上 wire，兜底退回最小开关菜单，避免造出"点了没反应"的假档位；
   * - true/缺省 → 用 GENERIC_EFFORT_MENU。
   */
  supportsEffort?: boolean;
}

/** 解析中间结果：菜单 + 是否走了通用兜底（后者要为 none 合成 wire 值） */
interface ResolvedThinkingEfforts {
  menu: ThinkingEffort[];
  genericFallback: boolean;
}

/** 名称含 embed 的模型一律不支持思考（唯一保留的代码横切规则） */
function isEmbeddingModel(modelName: string, modelType?: string): boolean {
  if (modelType === 'embedding') return true;
  const lower = modelName.toLowerCase();
  return lower.includes('embedding') || lower.includes('embed');
}

/**
 * 档位未知时的兜底菜单（能力短路已在上游完成）。
 * 仅当 provider 的格式能承载强度值时才给 GENERIC_EFFORT_MENU。
 */
function fallbackMenu(
  model: Pick<ThinkingAwareModelEntry, 'supportsThinking' | 'thinkingEfforts'>,
  opts: ThinkingFallbackOptions | undefined,
): ResolvedThinkingEfforts {
  if (opts?.supportsEffort === false) {
    // 开关型格式：只有"声明过能力"的模型给最小开关，其余视为不能思考
    const declaredCapable =
      model.supportsThinking === true || model.thinkingEfforts === true;
    return {
      menu: declaredCapable ? DEFAULT_SWITCH_MENU : EMPTY_EFFORTS,
      genericFallback: false,
    };
  }
  return { menu: [...GENERIC_EFFORT_MENU], genericFallback: true };
}

/**
 * 解析一个模型的思考档位菜单（含"是否走了通用兜底"）
 *
 * 能力与档位分离（对齐 DSH `reasoning` + `thinkingLevelMap`）：
 * - `supportsThinking: false` / `thinkingEfforts: false` / embedding → 空菜单
 * - 档位链：模型条目显式数组 > 实例 defaultEfforts > preset（按模型名匹配）
 * - 三级全空 / legacy `true` → 通用兜底：
 *   - 格式能发强度值 → `GENERIC_EFFORT_MENU`（官方 6 档）
 *   - 开关型格式 → `[none, on]`（仅声明过能力时），否则空菜单
 *
 * 注意：`thinkingEfforts: true` / `supportsThinking: true` 是**显式声明**，
 * 不看 preset（避免"声明了但没写清"被目录数据冒充成有档位）。
 */
function resolveEfforts(
  model: Pick<
    ThinkingAwareModelEntry,
    'modelName' | 'modelType' | 'supportsThinking' | 'thinkingEfforts'
  >,
  providerThinking: ProviderThinkingConfig | undefined,
  opts: ThinkingFallbackOptions | undefined,
): ResolvedThinkingEfforts {
  const empty: ResolvedThinkingEfforts = {
    menu: EMPTY_EFFORTS,
    genericFallback: false,
  };

  if (isEmbeddingModel(model.modelName, model.modelType)) return empty;
  if (model.supportsThinking === false) return empty;
  if (model.thinkingEfforts === false) return empty;

  // legacy true：声明了能力但没写清档位 → 直接兜底，不查 preset
  if (model.thinkingEfforts === true) {
    return fallbackMenu(model, opts);
  }

  let raw: readonly string[] | undefined;
  if (Array.isArray(model.thinkingEfforts)) {
    raw = model.thinkingEfforts;
  } else {
    // undefined / null → 实例供应商兜底
    raw = providerThinking?.defaultEfforts;
  }

  if (raw === undefined) {
    // preset 目录匹配（按模型名的迷你目录：custom 网关无法枚举模型时的主要来源）
    raw = findModelPreset(model.modelName)?.thinkingEfforts;
  }

  if (!raw || raw.length === 0) {
    return fallbackMenu(model, opts);
  }

  // 归一化：off→none，丢弃未知词，去重，按规范顺序排列（on 为正典档位，保留）
  const normalized = new Set<ThinkingEffort>();
  for (const item of raw) {
    const effort = normalizeThinkingEffort(String(item));
    if (effort !== undefined) {
      normalized.add(effort);
    }
  }
  const menu = THINKING_EFFORTS.filter((e) => normalized.has(e));
  return { menu, genericFallback: false };
}

/**
 * 解析一个模型的思考档位菜单（对 resolveEfforts 的薄包装，保持原签名）
 */
export function resolveThinkingEfforts(
  model: Pick<
    ThinkingAwareModelEntry,
    'modelName' | 'modelType' | 'supportsThinking' | 'thinkingEfforts'
  >,
  providerThinking: ProviderThinkingConfig | undefined,
  opts?: ThinkingFallbackOptions,
): ThinkingEffort[] {
  return resolveEfforts(model, providerThinking, opts).menu;
}

/** 菜单 + wire 值映射的解析结果 */
export interface ResolvedThinkingMenu {
  /** 前端菜单（中立档位，规范顺序） */
  menu: ThinkingEffort[];
  /** 档位 → wire 字符串（无 map 时缺省，wire 值恒等于档位名） */
  wireValues: Partial<Record<ThinkingEffort, string>>;
}

/**
 * 解析菜单与 wire 值映射（对 resolveEfforts 的扩展入口）
 *
 * supportsThinking: false → 空菜单（不发参数不回传）。map 存在时：菜单 =
 * 非 null 键（规范序），wireValues = 非 null 值；无 map 时沿用数组/默认链。
 *
 * 走通用兜底时额外合成 `none → 'none'`：兜底是"格式能发强度值"的通用模型，
 * 关闭要按官方的档位值发出去（openai 拼法 → `reasoning_effort:"none"`），
 * 而不是"参数缺席"。显式声明过档位的模型不合成，保持既有行为不变。
 */
export function resolveThinkingMenu(
  model: Pick<
    ThinkingAwareModelEntry,
    | 'modelName'
    | 'modelType'
    | 'supportsThinking'
    | 'thinkingEfforts'
    | 'thinkingEffortsMap'
  >,
  providerThinking: ProviderThinkingConfig | undefined,
  opts?: ThinkingFallbackOptions,
): ResolvedThinkingMenu {
  const wireValues: Partial<Record<ThinkingEffort, string>> = {};

  // 能力/声明双层短路：不支持思考 或 legacy false → 不推理
  if (model.supportsThinking === false || model.thinkingEfforts === false) {
    return { menu: [], wireValues };
  }

  // 防御性归一（store/catalog 解析时已归一；直接调用方可能传原始键）
  const map = normalizeEffortMap(model.thinkingEffortsMap);
  if (map !== undefined) {
    const menu: ThinkingEffort[] = [];
    for (const effort of THINKING_EFFORTS) {
      const value = map[effort];
      if (typeof value === 'string' && value) {
        menu.push(effort);
        wireValues[effort] = value;
      }
      // null / 缺省 → 该档不支持
    }
    // embedding 横切排除
    if (isEmbeddingModel(model.modelName, model.modelType)) {
      return { menu: [], wireValues: {} };
    }
    return { menu, wireValues };
  }

  // 无 map：沿用数组/默认回退链，wire 值恒等于档位名
  const { menu, genericFallback } = resolveEfforts(model, providerThinking, opts);
  if (genericFallback && menu.includes('none')) {
    wireValues.none = 'none';
  }
  return { menu, wireValues };
}
