import { describe, expect, it } from 'vitest'
import {
  normalizeConnectionName,
  validateConnectionName,
  type ConnectionNameRef,
} from './connectionNameValidation'

/**
 * 连接名称的就近校验规则。前后空格与编辑态自身排除必须与后端一致，
 * 否则会出现 Step 0 放行、最后保存才报 409 的交互回退。
 */
describe('validateConnectionName', () => {
  const connections: ConnectionNameRef[] = [
    { id: 'conn_a', name: '我的板子' },
    { id: 'conn_b', name: 'server-b' },
  ]

  it('空值及纯空格 → 必填', () => {
    expect(validateConnectionName('', connections)).toBe('required')
    expect(validateConnectionName('   ', connections)).toBe('required')
    expect(validateConnectionName(null, connections)).toBe('required')
    expect(validateConnectionName(undefined, connections)).toBe('required')
  })

  it('名称归一化为 trim 后的值', () => {
    expect(normalizeConnectionName('  server-c  ')).toBe('server-c')
  })

  it('新建同名（含前后空格）→ 已占用', () => {
    expect(validateConnectionName('我的板子', connections)).toBe('taken')
    expect(validateConnectionName('  我的板子  ', connections)).toBe('taken')
  })

  it('不同名称 → 通过', () => {
    expect(validateConnectionName('server-c', connections)).toBeNull()
  })

  it('编辑自身原名 → 通过', () => {
    expect(validateConnectionName('我的板子', connections, 'conn_a')).toBeNull()
    expect(validateConnectionName('  我的板子  ', connections, 'conn_a')).toBeNull()
  })

  it('编辑改成其他连接名 → 已占用', () => {
    expect(validateConnectionName('server-b', connections, 'conn_a')).toBe('taken')
  })

  it('空清单或加载失败时只做必填校验', () => {
    expect(validateConnectionName('server-c', [])).toBeNull()
    expect(validateConnectionName('server-c', null as unknown as ConnectionNameRef[])).toBeNull()
  })

  it('配置中已有带空格的旧名称时按归一化值判重', () => {
    const legacy: ConnectionNameRef[] = [{ id: 'conn_a', name: ' legacy ' }]
    expect(validateConnectionName('legacy', legacy)).toBe('taken')
  })
})
