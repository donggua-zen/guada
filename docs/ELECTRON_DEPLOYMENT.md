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
pnpm install
```

### 3. 初始化数据库

```bash
cd backend-ts
pnpm run db:seed:force
```

这会创建默认管理员账户：
- 用户名：`guada`
- 密码：`guada`

### 4. 开发模式运行

```bash
# 在项目根目录执行
pnpm run dev:electron
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
  // 旧的全局向量库路径，现已退役；仍在传入只为让启动迁移能把老数据搬进各库的 kb.db
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
pnpm run build:electron
```

> macOS 构建请使用 `pnpm run build:electron:mac`（等价命令，显式指定 `electron-builder --mac`）。
>
> **⚠️ macOS 包只能在 macOS 上构建。** 在 Windows 上构建 mac 目标是 electron-builder 的
> 硬性拒绝（报错原文 `Build for macOS is supported only on macOS`），不是配置能绕过的：
> dmg 依赖 `hdiutil`、签名依赖 `codesign`，都是 macOS 专有工具，原生模块也必须按 darwin
> 架构重建。所以 Windows 开发机出不了 mac 包，**推荐用 CI 出包**：
> `.github/workflows/release-macos.yml` 会在推送 `v*` tag 时自动构建 arm64 与 x64 两个 dmg
> （GitHub 托管 runner，公开仓库免费）。手工出包则需在一台 mac 上执行上面的命令。

构建过程包括：
1. 构建后端（TypeScript → JavaScript）
2. 构建前端（Vue → 静态文件）
3. 打包 Electron 应用
4. 重新编译原生模块（better-sqlite3 等）
5. 按目标平台裁剪原生二进制（见下文「平台二进制裁剪」）

**构建时间**：首次构建约 10-30 分钟（取决于机器性能）

### 2.1 平台二进制裁剪

后端依赖中包含大量按平台分发的预编译二进制（sharp / sqlite-vec / @node-rs/jieba /
@parcel/watcher / Prisma 引擎）。构建时**只保留目标平台的二进制**，避免打包体积膨胀：

- 目标平台由 `TARGET_PLATFORMS`（或兼容的 `SHARP_TARGET_PLATFORMS`）控制，
  默认取当前构建平台；多值用逗号分隔，如 `TARGET_PLATFORMS=darwin-x64,darwin-arm64`
- 平台包清单集中在 `scripts/platform-manifest.js`，新增平台包时在此登记
- 裁剪发生在 `scripts/optimize-electron-deps.js`（Step 5.2），
  原生模块重建由跨平台的 `scripts/rebuild-native-electron.js`（基于 @electron/rebuild）执行
- `pnpm run build:electron:backend` 会自动按当前平台选择目标，无需手工传参

常用脚本：

```bash
pnpm run optimize:electron-deps:mac      # 单独执行 macOS 依赖裁剪
pnpm run optimize:electron-deps:linux    # 单独执行 Linux 依赖裁剪
pnpm run build:electron:mac              # macOS 完整构建（.app + dmg）
pnpm run build:electron:dir              # 只生成未打包目录（本地验证最快）
```

> 注意：**产物架构由构建机架构决定**（`mac.target` 已不再写死 `arch` 列表）。原生模块只按
> 当前架构准备，所以在 arm64 机器上构建 x64 包会得到一个「app 是 x64、原生模块是 arm64」的
> 坏包 —— 1.0.1 发布时正是踩到这个：配置里的架构列表压过了命令行的 `--arm64`，一个 job
> 同时产出两个 dmg，其中另一个架构的包模块不匹配（`verify:asar` 的运行期烟测当场报
> `Could not load the "sharp" module using the darwin-x64 runtime`）。
> 多架构产物请由 CI 分 Job、**在各自架构的机器上**构建（见 4.5）。

### 2.2 后端依赖打进 app.asar（决定安装耗时的是文件数，不是包体）

**实测结论：安装耗时 ≈ 盘上文件数 × 18ms，与包体字节数几乎无关。** 同一台机器上三个
electron-builder + NSIS 应用（用 NTFS birth time 量的安装窗口）：

| 应用 | 盘上文件数 | 安装后体积 | 安装耗时 | 每文件 |
|---|---|---|---|---|
| ZCode 3.15.1 | 1,108 | 769 MB | 16.4 s | 15 ms |
| WorkBuddy 5.7.7 | 5,466 | 1.26 GB | ~110 s | 17 ms |
| GuaDa（改造前） | 17,211 | 767 MB | 347 s | 20 ms |

参照项目的做法是**把 JS 依赖全部打进 `app.asar`**（ZCode 的 asar 有 31,027 个条目、
盘上只有 1,112 个文件），我们此前把 1.5 万个 node_modules 文件以 `extraResources`
原样铺在磁盘上——字节数一样，安装时间差 20 倍。现在改为同样的做法：

- `build.files` 增加 `{ from: "backend-ts/node_modules_production/node_modules",
  to: "backend-ts/node_modules" }`，依赖进入 `app.asar`
- `backend-ts/dist` / `static` / `bundled-*` **仍是真实目录**（不改 `process.chdir`
  与 `process.cwd()` 定位 bundled-* 的语义）
- 原生模块经 `build.asarUnpack` 解包到 `app.asar.unpacked/`，盘上约 300–400 个文件

改造后盘上文件数约 1,700（asar 1 个 + dist/static/bundled-* + 解包的原生文件），
安装耗时应降到 30 s 级。安装包体积基本不变（asar 变大、压缩后总量相当）。

#### 四处不能改坏的约束

1. **入口仍是真实路径** → 后端由 `dist/main.js`（真实目录）启动，Node 从它出发的
   `node_modules` 向上查找**永远走不到 asar 内**。主进程用 `NODE_PATH` 指路
   （`electron/main.ts` 的 `getBackendNodeModulesPath`）。`ELECTRON_RUN_AS_NODE` 下
   asar 的 fs / 模块解析补丁是有效的（已实测）。
2. **`includeSubNodeModules: true` 必须保留**：pnpm hoisted 布局下仍有 20+ 个嵌套
   `node_modules`，electron-builder 的 walker 默认会**静默丢弃**它们（约 700 个文件）。
3. **`asarUnpack` 的 glob 按【源路径】书写**：electron-builder 用 appDir 相对路径匹配
   （`backend-ts/node_modules_production/node_modules/...`），**不是** `to` 路径。
   且 24.13.3 的 smartUnpack 只对 `.dll/.exe` 触发，`.node` 必须显式列出。
4. **sqlite-vec 的路径必须重写**：SQLite 的 `loadExtension` 走原生 `LoadLibrary`，
   不经过 Electron 的 dlopen 重定向，asar 虚拟路径必然加载失败（`no such module: vec0`）。
   统一走 `backend-ts/src/common/utils/asar-path.util.ts` 的 `loadSqliteVec()`
   （内部把 `app.asar` 段换成 `app.asar.unpacked`）。**不要改回 `sqliteVec.load(db)`。**

#### 校验（改完必须跑）

```bash
pnpm run build:electron:dir      # 或完整构建
pnpm run verify:asar             # 静态布局 + 运行期烟测（require 原生模块 + 真建 vec0 表）
```

`scripts/verify-asar-layout.js` 会检查：真实 `backend-ts/node_modules` 已消失、
asar 内含入口包、嵌套 node_modules 没丢、`asarUnpack` 列的每个包的原生文件都已解包、
源目录里应打包的文件一个不少、`@parcel/watcher` 补丁二进制 md5 一致，并以
`ELECTRON_RUN_AS_NODE + NODE_PATH` 起打包后的 Electron 逐个 require 原生依赖。
安装期回归在构建期是看不见的（要等用户装完点开），所以这一步不能省。

### 3. 构建产物

构建完成后，安装包位于 `release/` 目录。本项目未覆盖 `artifactName`，以下为 electron-builder
的默认命名（`<版本>` 取自 `package.json`）：

```
release/
├── GuaDa Setup 1.0.0.exe             # Windows 安装程序
├── GuaDa-1.0.0-arm64.dmg             # macOS 安装包（Apple Silicon）
├── GuaDa-1.0.0-x64.dmg               # macOS 安装包（Intel）
├── GuaDa-1.0.0.AppImage              # Linux AppImage
└── latest.yml                        # 更新元数据（随构建生成）
```

> dmg 的产物名**恒带架构后缀**，所以一次构建只产出目标架构的那一个；两个架构要分别构建
> （见 2.1 与 4.5）。

### 4. macOS 安装与签名

macOS 的 Gatekeeper 会拦截所有**未签名且未公证**的应用，而目前分发的 dmg 正属于这一类：
没有 Apple Developer 账号时，electron-builder 会跳过签名，并在构建日志里打印
`skipped macOS application code signing`。用户首次安装需要手动放行一次。

#### 4.1 安装步骤（用户侧）

1. 打开 dmg，把 **GuaDa** 拖进「应用程序」
2. 清除隔离属性（关键步骤，否则系统会以「来源不明」为由拦截）：

   ```bash
   xattr -cr /Applications/GuaDa.app
   ```

3. 正常双击打开

> 右键 →「打开」→「仍要打开」也能过，但只对当次有效，且部分系统版本上不出现「仍要打开」
> 入口。`xattr -cr` 一次到位，是推荐做法。

#### 4.2 如果提示「已损坏，无法打开」

Apple Silicon 上未签名的应用常报这个错 —— **不是文件真的损坏**，是 Gatekeeper 对
「无签名 + 有隔离属性」组合给出的误导性提示。执行完 4.1 的 `xattr -cr` 后若仍然报，
补一次 **ad-hoc 签名**（本机自签，不需要任何证书）：

```bash
codesign --force --deep --sign - /Applications/GuaDa.app
```

再打开即可。`--deep` 会连同 `Contents/Frameworks` 下的 Electron 组件一起重签。

#### 4.3 正式签名与公证（可选，当前未启用）

要让用户**双击即开、零步骤**，需要 Apple Developer 账号（$99/年）并走完整链路：
先用 `Developer ID Application` 证书签名（electron-builder 的 `mac.identity`），再提交
Apple 公证（notarization）并 stapling。两步都能放进 CI（证书与 Apple ID 凭据存 GitHub
Secrets）。当前未启用，因此对外分发的 mac 包都需要用户执行 4.1 / 4.2 的放行步骤。

#### 4.3.1 本地网络权限：打包版 ping 不通局域网（免费自签名即可解决）

macOS 的「本地网络」权限（系统设置 → 隐私与安全性 → 本地网络）按 **app 的代码签名身份** 记录授权，
并且按 **权限主体**（responsible process）判定，所以会出现「同一份 app 表现不同」：

- 从终端启动（`/Applications/GuaDa.app/Contents/MacOS/GuaDa`）时权限主体是终端，继承终端的授权
  → 终端里 `ping 192.168.3.245` 正常；
- 正常启动（Finder/Dock/`open`）时权限主体是 app 自己 → **未签名 / ad-hoc 包拿不到授权**，系统连
  询问都不弹，直接静默拦截局域网（`ping: sendto: No route to host`），而外网不受影响。

`mac.extendInfo.NSLocalNetworkUsageDescription` 已加（没有它系统连询问都不会弹），但**光有声明不够**：
没有稳定签名身份时授权落不到实处。已验证的免费解法是**自签名证书**（不需要 Apple 账号，$99 那套只在
"双击即开"时才需要）：

```bash
# 1) 生成自签名代码签名证书。OpenSSL 3 必须用 -legacy 导出 p12，
#    否则 macOS 的 security import 会报 "MAC verification failed during PKCS12 import"
openssl req -x509 -newkey rsa:2048 -keyout guada-sign.key -out guada-sign.crt -days 3650 -nodes \
  -subj "/CN=GuaDa Local Sign/O=GuaDa" -addext "keyUsage=digitalSignature" \
  -addext "extendedKeyUsage=codeSigning" -addext "basicConstraints=critical,CA:FALSE"
openssl pkcs12 -export -legacy -inkey guada-sign.key -in guada-sign.crt -out guada-sign.p12 \
  -passout pass:<密码> -name "GuaDa Local Sign"
base64 -i guada-sign.p12 | tr -d '\n' > guada-sign.p12.base64

# 2) 本地打包时签名（electron-builder 原生读这两个变量，无需改配置）
CSC_LINK="$(cat guada-sign.p12.base64)" CSC_KEY_PASSWORD=<密码> \
  npx electron-builder --mac --arm64 --publish never

# 3) CI：secret MAC_CSC_LINK = guada-sign.p12.base64 的内容，MAC_CSC_KEY_PASSWORD = 密码；
#    .github/workflows/release.yml 的打包步骤已读取它们（secret 缺失时照旧出未签名包）
```

三条注意：

- **证书要长期保存并复用**：TCC 按签名身份记授权，换证书 = 换身份 = 用户需重新授权一次。
- 自签名 ≠ 公证：用户首次打开仍需 4.1 / 4.2 的放行步骤（与未签名包一致，不会更差）。
- 验证：正常启动 app 后在终端里 `ping <局域网设备>`；`codesign -dv --verbose=2 GuaDa.app` 看
  `Authority=` 是否为该证书名。

#### 4.4 沙盒二进制的分发现状

**Windows 版已移除沙盒功能**（刻意取舍，不是缺口）：不再随包提供 `sandbox.exe`，
`build.win.extraResources` 为空。打包版 Windows 上 `resolveSandboxBin` 找不到二进制，
`shell.plugin.ts` 是 fail-closed —— 用户在会话里开沙盒档位时 shell 工具会明确报错拒绝执行，
**不会静默降级成无沙盒运行**。

**macOS 版按架构分发**：`mac.extraResources` 目前只打包 `sandbox/sandbox-macos-arm64`，
而运行时按 `sandbox-macos-${process.arch}` 查找（`backend-ts/src/modules/shell/process-manager.service.ts`
的 `resolveSandboxBin`）。CI 现在只出 arm64，所以两者一致；**若将来要出 Intel 版**，
需要先补一个 `sandbox/sandbox-macos-x64` 并加进 `mac.extraResources`
（该二进制如何构建尚未写进 `sandbox/README.md`），否则 x64 包的沙盒同样不可用（fail-closed）。

#### 4.5 构建方式选择

| 方式 | 适用 | 说明 |
|------|------|------|
| CI（推荐） | 正式发版 | 推 `v*` tag 触发 `.github/workflows/release.yml`：**macOS arm64**（`macos-latest`）与 **Windows x64**（`windows-latest`）两个 job 各自构建（同一套链路 + 同一道 `verify:asar` 闸门），产物上传为 Actions artifact 并附到同名 GitHub Release；随后 `publish-mirrors` 在 Gitee / GitCode 建同名 release |
| 本机 mac | 调试、临时验证 | `pnpm run build:electron:mac`，产物架构 = 本机架构。要出另一架构需同时指定 `TARGET_ARCH` 与 electron-builder 的 `--x64`/`--arm64`（见 2.1） |
| 本机 Windows | 调试、临时验证 | `pnpm run build:electron`，产物为 nsis 安装包 |

> CI 目前只出 macOS arm64（**Intel 版暂时不做**）与 Windows x64。
>
> **完整发版流程**（以 1.0.2 为例）：
> 1. 升版本号（`package.json` + `backend-ts/package.json`）→ 提交 `chore: bump version to X`
> 2. 打 tag `vX` 并推三个远端 → CI 出 mac/Windows 两个包、建 GitHub Release、在 Gitee/GitCode 建同名 release
> 3. **在国内机器**执行 `node scripts/upload-gitcode-release.mjs vX` —— 把安装包补到 GitCode 发行版
>
> 为什么第 3 步不在 CI 里做：实测 GitHub 的海外 runner 传到 `file.gitcode.com` 只有约 60KB/s，
> 235MB 的 dmg 传满 60 分钟都没完成（`curl exit 28`）；国内上传约 7.5MB/s，两个包不到一分钟。
> 脚本会自动从 GitHub 下载缺的包、先删同名旧附件再上传（可重复执行），token 取
> `GITCODE_TOKEN` 或 git 凭据（`host=gitcode.com`）。
>
> 镜像平台说明：
> - **GitCode**：CI 建 release + 写说明，安装包由上面第 3 步补
> - **Gitee**：**只发 release、不传二进制** —— 单附件上限 100M（官方文档），安装包 200M+ 放不进去
>
> 两者正文都会列出 GitHub 的下载地址。需要在 GitHub 仓库里配置 `GITEE_TOKEN` / `GITCODE_TOKEN`
> 两个 Secret（**token 必须来自对该仓库有写权限的账号**，否则 403），未配置时自动跳过。
>
> **这套流程与踩坑目录已固化成技能**（**本地技能，不入库**）：`.agents/skills/guada-release/`
> —— `SKILL.md`（发版三步 + 验证清单）、`references/pitfalls.md`（15 类症状 → 真因 → 修法）、
> `references/platforms.md`（三平台能力/限额/API）、`scripts/check-undeclared-deps.mjs`（发版预检）。
> `.agents/` 已在 `.gitignore` 里（AI 工具元信息不入库）；本机有这份技能时，
> 发版前先跑预检脚本、遇到流水线报错先查 pitfalls。

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
pnpm run rebuild:electron

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

### 检查更新（已实现）

「设置 → 关于 → 检查更新」会请求自建接口（实现见 `electron/main.ts` 的 `doCheckForUpdates`）：

```
https://ai.dingd.cn/api/check_update?version=<当前版本>&platform=<win|mac|linux>
```

接口返回 `hasUpdate` 及 `downloadUrl` / `releaseNotes` 等字段，界面据此显示「有新版本」并
给出下载按钮 —— 点击后用系统浏览器打开 `downloadUrl`。**没有自动下载，也没有静默安装**，
项目未使用 electron-updater。

> 该接口由本仓库之外的服务提供，因此**发布新版本时除了产出安装包，还要同步更新它的数据**
> （新版本号与下载地址），否则应用内的「检查更新」查不到新版本。这一步目前是手工的。

### 自动更新（未实现）

electron-builder 的 `publish` 配置（GitHub + 自建 generic 源）目前不参与实际分发：应用内没有
electron-updater，`publish.owner` 也仍是占位符 `your-username`。若要启用自动更新，需要先补齐
这两处。

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

```jsonc
{
  "scripts": {
    // 完整构建（顶层入口）
    "build:electron": "完整构建（当前平台，Windows 出 nsis）",
    "build:electron:mac": "完整构建（macOS，出 dmg）",
    "build:electron:dir": "只生成未打包目录，本地验证最快",

    // 完整构建的三个阶段（一般不用单独跑）
    "build:electron:pre": "清理 release/ + 编译 Electron 主进程 TS",
    "build:electron:backend": "后端编译 + 依赖裁剪 + 原生模块重建（按当前平台）",
    "build:electron:frontend": "前端构建（ELECTRON=true）",
    "build:electron:package": "electron-builder 打包（Windows nsis）",
    "build:electron:package:mac": "electron-builder 打包（macOS dmg）",

    // 单独执行
    "optimize:electron-deps": "按当前平台裁剪后端原生二进制",
    "optimize:electron-deps:mac": "按 macOS 裁剪",
    "rebuild:backend-native:electron": "只为 Electron ABI 重建原生模块"
  }
}
```

> 注意 `build:electron:package:mac` 等价于 `electron-builder --mac`，**不带架构参数**；而
> `mac.target` 同时声明了 x64 与 arm64，所以它会在当前机器架构上构建。要指定架构请直接调用
> `npx electron-builder --mac --arm64`（或 `--x64`）。

### 构建流程

1. **清理**：删除 `release/` 下的旧产物
2. **主进程编译**：`cd electron && tsc`
3. **后端构建**：`nest build` → 按目标平台裁剪原生二进制 → 为 Electron ABI 重建原生模块
4. **前端构建**：`cd frontend && pnpm run build`（`ELECTRON=true`）
5. **Electron 打包**：electron-builder 生成 .app/dmg 或 nsis 安装包
6. **签名**：Windows 未签名；macOS 未签名，安装放行步骤见第 4 章

---

**最后更新**: 2026-10-13
