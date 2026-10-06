/**
 * CEL 拼法表达式求值器（请求拼法）
 *
 * 用户可写的「拼法」表达式：把当前推理档位映射为 JSON 对象，合并进请求体。
 * 引擎：@marcbachmann/cel-js（纯 ESM，MIT，零依赖）——CEL 非图灵完备、
 * 无 IO，进程内求值安全；配合结构限制（maxAstNodes 等）与长度上限。
 *
 * 本文件是 CJS↔ESM 的唯一适配点：后端编译为 CJS，经 createRequire 走
 * Node ≥20.19 / ≥22.12 的 require(esm) 同步加载（Electron 41 / 现代 Node
 * 均满足；不满足时抛出明确错误）。前端同库同版本，保证编辑器预览与
 * 运行时行为逐字节一致。
 */
import { createRequire } from 'node:module';
import { THINKING_EFFORTS } from './thinking-vocabulary';

type CelModule = typeof import('@marcbachmann/cel-js');
type CelEnvironment = InstanceType<CelModule['Environment']>;

/** 表达式长度上限（字符）——远超正常拼法所需，防滥用 */
export const PATCH_EXPR_MAX_LENGTH = 8192;

/** 解析/求值结构限制（CEL 规范最小值的适度放宽） */
const PATCH_EXPR_LIMITS = {
  maxAstNodes: 512,
  maxDepth: 32,
  maxListElements: 64,
  maxMapEntries: 64,
  maxCallArguments: 16,
} as const;

/** 求值上下文：表达式可用的变量（前端编辑器提示同源） */
export interface PatchExprContext {
  /** 当前推理档位：none / on / minimal / low / medium / high / xhigh / max */
  reasoningLevel: string;
  /** 该档位的 wire 值：强度档 = 映射值 ?? 档位名；none = 映射值 ?? ""；on = "on" */
  wireValue: string;
  /** 该档位的显式映射值（thinkingEffortsMap），未映射为 "" */
  mappedWire: string;
  /** none 档的映射值（thinkingEffortsMap.none），未映射为 ""（与档位无关，始终可见） */
  offWire: string;
  /** 是否关闭思考（reasoningLevel == "none"） */
  off: boolean;
  /** 是否 legacy 开关档（reasoningLevel == "on"） */
  on: boolean;
}

/** 表达式诊断（解析/求值失败；range 供编辑器定位） */
export interface PatchExprDiagnostic {
  message: string;
  code?: string;
  start?: number;
  end?: number;
}

let env: CelEnvironment | undefined;

/**
 * 构造某档位的求值上下文。
 * - 强度档：mappedValue 为该档映射值（无映射传 undefined）
 * - none：offWire 为 thinkingEffortsMap.none（无映射传 undefined）
 * - on：wire 值锁定为 'on'（映射表不允许 on 键）
 */
export function buildPatchExprContext(
  level: string,
  opts?: { mappedValue?: string; offWire?: string },
): PatchExprContext {
  const isNone = level === 'none';
  const isOn = level === 'on';
  const offWire = opts?.offWire ?? '';
  const mappedWire = isNone ? offWire : isOn ? '' : opts?.mappedValue ?? '';
  const wireValue = isNone ? offWire : isOn ? 'on' : mappedWire || level;
  return {
    reasoningLevel: level,
    wireValue,
    mappedWire,
    offWire,
    off: isNone,
    on: isOn,
  };
}

/** 求值：表达式 → JSON 对象（失败抛错，错误信息可直接展示） */
export function evaluatePatchExpr(
  expr: string,
  ctx: PatchExprContext,
): Record<string, unknown> {
  const parsed = parsePatchExpr(expr);
  return normalizePatchResult(parsed(ctx));
}

/**
 * 校验：解析 + 对全部规范档位试算（含映射/未映射两种上下文，覆盖三元分支），
 * 全部通过返回 null，否则返回首个诊断。
 */
export function validatePatchExpr(expr: string): PatchExprDiagnostic | null {
  try {
    parsePatchExpr(expr);
  } catch (err) {
    return toDiagnostic(err);
  }
  const mappedAll: Record<string, string> = {
    none: 'minimal',
    minimal: 'minimal',
    low: 'low',
    medium: 'medium',
    high: 'high',
    xhigh: 'xhigh',
    max: 'max',
  };
  for (const level of THINKING_EFFORTS) {
    for (const opts of [
      undefined,
      { mappedValue: mappedAll[level], offWire: mappedAll.none },
    ]) {
      try {
        evaluatePatchExpr(expr, buildPatchExprContext(level, opts));
      } catch (err) {
        return toDiagnostic(err);
      }
    }
  }
  return null;
}

/** 错误 → 诊断（解析/求值错误带 range，可给编辑器做定位） */
export function toDiagnostic(err: unknown): PatchExprDiagnostic {
  const anyErr = err as any;
  const raw = String(anyErr?.summary ?? anyErr?.message ?? err ?? '表达式求值失败');
  const message = raw.split('\n')[0].trim() || '表达式求值失败';
  const range = anyErr?.range ?? anyErr?.node?.range;
  return {
    message,
    code: typeof anyErr?.code === 'string' ? anyErr.code : undefined,
    start: typeof range?.start === 'number' ? range.start : undefined,
    end: typeof range?.end === 'number' ? range.end : undefined,
  };
}

// ── 内部 ──────────────────────────────────────────────

const parseCache = new Map<string, (ctx?: any) => any>();
const PARSE_CACHE_MAX = 128;

function parsePatchExpr(expr: string): (ctx?: any) => any {
  const key = expr.trim();
  if (!key) throw new Error('表达式为空');
  if (key.length > PATCH_EXPR_MAX_LENGTH) {
    throw new Error(`表达式过长（上限 ${PATCH_EXPR_MAX_LENGTH} 字符）`);
  }
  const cached = parseCache.get(key);
  if (cached) return cached;
  const parsed = getEnv().parse(key);
  if (parseCache.size >= PARSE_CACHE_MAX) parseCache.clear();
  parseCache.set(key, parsed);
  return parsed;
}

/** 结果归一化：CEL map → 普通对象；非对象一律拒绝（merge patch 只接受对象） */
function normalizePatchResult(result: unknown): Record<string, unknown> {
  const value = normalizeCelValue(result);
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('表达式必须返回 JSON 对象（形如 {"reasoning_effort": wireValue}）');
  }
  return value as Record<string, unknown>;
}

/**
 * 递归归一化 CEL 值 → JSON 安全值：
 * - int 在 CEL 里是 BigInt（JSON.stringify 会炸）→ 安全范围内转 number
 * - map → 普通对象（库通常已返回普通对象，此处兜底）
 * - bytes（Uint8Array）等非 JSON 类型 → 明确拒绝
 */
function normalizeCelValue(value: unknown): unknown {
  if (typeof value === 'bigint') {
    if (
      value > BigInt(Number.MAX_SAFE_INTEGER) ||
      value < BigInt(Number.MIN_SAFE_INTEGER)
    ) {
      throw new Error('整数超出 JSON 安全范围（±2^53-1）');
    }
    return Number(value);
  }
  if (value instanceof Uint8Array) {
    throw new Error('不支持 bytes 值（JSON 无法表达）');
  }
  if (value instanceof Map) {
    return Object.fromEntries(
      [...value.entries()].map(([k, v]) => [String(k), normalizeCelValue(v)]),
    );
  }
  if (Array.isArray(value)) {
    return value.map(normalizeCelValue);
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, normalizeCelValue(v)]),
    );
  }
  return value;
}

function getEnv(): CelEnvironment {
  if (!env) {
    const cel = loadCelModule();
    env = new cel.Environment({
      // 拼法映射天然混合类型（字符串 + 嵌套对象），关闭同质字面量约束
      homogeneousAggregateLiterals: false,
      // 变量必须显式注册：拼错变量名 = 报错，而不是静默求值为 dyn
      unlistedVariablesAreDyn: false,
      limits: { ...PATCH_EXPR_LIMITS },
    })
      .registerVariable('reasoningLevel', 'string')
      .registerVariable('wireValue', 'string')
      .registerVariable('mappedWire', 'string')
      .registerVariable('offWire', 'string')
      .registerVariable('off', 'bool')
      .registerVariable('on', 'bool');
  }
  return env;
}

/**
 * 加载 ESM 引擎：createRequire 走 require(esm)（Node ≥20.19/22.12 原生支持），
 * 同步可用，避免为 CJS 包引入异步初始化。环境不满足时给出可读错误。
 */
function loadCelModule(): CelModule {
  try {
    const requireFromHere = createRequire(__filename);
    return requireFromHere('@marcbachmann/cel-js') as CelModule;
  } catch (err: any) {
    throw new Error(
      `CEL 求值引擎加载失败（需要 Node ≥20.19 / ≥22.12 的 require(esm) 支持）：${err?.message ?? err}`,
    );
  }
}
