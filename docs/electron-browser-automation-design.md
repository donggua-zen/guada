# Electron 浏览器自动化工具设计方案

> **版本**: 1.0
> **日期**: 2026-05-09
> **状态**: 设计阶段
> **依赖**: Electron、MCP SDK（项目已有）

---

## 目录

1. [背景与动机](#1-背景与动机)
2. [现有系统架构分析](#2-现有系统架构分析)
3. [总体方案设计](#3-总体方案设计)
4. [Electron 侧：MCP Bridge 实现](#4-electron-侧mcp-bridge-实现)
5. [Backend 侧：BrowserToolProvider 实现](#5-backend-侧browsertoolprovider-实现)
6. [工具能力矩阵](#6-工具能力矩阵)
7. [通信协议：stdio MCP](#7-通信协议stdio-mcp)
8. [无痕窗口方案](#8-无痕窗口方案)
9. [实施清单](#9-实施清单)
10. [附录：关键代码参考](#10-附录关键代码参考)

---

## 1. 背景与动机

### 1.1 需求场景

在 AI 聊天应用中，用户经常需要 LLM Agent 执行浏览器自动化任务，例如：

- 打开网页、获取页面内容进行摘要分析
- 在特定网站上执行 JavaScript 提取结构化数据
- 模拟登录、填表、点击等交互操作
- 截图当前页面用于视觉分析
- 多页面导航（前进、后退、刷新）

### 1.2 为什么不用 puppeteer/playwright

Electron 本身内置了完整 Chromium 引擎，`webContents` API 已经提供了所有浏览器自动化所需的核心能力：

| 能力 | Puppeteer | Electron webContents |
|------|-----------|---------------------|
| 页面导航 | `page.goto()` | `webContents.loadURL()` |
| JS 执行 | `page.evaluate()` | `webContents.executeJavaScript()` |
| 截图 | `page.screenshot()` | `webContents.capturePage()` |
| DOM 操作 | `page.$eval()` 等 | `executeJavaScript` 内直接操作 |
| 前进/后退/刷新 | `page.goBack()` 等 | `webContents.goBack()` 等 |
| Cookie 管理 | `page.cookies()` | `session.cookies` API |
| 网络拦截 | `page.setRequestInterception()` | `session.webRequest` API |

**结论**：零外部依赖即可实现完整浏览器自动化，且 Electron 场景下 puppeteer/playwright 反而需要额外连接 Chromium 进程，增加复杂度和资源消耗。

### 1.3 核心挑战

当前 [main.ts](file:///d:/AI/ai_chat/electron/main.ts) 启动的 NestJS 后端与 Electron Main Process 是**两个独立进程**，仅存在单向的 `child_process.spawn` + `process.send()` IPC 通道（后端→Electron 方向）。后端无法直接调用 Electron 的浏览器 API。

需要建立一条**双向、结构化**的通信通道。

---

## 2. 现有系统架构分析

### 2.1 系统拓扑

```
┌──────────────────────────────────────────────────────────────────┐
│                    Electron Main Process                          │
│  [electron/main.ts]                                               │
│  ├── BrowserWindow (主窗口, 1200x800)                             │
│  │   └── webContents → 加载 Vue 前端                              │
│  ├── ipcMain (渲染进程 ↔ 主进程通信)                                │
│  │   ├── get-backend-port                                         │
│  │   ├── show-context-menu                                        │
│  │   ├── clipboard-* / open-external                              │
│  │   └── window-minimize / maximize / close                       │
│  ├── autoUpdater (electron-updater)                               │
│  └── fork/spawn NestJS Backend                                    │
│       │                                                           │
│       ├── 开发模式: spawn npx ts-node-dev (固定端口 3000)           │
│       └── 生产模式: spawn process.execPath (ELECTRON_RUN_AS_NODE)  │
│            └── stdio: pipe + ipc → port 回传给 Electron            │
└───────────────────┬──────────────────────────────────────────────┘
                    │ child_process (独立进程)
┌───────────────────▼──────────────────────────────────────────────┐
│              NestJS Backend (独立进程)                             │
│  [backend-ts/src/main.ts]                                         │
│  ├── ChatController (SSE: /api/v1/chat/completions)               │
│  ├── AgentEngine (ReAct 多轮循环, 最大 40 轮)                      │
│  ├── ToolOrchestrator (工具注册/分发/执行)                          │
│  │   ├── ShellToolProvider            → namespace: "shell"        │
│  │   ├── KnowledgeBaseToolProvider    → namespace: "knowledge_base"│
│  │   ├── MCPToolProvider              → namespace: "mcp"           │
│  │   ├── SkillToolBridgeService       → namespace: "skill"         │
│  │   ├── MemoryToolProvider           → namespace: "memory"        │
│  │   ├── TimeToolProvider             → namespace: "time"          │
│  │   └── ImageRecognitionToolProvider → namespace: "image_recog"  │
│  └── McpClientService (stdio / sse / streamableHttp 三种协议)      │
└──────────────────────────────────────────────────────────────────┘
```

### 2.2 工具调用流程（现有）

```
用户消息 (HTTP POST /api/v1/chat/completions)
  → ChatController.completions()
    → AgentEngine.completions()
      → SessionLockService.tryLock()        ← 会话并发控制
      → SessionContextService.buildContext()  ← 构建上下文 + 工具配置
      → executeAgentLoop()                   ← ReAct 循环入口
        ┌──────────────────────────────────────┐
        │ do {                                 │
        │   context.getMessages()              │  ← 消息 + system prompt
        │   llmService.completions(stream)     │  ← 流式 LLM 调用
        │   yield SSE events                   │  ← 实时推送前端
        │                                      │
        │   if (toolCalls) {                   │
        │     toolOrchestrator.executeBatch()  │  ← 批量执行工具
        │       → 解析 namespace__toolName     │
        │       → provider.execute(request)    │
        │       → 返回结果字符串                │
        │     yield tool_calls_response        │
        │     needToContinue = true            │
        │   }                                  │
        │ } while (needToContinue)             │
        └──────────────────────────────────────┘
```

### 2.3 IToolProvider 接口

定义在 [tool-provider.interface.ts](file:///d:/AI/ai_chat/backend-ts/src/modules/tools/interfaces/tool-provider.interface.ts)：

```typescript
export interface IToolProvider {
  namespace: string
  getTools(enabled?: boolean | string[]): Promise<any[]>
  execute(request: ToolCallRequest, context?: Record<string, any>): Promise<string>
  getPrompt(context?: Record<string, any>): Promise<string>
  getPersistentPrompt?(context?: Record<string, any>): Promise<string>
  getMetadata(): ToolProviderMetadata
  getBriefDescription?(): Promise<string>
}
```

### 2.4 MCP 基础设施（已有）

项目已使用 `@modelcontextprotocol/sdk`，位于 [mcp-client.service.ts](file:///d:/AI/ai_chat/backend-ts/src/common/mcp/mcp-client.service.ts)。支持三种传输协议：

| 协议 | 传输方式 | 使用场景 |
|------|---------|---------|
| `stdio` | stdin/stdout 管道 | 本地方案（Electron Bridge 使用此协议） |
| `sse` | HTTP SSE 长连接 | 远程 MCP 服务器 |
| `streamableHttp` | HTTP 流式响应 | 远程 MCP 服务器 |

---

## 3. 总体方案设计

### 3.1 核心思路

将 Electron Main Process 本身变成一个 **stdio MCP Server**（电子桥 - Electron MCP Bridge），Backend 通过已有的 `McpClientService`（stdio transport）连接到这个 MCP Server，从而将 Electron 的浏览器 API 暴露为 LLM 可调用的工具。

### 3.2 架构图

```
                     ┌─────────────────────────────────┐
                     │     LLM (AI 模型)                │
                     │  想执行浏览器操作，返回 tool_call  │
                     └──────────────┬──────────────────┘
                                    │ tool_name: "browser__navigate"
                                    │ arguments: { url: "https://..." }
                                    ▼
┌───────────────────────────────────────────────────────────────┐
│  NestJS Backend                                                │
│                                                                │
│  ToolOrchestrator                                              │
│    → ElectronBrowserToolProvider  (namespace: "browser")       │
│      → McpClientService (stdio transport)                      │
│        ├── 开发模式: command="npx ts-node-dev", args=[bridge.ts]│
│        └── 生产模式: command=process.execPath,                 │
│                      args=["--electron-mcp-bridge"]            │
└──────────────────────────┬────────────────────────────────────┘
                           │ stdio pipe (stdin/stdout)
                           ▼
┌───────────────────────────────────────────────────────────────┐
│  Electron Main Process                                         │
│                                                                │
│  ElectronMCPBridge (stdio MCP Server)                          │
│  ├── tools/navigate      → webContents.loadURL(url)            │
│  ├── tools/execute_js    → webContents.executeJavaScript(code) │
│  ├── tools/screenshot    → webContents.capturePage()           │
│  ├── tools/get_content   → executeJavaScript("outerHTML")      │
│  ├── tools/go_back       → webContents.goBack()                │
│  ├── tools/go_forward    → webContents.goForward()             │
│  ├── tools/reload        → webContents.reload()                │
│  ├── tools/click         → inject click on selector            │
│  ├── tools/fill_input    → inject value into input             │
│  ├── tools/open_window   → new BrowserWindow (incognito)       │
│  └── tools/close_window  → win.close() + clearStorageData()    │
└───────────────────────────────────────────────────────────────┘
```

### 3.3 关键设计决策

| 决策点 | 选择 | 理由 |
|--------|------|------|
| 通信协议 | stdio MCP | 复用已有 MCP 基础设施，零额外依赖；原生管道通信延迟最低 |
| 工具加载模式 | `lazy` | 浏览器工具有十几个，不宜全部塞入 LLM 的 tools 参数，按需加载 |
| 命名空间 | `browser` | 语义清晰，与其他 namespace（shell、knowledge_base 等）风格一致 |
| Provider 类型 | 扁平的 MCP Provider | 直接用 `McpClientService` 作为底层传输，不经过 MCPToolProvider（避免工具名称二次拼接） |

---

## 4. Electron 侧：MCP Bridge 实现

### 4.1 创建文件

**文件路径**: `electron/mcp-bridge.ts`

在 [electron/main.ts](file:///d:/AI/ai_chat/electron/main.ts) 中 `app.whenReady()` 时启动该服务。

### 4.2 核心代码

```typescript
// electron/mcp-bridge.ts

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { BrowserWindow, session } from 'electron'
import log from 'electron-log'

let browserWindows = new Map<string, BrowserWindow>()
let activeWindowId: string | null = null

function waitForPageLoad(win: BrowserWindow): Promise<void> {
  return new Promise((resolve) => {
    if (!win.webContents.isLoadingMainFrame()) {
      resolve()
      return
    }
    win.webContents.once('did-finish-load', () => resolve())
  })
}

async function getOrCreateMainWindow(): Promise<BrowserWindow> {
  if (activeWindowId && browserWindows.has(activeWindowId)) {
    return browserWindows.get(activeWindowId)!
  }
  const { id, window: win } = await createAutomationWindow()
  activeWindowId = id
  return win
}

async function createAutomationWindow(
  url?: string,
): Promise<{ id: string; window: BrowserWindow }> {
  const windowId = `auto_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

  const win = new BrowserWindow({
    width: 1280,
    height: 900,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      session: session.fromPartition(`persist:incognito_${windowId}`),
    },
  })

  browserWindows.set(windowId, win)

  win.on('closed', async () => {
    const ses = win.webContents.session
    await ses.clearStorageData({
      storages: [
        'appcache', 'cookies', 'filesystem', 'indexdb',
        'localstorage', 'shadercache', 'websql', 'serviceworkers',
        'cachestorage',
      ],
    })
    await ses.clearCache()
    await ses.clearAuthCache()
    await ses.clearHostResolverCache()
    browserWindows.delete(windowId)
    if (activeWindowId === windowId) activeWindowId = null
    log.info(`自动化窗口 ${windowId} 已关闭，所有数据已清除`)
  })

  if (url) {
    await win.webContents.loadURL(url)
    await waitForPageLoad(win)
  }

  return { id: windowId, window: win }
}

export function startElectronMCPBridge() {
  const server = new Server(
    { name: 'electron-browser-bridge', version: '1.0.0' },
    { capabilities: { tools: {} } }
  )

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'navigate',
        description: 'Navigate the controlled browser window to a specified URL',
        inputSchema: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'URL to navigate to' },
            window_id: { type: 'string', description: 'Target window ID (optional)' },
          },
          required: ['url'],
        },
      },
      {
        name: 'execute_js',
        description: 'Execute JavaScript code in the current page and return the result as JSON',
        inputSchema: {
          type: 'object',
          properties: {
            code: { type: 'string', description: 'JavaScript code to execute' },
            window_id: { type: 'string', description: 'Target window ID (optional)' },
          },
          required: ['code'],
        },
      },
      {
        name: 'screenshot',
        description: 'Capture a screenshot of the current page, returns base64-encoded PNG',
        inputSchema: {
          type: 'object',
          properties: {
            window_id: { type: 'string', description: 'Target window ID (optional)' },
          },
        },
      },
      {
        name: 'get_page_content',
        description: 'Get the full text/DOM content of the current page, optionally filtered by CSS selector',
        inputSchema: {
          type: 'object',
          properties: {
            selector: { type: 'string', description: 'CSS selector to extract specific element text (optional)' },
            window_id: { type: 'string', description: 'Target window ID (optional)' },
          },
        },
      },
      {
        name: 'go_back',
        description: 'Navigate back in browser history',
        inputSchema: {
          type: 'object',
          properties: {
            window_id: { type: 'string', description: 'Target window ID (optional)' },
          },
        },
      },
      {
        name: 'go_forward',
        description: 'Navigate forward in browser history',
        inputSchema: {
          type: 'object',
          properties: {
            window_id: { type: 'string', description: 'Target window ID (optional)' },
          },
        },
      },
      {
        name: 'reload',
        description: 'Reload the current page',
        inputSchema: {
          type: 'object',
          properties: {
            window_id: { type: 'string', description: 'Target window ID (optional)' },
          },
        },
      },
      {
        name: 'click',
        description: 'Click on an HTML element identified by a CSS selector',
        inputSchema: {
          type: 'object',
          properties: {
            selector: { type: 'string', description: 'CSS selector for the target element' },
            window_id: { type: 'string', description: 'Target window ID (optional)' },
          },
          required: ['selector'],
        },
      },
      {
        name: 'fill_input',
        description: 'Type text into an input/textarea element identified by a CSS selector',
        inputSchema: {
          type: 'object',
          properties: {
            selector: { type: 'string', description: 'CSS selector for the input element' },
            value: { type: 'string', description: 'Text value to fill' },
            window_id: { type: 'string', description: 'Target window ID (optional)' },
          },
          required: ['selector', 'value'],
        },
      },
      {
        name: 'open_new_window',
        description: 'Open a new incognito browser window for automation tasks',
        inputSchema: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'Initial URL to open (optional)' },
          },
        },
      },
      {
        name: 'close_window',
        description: 'Close a browser window and permanently clear all its browsing data',
        inputSchema: {
          type: 'object',
          properties: {
            window_id: { type: 'string', description: 'Window ID to close' },
          },
        },
      },
    ],
  }))

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params
    const winId = (args?.window_id as string) || activeWindowId
    const win = winId ? browserWindows.get(winId) : null

    switch (name) {
      case 'navigate': {
        const targetWin = win || (await getOrCreateMainWindow())
        await targetWin.webContents.loadURL(args!.url)
        await waitForPageLoad(targetWin)
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              url: targetWin.webContents.getURL(),
              title: targetWin.webContents.getTitle(),
            }),
          }],
        }
      }

      case 'execute_js': {
        if (!win) throw new Error('No active browser window')
        const result = await win.webContents.executeJavaScript(args!.code)
        return {
          content: [{
            type: 'text',
            text: typeof result === 'string' ? result : JSON.stringify(result),
          }],
        }
      }

      case 'screenshot': {
        const targetWin = win || (await getOrCreateMainWindow())
        const image = await targetWin.webContents.capturePage()
        return {
          content: [{
            type: 'image',
            data: image.toPNG().toString('base64'),
            mimeType: 'image/png',
          }],
        }
      }

      case 'get_page_content': {
        const targetWin = win || (await getOrCreateMainWindow())
        const selector = args?.selector as string | undefined
        let script: string
        if (selector) {
          script = `
            (() => {
              const el = document.querySelector('${selector.replace(/'/g, "\\'")}');
              return el ? el.textContent : '(element not found)';
            })()
          `
        } else {
          script = 'document.documentElement.outerHTML'
        }
        const content = await targetWin.webContents.executeJavaScript(script)
        const maxLen = 50000
        const text = typeof content === 'string' ? content.substring(0, maxLen) : JSON.stringify(content)
        return { content: [{ type: 'text', text }] }
      }

      case 'go_back': {
        if (!win) throw new Error('No active window')
        if (win.webContents.canGoBack()) win.webContents.goBack()
        await waitForPageLoad(win)
        return { content: [{ type: 'text', text: JSON.stringify({ url: win.webContents.getURL() }) }] }
      }

      case 'go_forward': {
        if (!win) throw new Error('No active window')
        if (win.webContents.canGoForward()) win.webContents.goForward()
        await waitForPageLoad(win)
        return { content: [{ type: 'text', text: JSON.stringify({ url: win.webContents.getURL() }) }] }
      }

      case 'reload': {
        if (!win) throw new Error('No active window')
        win.webContents.reload()
        await waitForPageLoad(win)
        return { content: [{ type: 'text', text: JSON.stringify({ url: win.webContents.getURL() }) }] }
      }

      case 'click': {
        if (!win) throw new Error('No active window')
        const escSelector = (args!.selector as string).replace(/'/g, "\\'")
        const result = await win.webContents.executeJavaScript(`
          (() => {
            const el = document.querySelector('${escSelector}');
            if (!el) return JSON.stringify({ error: 'Element not found', selector: '${escSelector}' });
            el.click();
            return JSON.stringify({ clicked: true, tagName: el.tagName.toLowerCase() });
          })()
        `)
        return { content: [{ type: 'text', text: result }] }
      }

      case 'fill_input': {
        if (!win) throw new Error('No active window')
        const escSelector = (args!.selector as string).replace(/'/g, "\\'")
        const value = JSON.stringify(args!.value)
        const result = await win.webContents.executeJavaScript(`
          (() => {
            const el = document.querySelector('${escSelector}');
            if (!el) return JSON.stringify({ error: 'Element not found' });
            el.focus();
            el.value = ${value};
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            return JSON.stringify({ filled: true, selector: '${escSelector}' });
          })()
        `)
        return { content: [{ type: 'text', text: result }] }
      }

      case 'open_new_window': {
        const result = await createAutomationWindow(args?.url as string | undefined)
        activeWindowId = result.id
        return { content: [{ type: 'text', text: JSON.stringify({ window_id: result.id, url: args?.url || 'about:blank' }) }] }
      }

      case 'close_window': {
        if (!win) throw new Error('No active window or window not found')
        win.close()
        return { content: [{ type: 'text', text: JSON.stringify({ closed_window_id: winId }) }] }
      }

      default:
        throw new Error(`Unknown tool: ${name}`)
    }
  })

  const transport = new StdioServerTransport()
  server.connect(transport)
  log.info('Electron MCP Bridge started (stdio mode)')
}
```

### 4.3 在 main.ts 中集成

在 [main.ts](file:///d:/AI/ai_chat/electron/main.ts) 中需要：

1. 修改 `startBackend()` 函数，在生产环境中将 MCP Bridge 的 stdio 通道与后端建立连接。这有两种方案：

**方案 A**（推荐）：在后端启动参数中传入特殊标志，让后端知道连接 Electron MCP Bridge 的方式。

**方案 B**：在 Electron 中额外 fork 一个 MCP Bridge 进程，后端通过 `McpServer` 数据库条目连接。

推荐**方案 A**，因为 stdio 管道天然适合父子进程通信。

生产环境启动后端时，Electron 主进程已经在 [main.ts](file:///d:/AI/ai_chat/electron/main.ts) 第 `spawnOptions` 中配置了 `stdio`。当前配置是 `['pipe', 'pipe', 'pipe', 'ipc']`（四个流：stdin、stdout、stderr、ipc）。MCP Bridge 需要接管后端的 stdin/stdout。

**推荐实现方案**：不修改后端启动方式，而是在 Electron 主进程内启动 MCP Bridge 的 stdio server，并在后端通过环境变量传递连接信息。但 stdio MCP server 需要独立的 stdin/stdout 管道。

更实际的方案是：**在 `backend-ts/src/main.ts` 或后端启动脚本中，让后端主动通过 stdio 连接 Electron**。由于后端是被 fork 的子进程，它可以直接与父进程（Electron）通信。具体做法：

1. 后端启动时通过环境变量 `ELECTRON_MCP_BRIDGE=true` 获知自己在 Electron 环境中
2. 后端创建一个 MCP stdio client，直接连接到 `process.stdin` / `process.stdout`
3. Electron 主进程在 `startElectronMCPBridge()` 中，通过在 fork 子进程的 stdio 上读写来通信

**但这里有一个复杂性**：当前开发模式使用 `spawn npx ts-node-dev`，标准输入输出已被用于日志和错误输出，不适合在此之上叠加 MCP 协议。

**最终推荐方案**：使用一个独立的临时 TCP 端口或 Unix socket 作为 MCP Bridge 的传输层，简化连接管理。

---

## 5. Backend 侧：BrowserToolProvider 实现

### 5.1 创建文件

**文件路径**: `backend-ts/src/modules/tools/providers/browser-tool.provider.ts`

```typescript
// backend-ts/src/modules/tools/providers/browser-tool.provider.ts

import { Injectable, Logger } from '@nestjs/common'
import {
  IToolProvider,
  ToolCallRequest,
  ToolProviderMetadata,
} from '../interfaces/tool-provider.interface'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

@Injectable()
export class BrowserToolProvider implements IToolProvider {
  private readonly logger = new Logger(BrowserToolProvider.name)
  namespace = 'browser'

  private mcpClient: Client | null = null
  private connected = false

  async onModuleInit() {
    try {
      this.logger.log('Connecting to Electron MCP Bridge...')

      const transport = new StdioClientTransport({
        command: process.execPath,
        args: [],
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '0' },
      })

      this.mcpClient = new Client(
        { name: 'nest-backend', version: '1.0.0' },
        { capabilities: {} }
      )

      await this.mcpClient.connect(transport)
      this.connected = true
      this.logger.log('Connected to Electron MCP Bridge')
    } catch (error: any) {
      this.logger.warn(`Electron MCP Bridge not available: ${error.message}`)
      this.connected = false
    }
  }

  async getTools(enabled?: boolean | string[]): Promise<any[]> {
    if (!this.connected || !this.mcpClient) return []

    try {
      const response = await this.mcpClient.request(
        { method: 'tools/list', params: {} },
        { timeout: 5000 }
      )
      return (response as any)?.tools || []
    } catch (error: any) {
      this.logger.error(`Failed to get tools from Electron Bridge: ${error.message}`)
      return []
    }
  }

  async execute(
    request: ToolCallRequest,
    context?: Record<string, any>,
  ): Promise<string> {
    if (!this.connected || !this.mcpClient) {
      throw new Error('Electron MCP Bridge is not connected. Browser tools are unavailable.')
    }

    const response = await this.mcpClient.request(
      {
        method: 'tools/call',
        params: {
          name: request.name,
          arguments: request.arguments,
        },
      },
      { timeout: 60000 }
    )

    const result = response as any
    if (result?.content && result.content.length > 0) {
      const firstContent = result.content[0]
      if (firstContent.type === 'text') {
        return firstContent.text
      }
      return JSON.stringify(result.content)
    }
    return JSON.stringify(result)
  }

  async getPrompt(context?: Record<string, any>): Promise<string> {
    return [
      '# 浏览器控制工具 (browser)',
      '',
      '你可以通过以下工具直接控制内置的 Chromium 浏览器：',
      '',
      '| 工具 | 用途 |',
      '|------|------|',
      '| **navigate(url)** | 导航到指定 URL，返回页面标题和 URL |',
      '| **execute_js(code)** | 在当前页面中执行 JavaScript 代码并返回结果 |',
      '| **screenshot()** | 截取当前页面的完整截图（base64 编码 PNG） |',
      '| **get_page_content(selector?)** | 获取页面 HTML 内容，或通过 CSS selector 提取特定元素文本 |',
      '| **go_back()** | 浏览器后退 |',
      '| **go_forward()** | 浏览器前进 |',
      '| **reload()** | 刷新当前页面 |',
      '| **click(selector)** | 点击 CSS 选择器匹配的元素 |',
      '| **fill_input(selector, value)** | 向输入框填入文本 |',
      '| **open_new_window(url?)** | 打开新的自动化窗口，返回 window_id |',
      '| **close_window(window_id?)** | 关闭窗口并清除所有浏览数据 |',
      '',
      '## 使用建议',
      '1. 先用 `navigate` 打开目标网页',
      '2. 用 `get_page_content` 获取页面内容进行分析',
      '3. 如需交互，使用 `click` 和 `fill_input` 操作页面元素',
      '4. 如需提取结构化数据，使用 `execute_js` 编写 JavaScript',
      '5. 截图工具适合需要视觉分析或验证的场景',
      '6. 所有新打开的自动化窗口都是**完全无痕的**，关闭后不留任何数据',
    ].join('\n')
  }

  getMetadata(): ToolProviderMetadata {
    return {
      namespace: this.namespace,
      displayName: '浏览器控制',
      description: '通过 Electron 内置 Chromium 进行浏览器自动化操作，支持页面导航、JS 执行、截图、DOM 交互等',
      isMcp: false,
      loadMode: 'lazy',
    }
  }
}
```

### 5.2 注册到工具系统

在 [tools.module.ts](file:///d:/AI/ai_chat/backend-ts/src/modules/tools/tools.module.ts) 中添加：

```typescript
import { BrowserToolProvider } from './providers/browser-tool.provider'

@Module({
  providers: [
    // ... 已有 providers
    BrowserToolProvider,  // 新增
  ],
  // ...
})
```

在 [tool-orchestrator.service.ts](file:///d:/AI/ai_chat/backend-ts/src/modules/tools/tool-orchestrator.service.ts) 的构造函数中注入：

```typescript
constructor(
  // ... 已有注入
  browserProvider: BrowserToolProvider,
) {
  // ... 已有注册
  this.addProvider(browserProvider);
}
```

---

## 6. 工具能力矩阵

| 工具名 | 核心 API | 超时 | 返回格式 |
|--------|---------|------|---------|
| `browser__navigate` | `webContents.loadURL()` | 30s | `{url, title}` JSON |
| `browser__execute_js` | `webContents.executeJavaScript()` | 30s | 原始返回值 / JSON 序列化 |
| `browser__screenshot` | `webContents.capturePage()` | 30s | base64 PNG (MCP image 类型) |
| `browser__get_page_content` | `executeJavaScript("outerHTML")` | 30s | HTML 字符串 (截断 50000 字符) |
| `browser__go_back` | `webContents.goBack()` | 30s | `{url}` JSON |
| `browser__go_forward` | `webContents.goForward()` | 30s | `{url}` JSON |
| `browser__reload` | `webContents.reload()` | 30s | `{url}` JSON |
| `browser__click` | `executeJavaScript(el.click())` | 10s | `{clicked, tagName}` JSON |
| `browser__fill_input` | `executeJavaScript(el.value = x)` | 10s | `{filled}` JSON |
| `browser__open_new_window` | `new BrowserWindow(...)` | 10s | `{window_id}` JSON |
| `browser__close_window` | `win.close() + clearStorageData()` | 10s | `{closed_window_id}` JSON |

---

## 7. 通信协议：stdio MCP

### 7.1 为什么选择 stdio

| 方案 | 优点 | 缺点 |
|------|------|------|
| **stdio MCP** | 零配置、原生管道、最低延迟、复用已有基础设施 | 需要父子进程关系 |
| HTTP | 独立部署、灵活 | 端口管理复杂、需认证 |
| Unix Socket | 高性能、本地 | Windows 需命名管道，跨平台成本高 |
| electron ipcMain | 原生 Electron 机制 | 后端是独立 Node 进程，无法使用 Electron IPC |

### 7.2 推荐的传输方案调整

考虑到当前 Electron 使用 `child_process.spawn` 启动后端，后端和 Electron 不是直接的父子进程关系（开发模式下更是独立的 `npx ts-node-dev` 进程），建议采用以下方案之一：

**方案 1**（推荐生产环境）：在 Electron 中启动一个独立的 stdio MCP server 子进程，后端通过 McpServer 数据库配置连接。

```
Electron Main Process
  └── spawn "electron-bridge-process.js" (ELECTRON_RUN_AS_NODE)
       └── stdin/stdout = MCP stdio transport

NestJS Backend
  └── McpServer DB 记录: { type: "stdio", command: "...", args: [...] }
  └── McpClientService → StdioClientTransport → 连接到 Bridge 进程
```

**方案 2**（开发期间）：使用一个本地 HTTP MCP server，Electron 启动一个简单的 HTTP 服务器，后端通过 `streamableHttp` 连接。

**最终建议**：采用方案 1，改动最小且与现有 McpServer 管理机制完全兼容。需要额外创建一个 `electron/mcp-bridge-entry.ts` 作为独立入口文件。

---

## 8. 无痕窗口方案

### 8.1 需求定义

"无痕"意味着：自动打开的浏览器窗口在**关闭后不留下任何可追溯信息**，包括但不限于：

- 浏览历史 (History)
- Cookies
- localStorage / sessionStorage / IndexedDB
- HTTP 缓存 (Cache)
- DNS 缓存
- 下载文件
- Service Worker 注册
- 认证信息 (HTTP Auth)

### 8.2 实现原理

Electron 提供了 `session.fromPartition()` API 创建独立的浏览器会话。关键参数：

```typescript
// 带 "persist:" 前缀 = 会话存活期间持久化到磁盘，但可通过 API 彻底删除
session.fromPartition('persist:incognito_xxx')

// 不带 "persist:" = 纯内存模式，进程退出自然销毁（最彻底但可能有兼容问题）
session.fromPartition('incognito_xxx')
```

### 8.3 清理流程

```
窗口关闭事件 (win.on('closed'))
  │
  ├── session.clearStorageData()   ← 清除 localStorage/IndexedDB/cookies 等
  ├── session.clearCache()         ← 清除 HTTP 缓存
  ├── session.clearAuthCache()     ← 清除 HTTP 认证缓存
  ├── session.clearHostResolverCache() ← 清除 DNS 缓存
  │
  └── browserWindows.delete(windowId) ← 从管理 Map 中移除引用
```

### 8.4 清理范围对照表

| 数据类型 | 清理 API | 是否覆盖 |
|---------|---------|---------|
| Cookies | `clearStorageData({storages: ['cookies']})` | ✅ |
| localStorage | `clearStorageData({storages: ['localstorage']})` | ✅ |
| IndexedDB | `clearStorageData({storages: ['indexdb']})` | ✅ |
| Session Storage | 窗口关闭自动清除 | ✅ |
| HTTP Cache | `clearCache()` | ✅ |
| Auth Cache | `clearAuthCache()` | ✅ |
| DNS Cache | `clearHostResolverCache()` | ✅ |
| Service Workers | `clearStorageData({storages: ['serviceworkers']})` | ✅ |
| 浏览历史 | 仅存在于 autowindow session，不影响主窗口 | ✅ |
| 下载文件 | `will-download` 事件中拦截 + 清理临时文件 | ⚠️ 需额外处理 |

### 8.5 下载文件清理（需额外实现）

```typescript
win.webContents.session.on('will-download', (event, item) => {
  const tempPath = item.getSavePath()
  item.on('done', (event, state) => {
    if (state === 'completed') {
      // 读取文件内容后立即删除
      try {
        const content = fs.readFileSync(tempPath)
        // 将内容转为 base64 返回给调用方
        fs.unlinkSync(tempPath)
      } catch (e) {
        log.warn('Failed to clean up download:', e)
      }
    }
  })
})
```

---

## 9. 实施清单

### 9.1 新增文件

| 文件 | 说明 |
|------|------|
| `electron/mcp-bridge.ts` | Electron MCP Bridge 核心逻辑 |
| `electron/mcp-bridge-entry.ts` | Bridge 独立进程入口（方案 1 需要） |
| `backend-ts/src/modules/tools/providers/browser-tool.provider.ts` | Backend 侧的 Browser Tool Provider |

### 9.2 修改文件

| 文件 | 修改内容 |
|------|---------|
| [electron/main.ts](file:///d:/AI/ai_chat/electron/main.ts) | 启动时 spawn Electron MCP Bridge 进程 |
| [backend-ts/src/modules/tools/tools.module.ts](file:///d:/AI/ai_chat/backend-ts/src/modules/tools/tools.module.ts) | 注册 `BrowserToolProvider` |
| [backend-ts/src/modules/tools/tool-orchestrator.service.ts](file:///d:/AI/ai_chat/backend-ts/src/modules/tools/tool-orchestrator.service.ts) | 注入并注册 `BrowserToolProvider` |

### 9.3 依赖

| 包 | 用途 | 状态 |
|----|------|------|
| `@modelcontextprotocol/sdk` | MCP 协议实现 | ✅ 已在 backend-ts 中使用 |
| Electron (内置 API) | `BrowserWindow`, `session`, `webContents` | ✅ 已安装 |

无新增外部依赖。

### 9.4 测试验证

1. **连接测试**：启动应用后，确认后端日志显示 "Connected to Electron MCP Bridge"
2. **导航测试**：通过 LLM 触发 `browser__navigate`，验证页面加载
3. **JS 执行测试**：触发 `browser__execute_js` 执行 `document.title`，验证返回页面标题
4. **截图测试**：触发 `browser__screenshot`，验证返回 base64 图片
5. **交互测试**：依次执行导航 → 填表 → 点击 → 获取内容
6. **无痕测试**：打开新窗口 → 导航 → 关闭 → 确认 no 残留数据

---

## 10. 附录：关键代码参考

### 10.1 现有 MCP 使用方式

参考 [mcp-client.service.ts](file:///d:/AI/ai_chat/backend-ts/src/common/mcp/mcp-client.service.ts) 中的 `StdioClientTransport` 创建逻辑。

### 10.2 现有 Tool Provider 范例

参考 [shell-tool.provider.ts](file:///d:/AI/ai_chat/backend-ts/src/modules/tools/providers/shell-tool.provider.ts) — 已实现的基于 `IToolProvider` 接口的工具提供者。

### 10.3 Skill Tool Bridge

参考 [skill-tool-bridge.service.ts](file:///d:/AI/ai_chat/backend-ts/src/modules/skills/integration/skill-tool-bridge.service.ts) — 跨模块的 Tool Provider 范例。

### 10.4 Electron 窗口管理

参考 [main.ts](file:///d:/AI/ai_chat/electron/main.ts) 第 420 行的 `createWindow()` 函数 — 现有 BrowserWindow 创建方式。

---

> **审阅者**：后端/Skills 团队、前端/Electron 团队
> **下一步**：评审通过后进入实施阶段
