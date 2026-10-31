import { describe, expect, it } from 'vitest'
import {
  buildSchedule,
  computeNextRun,
  createDefaultScheduleDraft,
  describeSchedule,
  parseCronExpression,
  parseSchedule,
  validateScheduleDraft,
} from './schedule'

const t = (key: string, named?: Record<string, any>) =>
  named ? `${key}:${JSON.stringify(named)}` : key

describe('schedule builder', () => {
  it('generates the supported cron shapes', () => {
    expect(buildSchedule({ ...createDefaultScheduleDraft(), frequency: 'hourly', minute: 15 }))
      .toMatchObject({ scheduleType: 'cron', cronExpression: '15 * * * *' })
    expect(
      buildSchedule({
        ...createDefaultScheduleDraft(),
        frequency: 'every_hours',
        minute: 0,
        intervalHours: 2,
      }),
    ).toMatchObject({ cronExpression: '0 */2 * * *' })
    expect(buildSchedule({ ...createDefaultScheduleDraft(), frequency: 'daily', hour: 9, minute: 0 }))
      .toMatchObject({ cronExpression: '0 9 * * *' })
    expect(buildSchedule({ ...createDefaultScheduleDraft(), frequency: 'weekdays', hour: 18, minute: 30 }))
      .toMatchObject({ cronExpression: '30 18 * * 1-5' })
    expect(
      buildSchedule({
        ...createDefaultScheduleDraft(),
        frequency: 'weekly',
        hour: 8,
        minute: 0,
        weekdays: [3, 1, 1],
      }),
    ).toMatchObject({ cronExpression: '0 8 * * 1,3' })
    expect(
      buildSchedule({
        ...createDefaultScheduleDraft(),
        frequency: 'monthly',
        hour: 9,
        minute: 0,
        monthDays: [15, 1],
      }),
    ).toMatchObject({ cronExpression: '0 9 1,15 * *' })
  })

  it('creates a once schedule from a local datetime', () => {
    const value = buildSchedule({
      ...createDefaultScheduleDraft(),
      frequency: 'once',
      onceAt: '2030-05-20 08:30:00',
    })
    expect(value.scheduleType).toBe('once')
    expect(value.cronExpression).toBe('')
    expect(new Date(value.executeAt!).getFullYear()).toBe(2030)
    expect(new Date(value.executeAt!).getMinutes()).toBe(30)
  })
})

describe('schedule parser', () => {
  it('parses the legacy every-2-hours expression with all weekdays', () => {
    const draft = parseCronExpression('0 */2 * * 0,1,2,3,4,5,6')
    expect(draft).toMatchObject({ frequency: 'every_hours', intervalHours: 2, minute: 0 })
  })

  it('parses hourly, daily, weekdays, weekly and monthly', () => {
    expect(parseCronExpression('15 * * * *')).toMatchObject({ frequency: 'hourly', minute: 15 })
    expect(parseCronExpression('0 9 * * *')).toMatchObject({ frequency: 'daily', hour: 9, minute: 0 })
    expect(parseCronExpression('30 18 * * 1-5')).toMatchObject({ frequency: 'weekdays' })
    expect(parseCronExpression('0 8 * * 1,3')).toMatchObject({ frequency: 'weekly', weekdays: [1, 3] })
    expect(parseCronExpression('0 9 1,15 * *')).toMatchObject({ frequency: 'monthly', monthDays: [1, 15] })
  })

  it('does not misread a numeric month as a once task', () => {
    // 6 月 1 日每天 9 点：旧实现会误判为一次性任务
    expect(parseCronExpression('0 9 1 6 *')).toBeNull()
    const draft = parseSchedule({
      scheduleType: 'cron',
      cronExpression: '0 9 1 6 *',
      executeAt: null,
    })
    expect(draft.frequency).toBe('custom')
    expect(draft.cronExpression).toBe('0 9 1 6 *')
  })

  it('uses scheduleType/executeAt for once tasks', () => {
    const draft = parseSchedule({
      scheduleType: 'once',
      cronExpression: '',
      executeAt: '2030-05-20T00:30:00.000Z',
    })
    expect(draft.frequency).toBe('once')
    expect(draft.onceAt).toMatch(/^2030-05-20/)
  })

  it('leaves unrecognized expressions untouched', () => {
    const draft = parseSchedule({
      scheduleType: 'cron',
      cronExpression: '0 9 */2 * *',
      executeAt: null,
    })
    expect(draft.frequency).toBe('custom')
    expect(draft.cronExpression).toBe('0 9 */2 * *')
  })
})

describe('schedule validation and next run', () => {
  it('rejects empty weekday/month-day selections and invalid cron', () => {
    expect(validateScheduleDraft({ ...createDefaultScheduleDraft(), frequency: 'weekly', weekdays: [] }))
      .toBe('scheduler.validation.selectWeekday')
    expect(validateScheduleDraft({ ...createDefaultScheduleDraft(), frequency: 'monthly', monthDays: [] }))
      .toBe('scheduler.validation.selectMonthDay')
    expect(validateScheduleDraft({ ...createDefaultScheduleDraft(), frequency: 'custom', cronExpression: 'bad' }))
      .toBe('scheduler.validation.cronInvalid')
  })

  it('computes the next daily occurrence', () => {
    const now = new Date(2030, 0, 1, 10, 0, 0)
    const next = computeNextRun({ ...createDefaultScheduleDraft(), frequency: 'daily', hour: 9, minute: 0 }, now)
    expect(next).not.toBeNull()
    expect(next!.getDate()).toBe(2)
    expect(next!.getHours()).toBe(9)
  })

  it('computes the next weekday occurrence', () => {
    // 2030-01-05 是周六，下一个工作日应为周一 1 月 7 日
    const now = new Date(2030, 0, 5, 10, 0, 0)
    const next = computeNextRun(
      { ...createDefaultScheduleDraft(), frequency: 'weekdays', hour: 9, minute: 0 },
      now,
    )
    expect(next!.getDay()).toBe(1)
    expect(next!.getDate()).toBe(7)
  })
})

describe('schedule description', () => {
  it('describes common schedules', () => {
    expect(
      describeSchedule({ scheduleType: 'cron', cronExpression: '0 9 * * *' }, t, 'zh-CN'),
    ).toContain('scheduler.describe.daily')
    expect(
      describeSchedule({ scheduleType: 'cron', cronExpression: '0 9 1,15 * *' }, t, 'zh-CN'),
    ).toContain('scheduler.describe.monthly')
    expect(
      describeSchedule({ scheduleType: 'once', cronExpression: '', executeAt: '2030-05-20T00:30:00.000Z' }, t, 'zh-CN'),
    ).toContain('scheduler.describe.once')
  })
})
