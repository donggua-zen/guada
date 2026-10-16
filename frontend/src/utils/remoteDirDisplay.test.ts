import { describe, it, expect } from 'vitest'
import {
  resolveRemoteDirNames,
  formatRemoteDirNames,
  REMOTE_DIR_NAME_SEPARATOR,
} from './remoteDirDisplay'

/**
 * 「远程目录」按钮提示文案合成测试
 *
 * 覆盖:
 * - ID → 名称解析(顺序保持、未知 ID 回退原始 ID)
 * - 折叠: 不超过 3 个全列; 超过只留前 3 个 + 折叠计数(选十来个时提示条仍然很短)
 */
const sources = [
  { id: 'c1', name: 'ai_chat' },
  { id: 'c2', name: 'gpu-box' },
  { id: 'c3', name: 'nas' },
]

describe('resolveRemoteDirNames', () => {
  it('按绑定顺序解析名称', () => {
    expect(resolveRemoteDirNames(['c2', 'c1'], sources)).toEqual(['gpu-box', 'ai_chat'])
  })

  it('清单里找不到的 ID 回退用原始 ID（已删除连接 / 清单未加载）', () => {
    expect(resolveRemoteDirNames(['c1', 'ghost'], sources)).toEqual(['ai_chat', 'ghost'])
    expect(resolveRemoteDirNames(['c1'], [])).toEqual(['c1'])
  })

  it('未绑定任何连接时为空列表', () => {
    expect(resolveRemoteDirNames([], sources)).toEqual([])
  })
})

describe('formatRemoteDirNames', () => {
  const moreLabel = (n: number) => `等 ${n} 个`

  it('空列表 → 空串（调用方据此不显示 tooltip）', () => {
    expect(formatRemoteDirNames([], moreLabel)).toBe('')
  })

  it('不超过 3 个：全部列出', () => {
    expect(formatRemoteDirNames(['ai_chat'], moreLabel)).toBe('ai_chat')
    expect(formatRemoteDirNames(['ai_chat', 'gpu-box', 'nas'], moreLabel)).toBe(
      `ai_chat${REMOTE_DIR_NAME_SEPARATOR}gpu-box${REMOTE_DIR_NAME_SEPARATOR}nas`,
    )
  })

  it('超过 3 个：只留前 3 个 + 折叠计数（选十来个时长度仍有界）', () => {
    const names = Array.from({ length: 12 }, (_, i) => `conn-${i + 1}`)
    expect(formatRemoteDirNames(names, moreLabel)).toBe(
      `conn-1${REMOTE_DIR_NAME_SEPARATOR}conn-2${REMOTE_DIR_NAME_SEPARATOR}conn-3 等 9 个`,
    )
  })

  it('折叠阈值可由调用方指定', () => {
    expect(formatRemoteDirNames(['a', 'b'], moreLabel, 1)).toBe('a 等 1 个')
  })
})
