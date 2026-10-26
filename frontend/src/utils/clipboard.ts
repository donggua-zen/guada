/**
 * 写入系统剪贴板，按可靠性依次回退：
 * 1. Electron 主进程 IPC（最可靠，不受页面焦点/权限影响）
 * 2. preload 暴露的原生 clipboard（同步）
 * 3. 浏览器 Clipboard API（只在安全上下文可用）
 * 4. 旧式 execCommand('copy')（http 局域网访问等非安全上下文的兜底）
 *
 * 返回是否成功：调用方自行决定提示文案（不同入口的失败提示不同）。
 */
export async function writeTextToClipboard(text: string): Promise<boolean> {
    if (!text) return false;

    const electronAPI = typeof window !== 'undefined' ? window.electronAPI : undefined;

    if (electronAPI?.clipboardIPC?.writeText) {
        try {
            const result = await electronAPI.clipboardIPC.writeText(text);
            if (result.success) return true;
            console.warn('[clipboard] IPC 写入失败，尝试其他方式:', result.error);
        } catch (error) {
            console.warn('[clipboard] IPC 写入异常，尝试其他方式:', error);
        }
    }

    if (electronAPI?.clipboard?.writeText) {
        try {
            electronAPI.clipboard.writeText(text);
            return true;
        } catch (error) {
            console.warn('[clipboard] 直接调用失败:', error);
        }
    }

    if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch (error) {
            console.error('[clipboard] Web Clipboard API 写入失败:', error);
        }
    }

    // 非安全上下文（手机通过 http://局域网IP 访问）没有 navigator.clipboard，
    // 用隐藏 textarea + execCommand 兜底
    if (legacyCopy(text)) return true;

    console.error('[clipboard] 所有剪贴板 API 都不可用');
    return false;
}

/** 旧式复制：兼容非安全上下文（已废弃但仍是局域网 http 下唯一可用方案） */
function legacyCopy(text: string): boolean {
    if (typeof document === 'undefined' || typeof document.execCommand !== 'function') {
        return false;
    }
    try {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'fixed';
        textarea.style.top = '-1000px';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        textarea.setSelectionRange(0, textarea.value.length);
        const ok = document.execCommand('copy');
        document.body.removeChild(textarea);
        return ok;
    } catch {
        return false;
    }
}
