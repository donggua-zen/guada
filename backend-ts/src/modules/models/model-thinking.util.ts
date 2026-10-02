import { BadRequestException } from "@nestjs/common";
import {
  ModelThinkingConfig,
  THINKING_EFFORTS,
  ThinkingCompatConfig,
  ThinkingEffort,
  ThinkingEffortMap,
  ThinkingEffortPatch,
  normalizeThinkingEffort,
  normalizeThinkingFormat,
  parseThinkingCompat,
} from "../llm-core/thinking/thinking-vocabulary";
import {
  PATCH_EXPR_MAX_LENGTH,
  validatePatchExpr,
} from "../llm-core/thinking/cel-evaluator";

/**
 * 模型条目 thinking 声明的写入口校验（PUT /models/:id、POST /models）
 *
 * payload 约定（与编辑表单三态对齐）：
 * - thinkingEfforts: false → 显式"无思考档位"（不发思考参数、不回传推理）
 * - thinkingEfforts: string[] → 自定义档位菜单（词表校验 + 去重 + 规范序）
 * - thinkingEfforts: null → 清除条目级覆盖，回退继承链（实例级 > preset/类型卡）
 * - thinkingEffortsMap: { level: wire 值 } → 档位→wire 字符串映射（键须为词表档位且
 *   非 on；值为非空字符串或 null=该档不支持；null 整体 = 清除条目级覆盖）
 * - thinkingEffortsPatch: { level: patch 对象 } → 档位→JSON merge patch 映射
 *   （该档生效时整体打进请求体；null 整体 = 清除条目级覆盖）
 * - thinkingPatchExpr: "CEL 表达式" → 拼法表达式（档位→JSON 对象，存在时接管
 *   思考字段写入，替换内置 thinkingFormat 分派）；写入口做 parse + 全档位试算；
 *   空串/null = 清除条目级覆盖（回退内置拼法）
 * - compat: { thinkingFormat, supportsReasoningEffort, ... } → 条目级 wire 兼容开关
 * - compat: null → 清除条目级 compat，回退继承链
 * - legacy thinking: { style } → 归一到 compat.thinkingFormat（thinking: null → 清除 compat）
 * - 字段缺省 → 不变
 */
export interface ThinkingPatchResult {
  patch: {
    supportsThinking?: boolean;
    thinkingEfforts?: boolean | ThinkingEffort[];
    thinkingEffortsMap?: ThinkingEffortMap;
    thinkingEffortsPatch?: ThinkingEffortPatch;
    thinkingPatchExpr?: string;
    compat?: ThinkingCompatConfig;
  };
  clears: Array<
    | 'thinkingEfforts'
    | 'thinkingEffortsMap'
    | 'thinkingEffortsPatch'
    | 'thinkingPatchExpr'
    | 'compat'
    | 'supportsThinking'
  >;
}

/** 解析并校验请求体中的 thinking 字段；非法输入 fail-loud（400） */
export function parseThinkingPatch(data: any): ThinkingPatchResult {
  const result: ThinkingPatchResult = { patch: {}, clears: [] };

  // 能力声明：supportsThinking（true/false 显式；null = 清除覆盖回退继承链）
  const rawSupports = data?.supportsThinking;
  if (rawSupports === null) {
    result.clears.push('supportsThinking');
  } else if (typeof rawSupports === 'boolean') {
    result.patch.supportsThinking = rawSupports;
  } else if (rawSupports !== undefined) {
    throw new BadRequestException(
      'supportsThinking 须为布尔或 null（清除覆盖）',
    );
  }

  const rawEfforts = data?.thinkingEfforts;
  if (rawEfforts === null) {
    result.clears.push('thinkingEfforts');
  } else if (rawEfforts === false) {
    result.patch.thinkingEfforts = false;
  } else if (rawEfforts === true) {
    throw new BadRequestException(
      "thinkingEfforts: true 不是合法声明；请传档位数组、false 或 null（清除覆盖）",
    );
  } else if (Array.isArray(rawEfforts)) {
    result.patch.thinkingEfforts = normalizeEffortsArray(rawEfforts);
  } else if (rawEfforts !== undefined) {
    throw new BadRequestException(
      "thinkingEfforts 须为数组、false 或 null（清除覆盖）",
    );
  }

  // 档位→wire 映射：null 清除覆盖；对象经 fail-loud 归一（读取侧 normalizeEffortMap
  // 是宽容丢弃，写入口必须显式拒绝，避免"保存成功但档位静默消失"）
  const rawMap = data?.thinkingEffortsMap;
  if (rawMap === null) {
    result.clears.push('thinkingEffortsMap');
  } else if (rawMap !== undefined) {
    if (typeof rawMap !== 'object' || Array.isArray(rawMap)) {
      throw new BadRequestException(
        'thinkingEffortsMap 须为对象或 null（清除覆盖）',
      );
    }
    result.patch.thinkingEffortsMap = normalizeEffortsMapStrict(
      rawMap as Record<string, unknown>,
    );
  }

  // 档位→JSON merge patch 映射：null 清除覆盖；对象经 fail-loud 校验
  const rawPatch = data?.thinkingEffortsPatch;
  if (rawPatch === null) {
    result.clears.push('thinkingEffortsPatch');
  } else if (rawPatch !== undefined) {
    if (typeof rawPatch !== 'object' || Array.isArray(rawPatch)) {
      throw new BadRequestException(
        'thinkingEffortsPatch 须为对象或 null（清除覆盖）',
      );
    }
    result.patch.thinkingEffortsPatch = normalizeEffortPatchStrict(
      rawPatch as Record<string, unknown>,
    );
  }

  // 拼法表达式（CEL）：null/空串清除覆盖；字符串做 parse + 全档位试算（fail-loud，
  // 保存即校验——运行时求值失败会回落内置拼法，但配置错误必须在此拦下）
  const rawPatchExpr = data?.thinkingPatchExpr;
  if (rawPatchExpr === null) {
    result.clears.push('thinkingPatchExpr');
  } else if (rawPatchExpr !== undefined) {
    if (typeof rawPatchExpr !== 'string') {
      throw new BadRequestException(
        'thinkingPatchExpr 须为字符串或 null（清除覆盖）',
      );
    }
    const expr = rawPatchExpr.trim();
    if (!expr) {
      result.clears.push('thinkingPatchExpr');
    } else if (expr.length > PATCH_EXPR_MAX_LENGTH) {
      throw new BadRequestException(
        `拼法表达式过长（上限 ${PATCH_EXPR_MAX_LENGTH} 字符）`,
      );
    } else {
      const diagnostic = validatePatchExpr(expr);
      if (diagnostic) {
        const where =
          diagnostic.start !== undefined ? `（位置 ${diagnostic.start}）` : '';
        throw new BadRequestException(
          `拼法表达式无效：${diagnostic.message}${where}`,
        );
      }
      result.patch.thinkingPatchExpr = expr;
    }
  }

  // legacy thinking 块：{ style } 归一到 compat.thinkingFormat；null 视为清除 compat
  const rawThinking: ModelThinkingConfig | null | undefined = data?.thinking;
  if (
    rawThinking !== undefined &&
    rawThinking !== null &&
    (typeof rawThinking !== 'object' || Array.isArray(rawThinking))
  ) {
    throw new BadRequestException(
      "thinking 须为 { style } 对象或 null（清除覆盖）",
    );
  }
  const legacyFormat = normalizeThinkingFormat(rawThinking?.style);
  if (
    rawThinking &&
    typeof rawThinking === 'object' &&
    rawThinking.style !== undefined &&
    rawThinking.style !== null &&
    !legacyFormat
  ) {
    throw new BadRequestException(
      `未知思考格式 "${rawThinking.style}"；合法值：openai | deepseek | zai | qwen | openrouter | together | baseten | ant-ling | string-thinking | qwen-chat-template | chat-template（legacy 别名 reasoning-effort/thinking-toggle/enable-thinking 仍可读）`,
    );
  }

  const rawCompat = data?.compat;
  if (rawCompat === null) {
    result.clears.push('compat');
  } else {
    if (
      rawCompat !== undefined &&
      rawCompat.thinkingFormat !== undefined &&
      !normalizeThinkingFormat(rawCompat.thinkingFormat)
    ) {
      throw new BadRequestException(
        `未知思考格式 "${rawCompat.thinkingFormat}"；合法值：openai | deepseek | zai | qwen | openrouter | together | baseten | ant-ling | string-thinking | qwen-chat-template | chat-template（legacy 别名 reasoning-effort/thinking-toggle/enable-thinking 仍可读）`,
      );
    }
    let compat = parseThinkingCompat(rawCompat);
    if (legacyFormat) {
      // legacy 值仅在显式 compat 未给 format 时生效
      compat = { thinkingFormat: legacyFormat, ...(compat ?? {}) };
    }
    if (compat) {
      result.patch.compat = compat;
    } else if (rawThinking === null) {
      // thinking: null（无 compat 内容）= 清除条目级 compat，回退继承链
      result.clears.push('compat');
    }
  }

  return result;
}

/** 档位数组归一：词表校验（拒绝 legacy on）、去重、规范序；空/仅 none 拒绝 */
function normalizeEffortsArray(raw: unknown[]): ThinkingEffort[] {
  const efforts: ThinkingEffort[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') {
      throw new BadRequestException(`思考档位须为字符串，收到 ${JSON.stringify(item) ?? item}`);
    }
    const normalized = normalizeThinkingEffort(item);
    if (normalized === undefined) {
      throw new BadRequestException(
        `未知思考档位 "${item}"；合法值：${THINKING_EFFORTS.join(' | ')}`,
      );
    }
    if (!efforts.includes(normalized)) efforts.push(normalized);
  }
  if (!efforts.some((e) => e !== 'none')) {
    throw new BadRequestException(
      '自定义档位须至少包含一个非 none 档位（仅 none 等价于 false）',
    );
  }
  return efforts.sort(
    (a, b) => THINKING_EFFORTS.indexOf(a) - THINKING_EFFORTS.indexOf(b),
  );
}

/**
 * 档位→wire 映射归一（写入口 fail-loud 版）：
 * - 键：词表档位（off→none 归一）；on 不能作键（on 的 wire 行为由 thinkingFormat
 *   的开关字段承载，见 thinking-vocabulary ThinkingEffortMap 注释）
 * - 值：非空字符串（trim）或 null（显式不支持，菜单隐藏该档）
 * - 至少一个有效条目；返回值按规范档位序排列
 */
function normalizeEffortsMapStrict(raw: Record<string, unknown>): ThinkingEffortMap {
  const out: ThinkingEffortMap = {};
  for (const [key, value] of Object.entries(raw)) {
    const effort = normalizeThinkingEffort(key);
    if (effort === undefined) {
      throw new BadRequestException(
        `未知思考档位 "${key}"；合法值：${THINKING_EFFORTS.join(' | ')}`,
      );
    }
    if (effort === 'on') {
      throw new BadRequestException(
        'on 不能作为 thinkingEffortsMap 键（on 的开关行为由 thinkingFormat 承载，无独立 wire 值）',
      );
    }
    if (value === null) {
      out[effort] = null;
      continue;
    }
    if (typeof value === 'string' && value.trim()) {
      out[effort] = value.trim();
      continue;
    }
    throw new BadRequestException(
      `思考档位 "${key}" 的 wire 值须为非空字符串或 null，收到 ${JSON.stringify(value) ?? String(value)}`,
    );
  }
  if (Object.keys(out).length === 0) {
    throw new BadRequestException(
      'thinkingEffortsMap 须至少包含一个有效档位条目（清除覆盖请传 null）',
    );
  }
  // 键集去重已由 Object.entries 保证；按规范序输出便于落盘文件稳定
  const ordered: ThinkingEffortMap = {};
  for (const effort of THINKING_EFFORTS) {
    if (effort in out) ordered[effort] = out[effort];
  }
  return ordered;
}

/** JSON-safe：仅允许 plain object / 数组 / string / number / boolean / null */
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
 * 档位→JSON merge patch 映射归一（写入口 fail-loud 版）：
 * - 键：词表档位（off→none 归一）；on 不能作键（无独立 wire 值）
 * - 值：非数组 plain object、JSON-safe、非空（空 patch 无语义）
 * - 至少一个有效条目；返回值按规范档位序排列
 */
function normalizeEffortPatchStrict(
  raw: Record<string, unknown>,
): ThinkingEffortPatch {
  const out: ThinkingEffortPatch = {};
  for (const [key, value] of Object.entries(raw)) {
    const effort = normalizeThinkingEffort(key);
    if (effort === undefined) {
      throw new BadRequestException(
        `未知思考档位 "${key}"；合法值：${THINKING_EFFORTS.join(' | ')}`,
      );
    }
    if (effort === 'on') {
      throw new BadRequestException(
        'on 不能作为 thinkingEffortsPatch 键（on 的开关行为由 thinkingFormat 承载，无独立 wire 值）',
      );
    }
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new BadRequestException(
        `思考档位 "${key}" 的 patch 值须为对象（JSON merge patch），收到 ${JSON.stringify(value) ?? String(value)}`,
      );
    }
    const patch: Record<string, unknown> = {};
    for (const [patchKey, patchValue] of Object.entries(value)) {
      if (patchValue === undefined) continue;
      if (!isJsonSafe(patchValue)) {
        throw new BadRequestException(
          `思考档位 "${key}" 的 patch 含非 JSON 值（键 "${patchKey}"）`,
        );
      }
      patch[patchKey] = patchValue;
    }
    if (Object.keys(patch).length === 0) {
      throw new BadRequestException(
        `思考档位 "${key}" 的 patch 不能为空对象`,
      );
    }
    out[effort] = patch;
  }
  if (Object.keys(out).length === 0) {
    throw new BadRequestException(
      'thinkingEffortsPatch 须至少包含一个有效档位条目（清除覆盖请传 null）',
    );
  }
  const ordered: ThinkingEffortPatch = {};
  for (const effort of THINKING_EFFORTS) {
    if (effort in out) ordered[effort] = out[effort];
  }
  return ordered;
}

/**
 * 供应商级 compat 写入口校验（PUT /providers/:id、POST /providers）。
 * 非法 format fail-loud；合法值归一后返回（全空 → undefined = 不声明）。
 */
export function parseProviderCompatPatch(data: any): ThinkingCompatConfig | undefined {
  const raw = data?.compat;
  if (raw === undefined || raw === null) return undefined;
  if (raw.thinkingFormat !== undefined && !normalizeThinkingFormat(raw.thinkingFormat)) {
    throw new BadRequestException(
      `未知思考格式 "${raw.thinkingFormat}"；合法值：openai | deepseek | zai | qwen | openrouter | together | baseten | ant-ling | string-thinking | qwen-chat-template | chat-template`,
    );
  }
  const compat = parseThinkingCompat(raw);
  if (!compat && raw && typeof raw === 'object' && Object.keys(raw).length > 0) {
    throw new BadRequestException('compat 内容无效（未知字段或取值类型不符）');
  }
  return compat;
}
