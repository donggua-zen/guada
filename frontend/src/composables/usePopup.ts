// src/composables/usePopup.ts
import { type VNode } from 'vue'
import {
    ElMessage,
    ElNotification,
    type MessageHandler,
    type NotificationOptions
} from 'element-plus'
import { t } from '@/locales'
import {
    closeAllModals,
    openModal,
    type DialogSize
} from '@/components/ui/modalService'

/**
 * 确认对话框配置选项
 */
export interface ConfirmOptions {
    type?: 'success' | 'info' | 'warning' | 'error'
    confirmText?: string
    cancelText?: string
    /** 内容是否按 HTML 渲染。默认 false；只有可信内容才应显式开启。 */
    html?: boolean
    size?: DialogSize
    /** 确认按钮使用危险色（删除类操作）。 */
    danger?: boolean
}

/**
 * 输入弹窗配置选项
 */
export interface PromptOptions {
    defaultValue?: string
    placeholder?: string
    confirmText?: string
    cancelText?: string
    required?: boolean
    /** 返回 true 表示通过；返回字符串表示失败并展示该文案。 */
    validation?: (value: string) => boolean | string
    /** validation 返回 false 时展示的提示。 */
    validationMessage?: string
    inputType?: 'text' | 'password'
    size?: DialogSize
}

/**
 * 多行文本编辑配置
 */
export interface EditTextOptions {
    title?: string
    defaultValue?: string
    placeholder?: string
    confirmText?: string
    cancelText?: string
    required?: boolean
    rows?: number
    size?: DialogSize
}

/**
 * 单按钮提示框配置
 */
export interface AlertOptions {
    type?: 'info' | 'success' | 'warning' | 'error'
    confirmText?: string
    html?: boolean
    size?: DialogSize
}

/**
 * Toast 消息接口
 */
export interface ToastApi {
    success: (content: string, duration?: number) => void
    error: (content: string, duration?: number) => void
    warning: (content: string, duration?: number) => void
    info: (content: string, duration?: number) => void
    /** ElMessage.loading 的返回句柄（带 .close()；运行时始终有值，类型上保留 undefined 余地） */
    loading: (content: string, duration?: number) => MessageHandler | undefined
}

/**
 * 通知消息接口
 */
export interface NotifyApi {
    success: (title: string, content: string, options?: Partial<NotificationOptions>) => void
    error: (title: string, content: string, options?: Partial<NotificationOptions>) => void
    warning: (title: string, content: string, options?: Partial<NotificationOptions>) => void
    info: (title: string, content: string, options?: Partial<NotificationOptions>) => void
}

/**
 * 加载状态接口
 */
export interface LoadingApi {
    /** 返回 ElMessage.loading 的句柄（MessageHandler.close） */
    start: (text?: string) => MessageHandler | undefined
    wrap: <T>(promiseFn: Promise<T>, loadingText?: string) => Promise<T>
}

/**
 * usePopup 返回值类型
 */
export interface UsePopupReturn {
    confirm: (title: string, content: string, options?: ConfirmOptions) => Promise<boolean>
    confirmSuccess: (title: string, content: string, options?: ConfirmOptions) => Promise<boolean>
    confirmError: (title: string, content: string, options?: ConfirmOptions) => Promise<boolean>
    prompt: (title: string, options?: PromptOptions) => Promise<string | null>
    editText: (options?: EditTextOptions) => Promise<string | null>
    dialog: (options: { title: string; content: VNode | string; confirmText?: string; cancelText?: string }) => Promise<boolean>
    alert: (title: string, content: string, options?: AlertOptions) => Promise<boolean>
    toast: ToastApi
    notify: NotifyApi
    loading: LoadingApi
    closeAll: () => void
}

/**
 * 常用弹窗 Hook
 * 命令式弹窗统一委托给 GdDialogHost（底层 GdDialog），保证与声明式弹窗同源。
 */
export function usePopup(): UsePopupReturn {
    /**
     * 确认对话框
     */
    const confirm = async (
        title: string,
        content: string,
        options: ConfirmOptions = {}
    ): Promise<boolean> => {
        const {
            type = 'warning',
            confirmText = t('common.confirm'),
            cancelText = t('common.cancel'),
            html = false,
            size = 'xs',
            danger = type === 'error'
        } = options

        const result = await openModal({
            title,
            content,
            icon: type,
            html,
            size,
            showCancel: true,
            confirmText,
            cancelText,
            danger,
            closeOnClickModal: false
        })
        return result.action === 'confirm'
    }

    /**
     * 成功确认对话框
     */
    const confirmSuccess = (title: string, content: string, options: ConfirmOptions = {}): Promise<boolean> => {
        return confirm(title, content, { ...options, type: 'success' })
    }

    /**
     * 危险操作确认对话框
     */
    const confirmError = (title: string, content: string, options: ConfirmOptions = {}): Promise<boolean> => {
        return confirm(title, content, { ...options, type: 'error', danger: true })
    }

    /**
     * 单行输入弹窗
     */
    const prompt = async (title: string, options: PromptOptions = {}): Promise<string | null> => {
        const {
            defaultValue = '',
            placeholder = t('session.popup.inputPlaceholder'),
            confirmText = t('common.confirm'),
            cancelText = t('common.cancel'),
            required = true,
            validation,
            validationMessage = t('session.popup.invalidInput'),
            inputType = 'text',
            size = 'xs'
        } = options

        const result = await openModal({
            title,
            size,
            showCancel: true,
            confirmText,
            cancelText,
            closeOnClickModal: false,
            input: {
                type: inputType,
                defaultValue,
                placeholder,
                required,
                requiredMessage: t('session.popup.contentRequired'),
                validator: validation
                    ? (value: string) => {
                        const result = validation(value)
                        if (result === true) return null
                        return typeof result === 'string' ? result : validationMessage
                    }
                    : undefined
            }
        })

        return result.action === 'confirm' ? (result.value ?? '').trim() : null
    }

    /**
     * 多行文本编辑弹窗
     */
    const editText = async (options: EditTextOptions = {}): Promise<string | null> => {
        const {
            title = t('session.popup.editTitle'),
            defaultValue = '',
            placeholder = t('session.popup.inputPlaceholder'),
            confirmText = t('common.save'),
            cancelText = t('common.cancel'),
            required = true,
            rows = 6,
            size = 'sm'
        } = options

        const result = await openModal({
            title,
            size,
            showCancel: true,
            confirmText,
            cancelText,
            closeOnClickModal: false,
            textarea: {
                defaultValue,
                placeholder,
                rows,
                required,
                requiredMessage: t('session.popup.contentRequired')
            }
        })

        return result.action === 'confirm' ? (result.value ?? '').trim() : null
    }

    /**
     * 通用自定义对话框
     */
    const dialog = async (options: {
        title: string
        content: VNode | string
        confirmText?: string
        cancelText?: string
    }): Promise<boolean> => {
        const result = await openModal({
            title: options.title,
            content: options.content,
            size: 'sm',
            showCancel: true,
            confirmText: options.confirmText || t('common.confirm'),
            cancelText: options.cancelText || t('common.cancel'),
            closeOnClickModal: false
        })
        return result.action === 'confirm'
    }

    /**
     * 单按钮提示框
     */
    const alert = async (
        title: string,
        content: string,
        options: AlertOptions = {}
    ): Promise<boolean> => {
        const {
            type = 'info',
            confirmText = t('common.ok'),
            html = false,
            size = 'xs'
        } = options

        const result = await openModal({
            title,
            content,
            icon: type,
            html,
            size,
            showCancel: false,
            confirmText,
            closeOnClickModal: false
        })
        return result.action === 'confirm'
    }

    /**
     * Toast 消息提示
     */
    const toast: ToastApi = {
        success: (content: string, duration: number = 2000): void => {
            ElMessage.success({
                message: content,
                duration,
                showClose: true
            })
        },

        error: (content: string, duration: number = 3000): void => {
            ElMessage.error({
                message: content,
                duration,
                showClose: true
            })
        },

        warning: (content: string, duration: number = 2500): void => {
            ElMessage.warning({
                message: content,
                duration,
                showClose: true
            })
        },

        info: (content: string, duration: number = 2000): void => {
            ElMessage.info({
                message: content,
                duration,
                showClose: true
            })
        },

        loading: (content: string, duration: number = 0): MessageHandler | undefined => {
            // ElMessage.loading 不在 Element Plus 类型定义中，但运行时可用
            const messageFn = ElMessage as typeof ElMessage & {
                loading(opts: Record<string, unknown>): MessageHandler
            };
            return messageFn.loading({
                message: content,
                duration,
                showClose: true
            })
        }
    }

    /**
     * 通知消息
     */
    const notify: NotifyApi = {
        success: (title: string, content: string, options: Partial<NotificationOptions> = {}): void => {
            ElNotification.success({
                title,
                message: content,
                duration: 3000,
                ...options
            })
        },

        error: (title: string, content: string, options: Partial<NotificationOptions> = {}): void => {
            ElNotification.error({
                title,
                message: content,
                duration: 5000,
                ...options
            })
        },

        warning: (title: string, content: string, options: Partial<NotificationOptions> = {}): void => {
            ElNotification.warning({
                title,
                message: content,
                duration: 4000,
                ...options
            })
        },

        info: (title: string, content: string, options: Partial<NotificationOptions> = {}): void => {
            ElNotification.info({
                title,
                message: content,
                duration: 3000,
                ...options
            })
        }
    }

    /**
     * 加载状态管理
     */
    const loading: LoadingApi = {
        start: (text?: string): MessageHandler | undefined => {
            return toast.loading(text || t('session.popup.processing'))
        },

        wrap: async <T>(promiseFn: Promise<T>, loadingText: string = t('session.popup.processing')): Promise<T> => {
            const handler = loading.start(loadingText)
            try {
                const result = await promiseFn
                handler?.close()
                return result
            } catch (error) {
                handler?.close()
                throw error
            }
        }
    }

    /**
     * 关闭所有轻提示与命令式弹窗
     */
    const closeAll = (): void => {
        ElMessage.closeAll()
        closeAllModals()
    }

    return {
        // 确认对话框
        confirm,
        confirmSuccess,
        confirmError,

        // 输入弹窗
        prompt,
        editText,
        dialog,
        alert,

        // 消息提示
        toast,

        // 通知
        notify,

        // 加载状态
        loading,

        // 工具方法
        closeAll,
    }
}

export default usePopup
