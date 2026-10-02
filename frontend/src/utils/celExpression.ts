/**
 * 拼法表达式（CEL）前端求值 / 校验
 *
 * 与后端 `backend-ts/src/modules/llm-core/thinking/cel-evaluator.ts` 同库同版本
 * （@marcbachmann/cel-js）且同语义——编辑器预览即运行时行为。
 * 上下文规则（wireValue / mappedWire / offWire / off / on）与后端逐条对齐，
 * 改一处必须同步另一处（跨层冗余，注释互指；不做跨层共享包）。
 */
import { Environment } from '@marcbachmann/cel-js'

/** 表达式长度上限（与后端 PATCH_EXPR_MAX_LENGTH 同值） */
export const PATCH_EXPR_MAX_LENGTH = 8192

/** 求值上下文（与后端 PatchExprContext 同构） */
export interface PatchExprContext {
  /** 当前推理档位：none / on / minimal / low / medium / high / xhigh / max */
  reasoningLevel: string
  /** 该档位的 wire 值：强度档 = 映射值 ?? 档位名；none = 映射值 ?? ""；on = "on" */
  wireValue: string
  /** 该档位的显式映射值（thinkingEffortsMap），未映射为 "" */
  mappedWire: string
  /** none 档的映射值，未映射为 ""（与档位无关，始终可见） */
  offWire: string
  /** 是否关闭思考（reasoningLevel == "none"） */
  off: boolean
  /** 是否 legacy 开关档（reasoningLevel == "on"） */
  on: boolean
}

/** 表达式诊断（解析/求值失败；start/end 供编辑器定位） */
export interface CelDiagnostic {
  message: string
  start?: number
  end?: number
}

const env = new Environment({
  // 拼法映射天然混合类型（字符串 + 嵌套对象），关闭同质字面量约束
  homogeneousAggregateLiterals: false,
  // 变量必须显式注册：拼错变量名 = 报错，而不是静默求值为 dyn
  unlistedVariablesAreDyn: false,
  limits: {
    maxAstNodes: 512,
    maxDepth: 32,
    maxListElements: 64,
    maxMapEntries: 64,
    maxCallArguments: 16,
  },
})
  .registerVariable('reasoningLevel', 'string')
  .registerVariable('wireValue', 'string')
  .registerVariable('mappedWire', 'string')
  .registerVariable('offWire', 'string')
  .registerVariable('off', 'bool')
  .registerVariable('on', 'bool')

/**
 * 构造某档位的求值上下文（与后端 buildPatchExprContext 同语义）。
 * - 强度档：mappedValue 为该档映射值（无映射传 undefined）
 * - none：offWire 为 thinkingEffortsMap.none（无映射传 undefined）
 * - on：wire 值锁定为 'on'（映射表不允许 on 键）
 */
export function buildPatchExprContext(
  level: string,
  opts?: { mappedValue?: string; offWire?: string },
): PatchExprContext {
  const isNone = level === 'none'
  const isOn = level === 'on'
  const offWire = opts?.offWire ?? ''
  const mappedWire = isNone ? offWire : isOn ? '' : opts?.mappedValue ?? ''
  const wireValue = isNone ? offWire : isOn ? 'on' : mappedWire || level
  return {
    reasoningLevel: level,
    wireValue,
    mappedWire,
    offWire,
    off: isNone,
    on: isOn,
  }
}

/** 求值：表达式 → JSON 对象（失败抛错，错误信息可直接展示） */
export function evaluatePatchExpr(
  expr: string,
  ctx: PatchExprContext,
): Record<string, unknown> {
  const parsed = env.parse(expr.trim())
  return normalizePatchResult(parsed(ctx))
}

/**
 * 校验：解析 + 对全部规范档位试算（含映射/未映射两种上下文，覆盖三元分支），
 * 全部通过返回 null，否则返回首个诊断（与后端 validatePatchExpr 同语义）。
 */
export function validatePatchExpr(expr: string): CelDiagnostic | null {
  const source = expr.trim()
  if (!source) return null
  if (source.length > PATCH_EXPR_MAX_LENGTH) {
    return { message: `表达式过长（上限 ${PATCH_EXPR_MAX_LENGTH} 字符）` }
  }
  try {
    env.parse(source)
  } catch (err) {
    return toDiagnostic(err)
  }
  const levels = ['none', 'on', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']
  const mappedAll: Record<string, string> = {
    none: 'minimal',
    minimal: 'minimal',
    low: 'low',
    medium: 'medium',
    high: 'high',
    xhigh: 'xhigh',
    max: 'max',
  }
  for (const level of levels) {
    for (const opts of [
      undefined,
      { mappedValue: mappedAll[level], offWire: mappedAll.none },
    ]) {
      try {
        evaluatePatchExpr(source, buildPatchExprContext(level, opts))
      } catch (err) {
        return toDiagnostic(err)
      }
    }
  }
  return null
}

/** 错误 → 诊断（解析/求值错误带 range，可给编辑器做定位） */
export function toDiagnostic(err: unknown): CelDiagnostic {
  const anyErr = err as any
  const raw = String(anyErr?.summary ?? anyErr?.message ?? err ?? '表达式求值失败')
  const message = raw.split('\n')[0].trim() || '表达式求值失败'
  const range = anyErr?.range ?? anyErr?.node?.range
  return {
    message,
    start: typeof range?.start === 'number' ? range.start : undefined,
    end: typeof range?.end === 'number' ? range.end : undefined,
  }
}

/**
 * 结果归一化：CEL map → 普通对象；非对象一律拒绝（merge patch 只接受对象）。
 * CEL int 是 BigInt（JSON.stringify 会炸）→ 安全范围内转 number（与后端同）。
 */
function normalizePatchResult(result: unknown): Record<string, unknown> {
  const value = normalizeCelValue(result)
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('表达式必须返回 JSON 对象（形如 {"reasoning_effort": wireValue}）')
  }
  return value as Record<string, unknown>
}

function normalizeCelValue(value: unknown): unknown {
  if (typeof value === 'bigint') {
    if (
      value > BigInt(Number.MAX_SAFE_INTEGER) ||
      value < BigInt(Number.MIN_SAFE_INTEGER)
    ) {
      throw new Error('整数超出 JSON 安全范围（±2^53-1）')
    }
    return Number(value)
  }
  if (value instanceof Uint8Array) {
    throw new Error('不支持 bytes 值（JSON 无法表达）')
  }
  if (value instanceof Map) {
    return Object.fromEntries(
      [...value.entries()].map(([k, v]) => [String(k), normalizeCelValue(v)]),
    )
  }
  if (Array.isArray(value)) {
    return value.map(normalizeCelValue)
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, normalizeCelValue(v)]),
    )
  }
  return value
}
