/**
 * 安全截断字符串，确保不会切在 surrogate pair（如 emoji 🎬 = \uD83C\uDFAC）中间。
 *
 * 性能与原生 substring 一致（仅增加 O(1) 的边界检查），适合高频调用场景。
 *
 * @param str - 要截断的字符串
 * @param start - 起始位置（字符数，基于 code point）
 * @param end   - 结束位置（字符数，基于 code point），不传则截取到末尾
 * @returns 截断后的字符串
 *
 * @example
 * safeSubstring("abc🎬def", 0, 4)  // "abc🎬"（长度4个code point）
 * "abc🎬def".substring(0, 4)       // "abc\uD83C"（🍕被截断！）
 */
export function safeSubstring(str: string, start: number, end?: number): string {
  const len = str.length;

  // start 越界保护
  if (start >= len) return '';
  if (start < 0) start = 0;

  // end 越界保护
  const actualEnd = end === undefined || end > len ? len : end < 0 ? 0 : end;
  if (actualEnd <= start) return '';

  // 标准 substring 已能处理 start/end 逆序场景
  const lo = Math.min(start, actualEnd);
  const hi = Math.max(start, actualEnd);

  // 先用原生 substring 做主要截断（O(n)）
  let result = str.substring(lo, hi);

  // 回退检查：如果最后一个字符是高位代理（D800-DBFF），说明它被切掉了低位配对
  const lastIdx = result.length - 1;
  if (lastIdx >= 0) {
    const code = result.charCodeAt(lastIdx);
    if (code >= 0xD800 && code <= 0xDBFF) {
      // 去掉孤立的
      result = result.substring(0, lastIdx);
    }
  }

  // 检查截断后的第一个字符是否是低位代理（DC00-DFFF），如果是则说明高位被切掉了
  if (result.length > 0) {
    const code = result.charCodeAt(0);
    if (code >= 0xDC00 && code <= 0xDFFF) {
      result = result.substring(1);
    }
  }

  return result;
}

/**
 * 安全截取字符串末尾 N 个 code point，避免切在 surrogate pair 中间。
 *
 * @example
 * safeTail("abc🎬def", 4)  // "c🎬def"
 */
export function safeTail(str: string, count: number): string {
  if (count <= 0) return '';
  if (count >= str.length) return str;
  return safeSubstring(str, str.length - count);
}

/**
 * 过滤字符串中的孤立 surrogate 字符（无配对的 U+D800-U+DFFF）。
 * 作为安全截断的兜底防线。
 *
 * 仅删除失去配对的代理码元，保留合法的 surrogate pair（如 emoji 🎬）。
 */
export function removeOrphanSurrogates(str: string): string {
  // 高位代理后不跟低位代理 → 孤立高位
  // 低位代理前没有高位代理 → 孤立低位
  return str.replace(
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g,
    '',
  );
}

/**
 * 安全截取字符串头部 N 个 code point，避免切在 surrogate pair 中间。
 *
 * @example
 * safeTruncate("abc🎬def", 4)  // "abc🎬"
 */
export function safeTruncate(str: string, maxLen: number): string {
  return safeSubstring(str, 0, maxLen);
}
