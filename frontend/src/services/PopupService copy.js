// src/services/popupService.js
import Swal from 'sweetalert2'

// 默认弹窗配置
const defaultSwalConfig = {
  reverseButtons: true,
  customClass: {
    confirmButton: 'swal2-confirm-btn',
    cancelButton: 'swal2-cancel-btn'
  }
}

// 弹窗服务对象
const PopupService = {
  // 确认对话框
  confirm(title, text, confirmText = '确认', cancelText = '取消') {
    return Swal.fire({
      ...defaultSwalConfig,
      title,
      text,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#ff3b30',
      cancelButtonColor: '#4a90e2',
      confirmButtonText: confirmText,
      cancelButtonText: cancelText
    })
  },

  // 成功提示
  success(title, text, timer = 2000) {
    return Swal.fire({
      title,
      text,
      icon: 'success',
      timer,
      showConfirmButton: false
    })
  },

  // 错误提示
  error(title, text) {
    return Swal.fire({
      title,
      text,
      icon: 'error',
      confirmButtonText: '确定'
    })
  },

  // 编辑消息弹窗
  editMessage(currentContent) {
    return Swal.fire({
      title: '编辑消息',
      html: `<textarea id="swal-edit-textarea" class="modal-textarea" style="width:100%; min-height:200px; padding:12px; border:1px solid #d0d0d0; border-radius:4px; font-size:15px; resize:vertical;">${currentContent}</textarea>`,
      showCancelButton: true,
      confirmButtonText: '保存',
      cancelButtonText: '取消',
      reverseButtons: true,
      focusConfirm: false,
      preConfirm: () => {
        return document.getElementById('swal-edit-textarea').value
      },
      customClass: {
        confirmButton: 'swal2-confirm-btn',
        cancelButton: 'swal2-cancel-btn',
        container: 'swal2-edit-container'
      }
    })
  },

  // 输入框弹窗
  prompt(title, inputValue = '', inputPlaceholder = '') {
    return Swal.fire({
      ...defaultSwalConfig,
      title,
      input: 'text',
      inputValue,
      inputPlaceholder,
      showCancelButton: true,
      confirmButtonText: '保存',
      cancelButtonText: '取消',
      preConfirm: (value) => {
        if (!value) {
          Swal.showValidationMessage('内容不能为空')
          return false
        }
        return value
      }
    })
  },

  // 加载中提示
  loading(title = '处理中...') {
    return Swal.fire({
      title,
      allowOutsideClick: false,
      didOpen: () => {
        Swal.showLoading()
      }
    })
  },

  // Toast提示
  toast(title, icon = 'success', timer = 1500, position = 'top-end') {
    return Swal.fire({
      title,
      icon,
      timer,
      position,
      toast: true,
      showConfirmButton: false,
      showCloseButton: false,
      background: '#fff',
      color: '#333',
      customClass: {
        container: 'swal2-toast-container',
        popup: 'swal2-toast-popup'
      }
    })
  },
  // 编辑消息弹窗
  customDailog(customHtml) {
    return Swal.fire({
      title: '编辑消息',
      html: customHtml,
      showCancelButton: true,
      confirmButtonText: '保存',
      cancelButtonText: '取消',
      reverseButtons: true,
      focusConfirm: false,
      preConfirm: () => {
        return document.getElementById('swal-edit-textarea').value
      },
      customClass: {
        confirmButton: 'swal2-confirm-btn',
        cancelButton: 'swal2-cancel-btn',
        container: 'swal2-edit-container'
      }
    })
  },
  // 关闭当前弹窗
  close() {
    Swal.close()
  }
}

// 导出服务对象
export default PopupService