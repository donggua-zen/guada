/**
 * 浏览器工具
 */

/**
 * 在外部浏览器中打开 URL（公共方法，无业务依赖）。
 *
 * 主进程对 open-external 有 http(s) 白名单，非白名单协议会返回
 * `{ success: false }` 而不是抛错——过去这里丢弃返回值，用户看到的是
 * "点了完全没反应"。现在至少把失败打到控制台，便于定位。
 */
export function openInExternalBrowser(url: string): void {
    const isElectron = typeof window !== 'undefined' && window.electronAPI !== undefined
    if (isElectron) {
        window.electronAPI!.openExternal(url)
            .then((result) => {
                if (result?.success === false) {
                    console.warn('[browserUtils] openExternal rejected:', url, result.error)
                }
            })
            .catch((error) => {
                console.warn('[browserUtils] openExternal failed:', url, error)
            })
    } else {
        window.open(url, '_blank', 'noopener,noreferrer')
    }
}
