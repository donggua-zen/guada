import { app, BrowserWindow, ipcMain, Menu } from 'electron'
import * as path from 'path'
import { spawn, ChildProcess } from 'child_process'
import * as fs from 'fs'

let backendProcess: ChildProcess | null = null
let mainWindow: BrowserWindow | null = null

const isDev = process.env.NODE_ENV === 'development'

// 获取后端路径
function getBackendPath(): string {
  if (isDev) {
    // 编译后的文件在 electron/dist/，需要向上两级到达项目根目录
    return path.join(__dirname, '..', '..', 'backend-ts')
  } else {
    // 生产环境：从 resources 目录获取
    return path.join(process.resourcesPath, 'backend-ts')
  }
}

// 初始化数据库文件
async function initializeDatabase(userDataPath: string, backendPath: string): Promise<void> {
  const dbPath = path.join(userDataPath, 'ai_chat.db')
  const vectorDbPath = path.join(userDataPath, 'vector_db.sqlite')
  const isFirstRun = !fs.existsSync(dbPath)
  
  // 首次运行时执行数据库迁移和种子数据
  if (isFirstRun) {
    console.log('🔄 首次运行，执行数据库初始化...')
    try {
      // 使用 Prisma CLI 执行迁移
      // Prisma 会自动创建 SQLite 数据库文件，无需预先创建
      const { execSync } = require('child_process')
      
      // 设置环境变量
      const env = {
        ...process.env,
        DATABASE_URL: `file:${dbPath}`,
        VECTOR_DB_PATH: vectorDbPath
      }
      
      // 执行迁移（Prisma 会自动创建数据库文件和表结构）
      execSync('npx prisma migrate deploy', {
        cwd: backendPath,
        env,
        stdio: 'pipe' // 使用 pipe 而不是 inherit，避免弹出命令框
      })
      
      console.log('✅ 数据库迁移完成')
      
      // 执行种子数据（使用强制模式，无需确认）
      console.log('🌱 初始化种子数据...')
      execSync('npm run db:seed:force', {
        cwd: backendPath,
        env,
        stdio: 'pipe' // 使用 pipe 而不是 inherit，避免弹出命令框
      })
      
      console.log('✅ 种子数据初始化完成')
    } catch (error: any) {
      console.error('❌ 数据库初始化失败:', error.message)
      // 如果有错误输出，也打印出来
      if (error.stdout) {
        console.log('标准输出:', error.stdout.toString())
      }
      if (error.stderr) {
        console.error('错误输出:', error.stderr.toString())
      }
      console.warn('⚠️  应用将继续启动，但可能需要手动初始化数据库')
    }
  } else {
    console.log('💾 检测到已有数据库，跳过初始化')
  }
}

// 启动 NestJS 后端服务
async function startBackend(): Promise<void> {
  return new Promise(async (resolve, reject) => {
    const backendPath = getBackendPath()
    
    // 开发模式使用 ts-node-dev 启动，支持热重载
    // 生产模式使用编译后的 dist/main.js
    let nodePath: string
    let scriptPath: string
    let args: string[]
    
    if (isDev) {
      // 开发模式：使用 npx 运行 ts-node-dev
      nodePath = process.platform === 'win32' ? 'npx.cmd' : 'npx'
      scriptPath = 'ts-node-dev'
      args = [
        '--respawn',
        '--transpile-only',
        path.join(backendPath, 'src', 'main.ts')
      ]
      console.log('🔧 开发模式：使用 ts-node-dev 启动后端（支持热重载）')
    } else {
      // 生产模式：使用编译后的 JavaScript 文件
      nodePath = process.execPath
      scriptPath = path.join(backendPath, 'dist', 'main.js')
      args = []
      
      // 检查文件是否存在
      if (!fs.existsSync(scriptPath)) {
        console.error('后端文件不存在:', scriptPath)
        reject(new Error('Backend files not found'))
        return
      }
      console.log('📦 生产模式：使用编译后的后端文件')
    }

    // 设置数据库路径为 Electron 用户数据目录
    const userDataPath = app.getPath('userData')
    
    // 初始化数据库文件（如果不存在）
    await initializeDatabase(userDataPath, backendPath)
    
    const dbPath = path.join(userDataPath, 'ai_chat.db')
    const vectorDbPath = path.join(userDataPath, 'vector_db.sqlite')
    const staticDir = path.join(backendPath, 'static')
    
    console.log('数据库路径:', dbPath)
    console.log('向量数据库路径:', vectorDbPath)
    console.log('静态文件路径:', staticDir)
    console.log('后端端口: 3000 (固定)')
    
    // 启动后端进程
    const spawnOptions: any = {
      cwd: backendPath,
      env: {
        ...process.env,
        NODE_ENV: isDev ? 'development' : 'production',
        DATABASE_URL: `file:${dbPath}`,
        VECTOR_DB_PATH: vectorDbPath,
        STATIC_DIR: staticDir,
        UPLOAD_BASE_DIR: staticDir
      },
      stdio: ['pipe', 'pipe', 'pipe']
    }
    
    // Windows 下使用 shell 模式以支持 .cmd 文件
    if (process.platform === 'win32' && isDev) {
      spawnOptions.shell = true
    }
    
    backendProcess = spawn(nodePath, [scriptPath, ...args], spawnOptions)
    
    backendProcess.stdout?.on('data', (data) => {
      const message = data.toString()
      console.log(`Backend: ${message}`)
      
      // 检测后端是否启动成功
      if (message.includes('Application is running on')) {
        resolve()
      }
    })
    
    backendProcess.stderr?.on('data', (data) => {
      console.error(`Backend Error: ${data}`)
    })
    
    backendProcess.on('error', (error) => {
      console.error('Failed to start backend:', error)
      reject(error)
    })
    
    backendProcess.on('exit', (code) => {
      console.log(`Backend exited with code ${code}`)
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
  setupApplicationMenu()
  
  if (isDev) {
    // 开发环境加载 Vite 开发服务器
    mainWindow.loadURL('http://localhost:5173')
    // 延迟打开开发者工具，避免影响窗口显示
    setTimeout(() => {
      mainWindow?.webContents.openDevTools({ mode: 'detach' })
    }, 1000)
  } else {
    // 生产环境加载打包后的前端文件
    mainWindow.loadFile(path.join(__dirname, '..', 'frontend', 'dist', 'index.html'))
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
}

// 应用就绪
app.whenReady().then(async () => {
  try {
    setupIpcHandlers()
    
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
