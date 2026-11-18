import { describe, it, expect, beforeEach } from 'vitest'
import {
  DISCLOSURE_KEY_SEPARATOR,
  DISCLOSURE_MAX_ENTRIES,
  clearDisclosure,
  clearDisclosureForTurn,
  disclosureKey,
  disclosureSize,
  getDisclosure,
  resetDisclosureState,
  setDisclosure,
} from './disclosureState'

describe('disclosureKey', () => {
  it('由回合 id 与本地 id 组装，含分隔符', () => {
    expect(disclosureKey('turn-1', 'process-abc')).toBe(
      `turn-1${DISCLOSURE_KEY_SEPARATOR}process-abc`,
    )
  })

  it('不同回合的同名分组不会串键', () => {
    expect(disclosureKey('turn-1', 'process-abc')).not.toBe(
      disclosureKey('turn-2', 'process-abc'),
    )
  })
})

describe('disclosure state', () => {
  beforeEach(() => {
    resetDisclosureState()
  })

  it('未写入时返回 undefined（调用方按运行态派生）', () => {
    expect(getDisclosure(disclosureKey('t1', 'g1'))).toBeUndefined()
  })

  it('写入后可读回，且能覆盖', () => {
    const key = disclosureKey('t1', 'g1')
    setDisclosure(key, true)
    expect(getDisclosure(key)).toBe(true)
    setDisclosure(key, false)
    expect(getDisclosure(key)).toBe(false)
  })

  it('显式 false 与「从未写入」可区分', () => {
    const key = disclosureKey('t1', 'g1')
    setDisclosure(key, false)
    expect(getDisclosure(key)).toBe(false)
    expect(getDisclosure(disclosureKey('t1', 'other'))).toBeUndefined()
  })

  it('clearDisclosure 只清单个键', () => {
    const a = disclosureKey('t1', 'g1')
    const b = disclosureKey('t1', 'g2')
    setDisclosure(a, true)
    setDisclosure(b, true)
    clearDisclosure(a)
    expect(getDisclosure(a)).toBeUndefined()
    expect(getDisclosure(b)).toBe(true)
  })

  it('clearDisclosureForTurn 清掉该回合全部记录，不影响其他回合', () => {
    setDisclosure(disclosureKey('t1', 'g1'), true)
    setDisclosure(disclosureKey('t1', 'g2'), false)
    setDisclosure(disclosureKey('t2', 'g1'), true)
    clearDisclosureForTurn('t1')
    expect(getDisclosure(disclosureKey('t1', 'g1'))).toBeUndefined()
    expect(getDisclosure(disclosureKey('t1', 'g2'))).toBeUndefined()
    expect(getDisclosure(disclosureKey('t2', 'g1'))).toBe(true)
  })

  it('回合 id 是另一回合 id 的前缀时不会误清', () => {
    setDisclosure(disclosureKey('turn-1', 'g1'), true)
    setDisclosure(disclosureKey('turn-10', 'g1'), true)
    clearDisclosureForTurn('turn-1')
    expect(getDisclosure(disclosureKey('turn-1', 'g1'))).toBeUndefined()
    expect(getDisclosure(disclosureKey('turn-10', 'g1'))).toBe(true)
  })

  it('超过上限时按最久未触碰淘汰', () => {
    for (let i = 0; i < DISCLOSURE_MAX_ENTRIES; i += 1) {
      setDisclosure(disclosureKey('t1', `g${i}`), true)
    }
    expect(disclosureSize()).toBe(DISCLOSURE_MAX_ENTRIES)

    // 触碰最早的一条，使它不再是最旧
    setDisclosure(disclosureKey('t1', 'g0'), true)
    // 再写入一条，触发淘汰
    setDisclosure(disclosureKey('t1', 'new'), true)

    expect(disclosureSize()).toBe(DISCLOSURE_MAX_ENTRIES)
    expect(getDisclosure(disclosureKey('t1', 'g0'))).toBe(true)
    expect(getDisclosure(disclosureKey('t1', 'g1'))).toBeUndefined()
  })
})
