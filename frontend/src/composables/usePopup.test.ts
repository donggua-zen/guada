import { beforeEach, describe, expect, it, vi } from 'vitest'
import { usePopup } from './usePopup'
import { openModal } from '@/components/ui/modalService'

// mock 掉 modalService：断言门面传给 openModal 的 options 展开
vi.mock('@/components/ui/modalService', () => ({
  openModal: vi.fn(),
}))

const openModalMock = vi.mocked(openModal)

function resolveConfirm(value = ''): void {
  // 模拟 modalService.submitModal 的真实行为：提交口 trim（收口后的一致契约）
  openModalMock.mockResolvedValueOnce({ action: 'confirm', value: value.trim() })
}

beforeEach(() => {
  openModalMock.mockReset()
})

describe('usePopup', () => {
  it('confirm 展开 i18n 默认值并把 type 映射为 icon', async () => {
    resolveConfirm()
    const { confirm } = usePopup()
    const ok = await confirm('标题', '内容')

    expect(ok).toBe(true)
    expect(openModalMock).toHaveBeenCalledWith(expect.objectContaining({
      title: '标题',
      content: '内容',
      icon: 'warning', // 默认 type
      size: 'xs',
      showCancel: true,
      danger: false, // 非 error 型不默认危险色
      closeOnClickModal: false,
    }))
  })

  it('confirm 的 danger 默认跟 type=error 走，显式 zIndex 条件透传', async () => {
    resolveConfirm()
    const { confirm } = usePopup()
    await confirm('a', 'b', { type: 'error' })
    expect(openModalMock).toHaveBeenCalledWith(expect.objectContaining({ danger: true, icon: 'error' }))

    resolveConfirm()
    await confirm('a', 'b', { zIndex: 3500 })
    expect(openModalMock).toHaveBeenCalledWith(expect.objectContaining({ zIndex: 3500 }))

    resolveConfirm()
    await confirm('a', 'b') // 不传 zIndex 时 options 里不应出现 zIndex 键
    const arg = openModalMock.mock.calls[openModalMock.mock.calls.length - 1][0]
    expect(arg).not.toHaveProperty('zIndex')
  })

  it('confirm 非确认动作返回 false', async () => {
    openModalMock.mockResolvedValueOnce({ action: 'cancel' })
    const { confirm } = usePopup()
    await expect(confirm('a', 'b')).resolves.toBe(false)
  })

  it('prompt 透传 validation 并确认时返回值', async () => {
    const validation = (v: string) => (v.length > 3 ? null : '太短')
    resolveConfirm('  abc  ')
    const { prompt } = usePopup()
    const value = await prompt('输入', { validation, placeholder: 'p' })

    expect(value).toBe('abc')
    expect(openModalMock).toHaveBeenCalledWith(expect.objectContaining({
      input: expect.objectContaining({
        type: 'text',
        required: true,
        placeholder: 'p',
        validator: validation, // 门面以 modalService 的字段名直接透传，不再有布尔/字符串适配层
      }),
    }))
  })

  it('prompt 取消返回 null', async () => {
    openModalMock.mockResolvedValueOnce({ action: 'cancel' })
    const { prompt } = usePopup()
    await expect(prompt('输入')).resolves.toBeNull()
  })

  it('editText 展开默认值（保存按钮 / 6 行 / sm 尺寸），value 由 mock 透传', async () => {
    resolveConfirm('多行内容')
    const { editText } = usePopup()
    const value = await editText()

    expect(value).toBe('多行内容')
    expect(openModalMock).toHaveBeenCalledWith(expect.objectContaining({
      size: 'sm',
      textarea: expect.objectContaining({ rows: 6, required: true }),
      confirmText: expect.any(String),
    }))
  })
})
