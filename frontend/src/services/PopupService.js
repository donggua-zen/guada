// src/services/popupService.js
import { createDiscreteApi } from 'naive-ui'
import { h, ref } from 'vue' // 导入需要的 Vue API

// 创建离散API实例
const { message, dialog, notification, loadingBar } = createDiscreteApi([
  'message',
  'dialog',
  'notification',
  'loadingBar'
])

// Naive UI 弹窗服务对象
const PopupService = {
  // 确认对话框
  async confirm(title, content, confirmText = '确认', cancelText = '取消') {
    return new Promise((resolve) => {
      dialog.warning({
        title,
        content,
        positiveText: confirmText,
        negativeText: cancelText,
        onPositiveClick: () => resolve({ isConfirmed: true, isDenied: false, isDismissed: false }),
        onNegativeClick: () => resolve({ isConfirmed: false, isDenied: true, isDismissed: false }),
        onMaskClick: () => resolve({ isConfirmed: false, isDenied: false, isDismissed: true })
      })
    })
  },

  // 成功提示
  success(title, content, duration = 2000) {
    message.success(content || title, {
      duration,
      keepAliveOnHover: true
    })
  },

  // 错误提示
  error(title, content) {
    message.error(content || title, {
      duration: 3000,
      keepAliveOnHover: true
    })
  },

  // 编辑消息弹窗
  async editMessage(currentContent) {
    const contentRef = ref(currentContent)

    return new Promise((resolve) => {
      dialog.create({
        title: '编辑消息',
        content: () => h('div', [
          h('textarea', {
            value: contentRef.value,
            onInput: (e) => { contentRef.value = e.target.value },
            style: {
              width: '100%',
              minHeight: '200px',
              padding: '12px',
              border: '1px solid #d0d0d0',
              borderRadius: '4px',
              fontSize: '15px',
              resize: 'vertical'
            }
          })
        ]),
        positiveText: '保存',
        negativeText: '取消',
        onPositiveClick: () => {
          resolve(contentRef.value)
          return true
        },
        onNegativeClick: () => {
          resolve(null)
          return true
        }
      })
    })
  },

  // 输入框弹窗
  async prompt(title, inputValue = '', inputPlaceholder = '') {
    const inputRef = ref(inputValue)

    return new Promise((resolve) => {
      dialog.create({
        title,
        content: () => h('div', [
          h('input', {
            value: inputRef.value,
            placeholder: inputPlaceholder,
            onInput: (e) => { inputRef.value = e.target.value },
            style: {
              width: '100%',
              padding: '8px 12px',
              border: '1px solid #d0d0d0',
              borderRadius: '4px',
              fontSize: '14px'
            }
          })
        ]),
        positiveText: '保存',
        negativeText: '取消',
        onPositiveClick: () => {
          if (!inputRef.value.trim()) {
            message.error('内容不能为空')
            return false
          }
          resolve(inputRef.value)
          return true
        },
        onNegativeClick: () => {
          resolve(null)
          return true
        }
      })
    })
  },

  // 加载中提示
  loading(title = '处理中...') {
    loadingBar.start()
    // 如果需要显示带文字的加载状态，可以使用 message.loading
    const hide = message.loading(title, {
      duration: 0 // 持续显示
    })

    return {
      close: () => {
        loadingBar.finish()
        hide()
      }
    }
  },

  // Toast提示
  toast(content, type = 'success', duration = 1500) {
    const typeMap = {
      success: message.success,
      error: message.error,
      warning: message.warning,
      info: message.info
    }

    return typeMap[type](content, {
      duration,
      keepAliveOnHover: true
    })
  },

  // 自定义弹窗（简化版，推荐使用组件方式）
  async customDialog(customHtml, title = '编辑消息') {
    return new Promise((resolve) => {
      // 创建临时容器
      const tempDiv = document.createElement('div')
      tempDiv.innerHTML = customHtml

      dialog.create({
        title,
        content: () => h('div', { innerHTML: customHtml }),
        positiveText: '保存',
        negativeText: '取消',
        onPositiveClick: () => {
          const textarea = tempDiv.querySelector('#swal-edit-textarea')
          resolve(textarea ? textarea.value : null)
          return true
        },
        onNegativeClick: () => {
          resolve(null)
          return true
        }
      })
    })
  },

  // 信息提示
  info(title, content, duration = 2000) {
    message.info(content || title, {
      duration,
      keepAliveOnHover: true
    })
  },

  // 警告提示
  warning(title, content, duration = 3000) {
    message.warning(content || title, {
      duration,
      keepAliveOnHover: true
    })
  },

  // 关闭所有消息
  closeAll() {
    message.destroyAll()
  },

  // 关闭当前弹窗（兼容方法）
  close() {
    loadingBar.finish()
    this.closeAll()
  }
}

// 导出服务对象
export default PopupService