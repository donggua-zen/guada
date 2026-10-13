/**
 * 写入系统剪贴板，按可靠性依次回退：
 * 1. Electron 主进程 IPC（最可靠，不受页面焦点/权限影响）
 * 2. preload 暴露的原生 clipboard（同步）
 * 3. 浏览器 Clipboard API
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

    if (navigator.clipboard && navigator.clipboard.writeText) {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch (error) {
            console.error('[clipboard] Web Clipboard API 写入失败:', error);
        }
    } else {
        console.error('[clipboard] 所有剪贴板 API 都不可用');
    }

    return false;
}
