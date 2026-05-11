import { Injectable, Logger } from '@nestjs/common'
import {
  IToolProvider,
  ToolCallRequest,
  ToolProviderMetadata,
} from '../interfaces/tool-provider.interface'
import * as http from 'http'

interface IPCRequest {
  id: string
  method: string
  params: any
}

interface IPCResponse {
  id: string
  result?: any
  error?: {
    message: string
    code?: number
  }
}

@Injectable()
export class BrowserToolProvider implements IToolProvider {
  private readonly logger = new Logger(BrowserToolProvider.name)
  namespace = 'browser'

  private pendingRequests = new Map<string, {
    resolve: (value: any) => void
    reject: (reason: any) => void
    timeout: NodeJS.Timeout
  }>()

  private requestIdCounter = 0

  private bridgeMode: 'ipc' | 'tcp' = 'ipc'
  private tcpBaseUrl: string = ''

  async onModuleInit() {
    this.logger.log('Initializing Browser Tool Provider...')

    // 判断使用哪种通信方式
    this.bridgeMode = (process.env.BROWSER_BRIDGE_MODE as any) || 'ipc'
    this.logger.log(`BROWSER_BRIDGE_MODE: ${this.bridgeMode}`)
    this.logger.log(`ELECTRON_APP: ${process.env.ELECTRON_APP}`)
    this.logger.log(`process.send available: ${!!process.send}`)

    if (this.bridgeMode === 'tcp') {
      // TCP 模式（开发环境）
      const port = process.env.BROWSER_BRIDGE_PORT || '3001'
      this.tcpBaseUrl = `http://127.0.0.1:${port}/browser-tool`
      this.logger.log(`Using TCP communication mode: ${this.tcpBaseUrl}`)
      this.logger.log('Browser Tool Provider ready (TCP mode)')
    } else {
      // IPC 模式（生产环境）
      if (!process.send || !process.on) {
        this.logger.error('No IPC channel available, browser tools disabled')
        this.logger.error(`process.send: ${process.send}, process.on: ${!!process.on}`)
        return
      }

      this.logger.log('Using IPC communication mode')

      process.on('message', (message: any) => {
        this.logger.debug(`Received IPC message: ${JSON.stringify(message).substring(0, 200)}`)
        if (message && message.type === 'BROWSER_TOOL_RESPONSE') {
          this.handleResponse(message.data)
        }
      })

      this.logger.log('Browser Tool Provider ready (IPC mode)')
    }
  }

  /**
   * 处理来自 Electron 的响应
   */
  private handleResponse(response: IPCResponse) {
    const pending = this.pendingRequests.get(response.id)

    if (!pending) {
      this.logger.warn(`Received response for unknown request: ${response.id}`)
      return
    }

    // 清除超时
    clearTimeout(pending.timeout)
    this.pendingRequests.delete(response.id)

    if (response.error) {
      pending.reject(new Error(response.error.message))
    } else {
      pending.resolve(response.result)
    }
  }

  /**
   * 发送请求到 Electron 并等待响应
   */
  private async sendRequest(method: string, params: any): Promise<any> {
    if (this.bridgeMode === 'tcp') {
      return this.sendTCPRequest(method, params)
    } else {
      return this.sendIPCRequest(method, params)
    }
  }

  /**
   * 通过 TCP 发送请求
   */
  private sendTCPRequest(method: string, params: any): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = `req_${Date.now()}_${++this.requestIdCounter}`

      const requestData = { id, method, params }

      const req = http.request(this.tcpBaseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        timeout: 60000, // 60秒超时
      }, (res) => {
        let data = ''

        res.on('data', chunk => {
          data += chunk
        })

        res.on('end', () => {
          try {
            const response: IPCResponse = JSON.parse(data)

            if (response.error) {
              reject(new Error(response.error.message))
            } else {
              resolve(response.result)
            }
          } catch (error) {
            reject(new Error(`Failed to parse response: ${error}`))
          }
        })
      })

      req.on('error', (error) => {
        reject(new Error(`TCP request failed: ${error.message}`))
      })

      req.on('timeout', () => {
        req.destroy()
        reject(new Error(`Request timeout: ${method}`))
      })

      req.write(JSON.stringify(requestData))
      req.end()
    })
  }

  /**
   * 通过 IPC 发送请求
   */
  private sendIPCRequest(method: string, params: any): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = `req_${Date.now()}_${++this.requestIdCounter}`

      this.logger.debug(`Sending IPC request: ${method} (id: ${id})`)
      this.logger.debug(`Request params: ${JSON.stringify(params).substring(0, 200)}`)

      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id)
        this.logger.error(`IPC request timeout: ${method} (id: ${id})`)
        reject(new Error(`Request timeout: ${method}`))
      }, 60000) // 60秒超时

      this.pendingRequests.set(id, { resolve, reject, timeout })

      const request: IPCRequest = { id, method, params }

      if (process.send) {
        try {
          process.send({
            type: 'BROWSER_TOOL_CALL',
            data: request,
          })
          this.logger.debug(`IPC message sent successfully: ${id}`)
        } catch (error: any) {
          clearTimeout(timeout)
          this.pendingRequests.delete(id)
          this.logger.error(`Failed to send IPC message: ${error.message}`)
          reject(new Error(`Failed to send IPC message: ${error.message}`))
        }
      } else {
        clearTimeout(timeout)
        this.pendingRequests.delete(id)
        this.logger.error('No IPC channel available for sending')
        reject(new Error('No IPC channel available'))
      }
    })
  }

  async getTools(enabled?: boolean | string[], context?: Record<string, any>): Promise<any[]> {
    if (enabled === false) return []

    return [
      {
        name: 'navigate',
        description: '导航到指定 URL，返回页面标题和 URL',
        parameters: {
          type: 'object',
          properties: {
            url: { type: 'string', description: '要导航到的 URL' },
            window_id: { type: 'string', description: '目标窗口 ID（必填）' },
          },
          required: ['url', 'window_id'],
        },
      },
      {
        name: 'execute_js',
        description: '在指定窗口执行 JavaScript 代码并返回结果',
        parameters: {
          type: 'object',
          properties: {
            code: { type: 'string', description: '要执行的 JavaScript 代码' },
            window_id: { type: 'string', description: '目标窗口 ID（必填）' },
            is_async: { type: 'boolean', description: '是否支持异步代码（async/await、Promise 等），默认 false' },
          },
          required: ['code', 'window_id'],
        },
      },
      // {
      //   name: 'screenshot',
      //   description: '截取当前页面的完整截图（base64 编码 PNG）',
      //   parameters: {
      //     type: 'object',
      //     properties: {
      //       window_id: { type: 'string', description: '目标窗口 ID（可选）' },
      //     },
      //   },
      // },
      {
        name: 'get_page_text',
        description: '获取指定窗口的页面纯文本内容（移除所有 HTML 标签、脚本和样式）',
        parameters: {
          type: 'object',
          properties: {
            window_id: { type: 'string', description: '目标窗口 ID' },
          },
          required: ['window_id'],
        },
      },
      {
        name: 'get_page_struct',
        description: '获取指定窗口的页面结构化 JSON（选择器风格优化，大幅减少 Token 占用）',
        parameters: {
          type: 'object',
          properties: {
            window_id: { type: 'string', description: '目标窗口 ID' },
          },
          required: ['window_id'],
        },
      },
      {
        name: 'get_page_summary',
        description: '获取指定窗口的页面摘要（提取文本、链接和标题层级）',
        parameters: {
          type: 'object',
          properties: {
            window_id: { type: 'string', description: '目标窗口 ID' },
          },
          required: ['window_id'],
        },
      },
      {
        name: 'go_back',
        description: '浏览器后退',
        parameters: {
          type: 'object',
          properties: {
            window_id: { type: 'string', description: '目标窗口 ID' },
          },
          required: ['window_id'],
        },
      },
      {
        name: 'go_forward',
        description: '浏览器前进',
        parameters: {
          type: 'object',
          properties: {
            window_id: { type: 'string', description: '目标窗口 ID' },
          },
          required: ['window_id'],
        },
      },
      {
        name: 'reload',
        description: '刷新指定窗口的页面',
        parameters: {
          type: 'object',
          properties: {
            window_id: { type: 'string', description: '目标窗口 ID' },
          },
          required: ['window_id'],
        },
      },
      {
        name: 'click',
        description: '点击指定窗口中 CSS 选择器匹配的元素',
        parameters: {
          type: 'object',
          properties: {
            selector: { type: 'string', description: 'CSS 选择器' },
            window_id: { type: 'string', description: '目标窗口 ID' },
          },
          required: ['selector', 'window_id'],
        },
      },
      {
        name: 'fill_input',
        description: '向指定窗口的输入框填入文本',
        parameters: {
          type: 'object',
          properties: {
            selector: { type: 'string', description: 'CSS 选择器' },
            value: { type: 'string', description: '要填入的文本' },
            window_id: { type: 'string', description: '目标窗口 ID' },
          },
          required: ['selector', 'value', 'window_id'],
        },
      },
      {
        name: 'open_new_window',
        description: '打开新的自动化窗口，返回 window_id',
        parameters: {
          type: 'object',
          properties: {
            url: { type: 'string', description: '要打开的 URL' },
          },
          required: ['url'],
        },
      },
      {
        name: 'close_window',
        description: '关闭指定窗口并清除所有浏览数据',
        parameters: {
          type: 'object',
          properties: {
            window_id: { type: 'string', description: '要关闭的窗口 ID' },
          },
          required: ['window_id'],
        },
      },
      {
        name: 'get_window_list',
        description: '获取当前所有窗口的列表，包括窗口 ID、URL、标题等信息',
        parameters: {
          type: 'object',
          properties: {},
        },
      },
    ]
  }

  async execute(
    request: ToolCallRequest,
    context?: Record<string, any>,
  ): Promise<string> {
    try {
      this.logger.debug(`Executing browser tool: ${request.name}`)

      const result = await this.sendRequest(request.name, request.arguments)

      // 格式化结果为字符串
      if (typeof result === 'string') {
        return result
      }

      return JSON.stringify(result)
    } catch (error: any) {
      this.logger.error(`Failed to execute browser tool ${request.name}:`, error)
      throw error
    }
  }

  async getPrompt(context?: Record<string, any>): Promise<string> {
    return [
      '# 浏览器控制工具 (browser)',
      '',
      '你可以通过以下工具直接控制内置的 Chromium 浏览器：',
      '',
      '| 工具 | 用途 |',
      '|------|------|',
      '| **navigate(url, window_id)** | 导航到指定 URL，返回页面标题和 URL |',
      '| **execute_js(code, window_id, is_async?)** | 执行 JavaScript 代码，is_async=true 时支持异步代码 |',
      // '| **screenshot(window_id)** | 截取当前页面的完整截图（base64 编码 PNG） |',
      '| **get_page_text(window_id)** | 获取页面纯文本内容（移除所有 HTML 标签、脚本和样式） |',
      '| **get_page_struct(window_id)** | 获取页面结构化 JSON |',
      '| **get_page_summary(window_id)** | 获取页面摘要（文本、链接、标题层级） |',
      '| **go_back(window_id)** | 浏览器后退 |',
      '| **go_forward(window_id)** | 浏览器前进 |',
      '| **reload(window_id)** | 刷新指定窗口的页面 |',
      '| **click(selector, window_id)** | 点击 CSS 选择器匹配的元素 |',
      '| **fill_input(selector, value, window_id)** | 向输入框填入文本 |',
      '| **open_new_window(url)** | 打开新的自动化窗口，返回 window_id（URL 必填） |',
      '| **close_window(window_id)** | 关闭指定窗口并清除所有浏览数据 |',
      '| **get_window_list()** | 获取当前所有窗口的列表 |',
      '',
      '## 多窗口支持',
      '- 最多支持 5 个并发窗口',
      '- 每个窗口有独立的会话隔离（cookies、localStorage 等完全隔离）',
      '- 窗口无操作 5 分钟后自动关闭',
      '- **重要：所有操作方法都必须显式指定 `window_id` 参数**',
      '- 使用 `get_window_list()` 查看当前所有可用窗口',
      '- 使用 `open_new_window(url)` 创建新窗口后会返回新的 `window_id`',
      '',
      '## 使用建议',
      '1. 先用 `open_new_window(url)` 创建新窗口并导航到目标网页，获取 `window_id`',
      '2. 用 `get_page_text` 获取纯文本内容进行分析（适合快速了解页面主要内容）',
      '3. 用 `get_page_struct` 获取结构化 JSON（适合需要分析 DOM 结构或提取特定元素，Token 占用极低）',
      '4. 如需交互，使用 `click` 和 `fill_input` 操作页面元素',
      '5. 如需提取结构化数据，使用 `execute_js` 编写 JavaScript',
      '6. 多窗口场景：为不同任务创建专用窗口，通过 `window_id` 区分',
      '7. 使用 `get_window_list()` 查看当前所有窗口状态',
      '8. 所有新打开的自动化窗口都是**完全无痕的**，关闭后不留任何数据',
      '',
      '## execute_js 异步代码使用',
      '当需要执行异步代码时，设置 `is_async: true`：',
      '- `async/await` 语法',
      '- `Promise` 对象',
      '- `fetch` API 进行网络请求',
      '- `setTimeout/setInterval` 等定时器',
      '',
      '```javascript',
      '// 示例 1: 使用 async/await (is_async: true)',
      'const response = await fetch("https://api.example.com/data");',
      'const data = await response.json();',
      'return data;',
      '',
      '// 示例 2: 同步代码 (is_async: false 或不传)',
      'document.title',
      '',
      '// 示例 3: 使用 Promise (is_async: true)',
      'new Promise((resolve) => {',
      '  setTimeout(() => resolve("Hello after 1 second"), 1000);',
      '})',
      '```',
    ].join('\n')
  }

  async getBriefDescription(context?: Record<string, any>): Promise<string> {
    return '通过内置的 Chromium 进行浏览器自动化操作，支持页面导航、JS 执行、DOM 交互等。除非用户明确指定，否则应优先使用其他更高效的工具（如搜索 API、直接 HTTP 请求等），只有必须使用浏览器交互操作时才使用此工具集'
  }

  getMetadata(context?: Record<string, any>): ToolProviderMetadata {
    return {
      namespace: this.namespace,
      displayName: '浏览器控制',
      description: '通过 Electron 内置 Chromium 进行浏览器自动化操作',
      isMcp: false,
      loadMode: 'lazy',
    }
  }
}
