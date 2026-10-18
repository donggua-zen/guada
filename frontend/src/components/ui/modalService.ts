import { ref, shallowReactive, type Ref, type VNode } from 'vue'
import { ElMessage } from 'element-plus'
import { t } from '@/locales'
import { getErrorMessage } from '@/utils/errorMessage'

export type DialogSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | 'full'
export type ModalIcon = 'none' | 'info' | 'success' | 'warning' | 'error'

export interface ModalInputOptions {
  type?: 'text' | 'password'
  defaultValue?: string
  placeholder?: string
  required?: boolean
  requiredMessage?: string
  /** 返回错误文案表示校验失败；返回 null 表示通过。 */
  validator?: (value: string) => string | null
}

export interface ModalTextareaOptions {
  defaultValue?: string
  placeholder?: string
  rows?: number
  required?: boolean
  requiredMessage?: string
}

export interface ModalOptions {
  title?: string
  content?: string | VNode
  /** 字符串内容是否按 HTML 渲染。默认 false，只有可信内容才应开启。 */
  html?: boolean
  icon?: ModalIcon
  size?: DialogSize
  showCancel?: boolean
  confirmText?: string
  cancelText?: string
  danger?: boolean
  input?: ModalInputOptions
  textarea?: ModalTextareaOptions
  /** 返回 false 时保持弹窗打开，可用于异步校验。 */
  beforeConfirm?: (value: string) => boolean | Promise<boolean>
  closeOnClickModal?: boolean
  closeOnPressEscape?: boolean
}

export interface ModalResult {
  action: 'confirm' | 'cancel' | 'close'
  value?: string
}

export interface ModalEntry {
  id: number
  options: ModalOptions
  resolve: (result: ModalResult) => void
  inputValue: Ref<string>
  loading: Ref<boolean>
  visible: Ref<boolean>
  pendingResult: ModalResult | null
}

/**
 * 当前打开的弹窗队列。宿主组件 GdDialogHost 负责渲染，业务侧只通过
 * openModal / closeAllModals 操作，避免声明式与命令式两套状态。
 */
export const modalStack = shallowReactive<ModalEntry[]>([])

let sequence = 0

export function openModal(options: ModalOptions = {}): Promise<ModalResult> {
  return new Promise((resolve) => {
    const entry: ModalEntry = {
      id: ++sequence,
      options,
      resolve,
      inputValue: ref(options.input?.defaultValue ?? options.textarea?.defaultValue ?? ''),
      loading: ref(false),
      visible: ref(true),
      pendingResult: null,
    }
    modalStack.push(entry)
  })
}

export function settleModal(entry: ModalEntry, result: ModalResult): void {
  const index = modalStack.indexOf(entry)
  if (index < 0) return
  modalStack.splice(index, 1)
  entry.resolve(result)
}

export function requestCloseModal(entry: ModalEntry, result: ModalResult): void {
  if (entry.pendingResult) return
  entry.pendingResult = result
  entry.visible.value = false
}

/** 弹窗自身触发关闭（X / ESC / 遮罩）时调用，统一归为 close。 */
export function handleModalVisibility(entry: ModalEntry, visible: boolean): void {
  if (!visible) {
    requestCloseModal(entry, { action: 'close' })
  }
}

/** 离场动画结束后由宿主调用，真正从队列移除并 resolve。 */
export function finishModal(entry: ModalEntry): void {
  settleModal(entry, entry.pendingResult ?? { action: 'close' })
}

export function cancelModal(entry: ModalEntry): void {
  requestCloseModal(entry, { action: 'cancel' })
}

export async function submitModal(entry: ModalEntry): Promise<void> {
  const { options } = entry
  const rawValue = entry.inputValue.value
  const value = rawValue.trim()

  if (options.input) {
    if (options.input.required && !value) {
      ElMessage.error(options.input.requiredMessage || t('session.popup.contentRequired'))
      return
    }
    if (options.input.validator) {
      const message = options.input.validator(value)
      if (message) {
        ElMessage.error(message)
        return
      }
    }
  }

  if (options.textarea && options.textarea.required && !value) {
    ElMessage.error(options.textarea.requiredMessage || t('session.popup.contentRequired'))
    return
  }

  if (options.beforeConfirm) {
    entry.loading.value = true
    try {
      const allowed = await options.beforeConfirm(rawValue)
      if (!allowed) return
    } catch (error) {
      ElMessage.error(getErrorMessage(error) || t('session.popup.invalidInput'))
      return
    } finally {
      entry.loading.value = false
    }
  }

  requestCloseModal(entry, { action: 'confirm', value: rawValue })
}

export function closeAllModals(): void {
  for (const entry of [...modalStack]) {
    requestCloseModal(entry, { action: 'close' })
  }
}
