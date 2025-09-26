// popup.js - 弹窗相关功能模块

// 默认弹窗配置
const defaultSwalConfig = {
    reverseButtons: true,
    customClass: {
        confirmButton: 'swal2-confirm-btn',
        cancelButton: 'swal2-cancel-btn'
    }
};

// 弹窗服务对象
const PopupService = {
    // 确认对话框
    confirm: function (title, text, confirmText = '确认', cancelText = '取消') {
        return Swal.fire({
            ...defaultSwalConfig,
            title: title,
            text: text,
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#ff3b30',
            cancelButtonColor: '#4a90e2',
            confirmButtonText: confirmText,
            cancelButtonText: cancelText
        });
    },

    // 成功提示
    success: function (title, text, timer = 2000) {
        return Swal.fire({
            title: title,
            text: text,
            icon: 'success',
            timer: timer,
            showConfirmButton: false
        });
    },

    // 错误提示
    error: function (title, text) {
        return Swal.fire({
            title: title,
            text: text,
            icon: 'error',
            confirmButtonText: '确定'
        });
    },

    // 编辑消息弹窗
    editMessage: function (currentContent) {
        return Swal.fire({
            title: '编辑消息',
            html: `<textarea id="swal-edit-textarea" class="modal-textarea" style="width:100%; min-height:200px; padding:12px; border:1px solid #d0d0d0; border-radius:4px; font-size:15px; resize:vertical;">${currentContent}</textarea>`,
            showCancelButton: true,
            confirmButtonText: '保存',
            cancelButtonText: '取消',
            reverseButtons: true,
            focusConfirm: false,
            preConfirm: () => {
                return document.getElementById('swal-edit-textarea').value;
            },
            customClass: {
                confirmButton: 'swal2-confirm-btn',
                cancelButton: 'swal2-cancel-btn',
                container: 'swal2-edit-container'
            }
        });
    },

    // 输入框弹窗
    prompt: function (title, inputValue = '', inputPlaceholder = '') {
        return Swal.fire({
            ...defaultSwalConfig,
            title: title,
            input: 'text',
            inputValue: inputValue,
            inputPlaceholder: inputPlaceholder,
            showCancelButton: true,
            confirmButtonText: '保存',
            cancelButtonText: '取消',
            preConfirm: (value) => {
                if (!value) {
                    Swal.showValidationMessage('内容不能为空');
                    return false;
                }
                return value;
            }
        });
    },

    // 加载中提示
    loading: function (title = '处理中...') {
        return Swal.fire({
            title: title,
            allowOutsideClick: false,
            didOpen: () => {
                Swal.showLoading();
            }
        });
    },

    toast: function (title, icon = 'success', timer = 1500, position = 'top-end',) {
        return Swal.fire({
            title: title,
            icon: icon,
            timer: timer,
            position: position,
            toast: true,           // 启用Toast模式
            showConfirmButton: false,
            showCloseButton: false,
            background: '#fff',
            color: '#333',
            customClass: {
                container: 'swal2-toast-container',
                popup: 'swal2-toast-popup'
            }
        });
    },

    // 关闭当前弹窗
    close: function () {
        Swal.close();
    }
};

// 导出服务对象
if (typeof module !== 'undefined' && module.exports) {
    module.exports = PopupService;
} else {
    window.PopupService = PopupService;
}