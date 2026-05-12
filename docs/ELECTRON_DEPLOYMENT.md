# GuaDa AI Electron 版本部署指南

本文档提供 GuaDa AI Electron 桌面应用的完整构建、打包和分发指南。

---

## 一、环境要求

### 系统要求

| 平台 | 最低配置 | 推荐配置 |
|------|---------|---------|
| **Windows** | Windows 10 (64-bit) | Windows 11 |
| **macOS** | macOS 10.15+ | macOS 12+ |
| **Linux** | Ubuntu 20.04+ / CentOS 8+ | Ubuntu 22.04 LTS |

### 开发环境要求

- **Node.js**: ≥ 18.x（推荐 20.x LTS）
- **npm**: ≥ 9.x
- **Python**: 3.x（用于编译原生模块）
- **Visual Studio Build Tools**（Windows）: C++ 构建工具
- **Xcode Command Line Tools**（macOS）

---

## 二、快速开始

### 1. 克隆项目

```bash
git clone <repository-url> guada-ai
cd guada-ai
```

### 2. 安装依赖

```bash
# 安装所有依赖（包括后端和前端）
npm install
```

### 3. 初始化数据库

```bash
cd backend-ts
npm run db:seed:force
```

这会创建默认管理员账户：
- 用户名：`guada`
- 密码：`guada`

### 4. 开发模式运行

```bash
# 在项目根目录执行
npm run dev:electron
```

这将同时启动：
- 后端服务（NestJS）
- 前端界面（Vite）
- Electron 主进程

---

## 三、生产构建

### 1. 配置环境变量

Electron 应用的环境变量在 `electron/main.ts` 中动态设置，无需修改 `.env` 文件。

**关键配置位置**：`electron/main.ts` 第 340-357 行

```typescript
env: {
  ...process.env,
  NODE_ENV: 'production',
  ELECTRON_RUN_AS_NODE: '1',
  PORT: backendPort.toString(),
  BASE_URL: '__auto__',  // 自动检测端口
  DATABASE_URL: `file:${dbPath}`,
  VECTOR_DB_PATH: vectorDbPath,
  STATIC_DIR: staticDir,
  UPLOAD_ROOT_DIR: uploadDir,
  UPLOAD_URL_PREFIX: '/uploads',
  SETTINGS_DIR: userDataPath,
  LOGS_DIR: logsDir,
  SKILLS_DIR: skillsDir,
  WORKSPACE_BASE_DIR: workspaceDir,
  ELECTRON_APP: 'true',
  BROWSER_BRIDGE_MODE: 'ipc',
}
```

**如需修改配置**，编辑上述文件中的对应值。

### 2. 构建应用

```bash
# 在项目根目录执行
npm run build:electron
```

构建过程包括：
1. 构建后端（TypeScript → JavaScript）
2. 构建前端（Vue → 静态文件）
3. 打包 Electron 应用
4. 重新编译原生模块（better-sqlite3 等）

**构建时间**：首次构建约 10-30 分钟（取决于机器性能）

### 3. 构建产物

构建完成后，安装包位于 `release/` 目录：

```
release/
├── GuaDa-AI-Setup-1.0.0.exe          # Windows 安装程序
├── GuaDa-AI-1.0.0.dmg                # macOS 安装包
├── GuaDa-AI-1.0.0.AppImage           # Linux AppImage
└── ...
```

---

## 四、数据持久化

### Electron 数据存储位置

Electron 应用的数据存储在用户数据目录中，不同平台路径如下：

#### Windows
```
C:\Users\<用户名>\AppData\Roaming\GuaDa\
├── ai_chat.db              # SQLite 数据库
├── vector_db.sqlite        # 向量数据库
├── uploads/                # 上传文件
│   ├── avatars/
│   ├── documents/
│   └── ...
├── settings.json           # 应用设置
├── logs/                   # 日志文件
├── skills/                 # 技能插件
└── workspace/              # 会话工作区
```

#### macOS
```
~/Library/Application Support/GuaDa/
├── ai_chat.db
├── vector_db.sqlite
├── uploads/
├── settings.json
├── logs/
├── skills/
└── workspace/
```

#### Linux
```
~/.config/GuaDa/
├── ai_chat.db
├── vector_db.sqlite
├── uploads/
├── settings.json
├── logs/
├── skills/
└── workspace/
```

### 备份与迁移

**备份数据**：
```bash
# Windows PowerShell
Copy-Item "$env:APPDATA\GuaDa" "D:\Backup\GuaDa-Backup-$(Get-Date -Format 'yyyyMMdd')"

# macOS/Linux
cp -r ~/Library/Application\ Support/GuaDa ~/Desktop/GuaDa-Backup-$(date +%Y%m%d)
```

**迁移数据**：
将备份文件夹复制到新设备的相同位置即可。

---

## 五、高级配置

### 1. 自定义端口

默认情况下，Electron 会自动分配可用端口。如需固定端口：

编辑 `electron/main.ts`，找到端口分配逻辑：

```typescript
// 查找可用的端口
const backendPort = await getAvailablePort(3000);
```

修改为固定端口：
```typescript
const backendPort = 3000;  // 固定使用 3000 端口
```

### 2. 自定义数据目录

默认数据存储在用户数据区。如需自定义：

编辑 `electron/main.ts`：

```typescript
const userDataPath = app.getPath('userData');
```

修改为自定义路径：
```typescript
const userDataPath = 'D:\\GuaDa-Data';  // Windows
// 或
const userDataPath = '/opt/guada-data';  // Linux
```

### 3. 启用/禁用功能

通过修改 `electron/main.ts` 中的环境变量来控制功能：

```typescript
// 禁用浏览器自动化
BROWSER_BRIDGE_MODE: 'disabled',

// 启用调试模式
NODE_ENV: 'development',
```

---

## 六、故障排查

### 1. 构建失败：原生模块编译错误

**症状**：
```
Error: better-sqlite3.node was compiled against a different Node.js version
```

**解决方案**：

```bash
# 清理并重新构建
npm run rebuild:electron

# 或手动重建
cd backend-ts
npm rebuild better-sqlite3
```

### 2. 启动失败：数据库锁定

**症状**：
```
SqliteError: database is locked
```

**解决方案**：

1. 确保没有其他 GuaDa 实例在运行
2. 删除锁文件：
   ```bash
   # Windows
   Remove-Item "$env:APPDATA\GuaDa\ai_chat.db-shm"
   Remove-Item "$env:APPDATA\GuaDa\ai_chat.db-wal"
   
   # macOS/Linux
   rm ~/Library/Application\ Support/GuaDa/ai_chat.db-shm
   rm ~/Library/Application\ Support/GuaDa/ai_chat.db-wal
   ```

### 3. 白屏或无法加载

**症状**：
- Electron 窗口打开但显示白屏
- 控制台显示资源加载失败

**解决方案**：

1. 检查后端是否正常启动：
   ```bash
   # 查看 Electron 控制台输出
   # 应该看到 "Application is running on: http://localhost:XXXX"
   ```

2. 清除缓存并重启：
   ```bash
   # 删除缓存目录
   rm -rf ~/Library/Application\ Support/GuaDa/Cache
   # 或
   rm -rf ~/.config/GuaDa/Cache
   ```

3. 检查防火墙是否阻止了本地连接

### 4. 上传文件失败

**症状**：
- 文件上传时提示权限错误
- 上传后无法访问文件

**解决方案**：

1. 检查上传目录权限：
   ```bash
   # Linux/macOS
   chmod -R 755 ~/Library/Application\ Support/GuaDa/uploads
   ```

2. 确认磁盘空间充足

3. 检查文件大小限制（默认 50MB）

### 5. 内存占用过高

**症状**：
- 应用运行一段时间后内存占用持续增长
- 系统变慢

**解决方案**：

1. 重启应用释放内存
2. 清理旧会话和聊天记录
3. 调整上下文压缩设置（在角色设置中）
4. 限制同时打开的标签页数量

---

## 七、日志查看

### 日志位置

Electron 应用的日志存储在用户数据区的 `logs/` 目录：

```
<GuaDa数据目录>/logs/
├── combined-2026-05-12.log    # 综合日志
├── error-2026-05-12.log       # 错误日志
└── warn-2026-05-12.log        # 警告日志
```

### 查看日志

**Windows**：
```powershell
# 查看最新错误
Get-Content "$env:APPDATA\GuaDa\logs\error-*.log" -Tail 50
```

**macOS/Linux**：
```bash
# 实时查看日志
tail -f ~/Library/Application\ Support/GuaDa/logs/combined-*.log

# 查看错误日志
grep "ERROR" ~/Library/Application\ Support/GuaDa/logs/error-*.log | tail -50
```

### Electron 开发者工具

开发模式下，可以打开开发者工具：

1. 按 `Ctrl+Shift+I`（Windows/Linux）或 `Cmd+Option+I`（macOS）
2. 或在菜单中选择：查看 → 切换开发者工具

---

## 八、更新与升级

### 自动更新（待实现）

未来版本将支持自动更新功能。

### 手动更新

1. **下载新版本**：从发布页面下载最新的安装包
2. **备份数据**：备份用户数据目录（见第四章）
3. **安装新版本**：运行安装程序
4. **恢复数据**：数据通常会自动保留，如有问题可手动恢复

### 数据库迁移

如果新版本包含数据库结构变更：

1. 应用启动时会自动检测并执行迁移
2. 建议在更新前备份数据库
3. 如迁移失败，可查看日志获取详细信息

---

## 九、安全注意事项

### 1. API Key 保护

- API Key 存储在本地数据库中，已加密
- 不要分享数据库文件给他人
- 定期更换 API Key

### 2. 数据隐私

- 所有数据存储在本地，不会上传到云端
- 聊天记录、文件等均保存在用户设备上
- 卸载应用时会保留用户数据，需手动删除

### 3. 网络安全

- Electron 应用仅在本地运行，不暴露网络服务
- 如需远程访问，请使用 Web 版本并配置 HTTPS

---

## 十、常见问题 FAQ

### Q1: Electron 版本和 Web 版本有什么区别？

**A**: 
- **Electron 版本**：桌面应用，数据本地存储，无需配置服务器，适合个人使用
- **Web 版本**：需要部署后端服务器，支持多用户，适合团队协作

### Q2: 可以在多台设备上同步数据吗？

**A**: 
目前不支持自动同步。可以手动备份和恢复数据目录来实现同步。

### Q3: 如何完全卸载应用？

**A**:
1. 使用系统卸载程序卸载应用
2. 手动删除用户数据目录：
   - Windows: `%APPDATA%\GuaDa`
   - macOS: `~/Library/Application Support/GuaDa`
   - Linux: `~/.config/GuaDa`

### Q4: 支持哪些操作系统？

**A**:
- Windows 10/11 (64-bit)
- macOS 10.15+ (Intel 和 Apple Silicon)
- Linux (Ubuntu 20.04+, CentOS 8+, 其他发行版可能需要额外配置)

### Q5: 最小系统要求是什么？

**A**:
- CPU: 双核 2GHz+
- 内存: 4GB RAM（推荐 8GB）
- 磁盘: 500MB 可用空间（不含用户数据）
- 网络: 用于访问 LLM API

---

## 十一、技术支持

### 获取帮助

- **QQ 群**: 1047993501
- **GitHub Issues**: 提交问题报告
- **文档**: 查看 [故障排查指南](TROUBLESHOOTING.md)

### 提交问题报告

请提供以下信息：
1. 操作系统版本
2. Electron 应用版本
3. 错误日志（`logs/` 目录下的文件）
4. 复现步骤
5. 截图或录屏（如有）

---

## 附录：构建脚本说明

### package.json 中的相关脚本

```json
{
  "scripts": {
    "dev:electron": "启动 Electron 开发环境",
    "build:electron": "构建 Electron 生产版本",
    "rebuild:electron": "重新编译原生模块"
  }
}
```

### 构建流程

1. **清理**：删除之前的构建产物
2. **后端构建**：`cd backend-ts && npm run build`
3. **前端构建**：`cd frontend && npm run build`
4. **Electron 打包**：使用 electron-builder 打包
5. **原生模块重建**：针对 Electron ABI 重新编译原生模块
6. **签名**（macOS/Windows）：代码签名
7. **生成安装包**：创建 installer

---

**最后更新**: 2026-05-12
