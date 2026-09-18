# AI Sandbox

![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)
![CI](https://github.com/OWNER/ai-sandbox/actions/workflows/ci.yml/badge.svg)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Linux%20%7C%20macOS-lightgrey.svg)
![C++](https://img.shields.io/badge/C%2B%2B-17-orange.svg)

防止 AI 在执行命令时因幻觉写入/删除工作目录外的文件。基于 OS 原生沙盒机制实现，零注入、零钩子。

## 产品特色

- **轻量级**：单一可执行文件，静态链接运行时，零外部依赖，无需安装任何库、驱动或代理
- **即用即走，无后台服务**：进程启动 → 执行命令 → 退出，无常驻守护进程、无服务安装、无残留状态
- **精准隔离**：仅限制文件写入/删除，读取不受影响——适合"只需隔离文件写操作"的场景（如让 AI 只读系统、只写工作目录）

## 支持平台

| 平台 | 沙盒机制 | 状态 |
|------|---------|------|
| Windows | Restricted Token + ACL | ✅ 已实现 |
| Linux | Landlock LSM | ✅ 已实现 |
| macOS | Seatbelt (sandbox-exec) | ✅ 已实现 |

## 系统要求

| 平台 | 要求 |
|------|------|
| Windows | Vista 及以上（x64） |
| Linux | 内核 ≥ 5.13，Docker ≥ 20.10.21（如在容器内运行） |
| macOS | macOS 10.10+（自带 `/usr/bin/sandbox-exec`）。注意：`sandbox-exec` 自 macOS 10.15 起被 Apple 标记为 deprecated，但当前仍可用 |

无需额外运行时依赖。构建工具：CMake 3.20+、C++17 编译器（MSVC 2022+ / GCC 12+）。

## 构建

### Windows

```bat
build_project.bat
```

或手动：

```bat
cmake -S sandbox -B build -G "NMake Makefiles" -DCMAKE_BUILD_TYPE=Release
cmake --build build --config Release
```

输出：`build\bin\sandbox.exe`

### Linux

```bash
cmake -S sandbox -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build --config Release
```

输出：`build/bin/sandbox`

#### 在 Docker 中编译

```bash
docker build -t sandbox-dev -f sandbox/docker/Dockerfile .
docker run --rm -v "$(pwd):/workspace" sandbox-dev bash -c "cd /workspace && bash build_project.sh"
```

## 使用

### 命令行

```bash
# Windows
sandbox.exe -c "<命令>" --workspace <工作目录路径>

# Linux
sandbox -c "<命令>" --workspace <工作目录路径>
```

### 参数

| 参数 | 说明 |
|------|------|
| `-c`, `--command` | 要执行的命令（必填） |
| `--workspace` | 工作目录路径（必填），多个用逗号分隔 |
| `--shell` | 命令执行器：Windows `powershell`/`cmd`（默认 `powershell`），Linux `sh`/`bash`（默认 `sh`），macOS `sh`/`bash`/`zsh`（默认 `sh`） |
| `--read-only` | 只读模式：工作目录也变为只读 |
| `--version` | 显示版本号并退出 |
| `-h`, `--help` | 显示帮助 |

### 示例

```bash
# 基本用法
sandbox -c "ls" --workspace /project/src

# Python 脚本
sandbox -c "python script.py" --workspace /project

# 多工作目录
sandbox -c "npm install" --workspace /project/src,/project/shared

# 只读模式
sandbox -c "cat config.yml" --workspace /project --read-only

# 指定命令执行器
sandbox -c "Get-ChildItem" --workspace /project                     # Windows 默认即 powershell
sandbox -c "dir" --workspace /project --shell cmd                    # Windows 切换为 cmd
sandbox -c "echo hello" --workspace /project --shell bash            # Linux 切换为 bash
sandbox -c "echo hello" --workspace /project --shell zsh             # macOS 切换为 zsh

# 中文/带空格目录
sandbox -c "echo hello" --workspace "/我的项目/代码"
```

### 行为规则

| 操作 | 工作目录内 | 工作目录外 |
|------|----------|----------|
| 读取 | ✅ | ✅ |
| 写入 | ✅ | ❌ 被拒绝 |
| 删除 | ✅ | ❌ 被拒绝 |
| 创建 | ✅ | ❌ 被拒绝 |
| `--read-only` 模式写入 | ❌ 被拒绝 | ❌ 被拒绝 |

写入被拒绝时，子进程收到操作系统返回的 `ACCESS_DENIED`（Windows）或 `EACCES`（Linux），行为与权限不足时完全一致。

## 透明性保证

- **stdin/stdout/stderr 直通**：无缓存，子进程的输入输出直接传递
- **退出码透传**：子进程无论正常退出还是异常崩溃，都以相同退出码退出
- **错误信息透传**：无权限写入时由系统返回错误码，不额外打印
- **环境变量继承**：子进程自动继承父进程环境变量

## Node.js 集成

```js
const { spawn } = require('child_process');

function sandboxExec(command, workspace) {
  return spawn('sandbox', [
    '-c', command,
    '--workspace', workspace
  ], {
    shell: false,    // 禁用 shell 避免引号被二次解析
    stdio: 'inherit' // 透传 stdin/stdout/stderr
  });
}

const proc = sandboxExec('python train.py', '/project/src');
proc.on('exit', (code) => {
  console.log(`exit code: ${code}`);
});
```

## 原理

详见 [DESIGN.md](DESIGN.md)。

### Windows: Restricted Token + ACL

1. **生成随机 SID**：每次执行生成 `S-1-5-10-{rand}-{rand}-{rand}-{rand}` 格式的唯一标识
2. **授予写权限**：将该 SID 的 `GENERIC_WRITE | GENERIC_EXECUTE` ACE 添加到工作目录的 DACL
3. **创建 Restricted Token**：用 `CreateRestrictedToken` + `WRITE_RESTRICTED` 限制令牌，仅允许写该 SID 有权访问的目录
4. **启动子进程**：用受限令牌执行 `<命令>`（默认 `powershell.exe -NoProfile -NonInteractive -Command`，`--shell cmd` 切换为 `cmd.exe /c`），工作目录内可读写，目录外自动拒绝
5. **清理**：执行完毕后删除 ACE，删除 lock 文件

**心跳与僵尸清理**：后台线程每 10 分钟更新 lock 文件时间戳，每次启动时自动清理超过 30 分钟未更新的残留 ACE。

### Linux: Landlock LSM

1. **创建 Landlock ruleset**：限制所有写操作（`WRITE_FILE`、`REMOVE_FILE`、`MAKE_DIR` 等）
2. **添加允许写入规则**：为每个工作目录添加"允许写入"规则（read-only 模式跳过）
3. **限制自身及子进程**：`prctl(PR_SET_NO_NEW_PRIVS)` + `landlock_restrict_self()`
4. **启动子进程**：`fork()` + `execl("sh", "sh", "-c", ...)`，子进程继承 Landlock 限制
5. **自动清理**：Landlock 限制随进程退出自动失效，无需手动清理

**内核级强制**：限制由内核裁决，无法绕过。进程异常退出时限制自动失效，无残留。

## 设计要点

### 为什么不用低完整性（Low Integrity）？

低完整性级别会阻止大多数读取操作，不符合"工作目录外只读"的需求。Restricted Token + WRITE_RESTRICTED 只限制写操作，读操作不受影响。Linux Landlock 同理——默认仅限制写操作。

### 安全失败

如果运行环境不支持 Landlock（内核 < 5.13 或 Docker seccomp 拦截了 landlock syscall），sandbox 会输出明确的错误信息并退出，**不会静默降级为无保护运行**。

## 注意事项

- Windows: 命令默认通过 `powershell.exe -NoProfile -NonInteractive -Command` 执行，可用 `--shell cmd` 切换为 `cmd.exe /c`；Linux: 命令默认通过 `sh -c` 执行，可用 `--shell bash` 切换为 `bash -c`；macOS: 命令默认通过 `sh -c` 执行，可用 `--shell bash`/`--shell zsh` 切换，经 `/usr/bin/sandbox-exec` 应用 Seatbelt 沙箱
- Windows: 受限令牌的 restricting SID 列表为 `{workspace SID, logon SID, Everyone}`——三者缺一会导致进程无法初始化（`powershell.exe` 报 `0xC0000142`、`where.exe` 一类工具静默失败）。历史上曾把列表收窄为仅 workspace SID（`ee5c242`），默认 shell 改为 powershell 后该回归在默认路径上必现，现已恢复。详见 CHANGELOG
- Windows: 受限令牌启动的 `powershell.exe` 在部分环境（如 GitHub Windows runner）曾出现阻塞，CI 通过 `SANDBOX_TEST_SKIP_DEFAULT_SHELL` 跳过默认 shell 用例；该阻塞是否随上述 restricting SID 修复一并消失，尚待在 runner 上复测
- Windows（已知限制）: Restricted Token 回退后端能否拦截工作目录外的文件删除取决于内核对 `WRITE_RESTRICTED` 的实现——Win11 25H2（build 26200）实测已覆盖 `DELETE`（删除被拦截），更旧的 Windows 构建上可能仍存在缺口；Linux（Landlock）与 macOS（Seatbelt）不受影响。详见 CHANGELOG "Known issues"
- Windows: 24H2+ 默认走 Sandbox API（AppContainer）后端——默认拒绝、每次运行使用唯一 profile 名并即时清理；为保持"目录外只读"语义，各本地盘根会以 `fs_read_only` 声明（网络盘除外）。PowerShell 在该后端下会打印一条 `InitializeDefaultDrives` 失败噪音，不影响行为。设置环境变量 `SANDBOX_FORCE_RESTRICTED_TOKEN=1` 可强制走 Restricted Token 回退后端（用于 24H2+ 机器上的回归测试）
- 工作目录路径不存在时会自动创建
- Windows: `.sandbox/` 目录用于存放 lock 文件（隐藏属性），请勿手动删除
- Linux: 无额外文件，无残留
- 此方案只防止写操作，不限制读操作（如读取系统文件、环境变量等）
- 如在 Docker 容器内运行，需确保 Docker 版本 ≥ 20.10.21（默认 seccomp profile 包含 Landlock syscall）

## License

本项目采用 [Apache-2.0](LICENSE) 许可协议。
