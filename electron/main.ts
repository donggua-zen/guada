import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  shell,
  Tray,
  MenuItemConstructorOptions,
  dialog,
  clipboard,
  screen,
} from "electron";
import * as path from "path";
import * as os from "os";
import { ChildProcess, exec } from "child_process";
import * as fs from "fs";
// import { autoUpdater } from "electron-updater";
import log from "electron-log";
import { BrowserWebviewManager } from "./browser-tab-manager";
import {
  BridgeServer,
  generatePipePath,
  generateBridgeToken,
} from "./bridge-server";
import { BrowserAutomationService } from "./browser-automation-service";
let backendProcess: ChildProcess | null = null;
let mainWindow: BrowserWindow | null = null;
let windowManager: BrowserWebviewManager | null = null; // 窗口管理器
let isBackendStarting = false; // 防止重复启动
let isBackendStopping = false; // 标记后端正在被主动停止（非异常退出）
let backendPort: number | null = null; // 记录后端端口
let browserBridgeInitialized = false; // Browser Bridge 是否已初始化
let bridgeServer: BridgeServer | null = null;
let automationService: BrowserAutomationService | null = null;
let tray: Tray | null = null; // 系统托盘图标
let floatWindow: BrowserWindow | null = null; // 托盘悬浮小窗
/** 当前聚合的托盘统计信息 */
let trayStats = { running: 0, unread: 0 };
/** 悬浮窗设置（默认隐藏，用户在设置页开启后生效） */
let traySettings = { enabled: false, opacity: 95 };
let isBackendReady = false; // 后端真正就绪标志（仅 startBackend resolve 后为 true）

// 检查更新函数（定义在全局作用域，供 IPC 和自动检查共用）
async function doCheckForUpdates() {
  try {
    const currentVersion = app.getVersion();
    const platform =
      process.platform === "win32"
        ? "win"
        : process.platform === "darwin"
          ? "mac"
          : "linux";
    const apiUrl = `https://ai.dingd.cn/api/check_update?version=${currentVersion}&platform=${platform}`;

    const response = await fetch(apiUrl);
    if (!response.ok) {
      throw new Error(`API 请求失败: ${response.status}`);
    }

    const data: any = await response.json();

    if (data.hasUpdate) {
      mainWindow?.webContents.send("update-status", {
        status: "available",
        info: data,
      });
    } else {
      mainWindow?.webContents.send("update-status", {
        status: "not-available",
      });
    }

    return { success: true, data };
  } catch (error: any) {
    mainWindow?.webContents.send("update-status", {
      status: "error",
      error: error.message,
    });
    return { success: false, error: error.message };
  }
}

// 扩展 App 类型以支持退出标记
interface AppExtended extends Electron.App {
  isQuiting?: boolean;
}

// 配置 electron-log
log.transports.file.level = "info";
log.transports.file.maxSize = 50 * 1024 * 1024; // 50MB
log.transports.file.format = "[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {text}";

// 将 console 输出重定向到日志文件（可选，生产环境建议启用）
// Object.assign(console, log.functions)

// 单实例锁：确保同一时间只有一个应用实例运行
const gotTheLock = app.requestSingleInstanceLock();
// ── 进程级异常保护 ──
process.on("uncaughtException", (error) => {
  log.error("[Process] Uncaught exception:", error);
  log.error("[Process] Stack:", error.stack);
  // 不退出，让应用继续运行
});

process.on("unhandledRejection", (reason) => {
  const msg = reason instanceof Error ? reason.message : String(reason);
  const stack = reason instanceof Error ? reason.stack : "";
  log.error(`[Process] Unhandled rejection: ${msg}`);
  if (stack) log.error("[Process] Stack:", stack);
  // 不退出，让应用继续运行
});

if (!gotTheLock) {
  // 如果获取锁失败，说明已有实例在运行，立即退出当前实例
  log.warn("检测到已有应用实例在运行，退出当前实例");
  app.quit();
} else {
  // 如果获取锁成功，监听第二个实例启动事件
  app.on("second-instance", (event, commandLine, workingDirectory) => {
    // 当用户尝试启动第二个实例时，激活已存在的主窗口
    if (mainWindow) {
      // 如果窗口隐藏在托盘，则显示出来
      if (!mainWindow.isVisible()) {
        mainWindow.show();
      }
      // 如果窗口最小化，则还原窗口
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      // 聚焦窗口（将窗口带到前台）
      mainWindow.focus();
    }
  });
}

// 判断是否为开发模式（根据是否打包，而不是 NODE_ENV）
const isDev = !app.isPackaged;

// 旧数据目录（Electron 默认 userData）
const DEFAULT_USER_DATA = app.getPath("userData");
// 新数据目录（用户主目录下的 .guada）
const GUADA_HOME = path.join(os.homedir(), ".guada");
// 迁移标记文件
const MIGRATED_FLAG = path.join(GUADA_HOME, ".migrated");
// 跳过迁移标记
const SKIP_MIGRATION_FLAG = path.join(DEFAULT_USER_DATA, ".skip_migration");

/**
 * 检测应使用的数据目录
 * 优先级：已迁移标记 > 已存在 ~/.guada 数据 > 老用户 AppData > 新安装
 * Electron 环境下，环境变量由主进程动态设置，不作为用户自定义依据
 * @returns 数据根目录（~/guada/ 或 AppData/Roaming/guada-ai/）
 */
function detectDataPath(): string {
  // 已迁移：~/.guada/ 下有数据或迁移标记
  if (
    fs.existsSync(MIGRATED_FLAG) ||
    fs.existsSync(path.join(GUADA_HOME, "data", "ai_chat.db"))
  ) {
    return GUADA_HOME;
  }
  // 老用户：AppData 下已有数据库
  if (fs.existsSync(path.join(DEFAULT_USER_DATA, "ai_chat.db"))) {
    return DEFAULT_USER_DATA;
  }
  // 新安装：直接使用 ~/.guada/
  return GUADA_HOME;
}

/** 数据路径集合 */
interface DataPaths {
  dataHome: string; // 数据根目录
  dbPath: string; // 数据库文件
  vectorDbPath: string; // 向量数据库
  versionFile: string; // 数据库版本标记
  uploadDir: string; // 上传文件目录
  logsDir: string; // 日志目录
  skillsDir: string; // 技能目录
  workspaceDir: string; // 工作目录
  isNewLayout: boolean; // 是否使用新目录结构（data/ 子目录）
}

/**
 * 根据数据根目录计算所有子路径
 * 自动区分新旧布局：
 *   - 旧用户（dataHome === DEFAULT_USER_DATA）：文件直接在根目录
 *   - 新安装/已迁移（dataHome === GUADA_HOME）：文件在 data/ 子目录
 */
function computeDataPaths(dataHome: string): DataPaths {
  const isNewLayout = dataHome !== DEFAULT_USER_DATA;
  if (isNewLayout) {
    return {
      dataHome,
      dbPath: path.join(dataHome, "data", "ai_chat.db"),
      vectorDbPath: path.join(dataHome, "data", "vector_db.sqlite"),
      versionFile: path.join(dataHome, "data", "db_version.json"),
      uploadDir: path.join(dataHome, "file_stores"),
      logsDir: path.join(dataHome, "logs"),
      skillsDir: path.join(dataHome, "skills"),
      workspaceDir: path.join(dataHome, "workspaces"),
      isNewLayout: true,
    };
  }
  // 旧布局：数据库、上传文件等直接在根目录
  return {
    dataHome,
    dbPath: path.join(dataHome, "ai_chat.db"),
    vectorDbPath: path.join(dataHome, "vector_db.sqlite"),
    versionFile: path.join(dataHome, "db_version.json"),
    uploadDir: path.join(dataHome, "file_stores"),
    logsDir: path.join(dataHome, "logs"),
    skillsDir: path.join(dataHome, "skills"),
    workspaceDir: path.join(dataHome, "workspace"),
    isNewLayout: false,
  };
}

// 配置更新（已改为自定义 API 检测，不再使用 electron-updater）
// autoUpdater.autoDownload = false;
// if (isDev) {
//   autoUpdater.forceDevUpdateConfig = true;
// }

// 获取后端路径
function getBackendPath(): string {
  if (isDev) {
    // 编译后的文件在 electron/dist/，需要向上两级到达项目根目录
    return path.join(__dirname, "..", "..", "backend-ts");
  } else {
    // 生产环境：从 resources 目录获取（extraResources）
    return path.join(process.resourcesPath, "backend-ts");
  }
}

// 计算 Schema 版本的哈希值（基于 schema.prisma 文件内容）
function getSchemaVersion(backendPath: string): string {
  const crypto = require("crypto");
  const schemaPath = path.join(backendPath, "prisma", "schema.prisma");
  if (!fs.existsSync(schemaPath)) return "unknown";

  const content = fs.readFileSync(schemaPath, "utf-8");
  return crypto
    .createHash("md5")
    .update(content)
    .digest("hex")
    .substring(0, 12);
}

// 初始化数据库文件
async function initializeDatabase(
  dataHome: string,
  backendPath: string,
): Promise<void> {
  const paths = computeDataPaths(dataHome);
  const dbPath = paths.dbPath;
  const vectorDbPath = paths.vectorDbPath;
  const versionFilePath = paths.versionFile;
  // 确保 data 目录存在
  const dataDir = path.dirname(dbPath);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  const { execSync } = require("child_process");

  // 设置环境变量
  const env = {
    ...process.env,
    DATABASE_URL: `file:${dbPath}`,
    VECTOR_DB_PATH: vectorDbPath,
    NODE_ENV: process.env.NODE_ENV || "production",
  };

  const currentSchemaVersion = getSchemaVersion(backendPath);
  let storedVersion: any = null;
  try {
    if (fs.existsSync(versionFilePath)) {
      storedVersion = JSON.parse(fs.readFileSync(versionFilePath, "utf-8"));
    }
  } catch (e) {
    console.warn("⚠️  读取版本标记文件失败，将重新同步");
  }

  // 智能跳过同步：如果版本一致且数据库存在，则跳过初始化
  if (
    storedVersion &&
    storedVersion.schemaVersion === currentSchemaVersion &&
    fs.existsSync(dbPath) &&
    fs.statSync(dbPath).size > 0
  ) {
    console.log(`数据库版本已同步 (${currentSchemaVersion})，跳过初始化`);
    return;
  }

  console.log("检测到数据库需要同步或初始化...");
  try {
    // 1. 首次运行：从模板拷贝数据库文件
    const isFirstRun = !fs.existsSync(dbPath) || fs.statSync(dbPath).size === 0;
    if (isFirstRun) {
      let templatePath: string | null = null;

      if (isDev) {
        // 开发环境：直接指向项目根目录下的 data 文件夹
        const devPath = path.join(
          __dirname,
          "..",
          "..",
          "data",
          "seed_template.db",
        );
        if (fs.existsSync(devPath)) templatePath = devPath;
      } else {
        // 生产环境：指向打包后的 resources 目录
        const prodPath = path.join(
          process.resourcesPath,
          "data",
          "seed_template.db",
        );
        if (fs.existsSync(prodPath)) templatePath = prodPath;
      }

      if (templatePath) {
        console.log(`发现种子模板: ${templatePath}`);
        fs.copyFileSync(templatePath, dbPath);
        console.log("已从模板初始化数据库");
      } else {
        console.warn("⚠️  未找到种子模板，将执行动态同步");
      }
    }

    // 2. 备份逻辑优化：仅在非首次运行且结构变更时备份
    if (!isFirstRun) {
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const backupPath = `${dbPath}.bak.${timestamp}`;

      // WAL 模式下先 checkpoint，确保 .db-wal 中的数据合并回主文件
      // 开发模式：系统 Node.js 编译的原生模块与 Electron 主进程 ABI 不匹配，
      // 改用子进程（系统 Node.js）执行，避免直接加载失败。
      // 生产模式：node_modules 已为 Electron 重建，可直接加载。
      try {
        if (isDev) {
          // 开发模式：通过 execSync 启动系统 Node.js 子进程来做 checkpoint
          const { execSync } = require("child_process");
          const modulesDir = path.join(backendPath, "node_modules", "better-sqlite3");
          const script = [
            `const Database = require(${JSON.stringify(modulesDir)});`,
            `const db = new Database(${JSON.stringify(dbPath)});`,
            `db.pragma('wal_checkpoint(TRUNCATE)');`,
            `db.close();`,
          ].join("");
          execSync(`"node" -e ${JSON.stringify(script)}`, {
            cwd: backendPath,
            env: {
              ...process.env,
              NODE_PATH: path.join(backendPath, "node_modules"),
            },
            stdio: "pipe",
            timeout: 10000,
          });
        } else {
          // 生产模式：直接加载（模块已为 Electron 重建）
          const Database = require(
            path.join(backendPath, "node_modules", "better-sqlite3"),
          );
          const db = new Database(dbPath);
          db.pragma("wal_checkpoint(TRUNCATE)");
          db.close();
        }
        console.log("WAL checkpoint 完成，数据已合并");
      } catch (e) {
        console.warn("⚠️  WAL checkpoint 失败，仍以当前状态备份:", e);
      }

      fs.copyFileSync(dbPath, backupPath);
      console.log(`数据库结构变更，已备份至: ${backupPath}`);

      // 清理旧备份（保留最多 3 个）
      const backups = fs
        .readdirSync(path.dirname(dbPath))
        .filter((f) => f.startsWith(path.basename(dbPath) + ".bak."))
        .sort()
        .reverse();
      if (backups.length > 3) {
        for (let i = 3; i < backups.length; i++) {
          fs.unlinkSync(path.join(path.dirname(dbPath), backups[i]));
        }
      }
    }

    // 3. 使用 db push 同步结构（使用 Electron 内置的 Node.js 运行时）
    const prismaCli = path.join(
      backendPath,
      "node_modules",
      "prisma",
      "build",
      "index.js",
    );

    // 使用 process.execPath（Electron 内置的 Node.js），不依赖系统的 node 命令
    const nodeExecutable = process.execPath;

    // 设置 ELECTRON_RUN_AS_NODE，让 Electron 以纯 Node.js 模式运行
    const execEnv = { ...env, ELECTRON_RUN_AS_NODE: "1" };

    execSync(
      `"${nodeExecutable}" "${prismaCli}" db push --config=prisma.config.js --accept-data-loss`,
      {
        cwd: backendPath,
        env: execEnv,
        stdio: "pipe",
        encoding: "utf-8",
      },
    );
    console.log("数据库表结构同步成功");

    // 4. 更新版本标记
    fs.writeFileSync(
      versionFilePath,
      JSON.stringify(
        {
          schemaVersion: currentSchemaVersion,
          seedCompleted: true,
          updatedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
    console.log("数据库版本标记已更新");
  } catch (error: any) {
    console.error("数据库同步失败:", error.message);
    const dataHome = detectDataPath();
    handleDatabaseError(error, dbPath, dataHome);
    throw error; // 抛出错误以便主进程捕获并提示用户
  }
}

// 处理数据库错误并弹出模态框
async function handleDatabaseError(
  error: any,
  dbPath: string,
  dataHome: string,
) {
  if (!mainWindow) return;

  const options: Electron.MessageBoxOptions = {
    type: "error",
    title: "数据库同步失败",
    message: "应用启动时无法同步数据库结构",
    detail: `错误信息: ${error.message}\n\n您可以尝试点击“重试”或手动打开日志目录排查问题。`,
    buttons: ["重试", "打开日志目录", "退出"],
    defaultId: 0,
    cancelId: 2,
  };

  try {
    const response = await dialog.showMessageBox(mainWindow, options);
    if (response.response === 0) {
      // 重试：重新调用初始化
      console.log("用户选择重试数据库初始化...");
      await initializeDatabase(dataHome, getBackendPath());
    } else if (response.response === 1) {
      shell.openPath(dataHome);
      app.quit();
    } else {
      app.quit();
    }
  } catch (e) {
    console.error("显示错误对话框失败:", e);
    app.quit();
  }
}

// 迁移状态枚举
type MigrationStatus =
  | "available"
  | "migrated"
  | "new_install"
  | "skipped"
  | "env_override";

/**
 * 检测迁移状态（供前端判断是否显示迁移提示）
 */
function getMigrationStatus(): MigrationStatus {
  if (
    process.env.DATABASE_URL ||
    process.env.UPLOAD_ROOT_DIR ||
    process.env.SKILLS_DIR
  ) {
    return "env_override";
  }
  if (
    fs.existsSync(MIGRATED_FLAG) ||
    fs.existsSync(path.join(GUADA_HOME, "data", "ai_chat.db"))
  ) {
    return "migrated";
  }
  if (fs.existsSync(SKIP_MIGRATION_FLAG)) {
    return "skipped";
  }
  if (fs.existsSync(path.join(DEFAULT_USER_DATA, "ai_chat.db"))) {
    return "available";
  }
  return "new_install";
}

/** 递归复制目录 */
function copyRecursiveSync(src: string, dest: string): void {
  if (!fs.existsSync(src)) return;
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true });
    }
    const entries = fs.readdirSync(src);
    for (const entry of entries) {
      copyRecursiveSync(path.join(src, entry), path.join(dest, entry));
    }
  } else {
    fs.copyFileSync(src, dest);
  }
}

/**
 * 执行数据迁移（从 AppData 复制到 ~/.guada/）
 * 注意：必须在后端进程停止后执行，否则 SQLite 文件被锁定
 */
async function handleMigration(): Promise<void> {
  const oldDir = DEFAULT_USER_DATA;
  const newDir = GUADA_HOME;

  // 1. 创建目标目录结构
  const newPaths = computeDataPaths(newDir);
  fs.mkdirSync(path.dirname(newPaths.dbPath), { recursive: true });
  fs.mkdirSync(newPaths.logsDir, { recursive: true });
  fs.mkdirSync(path.join(newDir, "skills"), { recursive: true });

  // 2. 复制数据文件（后端已停止，数据库处于一致状态）
  const oldDbPath = path.join(oldDir, "ai_chat.db");
  const copyTasks = [
    // 数据库文件
    { src: oldDbPath, dest: newPaths.dbPath },
    {
      src: path.join(oldDir, "ai_chat.db-wal"),
      dest: path.join(path.dirname(newPaths.dbPath), "ai_chat.db-wal"),
    },
    {
      src: path.join(oldDir, "ai_chat.db-shm"),
      dest: path.join(path.dirname(newPaths.dbPath), "ai_chat.db-shm"),
    },
    { src: path.join(oldDir, "vector_db.sqlite"), dest: newPaths.vectorDbPath },
    {
      src: path.join(oldDir, "vector_db.sqlite-wal"),
      dest: path.join(path.dirname(newPaths.vectorDbPath), "vector_db.sqlite-wal"),
    },
    {
      src: path.join(oldDir, "vector_db.sqlite-shm"),
      dest: path.join(path.dirname(newPaths.vectorDbPath), "vector_db.sqlite-shm"),
    },
    { src: path.join(oldDir, "db_version.json"), dest: newPaths.versionFile },
    // 上传文件
    { src: path.join(oldDir, "file_stores"), dest: newPaths.uploadDir },
    // 技能
    { src: path.join(oldDir, "skills"), dest: newPaths.skillsDir },
    // 日志
    { src: path.join(oldDir, "logs"), dest: newPaths.logsDir },
    // 定时任务
    { src: path.join(oldDir, "scheduler"), dest: path.join(newDir, "scheduler") },
    // 子 Agent
    { src: path.join(oldDir, "agents"), dest: path.join(newDir, "agents") },
    // 微信机器人会话
    { src: path.join(oldDir, "wechat-personal"), dest: path.join(newDir, "wechat-personal") },
    // 设置中心配置文件（模型偏好、插件开关、OCR、外观等）
    { src: path.join(oldDir, ".config"), dest: path.join(newDir, ".config") },
  ];

  for (const task of copyTasks) {
    if (fs.existsSync(task.src)) {
      copyRecursiveSync(task.src, task.dest);
      console.log(`已复制: ${task.src} → ${task.dest}`);
    }
  }

  // 3. 校验目标数据库文件头（SQLite 格式标记 "SQLite format 3\0"）
  const newDbPath = newPaths.dbPath;
  if (fs.existsSync(newDbPath)) {
    const fd = fs.openSync(newDbPath, 'r');
    const buffer = Buffer.alloc(16);
    fs.readSync(fd, buffer, 0, 16, 0);
    fs.closeSync(fd);
    const header = buffer.toString('utf8', 0, 16);
    if (header !== 'SQLite format 3\0') {
      throw new Error(`目标数据库文件格式无效: ${header}`);
    }
    console.log('目标数据库校验通过（SQLite 格式正确）');
  }

  // 4. 写迁移标记
  fs.writeFileSync(
    MIGRATED_FLAG,
    JSON.stringify(
      {
        migratedAt: new Date().toISOString(),
        from: oldDir,
        to: newDir,
        version: 2,
      },
      null,
      2,
    ),
  );
  console.log(`迁移标记已写入: ${MIGRATED_FLAG}`);
}

// 启动 NestJS 后端服务
async function startBackend(): Promise<void> {
  // 防止重复启动
  if (isBackendStarting) {
    console.warn("⚠️  后端已在启动中，跳过重复调用");
    return Promise.resolve();
  }

  // 如果后端已经在运行，直接返回
  if (backendProcess && !backendProcess.killed) {
    console.warn("⚠️  后端已在运行，跳过重复调用");
    return Promise.resolve();
  }

  isBackendStarting = true;

  return new Promise(async (resolve, reject) => {
    const backendPath = getBackendPath();

    if (isDev) {
      // 开发模式：固定端口
      backendPort = 3000;
      console.log("开发模式：使用固定端口 3000");
      // 开发模式：使用 spawn 启动 ts-node-dev
      const { spawn } = await import("child_process");
      const nodePath = process.platform === "win32" ? "npx.cmd" : "npx";
      const scriptPath = "ts-node-dev";
      const args = [
        "--respawn",
        "--transpile-only",
        path.join(backendPath, "src", "main.ts"),
      ];

      console.log("开发模式：使用 ts-node-dev 启动后端（支持热重载）");

      // 检测数据目录
      const dataHome = detectDataPath();
      const paths = computeDataPaths(dataHome);
      console.log(`数据目录: ${dataHome}`);

      await initializeDatabase(dataHome, backendPath);

      const staticDir = path.join(backendPath, "static");

      console.log("Database path:", paths.dbPath);
      console.log("Vector database path:", paths.vectorDbPath);
      console.log("Static directory:", staticDir);
      console.log("Upload directory:", paths.uploadDir);
      console.log("Backend logs directory:", paths.logsDir);
      console.log("Skills directory:", paths.skillsDir);
      console.log("Workspace directory:", paths.workspaceDir);

      const spawnOptions: any = {
        cwd: backendPath,
        env: {
          ...process.env,
          NODE_ENV: "development",
          PORT: "3000",
          DATABASE_URL: `file:${paths.dbPath}`,
          VECTOR_DB_PATH: paths.vectorDbPath,
          STATIC_DIR: staticDir,
          UPLOAD_ROOT_DIR: paths.uploadDir,
          UPLOAD_URL_PREFIX: "/uploads",
          SETTINGS_DIR: dataHome, // 传递设置目录
          USERDATA_DIR: dataHome, // 传递用户数据目录
          LOGS_DIR: paths.logsDir, // 传递后端日志目录
          SKILLS_DIR: paths.skillsDir, // 传递技能目录
          WORKSPACE_BASE_DIR: paths.workspaceDir, // 传递会话工作目录基础路径
          ELECTRON_APP: "true", // 标识这是 Electron 环境
          GUADA_BRIDGE_PATH: process.env.GUADA_BRIDGE_PATH,
          GUADA_BRIDGE_TOKEN: process.env.GUADA_BRIDGE_TOKEN,
        },
        stdio: ["pipe", "pipe", "pipe"],
        shell: true,
      };

      backendProcess = spawn(nodePath, [scriptPath, ...args], spawnOptions);
    } else {
      // 生产模式：使用 0 让系统自动分配端口，通过 IPC 获取
      backendPort = 0;
      const { spawn } = await import("child_process");
      const nodePath = process.execPath;
      const scriptPath = path.join(backendPath, "dist", "main.js");

      // 检查文件是否存在
      if (!fs.existsSync(scriptPath)) {
        console.error("后端文件不存在:", scriptPath);
        reject(new Error("Backend files not found"));
        return;
      }

      console.log("生产模式：从 unpacked 目录启动后端");
      console.log("后端路径:", backendPath);

      // 检测数据目录
      const dataHome = detectDataPath();
      const paths = computeDataPaths(dataHome);
      console.log(`数据目录: ${dataHome}`);

      // 初始化数据库
      await initializeDatabase(dataHome, backendPath);

      const staticDir = path.join(backendPath, "static");

      console.log("Database path:", paths.dbPath);
      console.log("Vector database path:", paths.vectorDbPath);
      console.log("Static directory:", staticDir);
      console.log("Upload directory:", paths.uploadDir);
      console.log("Backend logs directory:", paths.logsDir);
      console.log("Skills directory:", paths.skillsDir);
      console.log("Workspace directory:", paths.workspaceDir);

      // 使用 spawn 启动后端
      const spawnOptions: any = {
        cwd: backendPath,
        env: {
          ...process.env,
          NODE_ENV: "production",
          ELECTRON_RUN_AS_NODE: "1", // 关键：以纯 Node 模式运行
          NODE_NO_WARNINGS: "1", // 抑制 Node.js 警告（如 punycode 弃用警告）
          PORT: backendPort.toString(),
          BASE_URL: "__auto__", // Electron 生产环境使用自动模式，动态设置 BASE_URL
          DATABASE_URL: `file:${paths.dbPath}`,
          VECTOR_DB_PATH: paths.vectorDbPath,
          STATIC_DIR: staticDir,
          UPLOAD_ROOT_DIR: paths.uploadDir,
          UPLOAD_URL_PREFIX: "/uploads",
          SETTINGS_DIR: dataHome, // 传递设置目录
          USERDATA_DIR: dataHome, // 传递用户数据目录
          LOGS_DIR: paths.logsDir, // 传递后端日志目录
          SKILLS_DIR: paths.skillsDir, // 传递技能目录
          WORKSPACE_BASE_DIR: paths.workspaceDir, // 传递会话工作目录基础路径
          ELECTRON_APP: "true", // 标识这是 Electron 环境
          GUADA_BRIDGE_PATH: process.env.GUADA_BRIDGE_PATH,
          GUADA_BRIDGE_TOKEN: process.env.GUADA_BRIDGE_TOKEN,
        },
        stdio: ["pipe", "pipe", "pipe"],
      };

      backendProcess = spawn(nodePath, [scriptPath], spawnOptions);
    }

    if (!backendProcess) {
      reject(new Error("Failed to create backend process"));
      return;
    }

    let isResolved = false;
    // 通过 BridgeServer 监听后端端口上报事件
    bridgeServer?.onEvent("port_ready", (data: any) => {
      if (data?.port && !isResolved) {
        backendPort = data.port;
        console.log(`通过 Bridge 接收到后端端口号 ${backendPort}`);
        isBackendStarting = false;
        isResolved = true;
        resolve();
      }
    });

    // 处理 stdout
    backendProcess.stdout?.on("data", (data) => {
      const message = data.toString().trim();
      if (message) {
        console.log(`[Backend] ${message}`);
      }

      // // 开发模式：通过日志检测启动成功（开发环境固定端口 3000）
      // if (isDev && message.includes("Application is running on") && !isResolved) {
      //   isBackendStarting = false;
      //   isResolved = true;
      //   console.log(`[Backend] Application is running on port ${backendPort}`);
      //   resolve();
      // }
    });

    // 处理 stderr
    backendProcess.stderr?.on("data", (data) => {
      const errorMessage = data.toString().trim();
      if (errorMessage) {
        console.error(`[Backend Error] ${errorMessage}`);
      }
    });

    // 处理错误
    backendProcess.on("error", (error) => {
      log.error("后端进程启动失败:", error);
      isBackendStarting = false; // 重置标志
      reject(error);
    });

    // 处理退出
    backendProcess.on("exit", (code) => {
      log.info(`后端进程退出，退出码: ${code}`);
      isBackendStarting = false; // 重置标志
      if (code !== 0 && code !== null && !isBackendStopping) {
        log.error(`后端进程异常退出，退出码: ${code}`);
      }
    });

    // 设置超时
    setTimeout(() => {
      reject(new Error("Backend startup timeout"));
    }, 60000);
  });
}

// 创建系统托盘图标
function createTray() {
  // 开发环境：electron/dist/main.js 在 electron/dist/ 下，向上两级到项目根目录
  // 生产环境：build-resources 在 resources/ 下
  const iconName = process.platform === "win32" ? "icon.ico" : "icon.png";
  const iconPath = isDev
    ? path.join(__dirname, "..", "..", "build-resources", iconName)
    : path.join(process.resourcesPath, "build-resources", iconName);

  tray = new Tray(iconPath);
  tray.setToolTip("GuaDa");

  updateTrayMenu();

  // 左键单击恢复窗口
  tray.on("click", () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.focus();
      } else {
        mainWindow.show();
      }
    } else {
      createWindow();
    }
  });

  // macOS 双击行为
  tray.on("double-click", () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

/** 更新托盘上下文菜单（含动态状态信息） */
function updateTrayMenu() {
  if (!tray) return;
  const items: MenuItemConstructorOptions[] = [
    {
      label: `运行中: ${trayStats.running}  未读: ${trayStats.unread}`,
      enabled: trayStats.running > 0 || trayStats.unread > 0,
      icon: undefined,
    },
    { type: "separator" },
    {
      label: "显示主窗口",
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        } else {
          createWindow();
        }
      },
    },
    { type: "separator" },
    {
      label: "退出",
      click: () => {
        app.quit();
      },
    },
  ];
  tray.setContextMenu(Menu.buildFromTemplate(items));
}

/**
 * 创建托盘悬浮小窗
 * 主窗口隐藏时，在屏幕右下角显示一个半透明状态卡片
 */
function createFloatWindow() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth, height: screenHeight } =
    primaryDisplay.workAreaSize;

  const floatingHTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="UTF-8"><style>
* { margin: 0; padding: 0; box-sizing: border-box; }
html { background: transparent; }
html, body { height: 100%; overflow: hidden; }
body {
  background: transparent;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  color: #e8e9ed;
  user-select: none;
  white-space: nowrap;
  display: flex; flex-direction: column; justify-content: center;
  padding: 0;
}
.card {
  background: rgba(30, 30, 35, 0.85);
  backdrop-filter: blur(8px);
  border-radius: 10px;
  border: 1px solid rgba(255,255,255,0.1);
  width: 100%; height: 100%;
  display: flex; flex-direction: column; justify-content: center;
  padding: 6px 12px;
}
.row { display: flex; align-items: center; gap: 6px; padding: 2px 0; font-size: 12px; }
.icon-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
.dot-green { background: #4caf50; box-shadow: 0 0 3px #4caf50; }
.dot-orange { background: #ff9800; box-shadow: 0 0 3px #ff9800; }
.row .val { margin-left: auto; font-weight: 600; font-variant-numeric: tabular-nums; }
</style></head>
<body>
<div class="card" id="card" style="opacity:0">
  <div class="row"><span class="icon-dot dot-green"></span><span>任务运行中</span><span class="val" id="val-running">0</span></div>
  <div class="row"><span class="icon-dot dot-orange"></span><span>未读消息</span><span class="val" id="val-unread">0</span></div>
</div>
<script>
const { ipcRenderer } = require('electron');
const card = document.getElementById('card');

// 接收用户设置的透明度（浮窗就绪后主进程 float:ready → applyTraySettings 会立即下发）
ipcRenderer.on('float:settings', (_, settings) => {
  if (settings.opacity !== undefined) {
    card.style.opacity = String(settings.opacity / 100);
  }
});

// 悬浮窗统计数据更新（仅更新数字，不设置透明度）
ipcRenderer.on('float:update', (_, data) => {
  document.getElementById('val-running').textContent = data.running;
  document.getElementById('val-unread').textContent = data.unread;
});

// 双击恢复主窗口
card.addEventListener('dblclick', () => {
  ipcRenderer.send('float:dblclick');
});

// JS 拖拽实现（替代 -webkit-app-region，避免鼠标事件被拦截）
let isDragging = false;
let dragStartX = 0, dragStartY = 0;

card.addEventListener('mousedown', (e) => {
  isDragging = false;
  dragStartX = e.screenX;
  dragStartY = e.screenY;

  const onMouseMove = (e) => {
    if (e.buttons !== 1) { cleanup(); return; }
    const dx = e.screenX - dragStartX;
    const dy = e.screenY - dragStartY;
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
      isDragging = true;
      ipcRenderer.send('float:drag-move', { dx, dy });
      dragStartX = e.screenX;
      dragStartY = e.screenY;
    }
  };

  const onMouseUp = () => {
    cleanup();
    isDragging = false;
  };

  const cleanup = () => {
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
  };

  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);
  });

  // 接收悬浮窗设置（透明度）
  ipcRenderer.on('float:settings', (_, settings) => {
    if (settings.opacity !== undefined) {
      userOpacity = settings.opacity / 100;
      card.style.opacity = String(userOpacity);
    }
  });

  // 通知主进程：浮窗已就绪，可下发缓存设置
  ipcRenderer.send('float:ready');
  <\/script>
</body>
</html>`;

  floatWindow = new BrowserWindow({
    width: 160,
    height: 80,
    x: screenWidth - 180,
    y: screenHeight - 100,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    show: false,
    focusable: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  floatWindow.loadURL(
    `data:text/html;charset=utf-8,${encodeURIComponent(floatingHTML)}`,
  );

  floatWindow.on("closed", () => {
    floatWindow = null;
  });
}

/**
 * 应用悬浮窗设置（显隐 + 透明度）
 */
function applyTraySettings() {
  if (!floatWindow || floatWindow.isDestroyed()) return;

  // 显隐控制：主窗口最小化或隐藏时且 enabled 才显示浮窗
  const isMinimized = mainWindow?.isMinimized() ?? false;
  const isHidden = mainWindow ? !mainWindow.isVisible() : true;
  const shouldShow =
    traySettings.enabled && mainWindow && (isMinimized || isHidden);
  if (shouldShow) {
    floatWindow.show();
    floatWindow.webContents.send("float:settings", {
      opacity: traySettings.opacity,
    });
  } else {
    floatWindow.hide();
  }
}

// 判断是否为本地地址（允许在主窗口内导航）
function isLocalUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "file:") return true;
    if (
      parsed.hostname === "localhost" ||
      parsed.hostname === "127.0.0.1" ||
      parsed.hostname === "[::1]"
    ) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

// 判断是否为安全的外部链接（仅允许 http/https）
function isSafeExternalUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

// 拦截外部链接：弹窗确认后用系统默认浏览器打开
async function handleExternalUrl(url: string): Promise<void> {
  if (!isSafeExternalUrl(url)) {
    log.warn(`[Security] Blocked non-http(s) URL: ${url}`);
    return;
  }
  const result = await dialog.showMessageBox(mainWindow!, {
    type: "question",
    title: "打开外部链接",
    message: "即将在默认浏览器中打开以下链接：",
    detail: url,
    buttons: ["打开", "取消"],
    defaultId: 0,
    cancelId: 1,
  });
  if (result.response === 0) {
    await shell.openExternal(url);
  }
}

// 创建窗口
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    frame: false, // 无边框窗口，去掉默认标题栏
    icon: isDev
      ? path.join(__dirname, "..", "build-resources", "icon.ico")
      : path.join(process.resourcesPath, "build-resources", "icon.ico"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: true, // 启用 <webview> 标签，用于浏览器自动化内嵌预览
    },
    show: false,
    backgroundColor: "#000000",
    titleBarStyle: "hidden", // 隐藏标题栏但保留系统按钮（macOS）
  });

  // 设置应用菜单
  // setupApplicationMenu()

  if (isDev) {
    // 开发环境：根据 USE_STATIC_FRONTEND 决定加载方式
    if (process.env.USE_STATIC_FRONTEND === "true") {
      // 使用编译后的静态前端文件
      const frontendPath = path.join(
        __dirname,
        "..",
        "..",
        "frontend",
        "dist",
        "index.html",
      );
      console.log("~ file: main.ts ~ line 438 ~ frontendPath", frontendPath);
      mainWindow.loadFile(frontendPath);
    } else {
      // 使用 Vite 开发服务器（热重载）
      mainWindow.loadURL("http://localhost:5173");
    }

    // 不再自动打开开发者工具，用户可以通过 Debug 菜单手动打开
    // setTimeout(() => {
    //   mainWindow?.webContents.openDevTools({ mode: 'right' })
    // }, 1000)
  } else {
    // 生产环境加载打包后的前端文件
    // __dirname 指向 app.asar/electron/dist，需要向上两级到 app.asar，然后进入 frontend/dist
    const frontendPath = path.join(
      __dirname,
      "..",
      "..",
      "frontend",
      "dist",
      "index.html",
    );

    mainWindow.loadFile(frontendPath);

    // 生产环境也不自动打开开发者工具
    // if (process.env.DEBUG_MODE === 'true') {
    //   setTimeout(() => {
    //     mainWindow?.webContents.openDevTools({ mode: 'right' })
    //   }, 1000)
    // }
  }

  // 窗口准备好后显示
  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });

  // 拦截 window.open() 和 target="_blank" 链接
  mainWindow.webContents.setWindowOpenHandler(({ url }: { url: string }) => {
    if (isLocalUrl(url)) {
      return { action: "allow" };
    }
    handleExternalUrl(url);
    return { action: "deny" };
  });

  // 拦截页面内导航（如点击 <a href="..."> 链接）
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (isLocalUrl(url)) {
      return; // 允许本地导航
    }
    event.preventDefault();
    handleExternalUrl(url);
  });

  // 前端加载完成后检查更新
  mainWindow.webContents.on("did-finish-load", () => {
    if ((app as AppExtended).isQuiting) return;
    log.info("Frontend loaded, checking for updates...");
    doCheckForUpdates();

    // 每 6 小时定期检查更新
    setInterval(
      () => {
        log.info("Periodic update check...");
        doCheckForUpdates();
      },
      6 * 60 * 60 * 1000,
    );
  });

  // 关闭按钮最小化到托盘（hide 事件中执行 applyTraySettings，避免重复触发闪烁）
  mainWindow.on("close", (event) => {
    if (!(app as AppExtended).isQuiting) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });

  // 主窗口隐藏/最小化 → 延迟 1s 显示浮窗（避免闪烁），恢复/显示 → 立即隐藏
  let floatShowTimeout: ReturnType<typeof setTimeout> | null = null;
  mainWindow.on("hide", () => {
    if (floatShowTimeout) clearTimeout(floatShowTimeout);
    floatShowTimeout = setTimeout(() => {
      applyTraySettings();
      floatShowTimeout = null;
    }, 500);
  });
  mainWindow.on("minimize", () => {
    if (floatShowTimeout) clearTimeout(floatShowTimeout);
    floatShowTimeout = setTimeout(() => {
      applyTraySettings();
      floatShowTimeout = null;
    }, 500);
  });
  mainWindow.on("show", () => {
    if (floatShowTimeout) {
      clearTimeout(floatShowTimeout);
      floatShowTimeout = null;
    }
    if (floatWindow) floatWindow.hide();
  });
  mainWindow.on("restore", () => {
    if (floatShowTimeout) {
      clearTimeout(floatShowTimeout);
      floatShowTimeout = null;
    }
    if (floatWindow) floatWindow.hide();
  });

  mainWindow.on("closed", () => {
    // 清理窗口管理器
    windowManager?.closeAllWindows();
    windowManager = null;
    mainWindow = null;
  });

  // 初始化窗口管理器（webview 架构：绑定主窗口监听 did-attach-webview）
  windowManager = new BrowserWebviewManager();
  windowManager.attachMainWindow(mainWindow);

  // 监听窗口大小变化（独立窗口不需要）
  // mainWindow.on('resize', () => {
  //   windowManager?.handleResize()
  // })
}

// IPC 通信处理
function setupIpcHandlers() {
  ipcMain.handle("get-app-info", () => {
    return {
      platform: process.platform,
      version: app.getVersion(),
      userDataPath: app.getPath("userData"),
      backendPort: backendPort,
      migration: {
        status: getMigrationStatus(),
        oldPath: DEFAULT_USER_DATA,
        newPath: GUADA_HOME,
      },
    };
  });

  // 数据迁移 IPC
  ipcMain.handle("migrate-data", async () => {
    try {
      console.log("开始数据迁移...");
      // 先停止后端
      if (backendProcess && !backendProcess.killed) {
        const { exec } = require("child_process");
        await new Promise<void>((resolve, reject) => {
          exec(`taskkill /pid ${backendProcess!.pid} /T /F`, (error: any) => {
            if (error) {
              console.error("停止后端失败:", error.message);
              reject(error);
            } else {
              console.log("后端进程已终止");
              resolve();
            }
          });
        });
        backendProcess = null;
      }

      await handleMigration();
      console.log("数据迁移完成，重新启动后端...");

      // 重启后端（startBackend 会检测到 .migrated 标记，使用新路径）
      isBackendReady = false;
      isBackendStarting = false;
      backendReadyPromise = startBackend()
        .then(() => {
          isBackendReady = true;
          console.log("后端迁移后重启成功");
        })
        .catch((error) => {
          console.error("后端迁移后重启失败:", error);
          isBackendReady = true;
        });

      await backendReadyPromise;
      return { success: true, message: "迁移完成" };
    } catch (error: any) {
      console.error("数据迁移失败:", error);
      return { success: false, message: error.message };
    }
  });

  // wait-backend-ready：单次 IPC 调用，后端就绪后返回，无需双向通信
  ipcMain.handle("wait-backend-ready", async () => {
    if (!isBackendReady) {
      await backendReadyPromise;
    }
    return { port: backendPort, error: null };
  });

  // 同步查询后端就绪状态（用于刷新场景，在 Vue 挂载前阻塞式确定初始值）
  ipcMain.on("get-backend-status-sync", (event) => {
    event.returnValue = { ready: isBackendReady };
  });

  ipcMain.handle("show-notification", (_, { title, body }) => {
    // 可以在这里实现系统通知
    console.log("Notification:", title, body);
  });

  // 接收渲染进程推送的托盘统计信息，更新悬浮窗 + 托盘菜单
  ipcMain.on(
    "tray:update-stats",
    (_, stats: { running: number; unread: number }) => {
      trayStats = stats;
      // 更新托盘工具提示
      if (tray) {
        const parts: string[] = [];
        if (stats.running > 0) parts.push(`${stats.running} 个任务运行中`);
        if (stats.unread > 0) parts.push(`${stats.unread} 条未读`);
        tray.setToolTip(
          `GuaDa${parts.length > 0 ? ` - ${parts.join("，")}` : ""}`,
        );
      }
      // 更新托盘菜单
      updateTrayMenu();
      // 更新悬浮窗内容（仅统计数据，不携带设置项）
      if (floatWindow && !floatWindow.isDestroyed()) {
        floatWindow.webContents.send("float:update", stats);
      }
    },
  );

  // 悬浮窗双击 → 显示主窗口
  ipcMain.on("float:dblclick", () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    } else {
      createWindow();
    }
  });

  // 悬浮窗鼠标拖拽移动
  ipcMain.on("float:drag-move", (_, { dx, dy }: { dx: number; dy: number }) => {
    if (!floatWindow || floatWindow.isDestroyed()) return;
    const [x, y] = floatWindow.getPosition();
    floatWindow.setPosition(x + dx, y + dy);
  });

  // 接收前端设置的悬浮窗配置（始终下发浮窗，不依赖主窗口可见状态）
  ipcMain.on(
    "tray:update-settings",
    (_, settings: { enabled: boolean; opacity: number }) => {
      traySettings = settings;
      if (floatWindow && !floatWindow.isDestroyed()) {
        floatWindow.webContents.send("float:settings", {
          opacity: traySettings.opacity,
        });
      }
      applyTraySettings();
    },
  );

  // 浮窗就绪后主动发送缓存的设置
  ipcMain.on("float:ready", () => {
    applyTraySettings();
    // 推送当前统计数据
    if (floatWindow && !floatWindow.isDestroyed()) {
      floatWindow.webContents.send("float:update", trayStats);
    }
  });

  // 窗口控制
  ipcMain.on("window-minimize", () => {
    mainWindow?.minimize();
  });

  ipcMain.on("window-maximize", () => {
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow?.maximize();
    }
  });

  ipcMain.on("window-close", () => {
    mainWindow?.close();
  });

  // 获取窗口最大化状态
  ipcMain.handle("is-window-maximized", () => {
    return mainWindow?.isMaximized() || false;
  });

  // 打开/关闭开发者工具
  ipcMain.on("toggle-devtools", () => {
    if (mainWindow) {
      if (mainWindow.webContents.isDevToolsOpened()) {
        mainWindow.webContents.closeDevTools();
      } else {
        mainWindow.webContents.openDevTools({ mode: "right" });
      }
    }
  });

  // 自动更新相关 IPC（自定义 API 检测）
  ipcMain.handle("check-for-updates", async () => {
    return doCheckForUpdates();
  });

  // 显示调试菜单（固定菜单项）
  ipcMain.handle("show-debug-menu", async (event) => {
    log.debug("[DebugMenu] Showing debug menu");
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) {
      log.error("[DebugMenu] No window found");
      return;
    }

    const menuItems: MenuItemConstructorOptions[] = [
      {
        label: "Open DevTools",
        click: () => {
          log.debug("[DebugMenu] Opening dev tools");
          win.webContents.openDevTools();
        },
      },
      { type: "separator" },
      {
        label: "Open Data Directory",
        click: () => {
          log.debug("[DebugMenu] Opening user data folder");
          shell.openPath(app.getPath("userData"));
        },
      },
      {
        label: "Open Install Directory",
        click: () => {
          log.debug("[DebugMenu] Opening install folder");
          const installPath = isDev
            ? path.join(__dirname, "..", "..")
            : path.dirname(app.getPath("exe"));
          shell.openPath(installPath);
        },
      },
    ];

    const menu = Menu.buildFromTemplate(menuItems);
    menu.popup({ window: win });
  });

  // 显示标签页右键菜单
  ipcMain.handle(
    "show-tab-context-menu",
    async (
      event,
      { tabId, isSplitMode }: { tabId: string; isSplitMode: boolean },
    ) => {
      log.debug("[TabMenu] Showing context menu for tab:", tabId);
      const win = BrowserWindow.fromWebContents(event.sender);
      if (!win) {
        log.error("[TabMenu] No window found");
        return;
      }

      // 获取目标窗口的 WebContents
      const targetWin = windowManager?.getWebContents(tabId);
      if (!targetWin) {
        log.error("[TabMenu] Target window not found:", tabId);
        return;
      }

      const menuItems: MenuItemConstructorOptions[] = [];

      // 打开开发者工具（内联模式）
      menuItems.push({
        label: "打开开发者工具",
        click: () => {
          targetWin.openDevTools({ mode: "right" });
        },
      });

      menuItems.push({ type: "separator" });

      // 隐藏/显示窗口（后台/前台模式）
      const isVisible = windowManager?.isWindowVisible(tabId) ?? false;
      menuItems.push({
        label: isVisible ? "隐藏窗口（后台模式）" : "显示窗口（前台模式）",
        click: () => {
          if (isVisible) {
            windowManager?.hideWindow(tabId);
          } else {
            windowManager?.showWindow(tabId);
          }
        },
      });

      menuItems.push({ type: "separator" });

      // 关闭窗口
      menuItems.push({
        label: "关闭窗口",
        click: () => {
          log.debug("[TabMenu] Closing window:", tabId);
          windowManager?.closeWindow(tabId);
        },
      });

      const menu = Menu.buildFromTemplate(menuItems);
      menu.popup({ window: win });
    },
  );

  // 打开用户数据目录
  ipcMain.on("open-user-data-folder", () => {
    const targetPath = detectDataPath();
    shell.openPath(targetPath).then((error) => {
      if (error) {
        console.error("Failed to open user data folder:", error);
      }
    });
  });

  // 打开安装目录
  ipcMain.on("open-install-folder", () => {
    let installPath: string;
    if (isDev) {
      // 开发环境：打开项目根目录
      installPath = path.join(__dirname, "..", "..");
    } else {
      // 生产环境：打开应用安装目录
      installPath = path.dirname(app.getPath("exe"));
    }
    shell.openPath(installPath).then((error) => {
      if (error) {
        console.error("Failed to open install folder:", error);
      }
    });
  });

  // 打开指定文件夹
  ipcMain.handle("open-folder", async (_, folderPath: string) => {
    try {
      await shell.openPath(folderPath);
      return { success: true };
    } catch (error) {
      log.error("打开文件夹失�?", error);
      return { success: false, error: String(error) };
    }
  });

  // 在资源管理器中显示并选中文件
  ipcMain.handle("show-item-in-folder", async (_, filePath: string) => {
    try {
      shell.showItemInFolder(filePath);
      return { success: true };
    } catch (error) {
      log.error("在资源管理器中显示文件失败", error);
      return { success: false, error: String(error) };
    }
  });

  // 用外部编辑器打开文件/目录（支持 vscode, 后续可扩展 cursor, webstorm 等）
  ipcMain.handle(
    "open-with-editor",
    async (_, params: { path: string; editor: string }) => {
      const { path: targetPath, editor } = params;
      try {
        let cmd: string;
        switch (editor) {
          case "vscode":
            cmd = `code "${targetPath}"`;
            break;
          default:
            return { success: false, error: `Unknown editor: ${editor}` };
        }
        await new Promise<void>((resolve, reject) => {
          exec(cmd, (error) => {
            if (error) reject(error);
            else resolve();
          });
        });
        return { success: true };
      } catch (error) {
        log.error(`用 ${editor} 打开失败`, error);
        return { success: false, error: String(error) };
      }
    },
  );

  // 选择文件夹对话框
  ipcMain.handle("select-folder", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory"],
      title: "选择工作目录",
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    return result.filePaths[0];
  });

  // 剪贴板操作（通过 IPC）
  ipcMain.handle("clipboard-write-text", (_, text: string) => {
    try {
      clipboard.writeText(text);
      return { success: true };
    } catch (error) {
      console.error("[Main] 剪贴板写入失败", error);
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle("clipboard-read-text", () => {
    try {
      const text = clipboard.readText();
      return { success: true, text };
    } catch (error) {
      console.error("[Main] 剪贴板读取失败", error);
      return { success: false, error: (error as Error).message };
    }
  });

  // 打开外部链接
  ipcMain.handle("open-external", async (_, url: string) => {
    try {
      if (!isSafeExternalUrl(url)) {
        log.warn(`[Security] Blocked open-external for non-http(s) URL: ${url}`);
        return { success: false, error: "仅允许 http/https 协议" };
      }
      await shell.openExternal(url);
      return { success: true };
    } catch (error) {
      log.error("打开外部链接失败:", error);
      return { success: false, error: String(error) };
    }
  });

  // ==================== 浏览器窗口管理 IPC ====================

  // 创建新窗口
  ipcMain.handle("browser:create-window", async (_, { url, metadata }) => {
    try {
      const windowInfo = await windowManager!.createWindow(url, metadata);
      return { success: true, window: windowInfo };
    } catch (error: any) {
      log.error("创建窗口失败:", error.message);
      return { success: false, error: error.message };
    }
  });

  // 关闭窗口
  ipcMain.handle("browser:close-window", async (_, { windowId }) => {
    try {
      const success = await windowManager!.closeWindow(windowId);
      return { success };
    } catch (error: any) {
      log.error("关闭窗口失败:", error.message);
      return { success: false, error: error.message };
    }
  });

  // 获取窗口列表
  ipcMain.handle("browser:get-windows", () => {
    try {
      const windows = windowManager!.getWindowList();
      return { success: true, windows };
    } catch (error: any) {
      log.error("获取窗口列表失败:", error.message);
      return { success: false, error: error.message };
    }
  });

  // 激活/聚焦窗口
  ipcMain.handle("browser:activate-window", async (_, { windowId }) => {
    try {
      // 使用 windowManager 的 showWindow 方法，会自动触发 window-updated 事件
      windowManager!.showWindow(windowId);
      return { success: true };
    } catch (error: any) {
      log.error("激活窗口失败:", error.message);
      return { success: false, error: error.message };
    }
  });

  // ==================== Browser Shell IPC（已废弃 — webview 架构下无需外壳窗口）====================

  // ==================== 浏览器窗口文件存储 IPC ====================

  // 获取浏览器窗口数据存储目录
  function getBrowserDataDir(sessionPath?: string): string {
    if (!sessionPath) {
      throw new Error("缺少会话路径，无法确定文件保存位置");
    }

    // 确保目录存在
    if (!fs.existsSync(sessionPath)) {
      fs.mkdirSync(sessionPath, { recursive: true });
    }

    return sessionPath;
  }

  // 验证文件名安全性（防止路径穿越）
  function sanitizeFilename(filename: string): {
    valid: boolean;
    sanitized?: string;
    error?: string;
  } {
    if (!filename || typeof filename !== "string") {
      return { valid: false, error: "文件名不能为空" };
    }

    // 移除非法字符，仅保留字母、数字、下划线、连字符、点和中文
    const sanitized = filename.replace(/[<>:"/\\|?*\x00-\x1f]/g, "").trim();

    if (!sanitized) {
      return { valid: false, error: "文件名无效" };
    }

    // 禁止路径穿越特征
    if (
      sanitized.includes("..") ||
      sanitized.startsWith("/") ||
      sanitized.startsWith("\\")
    ) {
      return { valid: false, error: "文件名包含非法路径字符" };
    }

    // 限制文件名长度
    if (sanitized.length > 255) {
      return { valid: false, error: "文件名过长（最大255字符）" };
    }

    return { valid: true, sanitized };
  }

  // 保存数据到文件
  ipcMain.handle(
    "browser:save-to-file",
    async (event, { filename, data, options }) => {
      try {
        const validation = sanitizeFilename(filename);
        if (!validation.valid) {
          return { success: false, error: validation.error };
        }

        // 通过 event.sender 反查窗口元数据，获取会话工作路径
        const senderId = (event.sender as any).id;
        const windowId = windowManager!.getWindowIdByWebContentsId(senderId);
        const metadata = windowId
          ? windowManager!.getWindowMetadata(windowId)
          : undefined;
        const sessionPath = metadata?.sessionPath as string | undefined;

        const targetDir = getBrowserDataDir(sessionPath);
        const filePath = path.join(targetDir, validation.sanitized!);

        // 根据编码方式处理数据
        const encoding = options?.encoding || "utf8";

        if (encoding === "base64") {
          // base64 模式：将 base64 字符串解码为 Buffer 后异步写入
          const base64Data =
            typeof data === "string" ? data : JSON.stringify(data);
          await fs.promises.writeFile(
            filePath,
            Buffer.from(base64Data, "base64"),
          );
          log.info(`[BrowserData] 二进制文件已保存: ${filePath}`);
        } else {
          // utf8 模式：文本或 JSON 数据异步写入
          await fs.promises.writeFile(
            filePath,
            typeof data === "string" ? data : JSON.stringify(data, null, 2),
            "utf-8",
          );
          log.info(`[BrowserData] 文本文件已保存: ${filePath}`);
        }

        return { success: true, filePath };
      } catch (error: any) {
        log.error("[BrowserData] 保存文件失败:", error);
        return { success: false, error: error.message || "保存文件失败" };
      }
    },
  );

  // 从文件读取数据
  ipcMain.handle(
    "browser:read-from-file",
    async (event, { filename, options }) => {
      try {
        const validation = sanitizeFilename(filename);
        if (!validation.valid) {
          return { success: false, error: validation.error };
        }

        // 通过 event.sender 反查窗口元数据，获取会话工作路径
        const senderId = (event.sender as any).id;
        const windowId = windowManager!.getWindowIdByWebContentsId(senderId);
        const metadata = windowId
          ? windowManager!.getWindowMetadata(windowId)
          : undefined;
        const sessionPath = metadata?.sessionPath as string | undefined;

        const targetDir = getBrowserDataDir(sessionPath);
        const filePath = path.join(targetDir, validation.sanitized!);

        try {
          await fs.promises.access(filePath);
        } catch {
          return { success: false, error: "文件不存在" };
        }

        // 根据编码方式读取文件
        const encoding = options?.encoding || "utf8";

        if (encoding === "base64") {
          // base64 模式：异步读取为 Buffer 后编码为 base64 字符串
          const buffer = await fs.promises.readFile(filePath);
          log.info(`[BrowserData] 二进制文件已读取: ${filePath}`);
          return { success: true, content: buffer.toString("base64") };
        } else {
          // utf8 模式：异步读取为文本
          const content = await fs.promises.readFile(filePath, "utf-8");
          log.info(`[BrowserData] 文本文件已读取: ${filePath}`);
          return { success: true, content };
        }
      } catch (error: any) {
        log.error("[BrowserData] 读取文件失败:", error);
        return { success: false, error: error.message || "读取文件失败" };
      }
    },
  );

  // 获取 Cookie
  ipcMain.handle("browser:get-cookies", async (event, filter) => {
    try {
      const sender = event.sender;
      const cookies = await sender.session.cookies.get(filter || {});
      log.info(`[BrowserCookie] 获取到 ${cookies.length} 个 cookie`);
      return { success: true, cookies };
    } catch (error: any) {
      log.error("[BrowserCookie] 获取 cookie 失败:", error);
      return { success: false, error: error.message || "获取 cookie 失败" };
    }
  });

  // 设置 Cookie
  ipcMain.handle("browser:set-cookie", async (event, cookie) => {
    try {
      const sender = event.sender;
      await sender.session.cookies.set(cookie);
      log.info(`[BrowserCookie] 设置 cookie: ${cookie.name}`);
      return { success: true };
    } catch (error: any) {
      log.error("[BrowserCookie] 设置 cookie 失败:", error);
      return { success: false, error: error.message || "设置 cookie 失败" };
    }
  });

  // 删除 Cookie
  ipcMain.handle("browser:remove-cookie", async (event, { url, name }) => {
    try {
      const sender = event.sender;
      await sender.session.cookies.remove(url, name);
      log.info(`[BrowserCookie] 删除 cookie: ${name}`);
      return { success: true };
    } catch (error: any) {
      log.error("[BrowserCookie] 删除 cookie 失败:", error);
      return { success: false, error: error.message || "删除 cookie 失败" };
    }
  });

  // ==================== 浏览器窗口后台/前台模式控制 ====================

  // 隐藏窗口（后台模式）
  ipcMain.handle("browser:hide-window", async (_, { windowId }) => {
    try {
      windowManager!.hideWindow(windowId);
      return { success: true };
    } catch (error: any) {
      log.error("隐藏窗口失败:", error.message);
      return { success: false, error: error.message };
    }
  });

  // 显示窗口（前台模式）
  ipcMain.handle("browser:show-window", async (_, { windowId }) => {
    try {
      windowManager!.showWindow(windowId);
      return { success: true };
    } catch (error: any) {
      log.error("显示窗口失败:", error.message);
      return { success: false, error: error.message };
    }
  });

  // 切换窗口可见性
  ipcMain.handle(
    "browser:toggle-window-visibility",
    async (_, { windowId }) => {
      try {
        const isVisible = windowManager!.toggleWindowVisibility(windowId);
        return { success: true, isVisible };
      } catch (error: any) {
        log.error("切换窗口可见性失败:", error.message);
        return { success: false, error: error.message };
      }
    },
  );

  // 获取窗口可见性状态
  ipcMain.handle("browser:get-window-visibility", async (_, { windowId }) => {
    try {
      const isVisible = windowManager!.isWindowVisible(windowId);
      return { success: true, isVisible };
    } catch (error: any) {
      log.error("获取窗口可见性失败:", error.message);
      return { success: false, error: error.message };
    }
  });

  // 清空所有浏览器自动化 session 数据（cookie、缓存、localStorage 等）
  ipcMain.handle("browser:clear-all-data", async () => {
    try {
      await windowManager?.clearAllBrowserData();
      return { success: true };
    } catch (error: any) {
      log.error("清除浏览器数据失败:", error.message);
      return { success: false, error: error.message };
    }
  });

  // glob 转正则匹配 URL（* → .*，? → .）
  function matchUrl(pattern: string, url: string): boolean {
    const re =
      "^" +
      pattern
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replace(/\*/g, ".*")
        .replace(/\?/g, ".") +
      "$";
    return new RegExp(re).test(url);
  }

  // 解析 @match / @exclude 头
  function parseUserscriptHeader(code: string): {
    include: string[];
    exclude: string[];
  } {
    const result = { include: ["**"] as string[], exclude: [] as string[] };
    const headerMatch = code.match(
      /\/\/ ==UserScript==\n([\s\S]*?)\/\/ ==\/UserScript==/,
    );
    if (!headerMatch) return result;
    const header = headerMatch[1];
    const matches = header.matchAll(/\/\/ @(match|include|exclude)\s+(\S+)/g);
    let hasMatch = false;
    const include: string[] = [];
    for (const [, key, pattern] of matches) {
      if (key === "exclude") result.exclude.push(pattern);
      else {
        include.push(pattern);
        hasMatch = true;
      }
    }
    if (hasMatch) result.include = include;
    return result;
  }

  // 获取用户脚本（preload 读取 .browser-work/scripts/*.js 用，带 URL 匹配过滤）
  ipcMain.handle(
    "browser:get-user-scripts",
    async (event, currentUrl: string) => {
      try {
        const senderId = (event.sender as any).id;
        const windowId = windowManager!.getWindowIdByWebContentsId(senderId);
        if (!windowId) {
          log.warn("[UserScripts] no windowId for sender " + senderId);
          return { success: true, scripts: [] };
        }
        const metadata = windowManager!.getWindowMetadata(windowId);
        const sessionPath = metadata?.sessionPath as string | undefined;
        if (!sessionPath) {
          log.warn("[UserScripts] no sessionPath for window " + windowId);
          return { success: true, scripts: [] };
        }
        const scriptsDir = path.join(sessionPath, ".browser-work", "scripts");
        log.info(
          "[UserScripts] scanning: " + scriptsDir + " for URL: " + currentUrl,
        );
        if (!fs.existsSync(scriptsDir)) {
          log.warn("[UserScripts] dir not found: " + scriptsDir);
          return { success: true, scripts: [] };
        }
        const files = (await fs.promises.readdir(scriptsDir)).filter((f) =>
          f.endsWith(".js"),
        );
        log.info("[UserScripts] found files: " + JSON.stringify(files));
        const scripts = [];
        for (const f of files) {
          const code = await fs.promises.readFile(
            path.join(scriptsDir, f),
            "utf-8",
          );
          const { include, exclude } = parseUserscriptHeader(code);
          const matchesUrl = exclude.some((p) => matchUrl(p, currentUrl))
            ? false
            : include.some((p) => matchUrl(p, currentUrl));
          if (matchesUrl) scripts.push({ id: f, code, matchesUrl });
        }
        return { success: true, scripts };
      } catch (error: any) {
        log.error("获取用户脚本失败:", error.message);
        return { success: true, scripts: [] };
      }
    },
  );
}

// 后端启动 Promise（供 IPC 和 Browser Bridge 等待）
let backendReadyPromise: Promise<void> | null = null;

app.whenReady().then(async () => {
  try {
    log.info("Application starting...");
    setupIpcHandlers();

    // 立即创建窗口，不用等后端启动
    createWindow();

    // 创建系统托盘图标
    createTray();

    // 创建托盘悬浮小窗
    createFloatWindow();

    // 启动后端服务（不阻塞窗口）
    log.info("Starting backend service in background...");

    // 先启动 Bridge Server，后端启动时需要连接
    const bridgePipePath = generatePipePath();
    const bridgeToken = generateBridgeToken();
    bridgeServer = new BridgeServer(bridgePipePath, bridgeToken);
    await bridgeServer.start();

    // 将 Bridge 路径和 token 通过环境变量传递给后端
    process.env.GUADA_BRIDGE_PATH = bridgePipePath;
    process.env.GUADA_BRIDGE_TOKEN = bridgeToken;

    // backendReadyPromise 在 startBackend 完成后 resolve（无论成功失败），供 IPC 和 Browser Bridge 使用
    backendReadyPromise = startBackend()
      .then(() => {
        log.info("Backend service started successfully");
        isBackendReady = true;
      })
      .catch((error) => {
        log.error("Backend service failed to start:", error);
        isBackendReady = true; // 让 UI 正常显示，错误由前端自行处理
      });

    // 窗口创建后，初始化 Browser Bridge（等后端就绪后再初始化）
    await backendReadyPromise;

    // 注册浏览器自动化服务为 Bridge 默认 handler
    if (windowManager && bridgeServer) {
      automationService = new BrowserAutomationService();
      automationService.initializeWindowManager(windowManager);
      bridgeServer.registerDefaultHandler(async (params: any, method: string) => {
        return automationService!.handleToolCall({ id: "0", method, params });
      });

      browserBridgeInitialized = true;
      log.info("Browser automation registered with Bridge Server");
    } else {
      log.error("WindowManager not available, cannot initialize browser automation");
    }

    log.info("Application initialized");
  } catch (error: any) {
    log.error("Application initialization failed:", error);
    app.quit();
  }
});

// 所有窗口关闭时
app.on("window-all-closed", () => {
  // 停止后端服务
  if (backendProcess) {
    console.log("Stopping backend service...");
    isBackendStopping = true;
    if (process.platform === "win32") {
      // Windows: 使用 taskkill 命令终止进程树
      const { exec } = require("child_process");
      exec(
        `taskkill /pid ${backendProcess.pid} /T /F`,
        (error: any, stdout: string, stderr: string) => {
          if (error) {
            console.error("Failed to kill backend process:", error.message);
          } else {
            console.log("Backend process terminated successfully");
          }
        },
      );
    } else {
      // Unix-like systems: 发送 SIGTERM 信号
      backendProcess.kill("SIGTERM");

      // 设置超时强制关闭
      setTimeout(() => {
        if (!backendProcess?.killed) {
          console.log("Force killing backend process...");
          backendProcess?.kill("SIGKILL");
        }
      }, 3000);
    }

    backendProcess = null;
  }

  if (process.platform !== "darwin") {
    app.quit();
  }
});

// macOS 激活应用
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// 应用退出前清理
let isCleaningUp = false;
app.on("before-quit", async (event) => {
  (app as AppExtended).isQuiting = true;

  if (isCleaningUp) return;
  isCleaningUp = true;
  event.preventDefault();

  // 0. 显示退出画面，浏览器导航会断开前端 keep-alive HTTP 连接
  if (mainWindow && !mainWindow.isDestroyed()) {
    const shutdownHtml = `<html><body style="margin:0;display:flex;align-items:center;justify-content:center;height:100vh;background:#1a1a2e;color:#e0e0e0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;flex-direction:column"><div style="width:40px;height:40px;border:3px solid rgba(255,255,255,0.1);border-top-color:#4a9eff;border-radius:50%;animation:spin 0.8s linear infinite;margin-bottom:20px"></div><p>正在退出...</p></div><style>@keyframes spin{to{transform:rotate(360deg)}}</style></body></html>`;
    mainWindow.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(shutdownHtml)}`,
    );

    // 等待导航完成，确保前端 HTTP 连接全部断开
    await new Promise<void>((resolve) => {
      mainWindow!.webContents.once("did-finish-load", resolve);
      setTimeout(resolve, 1500); // 兜底
    });
  }

  // 1. 通过 Bridge 发送优雅关闭信号，等待后端自行退出
  if (bridgeServer && backendProcess && !backendProcess.killed) {
    isBackendStopping = true;
    console.log("Sending graceful shutdown to backend...");
    bridgeServer.broadcast("shutdown", {});

    // 等待后端优雅退出（最多 5 秒）
    let backendExited = false;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 5000);
      backendProcess?.once("exit", (code) => {
        clearTimeout(timer);
        backendExited = true;
        console.log(`Backend exited with code ${code}`);
        resolve();
      });
    });

    // 如果后端仍未退出，强制终止
    if (!backendExited && backendProcess && !backendProcess.killed) {
      console.log("Backend did not exit gracefully, force killing...");
      if (process.platform === "win32") {
        const { execSync } = require("child_process");
        try {
          execSync(`taskkill /pid ${backendProcess.pid} /T /F`, {
            stdio: "ignore",
          });
        } catch (error) {
          console.error("Failed to kill backend process:", error);
        }
      } else {
        backendProcess.kill("SIGKILL");
      }
    }
    backendProcess = null;
  }

  // 2. 停止 Bridge Server
  if (bridgeServer) {
    await bridgeServer.stop();
    bridgeServer = null;
  }

  // 3. 清理浏览器自动化服务
  if (automationService) {
    await automationService.destroy();
    automationService = null;
  }

  // 继续退出流程
  app.quit();
});
