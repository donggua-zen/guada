import { contextBridge, ipcRenderer } from 'electron'

/**
 * 浏览器自动化窗口专用 Preload 脚本
 *
 * 为浏览器自动化窗口暴露安全的 Electron API，支持从页面内部保存内存数据到本地文件。
 * 与主应用 preload 隔离，仅注入浏览器自动化所需的最小权限 API。
 */

// 暴露安全的 API 到渲染进程的 window 对象
contextBridge.exposeInMainWorld('_browserBridge', {
  /**
   * 保存数据到本地文件（导出/下载）
   * 支持文本、JSON 对象和二进制数据（通过 base64 编码）
   *
   * @param filename 文件名（仅支持字母、数字、下划线、连字符和点，不允许路径穿越）
   * @param data 要保存的数据（字符串、对象或 base64 编码的二进制数据）
   * @param options 可选配置
   *   - encoding: 数据编码方式，'utf8' | 'base64'，默认为 'utf8'
   * @returns Promise<{ success: boolean; filePath?: string; error?: string }>
   *
   * 使用示例：
   *   // 保存文本
   *   await window.electronAPI.saveLocalFile('report.txt', 'Hello World');
   *
   *   // 保存 JSON 对象
   *   await window.electronAPI.saveLocalFile('data.json', { name: 'test', value: 123 });
   *
   *   // 保存二进制数据（如图片）
   *   const base64Data = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
   *   await window.electronAPI.saveLocalFile('image.png', base64Data, { encoding: 'base64' });
   */
  saveLocalFile: (
    filename: string,
    data: string | object,
    options?: { encoding?: 'utf8' | 'base64' }
  ) => ipcRenderer.invoke('browser:save-to-file', { filename, data, options }),

  /**
   * 读取本地文件内容
   * 支持以文本或 base64 编码返回二进制数据
   *
   * @param filename 文件名
   * @param options 可选配置
   *   - encoding: 读取编码方式，'utf8' | 'base64'，默认为 'utf8'
   * @returns Promise<{ success: boolean; content?: string; error?: string }>
   *   当 encoding 为 'base64' 时，content 为 base64 编码的字符串
   *
   * 使用示例：
   *   // 读取文本文件
   *   const result = await window.electronAPI.readLocalFile('report.txt');
   *   if (result.success) {
   *     console.log(result.content);
   *   }
   *
   *   // 读取二进制文件（如图片）
   *   const result = await window.electronAPI.readLocalFile('image.png', { encoding: 'base64' });
   *   if (result.success) {
   *     const img = document.createElement('img');
   *     img.src = 'data:image/png;base64,' + result.content;
   *     document.body.appendChild(img);
   *   }
   */
  readLocalFile: (
    filename: string,
    options?: { encoding?: 'utf8' | 'base64' }
  ) => ipcRenderer.invoke('browser:read-from-file', { filename, options }),

  /**
   * 获取当前窗口的所有 Cookie
   * 通过主进程 session.cookies API 获取，替代不可用的 chrome.cookies
   *
   * @param filter 可选过滤条件
   *   - url: 只返回匹配此 URL 的 cookie
   *   - name: 只返回指定名称的 cookie
   *   - domain: 只返回指定域名的 cookie
   * @returns Promise<{ success: boolean; cookies?: Electron.Cookie[]; error?: string }>
   *
   * 使用示例：
   *   const result = await window.electronAPI.getCookies();
   *   const result = await window.electronAPI.getCookies({ url: 'https://example.com' });
   */
  getCookies: (filter?: { url?: string; name?: string; domain?: string }) =>
    ipcRenderer.invoke('browser:get-cookies', filter),

  /**
   * 设置 Cookie
   * 通过主进程 session.cookies API 设置
   *
   * @param cookie 要设置的 cookie 信息
   *   - url: cookie 关联的 URL（必需）
   *   - name: cookie 名称（必需）
   *   - value: cookie 值（必需）
   *   - domain: 域名
   *   - path: 路径，默认 '/'
   *   - secure: 是否仅 HTTPS
   *   - httpOnly: 是否 httpOnly
   *   - expirationDate: 过期时间戳（秒）
   * @returns Promise<{ success: boolean; error?: string }>
   *
   * 使用示例：
   *   await window.electronAPI.setCookie({
   *     url: 'https://example.com',
     *     name: 'session',
     *     value: 'abc123',
     *     expirationDate: Math.floor(Date.now() / 1000) + 86400
     *   });
   */
  setCookie: (cookie: {
    url: string
    name: string
    value: string
    domain?: string
    path?: string
    secure?: boolean
    httpOnly?: boolean
    expirationDate?: number
  }) => ipcRenderer.invoke('browser:set-cookie', cookie),

  /**
   * 删除 Cookie
   *
   * @param url cookie 关联的 URL
   * @param name cookie 名称
   * @returns Promise<{ success: boolean; error?: string }>
   */
  removeCookie: (url: string, name: string) =>
    ipcRenderer.invoke('browser:remove-cookie', { url, name }),


})
