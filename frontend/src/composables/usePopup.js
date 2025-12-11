// src/composables/usePopup.js
import { ref, h } from 'vue'
import { useDialog, useMessage, useNotification, useLoadingBar } from 'naive-ui'

/**
 * 常用弹窗 Hook
 * 在 Vue 组件上下文中使用，确保主题和配置一致性
 */
export function usePopup() {
    const dialog = useDialog()
    const message = useMessage()
    const notification = useNotification()
    const loadingBar = useLoadingBar()

    /**
     * 确认对话框
     * @param {string} title - 标题
     * @param {string} content - 内容
     * @param {Object} options - 配置选项
     * @returns {Promise<boolean>}
     */
    const confirm = (title, content, options = {}) => {
        return new Promise((resolve) => {
            const {
                type = 'warning',
                confirmText = '确认',
                cancelText = '取消',
                showIcon = true
            } = options

            const dialogMethod = dialog[type] || dialog.warning

            dialogMethod({
                title,
                content,
                positiveText: confirmText,
                negativeText: cancelText,
                showIcon,
                onPositiveClick: () => resolve(true),
                onNegativeClick: () => resolve(false),
                onMaskClick: () => resolve(false)
            })
        })
    }

    /**
     * 成功确认对话框
     */
    const confirmSuccess = (title, content, options = {}) => {
        return confirm(title, content, { ...options, type: 'success' })
    }

    /**
     * 危险操作确认对话框
     */
    const confirmError = (title, content, options = {}) => {
        return confirm(title, content, { ...options, type: 'error' })
    }

    /**
     * 单行输入弹窗
     * @param {string} title - 标题
     * @param {Object} options - 配置选项
     * @returns {Promise<string|null>}
     */
    const prompt = (title, options = {}) => {
        const {
            defaultValue = '',
            placeholder = '请输入内容',
            confirmText = '确认',
            cancelText = '取消',
            required = true,
            validation
        } = options

        const inputValue = ref(defaultValue)

        return new Promise((resolve) => {
            dialog.create({
                title,
                content: () => h('div', [
                    h('input', {
                        value: inputValue.value,
                        placeholder,
                        onInput: (e) => { inputValue.value = e.target.value },
                        style: {
                            width: '100%',
                            padding: '8px 12px',
                            border: '1px solid #d0d0d0',
                            borderRadius: '4px',
                            fontSize: '14px'
                        },
                        onKeydown: (e) => {
                            if (e.key === 'Enter') {
                                e.target.closest('.n-dialog__action').querySelector('.UiButton--primary-type').click()
                            }
                        }
                    })
                ]),
                positiveText: confirmText,
                negativeText: cancelText,
                onPositiveClick: () => {
                    const value = inputValue.value.trim()

                    if (required && !value) {
                        message.error('内容不能为空')
                        return false
                    }

                    if (validation && !validation(value)) {
                        return false
                    }

                    resolve(value)
                    return true
                },
                onNegativeClick: () => {
                    resolve(null)
                    return true
                }
            })
        })
    }

    /**
     * 多行文本编辑弹窗
     * @param {Object} options - 配置选项
     * @returns {Promise<string|null>}
     */
    const editText = (options = {}) => {
        const {
            title = '编辑内容',
            defaultValue = '',
            placeholder = '请输入内容',
            confirmText = '保存',
            cancelText = '取消',
            required = true,
            rows = 6
        } = options

        const textValue = ref(defaultValue)

        return new Promise((resolve) => {
            dialog.create({
                title,
                content: () => h('div', [
                    h('textarea', {
                        value: textValue.value,
                        placeholder,
                        onInput: (e) => { textValue.value = e.target.value },
                        style: {
                            width: '100%',
                            minHeight: `${rows * 24}px`,
                            padding: '12px',
                            border: '1px solid #d0d0d0',
                            borderRadius: '4px',
                            fontSize: '14px',
                            resize: 'vertical',
                            fontFamily: 'inherit'
                        }
                    })
                ]),
                positiveText: confirmText,
                negativeText: cancelText,
                onPositiveClick: () => {
                    const value = textValue.value.trim()

                    if (required && !value) {
                        message.error('内容不能为空')
                        return false
                    }

                    resolve(value)
                    return true
                },
                onNegativeClick: () => {
                    resolve(null)
                    return true
                }
            })
        })
    }

    /**
     * Toast 消息提示
     */
    const toast = {
        /**
         * 成功提示
         */
        success: (content, duration = 2000) => {
            message.success(content, { duration, keepAliveOnHover: true })
        },

        /**
         * 错误提示
         */
        error: (content, duration = 3000) => {
            message.error(content, { duration, keepAliveOnHover: true })
        },

        /**
         * 警告提示
         */
        warning: (content, duration = 2500) => {
            message.warning(content, { duration, keepAliveOnHover: true })
        },

        /**
         * 信息提示
         */
        info: (content, duration = 2000) => {
            message.info(content, { duration, keepAliveOnHover: true })
        },

        /**
         * 加载中提示
         */
        loading: (content, duration = 0) => {
            return message.loading(content, { duration })
        }
    }

    /**
     * 通知消息
     */
    const notify = {
        /**
         * 成功通知
         */
        success: (title, content, options = {}) => {
            notification.success({
                title,
                content,
                duration: 3000,
                keepAliveOnHover: true,
                ...options
            })
        },

        /**
         * 错误通知
         */
        error: (title, content, options = {}) => {
            notification.error({
                title,
                content,
                duration: 5000,
                keepAliveOnHover: true,
                ...options
            })
        },

        /**
         * 警告通知
         */
        warning: (title, content, options = {}) => {
            notification.warning({
                title,
                content,
                duration: 4000,
                keepAliveOnHover: true,
                ...options
            })
        },

        /**
         * 信息通知
         */
        info: (title, content, options = {}) => {
            notification.info({
                title,
                content,
                duration: 3000,
                keepAliveOnHover: true,
                ...options
            })
        }
    }

    /**
     * 加载状态管理
     */
    const loading = {
        /**
         * 开始加载
         */
        start: (text) => {
            loadingBar.start()
            if (text) {
                return toast.loading(text)
            }
            return null
        },

        /**
         * 结束加载
         */
        finish: () => {
            loadingBar.finish()
        },

        /**
         * 加载错误
         */
        error: () => {
            loadingBar.error()
        },

        /**
         * 包装异步函数，自动处理加载状态
         */
        wrap: async (promiseFn, loadingText = '处理中...') => {
            const hide = loading.start(loadingText)
            try {
                const result = await promiseFn()
                loading.finish()
                if (hide) hide()
                return result
            } catch (error) {
                loading.error()
                if (hide) hide()
                throw error
            }
        }
    }

    /**
     * 关闭所有消息和弹窗
     */
    const closeAll = () => {
        message.destroyAll()
        // dialog 没有 destroyAll 方法，需要单独处理
    }

    return {
        // 确认对话框
        confirm,
        confirmSuccess,
        confirmError,

        // 输入弹窗
        prompt,
        editText,

        // 消息提示
        toast,

        // 通知
        notify,

        // 加载状态
        loading,

        // 工具方法
        closeAll,

        // 原始 API（用于特殊场景）
        $dialog: dialog,
        $message: message,
        $notification: notification,
        $loadingBar: loadingBar
    }
}

export default usePopup