/**
 * 浏览器工具
 */

/** 在外部浏览器中打开 URL（公共方法，无业务依赖） */
export function openInExternalBrowser(url: string): void {
    const isElectron = typeof window !== 'undefined' && window.electronAPI !== undefined
    if (isElectron) {
        window.electronAPI!.openExternal(url)
    } else {
        window.open(url, '_blank', 'noopener,noreferrer')
    }
}
