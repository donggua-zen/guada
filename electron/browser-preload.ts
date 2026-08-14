/// <reference lib="dom" />
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
   * @param filter cookie 过滤条件
   *   - url: cookie 关联的 URL（必需）
   *   - name: cookie 名称（必需）
   * @returns Promise<{ success: boolean; error?: string }>
   */
  removeCookie: (filter: { url: string; name: string }) =>
    ipcRenderer.invoke('browser:remove-cookie', filter),

  /**
   * 通知主进程弹窗已被自动关闭（alert/confirm/prompt）
   */
  notifyDialog: (type: string, message: string) =>
    ipcRenderer.send('browser:dialog-auto-dismissed', { type, message }),
})

// ── 反检测 + 弹窗自动关闭 ──
// 在页面脚本之前注入，通过 <script> 标签在主世界执行
;(function injectAntiDetection() {
  const isErrDoc =
    location.protocol === 'chrome-error:' ||
    location.href === '' ||
    location.href === 'about:blank'
  if (isErrDoc) return

  const gpuOptions = [
    { vendor: 'Intel Inc.', renderer: 'Intel Iris Xe Graphics' },
    { vendor: 'Intel Inc.', renderer: 'Intel(R) UHD Graphics 630' },
    { vendor: 'Intel Inc.', renderer: 'Intel(R) HD Graphics 620' },
    { vendor: 'NVIDIA Corporation', renderer: 'NVIDIA GeForce GTX 1660/PCIe/SSE2' },
    { vendor: 'NVIDIA Corporation', renderer: 'NVIDIA GeForce RTX 3060/PCIe/SSE2' },
    { vendor: 'Google Inc. (NVIDIA)', renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)' },
    { vendor: 'Google Inc. (Intel)', renderer: 'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)' },
    { vendor: 'Google Inc. (AMD)', renderer: 'ANGLE (AMD, AMD Radeon RX 580 Direct3D11 vs_5_0 ps_5_0, D3D11)' },
  ]
  const coreOptions = [4, 8, 12, 16]
  const memoryOptions = [4, 8, 16]
  const gpu = gpuOptions[Math.floor(Math.random() * gpuOptions.length)]
  const cores = coreOptions[Math.floor(Math.random() * coreOptions.length)]
  const memory = memoryOptions[Math.floor(Math.random() * memoryOptions.length)]
  const fp = {
    gpuVendor: gpu.vendor,
    gpuRenderer: gpu.renderer,
    cores,
    memory,
    canvasNoise: Math.floor(Math.random() * 3) + 1,
    audioNoise: (Math.random() * 0.0001 + 0.00001).toFixed(6),
  }

  const script = document.createElement('script')
  script.textContent = `
    (function() {
      var FP = ${JSON.stringify(fp)};

      // 1. 移除 webdriver 标志
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined, configurable: true });

      // 2. 伪装 plugins
      var fakePlugins = [
        { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format', version: 'undefined', length: 1, item: () => null, namedItem: () => null },
        { name: 'Native Client', filename: 'internal-nacl-plugin', description: '', version: 'undefined', length: 2, item: () => null, namedItem: () => null },
      ];
      Object.defineProperty(navigator, 'plugins', { get: () => fakePlugins, configurable: true });

      // 3. 伪装 mimeTypes
      Object.defineProperty(navigator, 'mimeTypes', { get: () => ({ length: 4, item: () => null, namedItem: () => null }), configurable: true });

      // 4. 伪装硬件信息
      Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => FP.cores, configurable: true });
      Object.defineProperty(navigator, 'deviceMemory', { get: () => FP.memory, configurable: true });
      Object.defineProperty(navigator, 'maxTouchPoints', { get: () => 0, configurable: true });

      // 5. 伪装语言
      Object.defineProperty(navigator, 'languages', { get: () => ['zh-CN', 'zh', 'en'], configurable: true });
      Object.defineProperty(navigator, 'language', { get: () => 'zh-CN', configurable: true });

      // 6. 伪装 platform
      Object.defineProperty(navigator, 'platform', { get: () => 'Win32', configurable: true });

      // 7. 伪装 vendor
      Object.defineProperty(navigator, 'vendor', { get: () => 'Google Inc.', configurable: true });

      // 8. 覆盖 Permissions API
      var origQuery = navigator.permissions.query;
      navigator.permissions.query = async function(desc) {
        var name = typeof desc === 'string' ? desc : desc.name;
        if (['notifications', 'clipboard-read', 'clipboard-write'].includes(name)) return { state: 'prompt', onchange: null };
        return origQuery.call(navigator.permissions, desc);
      };

      // 9. 覆盖 chrome 对象
      Object.defineProperty(window, 'chrome', { get: () => ({
        runtime: { OnInstalledReason: {}, OnRestartRequiredReason: {}, PlatformArch: {}, PlatformNaclArch: {}, PlatformOs: {}, RequestUpdateCheckStatus: {}, OnConnectEvent: { addListener: function(){} }, OnMessageEvent: { addListener: function(){} } },
        loadTimes: function() { return { commitLoadTime: performance.now()/1000, connectionInfo: 'h2', finishDocumentLoadTime: performance.now()/1000, finishLoadTime: performance.now()/1000, firstPaintAfterLoadTime: 0, firstPaintTime: performance.now()/1000, navigationStart: performance.now()/1000, npnNegotiatedProtocol: 'h2', requestTime: performance.now()/1000, startLoadTime: performance.now()/1000, wasAlternateProtocolAvailable: false, wasFetchedViaSpdy: true, wasNpnNegotiated: true }; },
        csi: function() { return { startE: performance.now(), onloadT: performance.now(), pageT: performance.now() }; },
        app: { isInstalled: false, InstallState: {}, RunningState: {}, getDetails: function() { return null; }, getIsInstalled: function() { return false; } },
        webstore: { onInstallStageChanged: { addListener: function(){} }, onDownloadProgress: { addListener: function(){} } },
      }), configurable: true });

      // 10. 覆盖 Notification 权限
      var origNotification = window.Notification;
      Object.defineProperty(window, 'Notification', { get: function() {
        return class extends origNotification { static get permission() { return 'default'; } static requestPermission() { return Promise.resolve('default'); } };
      }, configurable: true });

      // 11. WebGL 指纹混淆
      var getParamHandler = { apply: function(target, thisArg, args) { var p = args[0]; if (p === 37445) return FP.gpuVendor; if (p === 37446) return FP.gpuRenderer; return target.apply(thisArg, args); } };
      var origGetContext = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function(type) {
        var ctx = origGetContext.apply(this, arguments);
        if (ctx && (type === 'webgl' || type === 'experimental-webgl' || type === 'webgl2')) {
          ctx.getParameter = new Proxy(ctx.getParameter, getParamHandler);
        }
        return ctx;
      };

      // 12. Canvas 指纹防护
      var origToDataURL = HTMLCanvasElement.prototype.toDataURL;
      HTMLCanvasElement.prototype.toDataURL = function() {
        try { var ctx = origGetContext.call(this, '2d'); if (ctx && this.width > 0 && this.height > 0) { var d = ctx.getImageData(0, 0, this.width, this.height).data; for (var i = 0; i < d.length; i += 4) { d[i] = (d[i] + FP.canvasNoise) & 0xFF; } ctx.putImageData(new ImageData(d, this.width, this.height), 0, 0); } } catch(e) {}
        return origToDataURL.apply(this, arguments);
      };
      var origToBlob = HTMLCanvasElement.prototype.toBlob;
      HTMLCanvasElement.prototype.toBlob = function(cb) {
        try { var ctx = origGetContext.call(this, '2d'); if (ctx && this.width > 0 && this.height > 0) { var d = ctx.getImageData(0, 0, this.width, this.height).data; for (var i = 0; i < d.length; i += 4) { d[i] = (d[i] + FP.canvasNoise) & 0xFF; } ctx.putImageData(new ImageData(d, this.width, this.height), 0, 0); } } catch(e) {}
        return origToBlob.apply(this, arguments);
      };

      // 13. AudioContext 指纹防护
      var origGetFloat = AnalyserNode.prototype.getFloatFrequencyData;
      AnalyserNode.prototype.getFloatFrequencyData = function(arr) { origGetFloat.call(this, arr); var n = parseFloat(FP.audioNoise); for (var i = 0; i < arr.length; i++) { arr[i] += n * (i % 2 === 0 ? 1 : -1); } };
      var origGetChannel = AudioBuffer.prototype.getChannelData;
      AudioBuffer.prototype.getChannelData = function(ch) { var data = origGetChannel.call(this, ch); if (data.length < 16384) { var n = parseFloat(FP.audioNoise); for (var i = 0; i < data.length; i++) { data[i] += n * (Math.random() - 0.5); } } return data; };

      // 14. Dialog auto-dismiss — 立即返回默认值，通过 IPC 通知主进程
      window.alert = function(message) {
        try { window._browserBridge && window._browserBridge.notifyDialog('alert', String(message)); } catch(e) {}
      };
      window.confirm = function(message) {
        try { window._browserBridge && window._browserBridge.notifyDialog('confirm', String(message)); } catch(e) {}
        return true;
      };
      window.prompt = function(message) {
        try { window._browserBridge && window._browserBridge.notifyDialog('prompt', String(message)); } catch(e) {}
        return null;
      };
    })();
  `
  ;(document.head || document.documentElement).appendChild(script)
  script.remove()
})()

// ── 用户脚本自动注入 ──
// 从磁盘 .browser-work/*.js 读取脚本，以 <script> 注入到页面世界
async function injectUserScripts() {
  console.log('[BrowserPreload] injectUserScripts() called, href=' + location.href)
  try {
    const result = await ipcRenderer.invoke('browser:get-user-scripts', location.href)
    console.log('[BrowserPreload] IPC result:', JSON.stringify(result))
    const scripts = result?.scripts
    if (!scripts || scripts.length === 0) {
      console.log('[BrowserPreload] No scripts returned')
      return
    }
    for (const { id, code } of scripts) {
      try {
        console.log('[BrowserPreload] Injecting script:', id)
        const el = document.createElement('script')
        el.textContent = code
        document.documentElement.appendChild(el)
        console.log('[BrowserPreload] Script injected:', id)
      } catch (e) {
        console.error('[BrowserPreload] Failed to inject script ' + id + ':', e)
      }
    }
  } catch (e) {
    console.error('[BrowserPreload] Failed to load user scripts:', e)
  }
}

// 错误页和空文档不执行用户脚本。失败导航期间 Chromium 仍可能执行 preload，
// 此时继续发起 IPC 会与内部错误页导航并发。
const isErrorDocument =
  location.protocol === 'chrome-error:' ||
  location.href === '' ||
  location.href === 'about:blank'

if (!isErrorDocument) {
  console.log('[BrowserPreload] Preload loaded, readyState=' + document.readyState)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      console.log('[BrowserPreload] DOMContentLoaded fired')
      injectUserScripts()
    }, { once: true })
  } else {
    injectUserScripts()
  }
}
