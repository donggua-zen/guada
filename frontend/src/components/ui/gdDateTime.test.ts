import { describe, expect, it } from 'vitest'
import {
  buildMonthCells,
  combineDateTime,
  combineTime,
  daysInMonth,
  sameDay,
  splitDateTime,
  toLocalDateTimeString,
} from './gdDateTime'

describe('daysInMonth', () => {
  it('普通月份与二月', () => {
    expect(daysInMonth(2026, 1)).toBe(31)
    expect(daysInMonth(2026, 4)).toBe(30)
    expect(daysInMonth(2026, 2)).toBe(28)
  })

  it('闰年二月', () => {
    expect(daysInMonth(2024, 2)).toBe(29)
    expect(daysInMonth(2000, 2)).toBe(29)
    expect(daysInMonth(1900, 2)).toBe(28)
  })
})

describe('buildMonthCells', () => {
  it('固定 42 格且全部落在 6 周内', () => {
    for (const month of [1, 2, 7, 12]) {
      const cells = buildMonthCells(2026, month)
      expect(cells).toHaveLength(42)
    }
  })

  it('2026-11：首日周日，第一格就是 11-01，本月 30 格', () => {
    const cells = buildMonthCells(2026, 11)
    expect(cells[0].date.getFullYear()).toBe(2026)
    expect(cells[0].date.getMonth()).toBe(10)
    expect(cells[0].date.getDate()).toBe(1)
    expect(cells.filter((c) => c.inMonth)).toHaveLength(30)
  })

  it('2026-02：本月 28 格，前后月补位 14 格', () => {
    const cells = buildMonthCells(2026, 2)
    expect(cells.filter((c) => c.inMonth)).toHaveLength(28)
    expect(cells.filter((c) => !c.inMonth)).toHaveLength(14)
  })

  it('跨年补位：2026-01 的首格在 2025-12', () => {
    const cells = buildMonthCells(2026, 1)
    // 2026-01-01 是周四，首格回退到 2025-12-28（周日）
    expect(cells[0].date.getFullYear()).toBe(2025)
    expect(cells[0].date.getMonth()).toBe(11)
  })

  it('每周日开头', () => {
    const cells = buildMonthCells(2026, 11)
    for (let week = 0; week < 6; week += 1) {
      expect(cells[week * 7].date.getDay()).toBe(0)
    }
  })
})

describe('sameDay', () => {
  it('同日为真，跨月/跨年为假', () => {
    expect(sameDay(new Date(2026, 10, 2), new Date(2026, 10, 2))).toBe(true)
    expect(sameDay(new Date(2026, 10, 2, 8), new Date(2026, 10, 2, 23))).toBe(true)
    expect(sameDay(new Date(2026, 10, 2), new Date(2026, 9, 2))).toBe(false)
    expect(sameDay(new Date(2026, 11, 1), new Date(2027, 0, 1))).toBe(false)
  })
})

describe('toLocalDateTimeString / splitDateTime 往返', () => {
  it('往返一致', () => {
    const date = new Date(2026, 10, 2, 9, 5, 3)
    const str = toLocalDateTimeString(date)
    expect(str).toBe('2026-11-02 09:05:03')
    const parts = splitDateTime(str)
    expect(parts).toEqual({ y: 2026, m: 11, d: 2, h: 9, mi: 5, s: 3 })
  })

  it('16 字符 HH:mm 输入补 :00', () => {
    expect(splitDateTime('2026-11-02 09:05')).toEqual({ y: 2026, m: 11, d: 2, h: 9, mi: 5, s: 0 })
  })

  it('空/非法回退当前时间', () => {
    const now = new Date()
    for (const input of ['', undefined, 'not a date', '2026-13-40 99:99:99']) {
      const parts = splitDateTime(input)
      expect(parts.y).toBe(now.getFullYear())
      expect(parts.m).toBe(now.getMonth() + 1)
      expect(parts.d).toBe(now.getDate())
    }
  })

  it('月日越界（2 月 30 日）回退', () => {
    const now = new Date()
    expect(splitDateTime('2026-02-30 10:00:00').d).toBe(now.getDate())
  })
})

describe('combineDateTime / combineTime', () => {
  it('组合并 clamp 越界值', () => {
    const date = new Date(2026, 10, 2)
    expect(combineDateTime(date, 8, 5, 9)).toBe('2026-11-02 08:05:09')
    expect(combineDateTime(date, 24, -1, 60)).toBe('2026-11-02 23:00:59')
  })

  it('combineTime 补零', () => {
    expect(combineTime(9, 5)).toBe('09:05')
    expect(combineTime(23, 59)).toBe('23:59')
    expect(combineTime(-1, 90)).toBe('00:59')
  })
})
