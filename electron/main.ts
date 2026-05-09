import { app, BrowserWindow, ipcMain, Menu, shell, MenuItemConstructorOptions, dialog, clipboard } from 'electron'
import * as path from 'path'
import { fork, ChildProcess } from 'child_process'
import * as fs from 'fs'
import { autoUpdater } from 'electron-updater'
import * as net from 'net'
import log from 'electron-log'
import { startBrowserBridge } from './browser-bridge'
import { startBrowserBridgeTCP, stopBrowserBridgeTCP } from './browser-bridge-tcp'
import { BrowserTabManager } from './browser-tab-manager'

let backendProcess: ChildProcess | null = null
let mainWindow: BrowserWindow | null = null
let tabManager: BrowserTabManager | null = null  // 标签管理器
let isBackendStarting = false  // 防止重复启动
let backendPort: number | null = null  // 记录后端端口

// 配置 electron-log
log.transports.file.level = 'info'
log.transports.file.maxSize = 50 * 1024 * 1024 // 50MB
log.transports.file.format = '[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {text}'

// 将 console 输出重定向到日志文件（可选，生产环境建议启用）
// Object.assign(console, log.functions)

// 单实例锁：确保同一时间只有一个应用实例运行
const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
  // 如果获取锁失败，说明已有实例在运行，立即退出当前进程
  log.warn('检测到已有应用实例在运行，退出当前实例')
  app.quit()
} else {
  // 如果获取锁成功，监听第二个实例启动事件
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    // 当用户尝试启动第二个实例时，激活已存在的主窗口
    if (mainWindow) {
      // 如果窗口最小化，则还原窗口
      if (mainWindow.isMinimized()) {
        mainWindow.restore()
      }
      // 聚焦窗口（将窗口带到前台）
      mainWindow.focus()
    }
  })
}

// 判断是否为开发模式（根据是否打包，而不是 NODE_ENV）
const isDev = !app.isPackaged

// 配置更新源
autoUpdater.autoDownload = false
if (isDev) {
  autoUpdater.forceDevUpdateConfig = true
  // 在开发环境下，如果找不到 dev-app-update.yml，我们提供一个默认的占位配置以防止报错
  // 或者你可以选择在这里直接 return，不执行后续的 checkForUpdates
}

// 获取后端路径
function getBackendPath(): string {
  if (isDev) {
    // 编译后的文件在 electron/dist/，需要向上两级到达项目根目录
    return path.join(__dirname, '..', '..', 'backend-ts')
  } else {
    // 生产环境：从 resources/backend-ts 获取（extraResources）
    return path.join(process.resourcesPath, 'backend-ts')
  }
}

// 计算 Schema 版本的哈希值（基于 schema.prisma 内容）
function getSchemaVersion(backendPath: string): string {
  const crypto = require('crypto')
  const schemaPath = path.join(backendPath, 'prisma', 'schema.prisma')
  if (!fs.existsSync(schemaPath)) return 'unknown'

  const content = fs.readFileSync(schemaPath, 'utf-8')
  return crypto.createHash('md5').update(content).digest('hex').substring(0, 12)
}

// 初始化数据库文件
async function initializeDatabase(userDataPath: string, backendPath: string): Promise<void> {
  const dbPath = path.join(userDataPath, 'ai_chat.db')
  const vectorDbPath = path.join(userDataPath, 'vector_db.sqlite')
  const versionFilePath = path.join(userDataPath, 'db_version.json')
  const { execSync } = require('child_process')

  // 设置环境变量
  const env = {
    ...process.env,
    DATABASE_URL: `file:${dbPath}`,
    VECTOR_DB_PATH: vectorDbPath,
    NODE_ENV: process.env.NODE_ENV || 'production'
  }

  const currentSchemaVersion = getSchemaVersion(backendPath)
  let storedVersion: any = null
  try {
    if (fs.existsSync(versionFilePath)) {
      storedVersion = JSON.parse(fs.readFileSync(versionFilePath, 'utf-8'))
    }
  } catch (e) {
    console.warn('⚠️  读取版本标记文件失败，将重新同步')
  }

  // 智能跳过同步：如果版本一致且数据库存在，则跳过
  if (storedVersion && storedVersion.schemaVersion === currentSchemaVersion && fs.existsSync(dbPath) && fs.statSync(dbPath).size > 0) {
    console.log(`✅ 数据库版本已同步 (${currentSchemaVersion})，跳过初始化`)
    return
  }

  console.log('🔄 检测到数据库需要同步或初始化...')
  try {
    // 1. 首次运行：从模板拷贝数据库
    const isFirstRun = !fs.existsSync(dbPath) || fs.statSync(dbPath).size === 0
    if (isFirstRun) {
      let templatePath: string | null = null

      if (isDev) {
        // 开发环境：直接指向项目根目录下的 data 文件夹
        const devPath = path.join(__dirname, '..', '..', 'data', 'seed_template.db')
        if (fs.existsSync(devPath)) templatePath = devPath
      } else {
        // 生产环境：指向打包后的 resources 目录
        const prodPath = path.join(process.resourcesPath, 'data', 'seed_template.db')
        if (fs.existsSync(prodPath)) templatePath = prodPath
      }

      if (templatePath) {
        console.log(`📦 发现种子模板: ${templatePath}`)
        fs.copyFileSync(templatePath, dbPath)
        console.log('✅ 已从模板初始化数据库')
      } else {
        console.warn('⚠️  未找到种子模板，将执行动态同步')
      }
    }

    // 2. 备份逻辑优化：仅在非首次运行且结构变更时备份
    if (!isFirstRun) {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
      const backupPath = `${dbPath}.bak.${timestamp}`
      fs.copyFileSync(dbPath, backupPath)
      console.log(`📦 数据库结构变更，已备份至: ${backupPath}`)

      // 清理旧备份（保留最近 3 个）
      const backups = fs.readdirSync(path.dirname(dbPath))
        .filter(f => f.startsWith(path.basename(dbPath) + '.bak.'))
        .sort()
        .reverse()
      if (backups.length > 3) {
        for (let i = 3; i < backups.length; i++) {
          fs.unlinkSync(path.join(path.dirname(dbPath), backups[i]))
        }
      }
    }

    // 3. 使用 db push 同步结构（使用 Electron 内置的 Node.js 运行时）
    const prismaCli = path.join(backendPath, 'node_modules', 'prisma', 'build', 'index.js')
        
    // 使用 process.execPath（Electron 内置的 Node.js），不依赖系统的 node 命令
    const nodeExecutable = process.execPath
        
    // 设置 ELECTRON_RUN_AS_NODE，让 Electron 以纯 Node.js 模式运行
    const execEnv = { ...env, ELECTRON_RUN_AS_NODE: '1' }
        
    execSync(`"${nodeExecutable}" "${prismaCli}" db push --config=prisma.config.js --accept-data-loss`, {
      cwd: backendPath,
      env: execEnv,
      stdio: 'pipe',
      encoding: 'utf-8'
    })
    console.log('✅ 数据库表结构同步成功')

    // 4. 更新版本标记
    fs.writeFileSync(versionFilePath, JSON.stringify({
      schemaVersion: currentSchemaVersion,
      seedCompleted: true,
      updatedAt: new Date().toISOString()
    }, null, 2))
    console.log('💾 数据库版本标记已更新')

  } catch (error: any) {
    console.error('❌ 数据库同步失败:', error.message)
    handleDatabaseError(error, dbPath, userDataPath)
    throw error // 抛出错误以便主进程捕获并提示用户
  }
}

// 处理数据库错误并弹出模态框
async function handleDatabaseError(error: any, dbPath: string, userDataPath: string) {
  if (!mainWindow) return

  const options: Electron.MessageBoxOptions = {
    type: 'error',
    title: '数据库同步失败',
    message: '应用启动时无法同步数据库结构。',
    detail: `错误信息: ${error.message}\n\n您可以尝试点击“重试”或手动打开日志目录排查问题。`,
    buttons: ['重试', '打开日志目录', '退出'],
    defaultId: 0,
    cancelId: 2
  }

  try {
    const response = await dialog.showMessageBox(mainWindow, options)
    if (response.response === 0) {
      // 重试：重新调用初始化
      console.log('用户选择重试数据库同步...')
      await initializeDatabase(userDataPath, getBackendPath())
    } else if (response.response === 1) {
      shell.openPath(userDataPath)
      app.quit()
    } else {
      app.quit()
    }
  } catch (e) {
    console.error('显示错误对话框失败:', e)
    app.quit()
  }
}

// 启动 NestJS 后端服务
async function startBackend(): Promise<void> {
  // 防止重复启动
  if (isBackendStarting) {
    console.warn('⚠️  后端已在启动中，跳过重复调用')
    return Promise.resolve()
  }

  // 如果后端已经在运行，直接返回
  if (backendProcess && !backendProcess.killed) {
    console.warn('⚠️  后端已在运行，跳过启动')
    return Promise.resolve()
  }

  isBackendStarting = true

  return new Promise(async (resolve, reject) => {
    const backendPath = getBackendPath()

    if (isDev) {
      // 开发模式：固定端口，通过日志检测启动
      backendPort = 3000
      console.log('🔧 开发模式：使用固定端口 3000')
      // 开发模式：使用 spawn 启动 ts-node-dev
      const { spawn } = await import('child_process')
      const nodePath = process.platform === 'win32' ? 'npx.cmd' : 'npx'
      const scriptPath = 'ts-node-dev'
      const args = [
        '--respawn',
        '--transpile-only',
        path.join(backendPath, 'src', 'main.ts')
      ]

      console.log('🔧 开发模式：使用 ts-node-dev 启动后端（支持热重载）')

      const userDataPath = app.getPath('userData')
      await initializeDatabase(userDataPath, backendPath)

      const dbPath = path.join(userDataPath, 'ai_chat.db')
      const vectorDbPath = path.join(userDataPath, 'vector_db.sqlite')
      const staticDir = path.join(backendPath, 'static')
      const uploadDir = path.join(userDataPath, 'file_stores')
      const logsDir = path.join(userDataPath, 'logs') // 后端日志目录
      const skillsDir = path.join(userDataPath, 'skills') // 技能目录
      const workspaceDir = path.join(userDataPath, 'workspace') // 会话工作目录

      console.log('Database path:', dbPath)
      console.log('Vector database path:', vectorDbPath)
      console.log('Static directory:', staticDir)
      console.log('Upload directory:', uploadDir)
      console.log('Backend logs directory:', logsDir)
      console.log('Skills directory:', skillsDir)
      console.log('Workspace directory:', workspaceDir)

      const spawnOptions: any = {
        cwd: backendPath,
        env: {
          ...process.env,
          NODE_ENV: 'development',
          PORT: '3000',
          DATABASE_URL: `file:${dbPath}`,
          VECTOR_DB_PATH: vectorDbPath,
          STATIC_DIR: staticDir,
          UPLOAD_ROOT_DIR: uploadDir,
          UPLOAD_URL_PREFIX: '/uploads',
          SETTINGS_DIR: userDataPath, // 传递设置目录
          LOGS_DIR: logsDir, // 传递后端日志目录到用户数据区
          SKILLS_DIR: skillsDir, // 传递技能目录到用户数据区
          WORKSPACE_BASE_DIR: workspaceDir, // 传递会话工作目录基础路径
          ELECTRON_APP: 'true', // 标识这是 Electron 环境
          BROWSER_BRIDGE_MODE: 'tcp', // 开发模式使用 TCP
          BROWSER_BRIDGE_PORT: process.env.BROWSER_BRIDGE_PORT || '3001', // 传递端口号
        },
        stdio: ['pipe', 'pipe', 'pipe'], // 开发模式不需要 IPC
        shell: true
      }

      backendProcess = spawn(nodePath, [scriptPath, ...args], spawnOptions)
    } else {
      // 生产模式：使用 0 让系统自动分配端口，通过 IPC 获取
      backendPort = 0
      const { spawn } = await import('child_process')
      const nodePath = process.execPath
      const scriptPath = path.join(backendPath, 'dist', 'main.js')

      // 检查文件是否存在
      if (!fs.existsSync(scriptPath)) {
        console.error('后端文件不存在:', scriptPath)
        reject(new Error('Backend files not found'))
        return
      }

      console.log('📦 生产模式：从 unpacked 目录启动后端')
      console.log('后端路径:', backendPath)

      // 初始化数据库
      const userDataPath = app.getPath('userData')
      await initializeDatabase(userDataPath, backendPath)

      const dbPath = path.join(userDataPath, 'ai_chat.db')
      const vectorDbPath = path.join(userDataPath, 'vector_db.sqlite')
      const staticDir = path.join(backendPath, 'static')
      const uploadDir = path.join(userDataPath, 'file_stores')
      const logsDir = path.join(userDataPath, 'logs') // 后端日志目录
      const skillsDir = path.join(userDataPath, 'skills') // 技能目录
      const workspaceDir = path.join(userDataPath, 'workspace') // 会话工作目录

      console.log('Database path:', dbPath)
      console.log('Vector database path:', vectorDbPath)
      console.log('Static directory:', staticDir)
      console.log('Upload directory:', uploadDir)
      console.log('Backend logs directory:', logsDir)
      console.log('Skills directory:', skillsDir)
      console.log('Workspace directory:', workspaceDir)

      // 使用 spawn 启动后端
      const spawnOptions: any = {
        cwd: backendPath,
        env: {
          ...process.env,
          NODE_ENV: 'production',
          ELECTRON_RUN_AS_NODE: '1',  // 关键：以纯 Node 模式运行
          NODE_NO_WARNINGS: '1',  // 抑制 Node.js 警告（如 punycode 弃用警告）
          PORT: backendPort.toString(),
          BASE_URL: '__auto__',  // Electron 生产环境使用自动模式，动态设置 BASE_URL
          DATABASE_URL: `file:${dbPath}`,
          VECTOR_DB_PATH: vectorDbPath,
          STATIC_DIR: staticDir,
          UPLOAD_ROOT_DIR: uploadDir,
          UPLOAD_URL_PREFIX: '/uploads',
          SETTINGS_DIR: userDataPath, // 传递设置目录
          LOGS_DIR: logsDir, // 传递后端日志目录到用户数据区
          SKILLS_DIR: skillsDir, // 传递技能目录到用户数据区
          WORKSPACE_BASE_DIR: workspaceDir, // 传递会话工作目录基础路径
        },
        stdio: ['pipe', 'pipe', 'pipe', 'ipc'] // 增加 'ipc' 以支持 process.send
      }

      backendProcess = spawn(nodePath, [scriptPath], spawnOptions)
    }

    if (!backendProcess) {
      reject(new Error('Failed to create backend process'))
      return
    }

    let isResolved = false
    // 监听来自后端的 IPC 消息（仅生产环境有效）
    backendProcess.on('message', (message: any) => {
      if (message && message.type === 'PORT_READY' && !isResolved) {
        backendPort = message.port
        console.log(`📨 通过 IPC 接收到后端端口: ${backendPort}`)
        isBackendStarting = false
        isResolved = true
        resolve()
      }
    })

    // 处理 stdout
    backendProcess.stdout?.on('data', (data) => {
      const message = data.toString().trim()
      if (message) {
        console.log(`[Backend] ${message}`)
      }

      // 开发模式：通过日志检测启动成功
      if (isDev && message.includes('Application is running on') && !isResolved) {
        isBackendStarting = false
        isResolved = true
        console.log(`✅ 后端启动成功，端口: ${backendPort}`)
        resolve()
      }
    })

    // 处理 stderr
    backendProcess.stderr?.on('data', (data) => {
      const errorMessage = data.toString().trim()
      if (errorMessage) {
        console.error(`[Backend Error] ${errorMessage}`)
      }
    })

    // 处理错误
    backendProcess.on('error', (error) => {
      log.error('后端进程启动失败:', error)
      isBackendStarting = false  // 重置标志
      reject(error)
    })

    // 处理退出
    backendProcess.on('exit', (code) => {
      log.info(`后端进程退出，退出码: ${code}`)
      isBackendStarting = false  // 重置标志
      if (code !== 0 && code !== null) {
        log.error(`后端进程异常退出，退出码: ${code}`)
      }
    })

    // 设置超时
    setTimeout(() => {
      reject(new Error('Backend startup timeout'))
    }, 30000)
  })
}

// 创建窗口
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    frame: false, // 无边框窗口，去掉默认标题栏
    transparent: false, // 不透明背景
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    },
    show: false,
    backgroundColor: '#ffffff',
    titleBarStyle: 'hidden' // 隐藏标题栏但保留系统按钮（macOS）
  })

  // 设置应用菜单
  // setupApplicationMenu()

  if (isDev) {
    // 开发环境：根据 USE_STATIC_FRONTEND 决定加载方式
    if (process.env.USE_STATIC_FRONTEND === 'true') {
      // 使用编译后的静态前端文件
      const frontendPath = path.join(__dirname, '..', '..', 'frontend', 'dist', 'index.html')
      console.log('🚀 ~ file: main.ts ~ line 438 ~ frontendPath', frontendPath)
      mainWindow.loadFile(frontendPath)
    } else {
      // 使用 Vite 开发服务器（热重载）
      mainWindow.loadURL('http://localhost:5173')
    }

    // 延迟打开开发者工具，避免影响窗口显示
    setTimeout(() => {
      mainWindow?.webContents.openDevTools({ mode: 'detach' })
    }, 1000)
  } else {
    // 生产环境加载打包后的前端文件
    // __dirname 指向 app.asar/electron/dist，需要向上两级到达 app.asar，然后进入 frontend/dist
    const frontendPath = path.join(__dirname, '..', '..', 'frontend', 'dist', 'index.html')

    mainWindow.loadFile(frontendPath)

    // 如果启用了调试模式，自动打开开发者工具
    if (process.env.DEBUG_MODE === 'true') {
      setTimeout(() => {
        mainWindow?.webContents.openDevTools({ mode: 'detach' })
      }, 1000)
    }
  }

  // 窗口准备好后显示
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.on('closed', () => {
    // 清理标签管理器
    tabManager?.closeAllTabs()
    tabManager = null
    mainWindow = null
  })

  // ✅ 初始化标签管理器（默认最多5个标签）
  tabManager = new BrowserTabManager(mainWindow, 6)

  // 监听窗口大小变化
  mainWindow.on('resize', () => {
    tabManager?.handleResize()
  })

  // 初始化主应用标签
  tabManager.initializeMainApp().then(() => {
    log.info('✅ Main app tab initialized successfully')
  }).catch(err => {
    log.error('❌ Failed to initialize main app tab:', err)
  })
}

// IPC 通信处理
function setupIpcHandlers() {
  ipcMain.handle('get-app-info', () => {
    return {
      platform: process.platform,
      version: app.getVersion(),
      userDataPath: app.getPath('userData'),
      backendPort: backendPort
    }
  })

  ipcMain.handle('show-notification', (_, { title, body }) => {
    // 可以在这里实现系统通知
    console.log('Notification:', title, body)
  })

  // 窗口控制
  ipcMain.on('window-minimize', () => {
    mainWindow?.minimize()
  })

  ipcMain.on('window-maximize', () => {
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize()
    } else {
      mainWindow?.maximize()
    }
  })

  ipcMain.on('window-close', () => {
    mainWindow?.close()
  })

  // 获取窗口最大化状态
  ipcMain.handle('is-window-maximized', () => {
    return mainWindow?.isMaximized() || false
  })

  // 打开/关闭开发者工具
  ipcMain.on('toggle-devtools', () => {
    if (mainWindow) {
      if (mainWindow.webContents.isDevToolsOpened()) {
        mainWindow.webContents.closeDevTools()
      } else {
        mainWindow.webContents.openDevTools({ mode: 'detach' })
      }
    }
  })

  // 自动更新相关 IPC
  ipcMain.handle('check-for-updates', async () => {
    if (isDev) {
      console.warn('⚠️  开发环境下请确保根目录存在 dev-app-update.yml 文件')
      // 开发环境下如果没有配置文件，直接返回不可用，避免抛出 ENOENT 错误
      try {
        await autoUpdater.checkForUpdates()
        return { success: true }
      } catch (error: any) {
        if (error.code === 'ENOENT') {
          return { success: false, error: '开发环境未配置 dev-app-update.yml' }
        }
        return { success: false, error: error.message }
      }
    }

    try {
      await autoUpdater.checkForUpdates()
      return { success: true }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('start-download-update', () => {
    autoUpdater.downloadUpdate()
  })

  ipcMain.on('install-and-restart', () => {
    autoUpdater.quitAndInstall(false, true)
  })

  // 显示动态上下文菜单
  ipcMain.handle('show-context-menu', async (event, items: any[]) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return

    // 将前端传递的菜单项转换为 Electron MenuItem
    const menuItems: MenuItemConstructorOptions[] = items.map(item => {
      if (item.type === 'separator') {
        return { type: 'separator' as const }
      }

      return {
        label: item.label,
        type: (item.type || 'normal') as any,
        enabled: item.enabled !== false,
        visible: item.visible !== false,
        click: () => {
          // 通过 webContents 发送点击事件到渲染进程
          win.webContents.send('context-menu-clicked', item.label)
        }
      }
    })

    const menu = Menu.buildFromTemplate(menuItems)
    menu.popup({ window: win })
  })

  // 打开用户数据目录
  ipcMain.on('open-user-data-folder', () => {
    const userDataPath = app.getPath('userData')
    shell.openPath(userDataPath).then(error => {
      if (error) {
        console.error('Failed to open user data folder:', error)
      }
    })
  })

  // 打开安装目录
  ipcMain.on('open-install-folder', () => {
    let installPath: string
    if (isDev) {
      // 开发环境：打开项目根目录
      installPath = path.join(__dirname, '..', '..')
    } else {
      // 生产环境：打开应用安装目录
      installPath = path.dirname(app.getPath('exe'))
    }
    shell.openPath(installPath).then(error => {
      if (error) {
        console.error('Failed to open install folder:', error)
      }
    })
  })

  // 剪贴板操作（通过 IPC）
  ipcMain.handle('clipboard-write-text', (_, text: string) => {
    try {
      clipboard.writeText(text)
      return { success: true }
    } catch (error) {
      console.error('[Main] 剪贴板写入失败:', error)
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle('clipboard-read-text', () => {
    try {
      const text = clipboard.readText()
      return { success: true, text }
    } catch (error) {
      console.error('[Main] 剪贴板读取失败:', error)
      return { success: false, error: (error as Error).message }
    }
  })

  // 打开外部链接
  ipcMain.handle('open-external', async (_, url: string) => {
    try {
      await shell.openExternal(url)
      return { success: true }
    } catch (error) {
      log.error('打开外部链接失败:', error)
      return { success: false, error: String(error) }
    }
  })

  // ✅ 标签管理相关 IPC

  // 创建标签
  ipcMain.handle('browser:create-tab', async (_, { url }) => {
    try {
      const tab = await tabManager!.createTab(url)
      return { success: true, tab }
    } catch (error: any) {
      log.error('创建标签失败:', error.message)
      return { success: false, error: error.message }
    }
  })

  // 激活标签
  ipcMain.handle('browser:activate-tab', async (_, { tabId }) => {
    const success = tabManager!.activateTab(tabId)
    return { success }
  })

  // 关闭标签
  ipcMain.handle('browser:close-tab', async (_, { tabId }) => {
    const success = await tabManager!.closeTab(tabId)
    return { success }
  })

  // 获取标签列表
  ipcMain.handle('browser:get-tabs', () => {
    const tabs = tabManager!.getTabList()
    return { success: true, tabs }
  })
}

// 配置更新器事件监听
function setupAutoUpdater() {
  autoUpdater.on('checking-for-update', () => {
    mainWindow?.webContents.send('update-status', { status: 'checking' })
  })

  autoUpdater.on('update-available', (info) => {
    mainWindow?.webContents.send('update-status', { status: 'available', info })
  })

  autoUpdater.on('update-not-available', () => {
    mainWindow?.webContents.send('update-status', { status: 'not-available' })
  })

  autoUpdater.on('download-progress', (progressObj) => {
    mainWindow?.webContents.send('update-status', {
      status: 'downloading',
      progress: progressObj.percent
    })
  })

  autoUpdater.on('update-downloaded', () => {
    mainWindow?.webContents.send('update-status', { status: 'downloaded' })
  })

  autoUpdater.on('error', (err) => {
    mainWindow?.webContents.send('update-status', { status: 'error', error: err.message })
  })
}

// 应用就绪
app.whenReady().then(async () => {
  try {
    log.info('Application starting...')
    setupIpcHandlers()
    setupAutoUpdater()

    // 启动 Browser Bridge（根据模式选择）
    const bridgeMode = process.env.BROWSER_BRIDGE_MODE || (isDev ? 'tcp' : 'ipc')
    
    if (bridgeMode === 'tcp') {
      // TCP 模式（开发环境）
      const port = parseInt(process.env.BROWSER_BRIDGE_PORT || '3001')
      log.info(`Starting Browser Bridge in TCP mode on port ${port}...`)
      await startBrowserBridgeTCP(port, tabManager!)
      process.env.BROWSER_BRIDGE_PORT = String(port)
      log.info('Browser Bridge TCP started successfully')
    } else {
      // IPC 模式（生产环境）
      log.info('Starting Browser Bridge in IPC mode...')
      startBrowserBridge(tabManager!)
      log.info('Browser Bridge IPC started successfully')
    }

    // 启动后端服务
    log.info('Starting backend service...')
    await startBackend()
    log.info('Backend service started successfully')

    // 创建窗口（tabManager 在这里面创建）
    createWindow()
    
    // 窗口创建后，重新初始化 Browser Bridge（因为 tabManager 现在可用了）
    if (bridgeMode === 'tcp') {
      // 停止旧的 TCP server（如果有的话）
      await stopBrowserBridgeTCP()
      const port = parseInt(process.env.BROWSER_BRIDGE_PORT || '3001')
      await startBrowserBridgeTCP(port, tabManager!)
    } else {
      // IPC 模式重新初始化
      startBrowserBridge(tabManager!)
    }
    log.info('Browser Bridge re-initialized with TabManager')
    
    log.info('Application initialized')
  } catch (error: any) {
    log.error('Application initialization failed:', error)
    app.quit()
  }
})

// 所有窗口关闭时
app.on('window-all-closed', () => {
  // 停止后端服务
  if (backendProcess) {
    console.log('Stopping backend service...')

    // 根据平台选择适当的终止方式
    if (process.platform === 'win32') {
      // Windows: 使用 taskkill 命令终止进程树
      const { exec } = require('child_process')
      exec(`taskkill /pid ${backendProcess.pid} /T /F`, (error: any, stdout: string, stderr: string) => {
        if (error) {
          console.error('Failed to kill backend process:', error.message)
        } else {
          console.log('Backend process terminated successfully')
        }
      })
    } else {
      // Unix-like systems: 发送 SIGTERM 信号
      backendProcess.kill('SIGTERM')

      // 设置超时强制关闭
      setTimeout(() => {
        if (!backendProcess?.killed) {
          console.log('Force killing backend process...')
          backendProcess?.kill('SIGKILL')
        }
      }, 3000)
    }

    backendProcess = null
  }

  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// macOS 激活应用
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

// 应用退出前清理
app.on('before-quit', async () => {
  // 停止 Browser Bridge TCP Server
  if (process.env.BROWSER_BRIDGE_MODE === 'tcp') {
    await stopBrowserBridgeTCP()
  }
  
  if (backendProcess) {
    // 根据平台选择适当的终止方式
    if (process.platform === 'win32') {
      // Windows: 使用 taskkill 命令终止进程树
      const { execSync } = require('child_process')
      try {
        execSync(`taskkill /pid ${backendProcess.pid} /T /F`, { stdio: 'ignore' })
      } catch (error) {
        console.error('Failed to kill backend process:', error)
      }
    } else {
      // Unix-like systems: 发送 SIGTERM 信号
      backendProcess.kill('SIGTERM')
    }
  }
})
