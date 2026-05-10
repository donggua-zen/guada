/**
 * Electron Browser Automation Bridge - TCP Mode
 * 
 * 通过 HTTP Server 与 Backend 通信
 * 仅负责通信协议层，业务逻辑委托给 BrowserAutomationService
 */

import { createServer, IncomingMessage, ServerResponse } from 'http'
import log from 'electron-log'
import { BrowserAutomationService, ToolRequest, ToolResponse } from './browser-automation-service'
import { BrowserTabManager } from './browser-tab-manager'

let httpServer: ReturnType<typeof createServer> | null = null
let automationService: BrowserAutomationService | null = null

/**
 * 启动 TCP 模式的 Browser Bridge
 * @param port 监听端口，默认 3001
 * @param tabManager 标签管理器实例
 */
export function startBrowserBridgeTCP(port: number = 3001, tabManager?: BrowserTabManager): Promise<number> {
  return new Promise((resolve, reject) => {
    log.info(`Starting Browser Bridge TCP Server on port ${port}...`)

    // 初始化浏览器自动化服务
    automationService = new BrowserAutomationService()
    
    // 如果提供了 TabManager，则初始化
    if (tabManager) {
      automationService.initializeTabManager(tabManager)
    }

    // 创建 HTTP Server
    httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      // 只处理 /browser-tool 的 POST 请求
      if (req.url === '/browser-tool' && req.method === 'POST') {
        let body = ''

        req.on('data', chunk => {
          body += chunk
        })

        req.on('end', async () => {
          try {
            const request: ToolRequest = JSON.parse(body)
            log.debug(`Received TCP request: ${request.method} (id: ${request.id})`)

            const result = await automationService!.handleToolCall(request)

            const response: ToolResponse = {
              id: request.id,
              result,
            }

            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify(response))

            log.debug(`Sent TCP response for ${request.id}`)
          } catch (error: any) {
            log.error(`Error handling TCP request:`, error)

            const response: ToolResponse = {
              id: 'error',
              error: error.message,
            }

            res.writeHead(500, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify(response))
          }
        })
      } else {
        res.writeHead(404, { 'Content-Type': 'text/plain' })
        res.end('Not Found')
      }
    })

    // 监听指定端口，仅允许本地访问
    httpServer.listen(port, '127.0.0.1', () => {
      log.info(`Browser Bridge TCP Server listening on http://127.0.0.1:${port}/browser-tool`)
      resolve(port)
    })

    httpServer.on('error', (error: any) => {
      log.error('Browser Bridge TCP Server error:', error)
      reject(error)
    })
  })
}

/**
 * 停止 TCP 模式的 Browser Bridge
 */
export async function stopBrowserBridgeTCP(): Promise<void> {
  if (httpServer) {
    return new Promise((resolve) => {
      httpServer!.close(async () => {
        log.info('Browser Bridge TCP Server stopped')

        if (automationService) {
          await automationService.destroy()
          automationService = null
        }

        httpServer = null
        resolve()
      })
    })
  }
}
