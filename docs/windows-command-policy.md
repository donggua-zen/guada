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

| 档位 | 判定 | 交互 |
|---|---|---|
| `read-only`（计划模式同此档） | 正向**只读白名单**（静态可证的只读命令） | 白名单执行；其余**拒绝**（不弹窗，错误里给可操作提示并让用户切档） |
| `workspace-write`（默认） | **黑名单 + 作用域**（见 §3） | 默认直接执行；越界 / 主机级 / 远程副作用 / 不可核验 → **审批弹窗**；灾难级 → **直接拒绝** |
| `danger-full-access` | 不判定，全部执行 | — |

**审批卡四个选项**（`requestCommandApproval`）：

1. 「本次允许」——仅本次执行
2. 「放通此类（本项目）」——把**推导出的前缀规则**写入 `<工作区>/.guada/policy.yaml`
3. 「放通此类（全局）」——写入全局 `<SETTINGS_DIR>/policy.yaml`
4. 「拒绝」——`AskDeniedError(rejected)`

- 卡片上直接显示推导结果（如 `ffmpeg -i a b` → 「把 `ffmpeg *` 写入…」），用户知道放通的到底是什么。
- **越界类询问不提供放通选项**：`rm -rf D:\other\x` 推导出的 `rm *` 会把"越界"这一条件也一起放通，
  因此这类只给「本次允许 / 拒绝」（想长期放开请手编规则或改档位）。
- 灾难级命令、多段命令（`a && b`）同样不推导规则（前缀放通会顺带放行后续段落）。
- 规则落盘失败（或推导不出）时退回**会话内记忆**（同一条命令本会话不再重复问）。
- 放通规则也匹配 shell 包装的内层命令：`powershell -Command "ffmpeg …"` 命中 `ffmpeg *`。

### 用户规则（`policy.yaml`，可手编）

```yaml
allow:                       # 命中即静默执行（token 前缀匹配，末尾 * 表示其后任意）
  - "ffmpeg *"
  - "yt-dlp *"
  - "ssh *"
ask:                         # 命中即弹窗（用于收紧内置的默认放行）
  - "git push *"
deny:                        # 命中即拒绝（优先级高于 allow）
  - "npm publish *"
writeAllowPaths:             # 工作区外仍可写/编辑的目录（文件工具用）
  - "D:/AI/videos/out"
```

- 两级文件**并集**：全局 + 项目级；优先级在匹配时决定：
  **T0 灾难级 > 用户 deny > 用户 ask > 用户 allow > 内置判定**（项目级 deny 能压全局 allow）。
- 校验：条目非空、≤120 字符、≤8 个 token、禁止 shell 元字符（规则只是前缀匹配器）、
  单条 `*` 直接拒绝；`allow` 命中灾难级名单或放通整个 shell（`powershell *`）时给出**告警**。
- 设置页「命令策略」可编辑全局规则；项目级规则由审批卡写入，也可手编（随项目走）。
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
scan.ts              引号感知的顶层切分 + 记号化；记录"写重定向"与"不可核验构造"（只读档用）
flag-eval.ts         参数级核验（已知安全开关 / 明确危险开关 / 未知开关降级）
posix-rules.ts       Git Bash 侧只读白名单（命令、git 子命令、Windows 只读工具）
powershell-rules.ts  PowerShell 侧（别名解析 → 只读 cmdlet → 写 cmdlet → 回落 POSIX 表）
workspace-rules.ts   工作档：T0 灾难级 / T1 作用域判定 / T2 不可核验 + 用户规则匹配 + 规则推导
decision.ts          按 mode 分流：read-only → 只读白名单；workspace-write → workspace-rules
approval-memory.ts   会话内审批记忆（放通规则落盘失败时的兜底）
```

### 只读档（不变）

合成规则（`executing` = 当前执行壳方言，`other` = 另一方言）：

| executing | other | 结果 |
|---|---|---|
| read-only | ≠ unsafe | ✅ 白名单 |
| read-only | unsafe | ⚠️ 审批（保守：如 bash 壳下写 `Remove-Item`，PS 语义是删除） |
| unknown / unsafe | 任意 | ⚠️ 审批 / 拒绝 |

判定原则是**保守失败**：任何无法静态确定的构造（`$(…)`、反引号、`$变量`、脚本块 `{}`、子壳、
写重定向到文件、超长命令、未闭合引号）一律非白名单。段与段（`;`、`&&`、`||`、`|`）**每一段**都必须通过。

### 工作档（黑名单 + 作用域，默认放行）

只拦三类：

**T0 灾难级（`block`，硬拒且不可放通）**：`mkfs*`/`mke2fs`/`diskpart`/`bcdedit`、
`Format-Volume`/`Clear-Disk`/`Initialize-Disk`/`Remove-Partition`、`format <盘符>:`、
`dd of=/dev/*`、`> /dev/sd*`、`shutdown`/`reboot`/`Stop-Computer`/`Restart-Computer`、
`Set-ExecutionPolicy`/`vssadmin`/`wbadmin`、fork bomb、`kill -9 -1`、
`curl|wget|iwr … | sh|bash`、`… | iex`、`rm -rf /`（根或盘符根）。
用户规则无法覆盖（写进 `allow` 也只会得到一条告警）。

**T1 作用域敏感（`ask` / 区内 `allow`）**：

- **路径型写/删/移动**：`rm|del|erase|rd|rmdir|Remove-Item|mv|move|Move-Item|rename|ren|`
  `cp|copy|Copy-Item|mkdir|New-Item|touch|Set-Content|Add-Content|Out-File|tee|`
  `chmod|chown|takeown|icacls|attrib|Set-Acl|ln|mklink`，以及**写重定向到文件**，
  再加上两个方言分析器判为 `unsafe` 的写入类参数（`find -delete`、`sort -o`、`sed -i`、`Set-Content` …）。
  判定：所有路径候选归一后**全部落在会话工作区内 → 放行**（`rm -rf build`、`del *.tmp`、
  `mkdir tmp`、`echo x > out.txt`）；任一越界（绝对路径 / `..` / `~`）→ 弹窗；
  含动态构造的目标（`$VAR`/`%VAR%`/反引号）或段内无路径 token → 弹窗。
  **相对路径基准跟随 `cd` 移动**（`cd /etc && rm passwd` 会因基准越界而弹窗）。
- **主机级动作**：`Stop-Process|taskkill|Stop-Service|Restart-Service|sc stop|delete|schtasks|…`
  → 弹窗（与工作区无关，可用 `Stop-Process *` 放通）。
- **远程 / 不可逆副作用**：`ssh|scp|sftp|rsync|plink|Invoke-Command|Enter-PSSession`、
  `git push|reset --hard|clean -f|rebase|filter-branch|branch -D`、`npm|pnpm|yarn publish`、
  `docker rm|rmi|prune`、`kubectl delete`、`git config --global` → 弹窗（可用 `ssh *` 等放通）。
- **shell 包装必须解包后判定**：`powershell|pwsh … -Command/-c "…"`、`cmd /c "…"`、`bash|sh -c "…"`
  （可带尾随 `2>&1`）；`-File x` / `sh x` 这类"跑脚本"按**脚本路径**做作用域判定。
  解包失败 → 弹窗（这是黑名单模式的反绕过必需项）。

**T2 不可核验（仅风险段才问）**：风险段里出现动态构造、未闭合引号（两种引号口径任一成立即算闭合，
兼容 POSIX 的 `\"` 与"Windows 路径以 `\` 结尾"）、超长命令（>4096）；
heredoc 正文按数据剥离——`cat > file <<EOF` 这类**写文件**的 heredoc 放行，
`python <<EOF` 这类把 stdin 交给解释器的直接判不可核验；纯环境变量赋值段（`set VAR=x`）跳过。
**非风险段里的动态构造不再触发弹窗**（所以 `echo "approval test $(date)"` 不会问）。

### 放行率（真实数据测量）

本机历史会话 **2367 条** `run_command`（239 会话，含各自工作区）实测：

| 方案 | 放行 | 弹窗 | 硬拒 |
|---|---|---|---|
| 旧：只读白名单 + 工作档未知即问 | 22.4% | 77.6% | 0 |
| 新：工作档黑名单 + 作用域 | **87.4%** | 12.6% | 0 |
| 新 + 示例规则（`ffmpeg *` / `ffprobe *` / `yt-dlp *` / `ssh *` / `scp *` / `Stop-Process *` / `taskkill *`） | **91.5%** | **8.5%** | 0 |

剩余弹窗集中在：远程副作用（ssh/scp 部署）、真正的工作区外路径、管道喂给 `Remove-Item` 之类的
不可判定删除、循环/动态目标、无工作区的会话。这些正是"该问"的部分，且多数可用一条 allow 规则消除
（这也是 user-configurable 名单的目的：视频工作者放通 `ffmpeg *`，部署流程放通 `ssh *`）。
只读白名单仍是维护性资产：新增条目须确认"该命令没有任何写语义"或把写开关写进 `forbidden`。

## 4. 实现落点

| 位置 | 作用 |
|---|---|
| `common/services/command-policy/*` | 策略层（纯函数，可单测） |
| `common/services/policy-rules.service.ts` | 用户规则：两级 YAML 读写 / 合并 / 校验 / mtime 缓存（热路径同步接口） |
| `modules/policy/policy.controller.ts` | `GET /policy/rules`、`PUT /policy/rules`（AuthGuard） |
| `common/services/sandbox-policy.ts` | `isShellSandboxSupported()` / `isCommandPolicyEnforced()`：平台能力门（互斥） |
| `shell.plugin.ts` → `enforceCommandPolicy()` | 命令执行前的策略门 + 审批 + 规则落盘 + 会话记忆 + 无人值守拒绝 |
| `ask.service.ts` → `requestCommandApproval()` | 四选项审批卡 + 「放通此类」规则推导（不动既有的 `requestApproval`） |
| `file.plugin.ts` → `ensureWriteApproval()` | 工作区外写入审批；消费 `writeAllowPaths`（长期可写目录不再问） |
| `session-context.ts` → `hasAnswerSurface()` | 是否有人能应答（子代理/机器人/无订阅者 → false） |
| `process-manager.service.ts` | 平台门：Windows 不再包装 sandbox.exe（纵深防御） |
| `windows-shell-detect.ts` | 执行壳检测：Git Bash 优先 → PowerShell → cmd |
| 前端 `setting/CommandPolicySettings.vue` | 设置页「命令策略」：四个列表 + 生效状态 + 校验告警 |

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
