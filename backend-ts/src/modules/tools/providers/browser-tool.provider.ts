import { Injectable, Logger } from '@nestjs/common'
import {
  IToolProvider,
  ToolCallRequest,
  ToolProviderMetadata,
} from '../interfaces/tool-provider.interface'
import * as http from 'http'
import * as path from 'path'
import * as fs from 'fs'
import { WorkspaceService } from '../../../common/services/workspace.service'

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

  constructor(private workspaceService: WorkspaceService) { }

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
        description: '在指定窗口执行 JavaScript 代码并返回结果。支持直接传入代码字符串或文件路径（相对路径相对于会话工作目录）',
        parameters: {
          type: 'object',
          properties: {
            code: { type: 'string', description: '要执行的 JavaScript 代码字符串' },
            file_path: { type: 'string', description: 'JavaScript 文件路径（相对路径相对于会话工作目录，与 code 二选一）' },
            window_id: { type: 'string', description: '目标窗口 ID（必填）' },
            is_async: { type: 'boolean', description: '是否支持异步代码（async/await、Promise 等），默认 false' },
          },
          required: ['window_id'],
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
        description: '打开新的独立窗口，返回 window_id。支持传递元数据用于 session 隔离和作用域标识',
        parameters: {
          type: 'object',
          properties: {
            url: { type: 'string', description: '要打开的 URL' },
            metadata: { 
              type: 'object', 
              description: '可选元数据，如 { scope: "session_123", purpose: "research" }',
              properties: {
                scope: { type: 'string', description: '作用域标识，用于 session 隔离' },
                purpose: { type: 'string', description: '窗口用途描述' },
              },
            },
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

      // 特殊处理 execute_js，支持文件路径
      if (request.name === 'execute_js') {
        return await this.executeJsWithFileSupport(request.arguments, context)
      }

      const result = await this.sendRequest(request.name, request.arguments)

      // 特殊处理 get_page_struct，如果结果过大则保存到临时文件
      if (request.name === 'get_page_struct') {
        return await this.handleLargeStructResult(result, context)
      }

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

  /**
   * 执行 JavaScript，支持代码字符串或文件路径
   */
  private async executeJsWithFileSupport(args: any, context?: Record<string, any>): Promise<string> {
    const { code, file_path, window_id, is_async } = args

    // 验证 window_id
    if (!window_id) {
      throw new Error('window_id 是必填参数')
    }

    // 验证 code 和 file_path 至少提供一个
    if (!code && !file_path) {
      throw new Error('必须提供 code 或 file_path 其中之一')
    }

    if (code && file_path) {
      throw new Error('code 和 file_path 不能同时提供')
    }

    let finalCode: string

    if (file_path) {
      // 从文件读取 JavaScript 代码
      finalCode = await this.readJsFile(file_path, context)
    } else {
      finalCode = code
    }

    // 发送请求到 Electron
    const result = await this.sendRequest('execute_js', {
      code: finalCode,
      window_id,
      is_async: is_async || false,
    })

    // 格式化结果为字符串
    if (typeof result === 'string') {
      return result
    }

    return JSON.stringify(result)
  }

  /**
   * 读取 JavaScript 文件内容
   */
  private async readJsFile(filePath: string, context?: Record<string, any>): Promise<string> {
    if (!filePath || typeof filePath !== 'string') {
      throw new Error('文件路径不能为空')
    }

    try {
      // 解析文件路径
      const resolvedPath = this.resolveJsFilePath(filePath, context)
      this.logger.log(`读取 JavaScript 文件: ${filePath} -> ${resolvedPath}`)

      // 检查文件是否存在（异步）
      try {
        await fs.promises.access(resolvedPath)
      } catch (error: any) {
        throw new Error(`文件不存在: ${resolvedPath}`)
      }

      const stats = await fs.promises.stat(resolvedPath)
      if (!stats.isFile()) {
        throw new Error(`${resolvedPath} 不是一个文件`)
      }

      // 检查文件大小（限制为 1MB）
      const maxSize = 5 * 1024 * 1024 // 1MB
      if (stats.size > maxSize) {
        throw new Error(`文件过大: ${stats.size} bytes (最大允许 ${maxSize} bytes)`)
      }

      // 读取文件内容（异步）
      const content = await fs.promises.readFile(resolvedPath, 'utf-8')
      this.logger.debug(`成功读取 JavaScript 文件，大小: ${content.length} 字符`)

      return content
    } catch (error: any) {
      this.logger.error(`读取 JavaScript 文件失败: ${error.message}`)
      throw new Error(`读取 JavaScript 文件失败: ${error.message}`)
    }
  }

  /**
   * 解析 JavaScript 文件路径（复用 WorkspaceService）
   */
  private resolveJsFilePath(filePath: string, context?: Record<string, any>): string {
    return this.workspaceService.resolveFilePath(filePath, context?.sessionId)
  }

  /**
   * 处理 get_page_struct 的大结果，超过 100KB 时保存到临时文件
   */
  private async handleLargeStructResult(result: any, context?: Record<string, any>): Promise<string> {
    const MAX_SIZE_BYTES = 100 * 1024 // 100KB

    // 将结果转换为 JSON 字符串
    const jsonString = typeof result === 'string' ? result : JSON.stringify(result)
    const byteSize = Buffer.byteLength(jsonString, 'utf-8')

    // 如果结果小于 100KB，直接返回
    if (byteSize <= MAX_SIZE_BYTES) {
      this.logger.debug(`get_page_struct result size: ${byteSize} bytes (< 100KB), returning directly`)
      return jsonString
    }

    // 结果过大，保存到临时文件
    this.logger.log(`get_page_struct result too large: ${byteSize} bytes (> 100KB), saving to temp file`)

    try {
      // 确保 sessionId 存在
      if (!context?.sessionId) {
        throw new Error('无法保存大结果：缺少会话 ID')
      }

      // 生成临时文件名
      const timestamp = Date.now()
      const fileName = `get_page_struct_output_${timestamp}.json`

      // 创建 tools_output 目录
      const workspaceDir = this.workspaceService.getWorkspaceDir(context.sessionId)
      const outputDir = path.join(workspaceDir, 'tools_output')

      // 确保目录存在（异步）
      await fs.promises.mkdir(outputDir, { recursive: true })

      const filePath = path.join(outputDir, fileName)

      // 写入文件（异步）
      await fs.promises.writeFile(filePath, jsonString, 'utf-8')

      this.logger.log(`Saved large struct result to: ${filePath}`)

      // 返回文件路径信息（使用相对路径）
      const relativePath = path.join('tools_output', fileName)
      return JSON.stringify({
        message: '结果过大，已保存到你的工作目录',
        file_path: relativePath,
        file_size_bytes: byteSize,
        file_size_kb: Math.round(byteSize / 1024),
      })
    } catch (error: any) {
      this.logger.error(`Failed to save large struct result: ${error.message}`)
      // 如果保存失败，尝试返回截断的结果
      const truncated = jsonString.substring(0, MAX_SIZE_BYTES) + '\n... [结果被截断]'
      return JSON.stringify({
        error: `保存大结果失败: ${error.message}`,
        truncated_result: truncated,
        original_size_bytes: byteSize,
      })
    }
  }

  async getPrompt(context?: Record<string, any>): Promise<string> {
    return [
      '# 浏览器控制工具使用说明 (browser)',
      '',
      '你可以通过本工具集直接控制内置的 Chromium 浏览器，支持页面导航、JS 执行、DOM 交互等。',
      '',
      '## 多窗口支持',
      '- 最多支持 5 个并发窗口',
      '- 每个窗口有独立的会话隔离（cookies、localStorage 等完全隔离）',
      '- 使用 `get_window_list()` 查看当前所有可用窗口',
      '- 使用 `open_new_window(url)` 创建新窗口后会返回新的 `window_id`',
      '',
      '## 使用建议',
      '1. 先用 `open_new_window(url)` 创建新窗口并导航到目标网页，获取 `window_id`',
      '2. 用 `get_page_text` 获取纯文本内容进行分析（适合快速了解页面主要内容）',
      '3. 用 `get_page_struct` 获取结构化 JSON（适合需要分析 DOM 结构或提取特定元素）',
      '4. 如需交互，使用 `click` 和 `fill_input` 操作页面元素',
      '5. 进阶功能，使用 `execute_js` 编写 JavaScript 或使用 `file_path` 参数执行外部 JS 文件',
      '6. 所有新打开的自动化窗口都是**完全无痕的**，关闭后不留任何数据',
      '',
      '## execute_js 异步代码使用',
      '当需要执行异步代码时，设置 `is_async: true`：',
      '- `async/await` 语法',
      '- `Promise` 对象',
      '- `fetch` API 进行网络请求',
      '- `setTimeout/setInterval` 等定时器',
      '',
      '## execute_js 文件执行',
      '可以通过 `file_path` 参数执行外部 JavaScript 文件，长代码建议使用此方法',
      '',
      '```javascript',
      '// 示例 1: 使用 code 参数直接执行代码',
      '{"code": "document.title", "window_id": "abc123"}',
      '',
      '// 示例 2: 使用 file_path 参数执行文件',
      '{"file_path": "scripts/extract-data.js", "window_id": "abc123", "is_async": true}',
      '',
      '// 示例 3: 使用 async/await (is_async: true)',
      'const response = await fetch("https://api.example.com/data");',
      'const data = await response.json();',
      'return data;',
      '',
      '// 示例 4: 同步代码 (is_async: false 或不传)',
      'document.title',
      '',
      '// 示例 5: 使用 Promise (is_async: true)',
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
