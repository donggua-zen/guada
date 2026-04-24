import { app, BrowserWindow, ipcMain, Menu, shell } from 'electron'
import * as path from 'path'
import { fork, ChildProcess } from 'child_process'
import * as fs from 'fs'
import { autoUpdater } from 'electron-updater'

let backendProcess: ChildProcess | null = null
let mainWindow: BrowserWindow | null = null
let isBackendStarting = false  // 防止重复启动

// 单实例锁：确保同一时间只有一个应用实例运行
const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
  // 如果获取锁失败，说明已有实例在运行，立即退出当前进程
  console.log('⚠️  检测到已有应用实例在运行，退出当前实例')
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

// 初始化数据库文件
async function initializeDatabase(userDataPath: string, backendPath: string): Promise<void> {
  const dbPath = path.join(userDataPath, 'ai_chat.db')
  const vectorDbPath = path.join(userDataPath, 'vector_db.sqlite')
  const { execSync } = require('child_process')

  // 设置环境变量
  const env = {
    ...process.env,
    DATABASE_URL: `file:${dbPath}`,
    VECTOR_DB_PATH: vectorDbPath
  }

  // 判断是否为首次运行（数据库文件不存在或大小为0）
  const isFirstRun = !fs.existsSync(dbPath) || fs.statSync(dbPath).size === 0

  if (isFirstRun) {
    console.log('🔄 检测到首次运行，正在初始化数据库...')
    try {
      // 1. 使用 db push 直接根据 schema 创建表结构（适合无迁移历史的初始化）
      execSync('npx prisma db push', {
        cwd: backendPath,
        env,
        stdio: 'pipe'
      })
      console.log('✅ 数据库表结构创建成功')

      // 2. 执行种子数据
      console.log('🌱 正在初始化种子数据...')
      execSync('npm run db:seed:force', {
        cwd: backendPath,
        env,
        stdio: 'pipe'
      })
      console.log('✅ 种子数据初始化完成')
    } catch (error: any) {
      console.error('❌ 数据库初始化失败:', error.message)
      if (error.stderr) console.error('错误详情:', error.stderr.toString())
    }
  } else {
    // 非首次运行，尝试执行迁移以更新结构
    console.log('💾 检测到已有数据库，检查结构更新...')
    try {
      // 备份旧数据库以防万一
      const backupPath = `${dbPath}.bak`
      fs.copyFileSync(dbPath, backupPath)
      
      execSync('npx prisma migrate deploy', {
        cwd: backendPath,
        env,
        stdio: 'pipe'
      })
      console.log('✅ 数据库迁移检查完成')
    } catch (migrateError: any) {
      const errorMsg = migrateError.stderr?.toString() || ''
      if (errorMsg.includes('P3005')) {
        console.warn('⚠️  数据库未基线化，尝试同步结构...')
        try {
          execSync('npx prisma db push', {
            cwd: backendPath,
            env,
            stdio: 'pipe'
          })
          console.log('✅ 数据库结构已同步 (db push)')
        } catch (pushError: any) {
          console.error('❌ 结构同步失败:', pushError.message)
        }
      } else {
        console.error('❌ 数据库迁移失败:', migrateError.message)
        // 迁移失败时尝试恢复备份
        const backupPath = `${dbPath}.bak`
        if (fs.existsSync(backupPath)) {
          fs.copyFileSync(backupPath, dbPath)
          console.warn('⚠️  已尝试从备份恢复数据库')
        }
      }
    }
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
      
      const spawnOptions: any = {
        cwd: backendPath,
        env: {
          ...process.env,
          NODE_ENV: 'development',
          DATABASE_URL: `file:${dbPath}`,
          VECTOR_DB_PATH: vectorDbPath,
          STATIC_DIR: staticDir,
        },
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: true
      }
      
      backendProcess = spawn(nodePath, [scriptPath, ...args], spawnOptions)
    } else {
      // 生产模式：使用 spawn 从 unpacked 目录启动
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
      
      console.log('数据库路径:', dbPath)
      console.log('向量数据库路径:', vectorDbPath)
      console.log('静态文件路径:', staticDir)
      
      // 使用 spawn 启动后端
      const spawnOptions: any = {
        cwd: backendPath,
        env: {
          ...process.env,
          NODE_ENV: 'production',
          ELECTRON_RUN_AS_NODE: '1',  // 关键：以纯 Node 模式运行
          NODE_NO_WARNINGS: '1',  // 抑制 Node.js 警告（如 punycode 弃用警告）
          DATABASE_URL: `file:${dbPath}`,
          VECTOR_DB_PATH: vectorDbPath,
          STATIC_DIR: staticDir,
          UPLOAD_BASE_DIR: staticDir
        },
        stdio: ['pipe', 'pipe', 'pipe']
      }
      
      backendProcess = spawn(nodePath, [scriptPath], spawnOptions)
    }
    
    if (!backendProcess) {
      reject(new Error('Failed to create backend process'))
      return
    }
    
    // 处理 stdout
    backendProcess.stdout?.on('data', (data) => {
      const message = data.toString().trim()
      if (message) {
        console.log(`[Backend] ${message}`)
      }
      
      // 检测后端是否启动成功
      if (message.includes('Application is running on')) {
        isBackendStarting = false  // 重置标志
        console.log('✅ 后端启动成功')
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
      console.error('Failed to start backend:', error)
      isBackendStarting = false  // 重置标志
      reject(error)
    })
    
    // 处理退出
    backendProcess.on('exit', (code) => {
      console.log(`Backend exited with code ${code}`)
      isBackendStarting = false  // 重置标志
      if (code !== 0 && code !== null) {
        console.error(`Backend crashed with code ${code}`)
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
    mainWindow = null
  })
}

// 设置应用菜单
function setupApplicationMenu() {
  if (isDev) {
    // 开发环境：提供开发者工具快捷访问
    const template: Electron.MenuItemConstructorOptions[] = [
      {
        label: '视图',
        submenu: [
          { role: 'reload', label: '重新加载' },
          { role: 'forceReload', label: '强制重新加载' },
          { role: 'toggleDevTools', label: '切换开发者工具' },
          { type: 'separator' },
          { role: 'resetZoom', label: '实际大小' },
          { role: 'zoomIn', label: '放大' },
          { role: 'zoomOut', label: '缩小' },
          { type: 'separator' },
          { role: 'togglefullscreen', label: '全屏' }
        ]
      },
      {
        label: '窗口',
        submenu: [
          { role: 'minimize', label: '最小化' },
          { role: 'close', label: '关闭' }
        ]
      }
    ]
    
    const menu = Menu.buildFromTemplate(template)
    Menu.setApplicationMenu(menu)
  } else {
    // 生产环境：隐藏菜单栏
    Menu.setApplicationMenu(null)
  }
}

// IPC 通信处理
function setupIpcHandlers() {
  ipcMain.handle('get-app-info', () => {
    return {
      platform: process.platform,
      version: app.getVersion(),
      userDataPath: app.getPath('userData')
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
    setupIpcHandlers()
    setupAutoUpdater()
    
    // 启动后端服务
    console.log('Starting backend service...')
    await startBackend()
    console.log('Backend service started successfully')
    
    // 创建窗口
    createWindow()
  } catch (error) {
    console.error('Failed to initialize app:', error)
    app.quit()
  }
})

// 所有窗口关闭时
app.on('window-all-closed', () => {
  // 停止后端服务
  if (backendProcess) {
    console.log('Stopping backend service...')
    backendProcess.kill()
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
app.on('before-quit', () => {
  if (backendProcess) {
    backendProcess.kill()
  }
})
