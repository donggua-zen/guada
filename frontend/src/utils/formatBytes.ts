/**
 * 字节数格式化（二进制单位，1024 进制）。
 *
 * 用于展示请求媒体大小：B 不带小数，KB 以上保留一位小数。
 * null/undefined/负数/NaN 返回占位符，避免旧数据或异常值显示成 NaN。
 */
export function formatBytes(bytes: number | null | undefined, digits = 1): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return '—'
  const units = ['B', 'KB', 'MB', 'GB', 'TB'] as const
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return unit === 0 ? `${Math.round(value)} B` : `${value.toFixed(digits)} ${units[unit]}`
}
