// src/composables/usePopup.ts
import { t } from '@/locales'
import {
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
    /** 确认按钮使用危险色（删除类操作，type='error' 时默认 true）。 */
    danger?: boolean
    /** 显式层级（浮层内打开、且浮层保持打开时传 3500） */
    zIndex?: number
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
    /** 校验器：通过返回 null，失败返回错误文案（与 modalService 的 ModalInputOptions.validator 同签名）。 */
    validation?: (value: string) => string | null
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
 * usePopup 返回值类型
 *
 * 轻提示（toast/notify/loading）不在此处——统一走模块级 toastService：
 * `import { toast, notify } from '@/components/ui/toastService'`。
 * hook 门面在 store/utils 等非组件环境够不着，模块级单例才是全场景平权入口。
 */
export interface UsePopupReturn {
    confirm: (title: string, content: string, options?: ConfirmOptions) => Promise<boolean>
    prompt: (title: string, options?: PromptOptions) => Promise<string | null>
    editText: (options?: EditTextOptions) => Promise<string | null>
}

/**
 * 常用弹窗 Hook
 *
 * 命令式弹窗统一委托给 GdDialogHost（底层 GdDialog + modalService），保证与声明式弹窗同源。
 * 职责边界（照 zcode 对照评估的结论）：
 * - 零状态一次性确认/输入 → 本门面（confirm/prompt/editText）
 * - 有状态、表单校验、自定义插槽内容 → 声明式 <GdDialog>
 * - 轻提示 → 直连 toastService（toast/notify）
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
            danger = type === 'error',
            zIndex
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
            closeOnClickModal: false,
            ...(zIndex === undefined ? {} : { zIndex })
        })
        return result.action === 'confirm'
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
                validator: validation
            }
        })

        // trim 已由 modalService.submitModal 收口（rawValue.trim()），此处直接透传
        return result.action === 'confirm' ? (result.value ?? '') : null
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
                required
            }
        })

        return result.action === 'confirm' ? (result.value ?? '') : null
    }

    return {
        confirm,
        prompt,
        editText,
    }
}

export default usePopup
