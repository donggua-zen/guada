/**
 * Electron Browser Automation Bridge - IPC Mode
 * 
 * 通过 Electron IPC 与 Backend 通信
 * 仅负责通信协议层，业务逻辑委托给 BrowserAutomationService
 */

import log from 'electron-log'
import { BrowserAutomationService, ToolRequest, ToolResponse } from './browser-automation-service'
import { BrowserTabManager } from './browser-tab-manager'

let automationService: BrowserAutomationService | null = null

/**
 * 启动 IPC 模式的 Browser Bridge
 */
export function startBrowserBridge(tabManager: BrowserTabManager): void {
  log.info('🌉 Starting Browser Bridge in IPC mode...')

  // 初始化浏览器自动化服务
  automationService = new BrowserAutomationService()
  
  // 初始化 TabManager
  automationService.initializeTabManager(tabManager)

  // 监听来自父进程的消息
  if (process.send) {
    log.info('✅ Browser Bridge ready, waiting for IPC messages')

    process.on('message', async (message: any) => {
      if (!message || message.type !== 'BROWSER_TOOL_CALL') {
        return
      }

      const request: ToolRequest = message.data

      try {
        log.debug(`📨 Received IPC request: ${request.method} (id: ${request.id})`)

        const result = await automationService!.handleToolCall(request)

        const response: ToolResponse = {
          id: request.id,
          result,
        }

        process.send!({
          type: 'BROWSER_TOOL_RESPONSE',
          data: response,
        })

        log.debug(`📤 Sent IPC response for ${request.id}`)
      } catch (error: any) {
        log.error(`❌ Error handling IPC request ${request.id}:`, error)

        const response: ToolResponse = {
          id: request.id,
          error: error.message,
        }

        process.send!({
          type: 'BROWSER_TOOL_RESPONSE',
          data: response,
        })
      }
    })
  } else {
    log.warn('⚠️ No IPC channel available, Browser Bridge disabled')
  }

  // 应用退出时清理
  process.on('exit', async () => {
    if (automationService) {
      await automationService.destroy()
    }
  })
}

/**
 * 停止 Browser Bridge
 */
export async function stopBrowserBridge(): Promise<void> {
  if (automationService) {
    await automationService.destroy()
    automationService = null
    log.info('🛑 Browser Bridge stopped')
  }
}
