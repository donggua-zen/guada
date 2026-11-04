import { describe, expect, it } from 'vitest'
import { resolveWorkspaceChoiceMode } from './workspaceChoice'

/**
 * 「上次选择」的模式推断。
 *
 * 三个入口（新建页工具栏 / 定时任务编辑器 / 侧栏分组「+」）共用这份判定：
 * 判错会让记忆失效 —— 例如把公共目录记成 custom，下次 public 分支就走不到，
 * 转而依赖 recentList 是否仍包含它。
 */
describe('resolveWorkspaceChoiceMode', () => {
  const publicPath = 'D:/AI/work/public'

  it('null → auto（不指定目录，后端生成随机目录）', () => {
    expect(resolveWorkspaceChoiceMode(null, publicPath)).toBe('auto')
    expect(resolveWorkspaceChoiceMode(null, null)).toBe('auto')
  })

  it('等于公共目录 → public', () => {
    expect(resolveWorkspaceChoiceMode(publicPath, publicPath)).toBe('public')
  })

  it('其它绝对路径 → custom', () => {
    expect(resolveWorkspaceChoiceMode('D:/AI/alpha', publicPath)).toBe('custom')
  })

  it('公共目录未知时，路径只能记为 custom', () => {
    expect(resolveWorkspaceChoiceMode(publicPath, null)).toBe('custom')
  })
})
