// src/composables/usePopup.ts
import { ref, h, type VNode } from 'vue'
import {
    ElMessageBox,
    ElMessage,
    ElNotification,
    ElButton,
    type ElMessageBoxOptions
} from 'element-plus'

/**
 * 确认对话框配置选项
 */
export interface ConfirmOptions {
    type?: 'success' | 'info' | 'warning' | 'error'
    confirmText?: string
    cancelText?: string
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
    validation?: (value: string) => boolean
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
}

/**
 * Toast 消息接口
 */
export interface ToastApi {
    success: (content: string, duration?: number) => void
    error: (content: string, duration?: number) => void
    warning: (content: string, duration?: number) => void
    info: (content: string, duration?: number) => void
    loading: (content: string, duration?: number) => any
}

/**
 * 通知消息接口
 */
export interface NotifyApi {
    success: (title: string, content: string, options?: any) => void
    error: (title: string, content: string, options?: any) => void
    warning: (title: string, content: string, options?: any) => void
    info: (title: string, content: string, options?: any) => void
}

/**
 * 加载状态接口
 */
export interface LoadingApi {
    start: (text?: string) => any
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
    toast: ToastApi
    notify: NotifyApi
    loading: LoadingApi
    closeAll: () => void
}

/**
 * 常用弹窗 Hook
 * 在 Vue 组件上下文中使用，确保主题和配置一致性
 */
export function usePopup(): UsePopupReturn {
    // const loadingBar = useLoadingBar()

    /**
     * 确认对话框
     */
    const confirm = (title: string, content: string, options: ConfirmOptions = {}): Promise<boolean> => {
        const {
            type = 'warning',
            confirmText = '确认',
            cancelText = '取消'
        } = options

        return new Promise((resolve) => {
            ElMessageBox({
                title,
                message: content,
                type,
                confirmButtonText: confirmText,
                cancelButtonText: cancelText,
                showCancelButton: true,
                distinguishCancelAndClose: true,
                dangerouslyUseHTMLString: true
            }).then(() => {
                resolve(true)
            }).catch(() => {
                resolve(false)
            })
        })
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
        return confirm(title, content, { ...options, type: 'error' })
    }

    /**
     * 单行输入弹窗
     */
    const prompt = (title: string, options: PromptOptions = {}): Promise<string | null> => {
        const {
            defaultValue = '',
            placeholder = '请输入内容',
            confirmText = '确认',
            cancelText = '取消',
            required = true,
            validation
        } = options

        return new Promise((resolve) => {
            ElMessageBox.prompt('', title, {
                confirmButtonText: confirmText,
                cancelButtonText: cancelText,
                inputPlaceholder: placeholder,
                inputValue: defaultValue,
                dangerouslyUseHTMLString: true,
                distinguishCancelAndClose: true
            }).then(({ value }) => {
                const inputValue = value.trim()

                if (required && !inputValue) {
                    ElMessage.error('内容不能为空')
                    return resolve(null)
                }

                if (validation && !validation(inputValue)) {
                    return resolve(null)
                }

                resolve(inputValue)
            }).catch(() => {
                resolve(null)
            })
        })
    }

    /**
     * 多行文本编辑弹窗
     */
    const editText = (options: EditTextOptions = {}): Promise<string | null> => {
        const {
            title = '编辑内容',
            defaultValue = '',
            placeholder = '请输入内容',
            confirmText = '保存',
            cancelText = '取消',
            required = true,
            rows = 6
        } = options

        // 使用 Element Plus 的 VNode 方式创建自定义内容
        const container: VNode = h('div', {
            style: {
                width: '100%',
                padding: '12px 0'
            }
        }, [
            h('textarea', {
                value: defaultValue,
                placeholder,
                style: {
                    width: '100%',
                    minHeight: `${rows * 24}px`,
                    padding: '12px',
                    border: '1px solid #dcdfe6',
                    borderRadius: '4px',
                    fontSize: '14px',
                    resize: 'vertical',
                    fontFamily: 'inherit',
                    boxSizing: 'border-box'
                },
                onInput: (e: Event) => {
                    // 注意：这里我们无法直接访问 textarea 元素
                    // 在 beforeClose 回调中仍然需要通过 DOM 查询获取值
                }
            })
        ])

        return new Promise((resolve) => {
            ElMessageBox({
                title,
                message: container,
                confirmButtonText: confirmText,
                cancelButtonText: cancelText,
                showCancelButton: true,
                distinguishCancelAndClose: true,
                customClass: 'w-full',
                beforeClose: (action, instance: any, done) => {
                    if (action === 'confirm') {
                        // 通过查询 DOM 获取 textarea 的值
                        const textarea = instance.message?.el?.querySelector('textarea')
                        const value = textarea ? textarea.value.trim() : ''

                        if (required && !value) {
                            ElMessage.error('内容不能为空')
                            return
                        }

                        done()
                        resolve(value)
                    } else {
                        done()
                        resolve(null)
                    }
                }
            }).catch(() => {
                resolve(null)
            })
        })
    }

    /**
     * 通用自定义对话框
     */
    const dialog = (options: { title: string; content: VNode | string; confirmText?: string; cancelText?: string }): Promise<boolean> => {
        return new Promise((resolve) => {
            ElMessageBox({
                title: options.title,
                message: options.content,
                confirmButtonText: options.confirmText || '确认',
                cancelButtonText: options.cancelText || '取消',
                showCancelButton: true,
                distinguishCancelAndClose: true,
            }).then(() => {
                resolve(true)
            }).catch(() => {
                resolve(false)
            })
        })
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

        loading: (content: string, duration: number = 0): any => {
            return (ElMessage as any).loading({
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
        success: (title: string, content: string, options: any = {}): void => {
            ElNotification.success({
                title,
                message: content,
                duration: 3000,
                ...options
            })
        },

        error: (title: string, content: string, options: any = {}): void => {
            ElNotification.error({
                title,
                message: content,
                duration: 5000,
                ...options
            })
        },

        warning: (title: string, content: string, options: any = {}): void => {
            ElNotification.warning({
                title,
                message: content,
                duration: 4000,
                ...options
            })
        },

        info: (title: string, content: string, options: any = {}): void => {
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
        start: (text?: string): any => {
            return toast.loading(text || '处理中...')
        },

        wrap: async <T>(promiseFn: Promise<T>, loadingText: string = '处理中...'): Promise<T> => {
            const hide = loading.start(loadingText)
            try {
                const result = await promiseFn
                // loading.finish()
                if (hide && typeof hide === 'function') hide()
                return result
            } catch (error) {
                if (hide && typeof hide === 'function') hide()
                throw error
            }
        }
    }

    /**
     * 关闭所有消息和弹窗
     */
    const closeAll = (): void => {
        ElMessage.closeAll()
        // ElMessageBox 没有 closeAll 方法
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
