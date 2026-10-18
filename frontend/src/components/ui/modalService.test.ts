import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ElMessage } from 'element-plus'
import {
  cancelModal,
  closeAllModals,
  finishModal,
  handleModalVisibility,
  modalStack,
  openModal,
  settleModal,
  submitModal,
} from './modalService'

function drain() {
  for (const entry of [...modalStack]) {
    settleModal(entry, { action: 'close' })
  }
}

beforeEach(() => {
  drain()
  vi.restoreAllMocks()
})

describe('modalService', () => {
  it('入队后可通过 finishModal 以 confirm 结果结束', async () => {
    const promise = openModal({ title: 'test' })
    expect(modalStack).toHaveLength(1)

    const entry = modalStack[0]
    await submitModal(entry)

    expect(entry.pendingResult).toEqual({ action: 'confirm', value: '' })
    expect(entry.visible.value).toBe(false)

    finishModal(entry)
    await expect(promise).resolves.toEqual({ action: 'confirm', value: '' })
    expect(modalStack).toHaveLength(0)
  })

  it('取消返回 cancel，弹窗自身关闭返回 close', async () => {
    const cancelPromise = openModal({ title: 'cancel' })
    const cancelEntry = modalStack[0]
    cancelModal(cancelEntry)
    finishModal(cancelEntry)
    await expect(cancelPromise).resolves.toEqual({ action: 'cancel' })

    const closePromise = openModal({ title: 'close' })
    const closeEntry = modalStack[0]
    handleModalVisibility(closeEntry, false)
    finishModal(closeEntry)
    await expect(closePromise).resolves.toEqual({ action: 'close' })
  })

  it('必填输入为空时保持打开并提示', async () => {
    const errorSpy = vi.spyOn(ElMessage, 'error').mockReturnValue(undefined as never)
    const promise = openModal({ title: 'input', input: { required: true } })
    const entry = modalStack[0]

    await submitModal(entry)

    expect(errorSpy).toHaveBeenCalled()
    expect(entry.visible.value).toBe(true)
    expect(entry.pendingResult).toBeNull()

    cancelModal(entry)
    finishModal(entry)
    await promise
  })

  it('beforeConfirm 返回 false 时保持打开', async () => {
    const promise = openModal({
      title: 'async',
      beforeConfirm: async () => false,
    })
    const entry = modalStack[0]

    await submitModal(entry)

    expect(entry.visible.value).toBe(true)
    expect(entry.pendingResult).toBeNull()

    cancelModal(entry)
    finishModal(entry)
    await promise
  })

  it('closeAllModals 关闭队列中的所有弹窗', async () => {
    const first = openModal({ title: 'first' })
    const second = openModal({ title: 'second' })
    expect(modalStack).toHaveLength(2)

    closeAllModals()
    expect(modalStack.every((entry) => entry.visible.value === false)).toBe(true)

    for (const entry of [...modalStack]) {
      finishModal(entry)
    }
    await expect(first).resolves.toEqual({ action: 'close' })
    await expect(second).resolves.toEqual({ action: 'close' })
  })
})
