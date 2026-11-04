import { describe, expect, it } from 'vitest'
import { resolveGroupWorkspacePath } from './newSessionEntry'

/**
 * 侧栏分组「新建会话」的目标目录解析。
 *
 * 关键约束：虚拟「通用」桶没有自身路径，必须显式落到公共目录——
 * 否则新建页会回退「上次选择」，可能落到别的项目目录（会话跑出「通用」桶）。
 */
describe('resolveGroupWorkspacePath', () => {
  const publicPath = 'D:/AI/work/public'

  it('真实目录分组 → 分组自身路径', () => {
    expect(
      resolveGroupWorkspacePath({ kind: 'workspace', path: 'D:\\AI\\alpha' }, publicPath),
    ).toBe('D:\\AI\\alpha')
  })

  it('目录分组缺路径 → 不指定（回退上次选择）', () => {
    expect(resolveGroupWorkspacePath({ kind: 'workspace', path: null }, publicPath)).toBeNull()
    expect(resolveGroupWorkspacePath({ kind: 'workspace' }, publicPath)).toBeNull()
  })

  it('「通用」桶 → 公共目录', () => {
    expect(resolveGroupWorkspacePath({ kind: 'general', path: null }, publicPath)).toBe(publicPath)
  })

  it('「通用」桶但公共目录未知 → 不指定', () => {
    expect(resolveGroupWorkspacePath({ kind: 'general', path: null }, null)).toBeNull()
  })

  it('无 kind（手工分组 / 置顶分区）→ 不指定', () => {
    expect(resolveGroupWorkspacePath({ path: 'D:\\AI\\alpha' }, publicPath)).toBeNull()
    expect(resolveGroupWorkspacePath({}, publicPath)).toBeNull()
  })
})
