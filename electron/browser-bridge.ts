/**
 * Electron Browser Automation Bridge - IPC Mode
 * 
 * 通过 Electron IPC 与 Backend 通信
 * 仅负责通信协议层，业务逻辑委托给 BrowserAutomationService
 */

import log from 'electron-log'
import { BrowserAutomationService, ToolRequest, ToolResponse } from './browser-automation-service'
import { BrowserWindowManager } from './browser-tab-manager'

let automationService: BrowserAutomationService | null = null

/**
 * 启动 IPC 模式的 Browser Bridge
 * @param windowManager - 窗口管理器
 * @param backendProcess - 后端子进程（可选，用于监听 IPC）
 */
export function startBrowserBridge(windowManager: BrowserWindowManager, backendProcess?: any): void {
  log.info('Starting Browser Bridge in IPC mode...')

  // 初始化浏览器自动化服务
  automationService = new BrowserAutomationService()
  
  // 初始化 WindowManager
  automationService.initializeWindowManager(windowManager)

  // 如果提供了后端进程，监听它的 IPC 消息
  if (backendProcess) {
    log.info('Browser Bridge listening to backend process IPC messages')

    backendProcess.on('message', async (message: any) => {
      if (!message || message.type !== 'BROWSER_TOOL_CALL') {
        return
      }

      const request: ToolRequest = message.data

      try {
        log.info(`Received IPC request from backend: ${request.method} (id: ${request.id})`)
        log.debug(`Request params: ${JSON.stringify(request.params).substring(0, 200)}`)

        const result = await automationService!.handleToolCall(request)

        const response: ToolResponse = {
          id: request.id,
          result,
        }

        log.info(`Sending IPC response for ${request.id}`)
        backendProcess.send!({
          type: 'BROWSER_TOOL_RESPONSE',
          data: response,
        })

        log.debug(`Sent IPC response for ${request.id}`)
      } catch (error: any) {
        log.error(`Error handling IPC request ${request.id}:`, error)

        const response: ToolResponse = {
          id: request.id,
          error: error.message,
        }

        backendProcess.send!({
          type: 'BROWSER_TOOL_RESPONSE',
          data: response,
        })
      }
    })

    log.info('Browser Bridge IPC ready (listening to backend process)')
  } else {
    log.warn('⚠️ No backend process provided, Browser Bridge IPC disabled')
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
    log.info('Browser Bridge stopped')
  }
}
