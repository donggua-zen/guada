/**
 * 定时任务调度的纯逻辑层
 *
 * 负责三件事：
 * 1. 把 UI 的「调度句」状态生成 cron / executeAt；
 * 2. 把已有任务反向解析回调度句状态（无法识别的表达式原样落到 custom）；
 * 3. 生成人类可读摘要与下次运行时间。
 *
 * 解析原则：一次性任务只认 scheduleType/executeAt，绝不从 cron 的数字月份推断，
 * 避免「每月 1 日」被误判成一次性任务。
 */

export type ScheduleFrequency =
  | 'hourly'
  | 'every_hours'
  | 'daily'
  | 'weekdays'
  | 'weekly'
  | 'monthly'
  | 'once'
  | 'custom'

export interface ScheduleDraft {
  frequency: ScheduleFrequency
  /** 0-23 */
  hour: number
  /** 0-59 */
  minute: number
  /** every_hours 的间隔小时数，1-23 */
  intervalHours: number
  /** weekly 选中的星期，0=周日 … 6=周六 */
  weekdays: number[]
  /** monthly 选中的日期，1-31 */
  monthDays: number[]
  /** once 的本地时间，格式 YYYY-MM-DD HH:mm:ss */
  onceAt: string
  /** custom 的原始 5 段 cron */
  cronExpression: string
}

export interface ScheduleValue {
  scheduleType: 'cron' | 'once'
  cronExpression: string
  executeAt?: string | null
}

/** 与后端一致的固定时区；UI 只展示，不做换算 */
export const SCHEDULE_TIMEZONE_LABEL = 'GMT+8'

const CRON_FIELD = '[0-9*,/-]+'
const CRON_PATTERN = new RegExp(
  `^${CRON_FIELD}\\s+${CRON_FIELD}\\s+${CRON_FIELD}\\s+${CRON_FIELD}\\s+${CRON_FIELD}$`,
)

export function createDefaultScheduleDraft(): ScheduleDraft {
  return {
    frequency: 'daily',
    hour: 9,
    minute: 0,
    intervalHours: 2,
    weekdays: [1],
    monthDays: [1],
    onceAt: '',
    cronExpression: '0 9 * * *',
  }
}

export function isValidCronExpression(expr: string): boolean {
  return CRON_PATTERN.test((expr || '').trim())
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

/** Date → el-date-picker 使用的本地时间字符串 */
export function toLocalDateTimeString(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(
    date.getHours(),
  )}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`
}

/** 本地时间字符串（YYYY-MM-DD HH:mm[:ss]）→ Date；无效返回 null */
export function parseLocalDateTime(value: string): Date | null {
  if (!value) return null
  const normalized = value.length === 16 ? `${value}:00` : value
  const date = new Date(normalized.replace(' ', 'T'))
  return Number.isNaN(date.getTime()) ? null : date
}

function uniqueSorted(values: number[]): number[] {
  return Array.from(new Set(values)).sort((a, b) => a - b)
}

/** 调度句状态 → 保存到后端的值 */
export function buildSchedule(draft: ScheduleDraft): ScheduleValue {
  const minute = Math.min(59, Math.max(0, Math.floor(draft.minute)))
  const hour = Math.min(23, Math.max(0, Math.floor(draft.hour)))

  switch (draft.frequency) {
    case 'hourly':
      return { scheduleType: 'cron', cronExpression: `${minute} * * * *`, executeAt: null }
    case 'every_hours': {
      const interval = Math.min(23, Math.max(1, Math.floor(draft.intervalHours)))
      return {
        scheduleType: 'cron',
        cronExpression: `${minute} */${interval} * * *`,
        executeAt: null,
      }
    }
    case 'daily':
      return { scheduleType: 'cron', cronExpression: `${minute} ${hour} * * *`, executeAt: null }
    case 'weekdays':
      return { scheduleType: 'cron', cronExpression: `${minute} ${hour} * * 1-5`, executeAt: null }
    case 'weekly': {
      const days = uniqueSorted(draft.weekdays)
      const dayField = days.length > 0 ? days.join(',') : '1'
      return { scheduleType: 'cron', cronExpression: `${minute} ${hour} * * ${dayField}`, executeAt: null }
    }
    case 'monthly': {
      const days = uniqueSorted(draft.monthDays)
      const dayField = days.length > 0 ? days.join(',') : '1'
      return { scheduleType: 'cron', cronExpression: `${minute} ${hour} ${dayField} * *`, executeAt: null }
    }
    case 'once': {
      const date = parseLocalDateTime(draft.onceAt)
      return {
        scheduleType: 'once',
        cronExpression: '',
        executeAt: date ? date.toISOString() : null,
      }
    }
    case 'custom':
    default:
      return {
        scheduleType: 'cron',
        cronExpression: (draft.cronExpression || '').trim(),
        executeAt: null,
      }
  }
}

interface TaskLike {
  scheduleType: 'cron' | 'once'
  cronExpression: string
  executeAt?: string | null
}

/** 已有任务 → 调度句状态；无法识别的 cron 落到 custom 并原样保留 */
export function parseSchedule(task: TaskLike): ScheduleDraft {
  const draft = createDefaultScheduleDraft()

  if (task.scheduleType === 'once') {
    draft.frequency = 'once'
    const date = task.executeAt ? new Date(task.executeAt) : null
    draft.onceAt = date && !Number.isNaN(date.getTime()) ? toLocalDateTimeString(date) : ''
    return draft
  }

  const parsed = parseCronExpression(task.cronExpression)
  if (parsed) return parsed

  // 无法识别 → 自定义，原样保留表达式，绝不重新解释
  draft.frequency = 'custom'
  draft.cronExpression = task.cronExpression || ''
  return draft
}

/** cron → 调度句状态；只识别本 UI 能无损表达的模式 */
export function parseCronExpression(expr: string): ScheduleDraft | null {
  const parts = (expr || '').trim().split(/\s+/)
  if (parts.length !== 5) return null
  const [minStr, hourStr, domStr, monthStr, dowStr] = parts

  if (!/^\d+$/.test(minStr)) return null
  const minute = Number(minStr)
  const draft = createDefaultScheduleDraft()
  draft.minute = minute
  draft.cronExpression = expr.trim()

  // 月份受限的表达式无法用调度句表达，保留为自定义
  if (monthStr !== '*') return null

  // 每小时：M * * * *
  if (hourStr === '*' && domStr === '*' && dowStr === '*') {
    draft.frequency = 'hourly'
    return draft
  }

  // 每 N 小时：M */N * * *（星期为全量或 * 时等价于每天）
  if (hourStr.startsWith('*/') && domStr === '*' && isEveryDayDow(dowStr)) {
    const interval = Number(hourStr.slice(2))
    if (!Number.isInteger(interval) || interval < 1 || interval > 23) return null
    draft.frequency = 'every_hours'
    draft.intervalHours = interval
    return draft
  }

  if (!/^\d+$/.test(hourStr)) return null
  const hour = Number(hourStr)
  if (hour < 0 || hour > 23) return null
  draft.hour = hour

  // 每天：M H * * *
  if (domStr === '*' && dowStr === '*') {
    draft.frequency = 'daily'
    return draft
  }

  // 工作日：M H * * 1-5
  if (domStr === '*' && dowStr === '1-5') {
    draft.frequency = 'weekdays'
    return draft
  }

  // 每周：M H * * 0,1,…
  if (domStr === '*') {
    const weekdays = parseNumberList(dowStr, 0, 6)
    if (!weekdays || weekdays.length === 0) return null
    if (weekdays.length === 7) {
      draft.frequency = 'daily'
      return draft
    }
    if (weekdays.join(',') === '1,2,3,4,5') {
      draft.frequency = 'weekdays'
      return draft
    }
    draft.frequency = 'weekly'
    draft.weekdays = weekdays
    return draft
  }

  // 每月：M H 1,15 * *
  if (dowStr === '*') {
    const monthDays = parseNumberList(domStr, 1, 31)
    if (!monthDays || monthDays.length === 0) return null
    draft.frequency = 'monthly'
    draft.monthDays = monthDays
    return draft
  }

  // 同时限定日期与星期（如 1,15 * 1）无法用简单调度句表达
  return null
}

function isEveryDayDow(dow: string): boolean {
  if (dow === '*') return true
  const days = parseNumberList(dow, 0, 6)
  return !!days && days.length === 7
}

function parseNumberList(value: string, min: number, max: number): number[] | null {
  const result: number[] = []
  for (const raw of value.split(',')) {
    const piece = raw.trim()
    if (!/^\d+$/.test(piece)) return null
    const num = Number(piece)
    if (num < min || num > max) return null
    result.push(num)
  }
  return uniqueSorted(result)
}

// ───────────────────────── 展示与校验 ─────────────────────────

type TFn = (key: string, named?: Record<string, string | number>) => string

const WEEKDAY_KEYS = [
  'common.weekday.sunday',
  'common.weekday.monday',
  'common.weekday.tuesday',
  'common.weekday.wednesday',
  'common.weekday.thursday',
  'common.weekday.friday',
  'common.weekday.saturday',
]

function formatTime(hour: number, minute: number): string {
  return `${pad2(hour)}:${pad2(minute)}`
}

function formatWeekdays(days: number[], t: TFn): string {
  return uniqueSorted(days)
    .map((day) => t(WEEKDAY_KEYS[day] ?? WEEKDAY_KEYS[0]))
    .join(t('scheduler.format.listSeparator'))
}

function formatMonthDays(days: number[], t: TFn): string {
  return uniqueSorted(days)
    .map((day) => t('scheduler.format.dayOfMonth', { day }))
    .join(t('scheduler.format.listSeparator'))
}

function formatLocaleDateTime(date: Date, locale: string, withYear = false): string {
  const options: Intl.DateTimeFormatOptions = {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }
  if (withYear) options.year = 'numeric'
  return new Intl.DateTimeFormat(locale, options).format(date)
}

/** 人类可读的一句话调度摘要（卡片、编辑页共用） */
export function describeSchedule(task: TaskLike, t: TFn, locale: string): string {
  const draft = parseSchedule(task)

  if (draft.frequency === 'once') {
    if (!task.executeAt) return t('scheduler.describe.custom')
    const date = new Date(task.executeAt)
    if (Number.isNaN(date.getTime())) return t('scheduler.describe.custom')
    return t('scheduler.describe.once', { time: formatLocaleDateTime(date, locale, true) })
  }

  switch (draft.frequency) {
    case 'hourly':
      return t('scheduler.describe.hourly', { minute: pad2(draft.minute) })
    case 'every_hours':
      return t('scheduler.describe.everyHours', {
        interval: draft.intervalHours,
        minute: pad2(draft.minute),
      })
    case 'daily':
      return t('scheduler.describe.daily', { time: formatTime(draft.hour, draft.minute) })
    case 'weekdays':
      return t('scheduler.describe.weekdays', { time: formatTime(draft.hour, draft.minute) })
    case 'weekly':
      return t('scheduler.describe.weekly', {
        days: formatWeekdays(draft.weekdays, t),
        time: formatTime(draft.hour, draft.minute),
      })
    case 'monthly':
      return t('scheduler.describe.monthly', {
        days: formatMonthDays(draft.monthDays, t),
        time: formatTime(draft.hour, draft.minute),
      })
    default:
      return t('scheduler.describe.custom')
  }
}

/** 校验调度句；返回 i18n key，null 表示通过 */
export function validateScheduleDraft(draft: ScheduleDraft): string | null {
  switch (draft.frequency) {
    case 'weekly':
      if (uniqueSorted(draft.weekdays).length === 0) return 'scheduler.validation.selectWeekday'
      break
    case 'monthly':
      if (uniqueSorted(draft.monthDays).length === 0) return 'scheduler.validation.selectMonthDay'
      break
    case 'once': {
      const date = parseLocalDateTime(draft.onceAt)
      if (!date) return 'scheduler.validation.selectOnceTime'
      if (date.getTime() <= Date.now()) return 'scheduler.validation.onceTimeInPast'
      break
    }
    case 'custom':
      if (!isValidCronExpression(draft.cronExpression)) return 'scheduler.validation.cronInvalid'
      break
    default:
      break
  }
  return null
}

/**
 * 计算下次运行时间。
 *
 * custom 无法在前端安全推算，返回 null（保存后使用后端的 nextRunAt）。
 */
export function computeNextRun(draft: ScheduleDraft, now = new Date()): Date | null {
  if (draft.frequency === 'custom') return null

  if (draft.frequency === 'once') {
    const date = parseLocalDateTime(draft.onceAt)
    return date && date.getTime() > now.getTime() ? date : null
  }

  const minute = Math.min(59, Math.max(0, Math.floor(draft.minute)))
  const hour = Math.min(23, Math.max(0, Math.floor(draft.hour)))

  if (draft.frequency === 'hourly') {
    const candidate = new Date(now)
    candidate.setSeconds(0, 0)
    if (candidate.getMinutes() > minute) candidate.setHours(candidate.getHours() + 1)
    candidate.setMinutes(minute)
    return candidate
  }

  if (draft.frequency === 'every_hours') {
    const interval = Math.min(23, Math.max(1, Math.floor(draft.intervalHours)))
    const candidate = new Date(now)
    candidate.setSeconds(0, 0)
    candidate.setMinutes(minute)
    for (let i = 0; i < 48; i++) {
      if (candidate.getHours() % interval === 0 && candidate.getTime() > now.getTime()) {
        return candidate
      }
      candidate.setHours(candidate.getHours() + 1)
      candidate.setMinutes(minute)
    }
    return null
  }

  if (draft.frequency === 'daily') {
    return nextAtTime(now, hour, minute, () => true)
  }

  if (draft.frequency === 'weekdays') {
    return nextAtTime(now, hour, minute, (date) => date.getDay() >= 1 && date.getDay() <= 5)
  }

  if (draft.frequency === 'weekly') {
    const days = new Set(uniqueSorted(draft.weekdays))
    if (days.size === 0) return null
    return nextAtTime(now, hour, minute, (date) => days.has(date.getDay()))
  }

  if (draft.frequency === 'monthly') {
    const days = new Set(uniqueSorted(draft.monthDays))
    if (days.size === 0) return null
    return nextAtTime(now, hour, minute, (date) => days.has(date.getDate()))
  }

  return null
}

function nextAtTime(
  now: Date,
  hour: number,
  minute: number,
  matchDay: (date: Date) => boolean,
): Date | null {
  const candidate = new Date(now)
  candidate.setSeconds(0, 0)
  // 最多向后找 400 天（覆盖 2 月 29 日等极端月份组合）
  for (let i = 0; i < 400; i++) {
    candidate.setHours(hour, minute, 0, 0)
    if (matchDay(candidate) && candidate.getTime() > now.getTime()) {
      return candidate
    }
    candidate.setDate(candidate.getDate() + 1)
  }
  return null
}

/** 下次运行的相对文案：今天/明天 HH:mm，其余用本地化日期 */
export function formatNextRun(date: Date, t: TFn, locale: string, now = new Date()): string {
  const time = new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)

  const dayKey = (value: Date) =>
    `${value.getFullYear()}-${value.getMonth()}-${value.getDate()}`

  if (dayKey(date) === dayKey(now)) return t('scheduler.format.today', { time })

  const tomorrow = new Date(now)
  tomorrow.setDate(tomorrow.getDate() + 1)
  if (dayKey(date) === dayKey(tomorrow)) return t('scheduler.format.tomorrow', { time })

  return formatLocaleDateTime(date, locale, date.getFullYear() !== now.getFullYear())
}

/** 卡片上的「下次运行 …」；已暂停或没有下次时间时返回 null */
export function formatTaskNextRun(
  task: { nextRunAt?: string | null; enabled?: boolean },
  t: TFn,
  locale: string,
  now = new Date(),
): string | null {
  if (task.enabled === false) return null
  if (!task.nextRunAt) return null
  const date = new Date(task.nextRunAt)
  if (Number.isNaN(date.getTime())) return null
  return formatNextRun(date, t, locale, now)
}
