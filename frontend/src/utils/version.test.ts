import { describe, it, expect } from 'vitest'
import { compareVersions, isVersionNewer } from './version'

describe('compareVersions', () => {
  it('按数字段比较，而不是字符串不相等', () => {
    expect(compareVersions('1.2.0', '1.0.0')).toBe(1)
    expect(compareVersions('1.0.0', '1.2.0')).toBe(-1)
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0)
  })

  it('数字段按数值比较（1.10 > 1.2）', () => {
    expect(isVersionNewer('1.10.0', '1.2.0')).toBe(true)
    expect(isVersionNewer('1.2.0', '1.10.0')).toBe(false)
  })

  it('支持 v 前缀与缺失段', () => {
    expect(isVersionNewer('v1.2.1', '1.2.0')).toBe(true)
    expect(compareVersions('1.2', '1.2.0')).toBe(0)
    expect(compareVersions('1.2.0.0', '1.2')).toBe(0)
  })

  it('正式版高于同版本号预发布版', () => {
    expect(isVersionNewer('1.0.0', '1.0.0-beta')).toBe(true)
    expect(isVersionNewer('1.0.0-beta', '1.0.0')).toBe(false)
  })

  it('预发布标识按数字感知排序', () => {
    expect(isVersionNewer('1.0.0-beta.2', '1.0.0-beta.1')).toBe(true)
    expect(isVersionNewer('1.0.0-beta.10', '1.0.0-beta.2')).toBe(true)
  })

  it('忽略 build metadata', () => {
    expect(compareVersions('1.2.0+build.1', '1.2.0+build.2')).toBe(0)
    expect(compareVersions('1.2.0-beta+sha', '1.2.0-beta')).toBe(0)
  })
})
