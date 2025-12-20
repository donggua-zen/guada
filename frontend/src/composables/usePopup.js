// src/composables/usePopup.js
import { ref, h, render } from 'vue'
import {
    ElMessageBox,
    ElMessage,
    ElNotification,
    ElButton
} from 'element-plus'

/**
 * 常用弹窗 Hook
 * 在 Vue 组件上下文中使用，确保主题和配置一致性
 */
export function usePopup() {
    // const loadingBar = useLoadingBar()

    /**
     * 确认对话框
     * @param {string} title - 标题
     * @param {string} content - 内容
     * @param {Object} options - 配置选项
     * @returns {Promise<boolean>}
     */
    const confirm = (title, content, options = {}) => {
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

        // 使用 Element Plus 的 VNode 方式创建自定义内容
        const container = h('div', {
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
                onInput: (e) => {
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
                beforeClose: (action, instance, done) => {
                    if (action === 'confirm') {
                        // 通过查询 DOM 获取 textarea 的值
                        const textarea = instance.message.el.querySelector('textarea')
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
     * Toast 消息提示
     */
    const toast = {
        /**
         * 成功提示
         */
        success: (content, duration = 2000) => {
            ElMessage.success({
                message: content,
                duration,
                showClose: true
            })
        },

        /**
         * 错误提示
         */
        error: (content, duration = 3000) => {
            ElMessage.error({
                message: content,
                duration,
                showClose: true
            })
        },

        /**
         * 警告提示
         */
        warning: (content, duration = 2500) => {
            ElMessage.warning({
                message: content,
                duration,
                showClose: true
            })
        },

        /**
         * 信息提示
         */
        info: (content, duration = 2000) => {
            ElMessage.info({
                message: content,
                duration,
                showClose: true
            })
        },

        /**
         * 加载中提示
         */
        loading: (content, duration = 0) => {
            return ElMessage.loading({
                message: content,
                duration,
                showClose: true
            })
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
            ElNotification.success({
                title,
                message: content,
                duration: 3000,
                ...options
            })
        },

        /**
         * 错误通知
         */
        error: (title, content, options = {}) => {
            ElNotification.error({
                title,
                message: content,
                duration: 5000,
                ...options
            })
        },

        /**
         * 警告通知
         */
        warning: (title, content, options = {}) => {
            ElNotification.warning({
                title,
                message: content,
                duration: 4000,
                ...options
            })
        },

        /**
         * 信息通知
         */
        info: (title, content, options = {}) => {
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
    const loading = {
        /**
         * 开始加载
         */
        start: (text) => {
            return toast.loading(text || '处理中...')
        },

        /**
         * 包装异步函数，自动处理加载状态
         */
        wrap: async (promiseFn, loadingText = '处理中...') => {
            const hide = loading.start(loadingText)
            try {
                const result = await promiseFn()
                // loading.finish()
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