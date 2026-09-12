import { BadRequestException } from "@nestjs/common";
import {
  ModelThinkingConfig,
  THINKING_EFFORTS,
  ThinkingCompatConfig,
  ThinkingEffort,
  normalizeThinkingEffort,
  normalizeThinkingFormat,
  parseThinkingCompat,
} from "../llm-core/thinking/thinking-vocabulary";

/**
 * 模型条目 thinking 声明的写入口校验（PUT /models/:id、POST /models）
 *
 * payload 约定（与编辑表单三态对齐）：
 * - thinkingEfforts: false → 显式"无思考档位"（不发思考参数、不回传推理）
 * - thinkingEfforts: string[] → 自定义档位菜单（词表校验 + 去重 + 规范序）
 * - thinkingEfforts: null → 清除条目级覆盖，回退继承链（实例级 > preset/类型卡）
 * - compat: { thinkingFormat, supportsReasoningEffort, ... } → 条目级 wire 兼容开关
 * - compat: null → 清除条目级 compat，回退继承链
 * - legacy thinking: { style } → 归一到 compat.thinkingFormat（thinking: null → 清除 compat）
 * - 字段缺省 → 不变
 */
export interface ThinkingPatchResult {
  patch: {
    supportsThinking?: boolean;
    thinkingEfforts?: boolean | ThinkingEffort[];
    compat?: ThinkingCompatConfig;
  };
  clears: Array<'thinkingEfforts' | 'compat' | 'supportsThinking'>;
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
