/**
 * GdDatePicker / GdTimePicker 的纯日期逻辑。
 * 从 schedule.ts（src/components/scheduler/schedule.ts）的
 * toLocalDateTimeString / parseLocalDateTime 镜像而来——ui 层不反向依赖 feature 目录。
 */

export type DateTimeParts = {
  y: number
  /** 1-12 */
  m: number
  d: number
  h: number
  mi: number
  s: number
}

export function pad2(v: number): string {
  return String(v).padStart(2, '0')
}

export const HOUR_RANGE = Array.from({ length: 24 }, (_, i) => i)
export const MINUTE_RANGE = Array.from({ length: 60 }, (_, i) => i)
export const SECOND_RANGE = MINUTE_RANGE

export function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate()
}

/**
 * 6×42 日历格（周日起始），含前后月补位。
 * @param month 1-12
 */
export function buildMonthCells(year: number, month: number): { date: Date; inMonth: boolean }[] {
  const first = new Date(year, month - 1, 1)
  const start = new Date(year, month - 1, 1 - first.getDay())
  const cells: { date: Date; inMonth: boolean }[] = []
  for (let i = 0; i < 42; i += 1) {
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i)
    cells.push({ date, inMonth: date.getMonth() === month - 1 })
  }
  return cells
}

export function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate()
}

/** Date → "YYYY-MM-DD HH:mm:ss" */
export function toLocalDateTimeString(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} `
    + `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`
}

/**
 * "YYYY-MM-DD HH:mm[:ss]" → parts；空/非法回退当前时间。
 * schedule.ts 的 parseLocalDateTime 语义（16 字符输入补 :00）。
 */
export function splitDateTime(value: string | null | undefined): DateTimeParts {
  const now = new Date()
  const fallback: DateTimeParts = {
    y: now.getFullYear(),
    m: now.getMonth() + 1,
    d: now.getDate(),
    h: now.getHours(),
    mi: now.getMinutes(),
    s: now.getSeconds(),
  }
  if (!value) return fallback
  const str = value.trim()
  if (str.length === 16) return splitDateTime(`${str}:00`)
  const match = str.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/)
  if (!match) return fallback
  const parts: DateTimeParts = {
    y: Number(match[1]),
    m: Number(match[2]),
    d: Number(match[3]),
    h: Number(match[4]),
    mi: Number(match[5]),
    s: Number(match[6]),
  }
  const probe = new Date(parts.y, parts.m - 1, parts.d, parts.h, parts.mi, parts.s)
  if (Number.isNaN(probe.getTime())
    || probe.getMonth() !== parts.m - 1
    || probe.getDate() !== parts.d) {
    return fallback
  }
  return parts
}

/** 选中日期 + 时分秒 → "YYYY-MM-DD HH:mm:ss" */
export function combineDateTime(date: Date, h: number, mi: number, s: number): string {
  const clampedH = Math.min(23, Math.max(0, h))
  const clampedMi = Math.min(59, Math.max(0, mi))
  const clampedS = Math.min(59, Math.max(0, s))
  return toLocalDateTimeString(new Date(date.getFullYear(), date.getMonth(), date.getDate(), clampedH, clampedMi, clampedS))
}

/** (h, m) → "HH:mm" */
export function combineTime(h: number, m: number): string {
  return `${pad2(Math.min(23, Math.max(0, h)))}:${pad2(Math.min(59, Math.max(0, m)))}`
}
