# Windows 命令策略（去沙盒）

> 版本：1.0 | 日期：2026-10-09 | 状态：已实施
> 关联：[安全模式三档方案.md](安全模式三档方案.md)（档位词表）、[交互层统一Ask方案.md](交互层统一Ask方案.md)（审批闭环）

## 1. 为什么 Windows 不再用 OS 沙盒

原先 Windows 走自带 `sandbox.exe`（Restricted Token + 工作区 ACL 授权）。实测与线上反馈的问题：

| 问题 | 表现 |
|---|---|
| 工作区授权失败 | 无权写 DACL 的目录 / 多级不存在目录 / 超长路径 → `ACL setup failed`，命令**完全不能执行**（fail-closed 但对用户等于不可用） |
| junction / 符号链接工作区 | ACE 落在链接自身条目、目标目录没有 ACE → **工作区内写入也被拒** |
| MSYS 工具崩溃 | 受限令牌下 `bash/grep/sed/tail/ls/ssh` 启动即 `NtSetInformationToken(TokenDefaultDacl) 0xC0000022` + `CreateFileMapping Win32 error 5` |
| PowerShell 受限语言模式 | 沙盒自带那层 PS 是 ConstrainedLanguage，`[IO.File]::…`、`Add-Type`、COM 全部不可用 |
| 其它 | `whoami`/WMI 拒绝访问、`%TEMP%`/缓存不可写（npm/pip 类工具失败）、授权失败信息不可读 |

因此 Windows 改为**进程内命令策略层**，Linux/macOS 继续使用 Landlock / Seatbelt 沙盒，行为不变。

## 2. 语义（三档）

| 档位 | 白名单内命令 | 白名单外命令 |
|---|---|---|
| `read-only`（计划模式同此档） | 执行 | **拒绝**（不弹窗；错误里给可操作提示，并让用户切档） |
| `workspace-write`（默认） | 执行 | **审批弹窗**：本次允许 / 本会话内始终允许 / 拒绝 |
| `danger-full-access` | 不判定，全部执行 | — |

- 「本会话内始终允许」记的是**规范化后的命令全文**（折叠空白），内存态、进程重启失效、不跨会话；
  不做前缀记忆（避免"记住 `git push`"顺手放行 `git push --force`）。
- **无人值守 fail-closed**：子代理 / 机器人会话，或前端 SSE 没有在线连接（应用未打开）时，
  需要审批的命令**直接拒绝**，绝不弹窗挂起。
  - 判定实现：`JsonlSessionContext.hasAnswerSurface()` = 「非 bot/sub_agent」且
    （`SessionEventsService.hasConnectedClients()` 为真 **或** 该会话在 `SessionStreamManager`
    有进程内订阅者）。注意前端连接登记在 **SessionEventsService 的用户级 SSE 表**里，
    `SessionStreamManager.subscribers` 只统计进程内消费者，两者互不可见——早期版本误用后者，
    导致正常使用时被判成"无人应答"而全量拒绝（已修）。
  - 残留边界：`hasConnectedClients()` 是**用户级**的（任一台前端在线即为真），无法判断"用户此刻
    是否停在某个具体会话上"。因此"应用开着但停在别的会话"时，审批卡会等到用户切回该会话才被看到
    （与文件写入审批 / 计划审批的既有行为一致：无超时）。
- 这是对 [交互层统一Ask方案.md](交互层统一Ask方案.md)「无超时、不做 fail-closed 自动拒绝」的
  **显式例外**：只在**执行许可**类审批上成立（命令策略 + 工作区外文件写入，均为无人可应答即拒绝）；
  计划审批等协作决策的 ask 语义保持原样。

## 3. 判定算法（`backend-ts/src/common/services/command-policy/`）

```
scan.ts              引号感知的顶层切分 + 记号化；把"写重定向"与"不可核验构造"分开记录
flag-eval.ts         参数级核验（已知安全开关 / 明确危险开关 / 未知开关降级）
posix-rules.ts       Git Bash 侧只读白名单（命令、git 子命令、Windows 只读工具）
powershell-rules.ts  PowerShell 侧（别名解析 → 只读 cmdlet → 写 cmdlet → 回落 POSIX 表）
decision.ts          双方言合成（执行壳方言为准，另一方言作绊线）
approval-memory.ts   会话内审批记忆
```

合成规则（`executing` = 当前执行壳方言，`other` = 另一方言）：

| executing | other | 结果 |
|---|---|---|
| read-only | ≠ unsafe | ✅ 白名单 |
| read-only | unsafe | ⚠️ 审批（保守：如 bash 壳下写 `Remove-Item`，PS 语义是删除） |
| unknown / unsafe | 任意 | ⚠️ 审批 / 拒绝 |

判定原则是**保守失败**而不是"证明安全"：任何无法静态确定的构造（`$(…)`、反引号、`$变量`、
脚本块 `{}`、子壳、`-EncodedCommand`、写重定向到文件、超长命令、未闭合引号）一律非白名单。
段与段（`;`、`&&`、`||`、`|`）**每一段**都必须通过。

### 白名单覆盖（真实数据测量）

用本机历史会话中的 1871 条 `run_command` 命令实测（多为旧 PowerShell/cmd 时代命令）：

- Git Bash 壳：**25.1% 自动放行**；其余 `unknown-command` / `unverifiable-syntax` / `write-signal`
- PowerShell 壳：5.3%（历史命令里大量 `$`、`{}`、`&&` 等 PS 侧不可核验构造）

被拒的多数是**真正需要审批**的命令（`python script.py`、`powershell -Command …`、`curl`、`ssh`、
`npm install`、`mk`/`rm`/`copy`、带写重定向的探测命令）。白名单是维护性资产：新增条目须确认
"该命令没有任何写语义"或把写开关写进 `forbidden`。

## 4. 实现落点

| 位置 | 作用 |
|---|---|
| `common/services/command-policy/*` | 策略层（纯函数，可单测） |
| `common/services/sandbox-policy.ts` | `isShellSandboxSupported()` / `isCommandPolicyEnforced()`：平台能力门（互斥） |
| `shell.plugin.ts` → `enforceCommandPolicy()` | 命令执行前的策略门 + 审批 + 会话记忆 + 无人值守拒绝 |
| `ask.service.ts` → `requestCommandApproval()` | 三选项审批卡（新增；不动既有的 `requestApproval`） |
| `session-context.ts` → `hasAnswerSurface()` | 是否有人能应答（子代理/机器人/无订阅者 → false） |
| `process-manager.service.ts` | 平台门：Windows 不再包装 sandbox.exe（纵深防御） |
| `windows-shell-detect.ts` | 执行壳检测：Git Bash 优先 → PowerShell → cmd |

逃生舱（仅供回归对比）：

- `SANDBOX_WIN_ENABLE=1`：恢复 Windows OS 沙盒（此时命令策略层自动让位，避免双重门禁）
- `GUADA_SHELL=<path>`：显式指定执行壳（bash / powershell / cmd）
- `GUADA_GIT_BASH_NO_LOGIN=1`：Git Bash 不用 login shell（用户 profile 产生噪音时）

## 5. 残留清理

旧后端留下的两类残留，用 `scripts/cleanup-sandbox-grants.mjs` 清理（默认 dry-run）：

```bat
:: 指定工作区
node scripts/cleanup-sandbox-grants.mjs --workspace "D:\AI\ai_chat"
:: 从会话库自动发现工作区（Node ≥ 22.5）
node scripts/cleanup-sandbox-grants.mjs --db "%USERPROFILE%\.guada\data\ai_chat.db"
:: 真正执行
node scripts/cleanup-sandbox-grants.mjs --db "%USERPROFILE%\.guada\data\ai_chat.db" --apply
```

清理内容：工作区目录 DACL 上**非继承**且 SID 前缀为 `S-1-4-`（v1.3.0 确定性能力 SID）或
`S-1-5-10-`（更早的随机 SID）的 ACE，以及只含 `acl.lock` 的 `<workspace>\.sandbox\` 目录。
不动任何用户/系统授权。

## 6. 已知边界

- 白名单外的一切都靠审批：**批准即全权执行**（没有路径维度的强制），档位名不再等于"写入限工作目录"。
- `cmd.exe` 作执行壳（既无 Git Bash 也无 PowerShell，极罕见）没有白名单 → 一律需审批。
- 判定是保守的启发式：**不能**阻止白名单命令 + 恶意外部资源的组合（如 `git` 读取被篡改的
  `.git/config` 触发 hook）；真正的强隔离仍需容器/远程环境。
