/**
 * JSON Merge Patch（RFC 7386）应用器
 *
 * 思考域的档位→patch 映射（thinkingEffortsPatch）在该档生效时整体打到
 * 装配完成的请求体上，本模块是唯一的 patch 语义实现：
 * - patch 值为 null → 删除目标键
 * - patch 值为 plain object → 递归合并（目标非对象时以空对象为基础）
 * - 其余（数组/标量）→ 整体替换
 * 返回深拷贝，不改入参（请求体装配散布在适配器内，原地改动难以推理）。
 */

export type JsonMergePatchValue =
  | null
  | string
  | number
  | boolean
  | JsonMergePatchObject
  | JsonMergePatchValue[]
  | { [key: string]: JsonMergePatchValue };

export interface JsonMergePatchObject {
  [key: string]: JsonMergePatchValue;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cloneJson<T>(value: T): T {
  if (Array.isArray(value)) return value.map(cloneJson) as unknown as T;
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      out[key] = cloneJson(entry);
    }
    return out as T;
  }
  return value;
}

/**
 * 对 target 应用一个 merge patch，返回深拷贝结果（不修改入参）。
 * target 允许为任意 JSON 值；patch 必须是 plain object（顶层删除无意义）。
 */
export function applyJsonMergePatch<T extends object>(
  target: T,
  patch: JsonMergePatchObject,
): T {
  return mergeInto(cloneJson(target), patch) as T;
}

function mergeInto(
  target: unknown,
  patch: Record<string, unknown>,
): unknown {
  const base = isPlainObject(target) ? target : {};
  const result: Record<string, unknown> = { ...base };
  for (const [key, patchValue] of Object.entries(patch)) {
    if (patchValue === null) {
      delete result[key];
      continue;
    }
    if (isPlainObject(patchValue)) {
      result[key] = mergeInto(result[key], patchValue);
      continue;
    }
    result[key] = cloneJson(patchValue);
  }
  return result;
}
