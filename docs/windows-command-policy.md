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

## 2. 语义（用户两档 + 计划模式内部只读）

> Windows 输入区不再提供 `read-only` 用户档位（2026-10 起）：该平台没有可靠的
> OS 级只读沙盒，只有命令白名单。下表保留 `read-only`，因为计划模式仍强制使用
> 这套只读命令策略；历史会话与旧客户端传入的 `read-only` 会在入口归一化为
> `workspace-write`。前端档位列表以 `/capabilities` 返回的 `sandboxModes` 为准。

| 档位 | 语义 | 未命中时 | 用户怎么配 |
|---|---|---|---|
| `read-only`（仅计划模式内部 / 历史兼容） | **名单制**（出厂只读名单） | **拒绝**（不弹窗；错误里给可操作提示） | 删掉不想放行的内置条目、加自己确认只读的命令 |
| `workspace-write`（默认） | **例外制**（默认执行） | **直接执行** | 放通 / 收紧必问项、放通敏感路径、加可写根 |
| `danger-full-access` | 不判定，全部执行 | — | — |

用户可选档位只有 `workspace-write` 与 `danger-full-access`；只读体验改由计划模式提供。

**判定顺序（一句话版：灾难级 → deny → 你的规则 → 出厂规则 → 默认动作）**：

```
1. 灾难级（代码硬底线，不可配）              → 拒绝（格式化磁盘 / 关机 / 删根 / 下载即执行…）
2. deny 规则（任意来源、任意种类）            → 拒绝
3. 你的路径规则 → 你的命令规则               → allow / ask
4. 出厂命令规则（必问项）                     → ask
5. 出厂路径规则（敏感路径 ask / 可写根 allow） → ask / allow
6. 默认动作：只读档 = 名单命中即放行，否则拒绝；工作档 = 执行
7. 工作档：路径型动作（rm/mv/cp/mkdir/Set-Content…）的目标不在**可写根**内 → 询问
```

三个要点：
- **deny 永远优先**；**你的规则整体先于出厂规则**（所以"放通一条命令"能盖住出厂必问项）。
- **只读档不弹窗**：ask 与 deny 都按拒绝处理（包括敏感路径）。
- **出厂规则不写进你的文件**，随版本升级自动跟随；「清空我的改动」不会动出厂规则。

## 3. 配置（你的文件只存"改动"）

```yaml
# <数据目录>/policy.yaml —— 只存你的改动，默认几乎是空的
rules:                       # 一条有序表，两种条目
  - { action: allow, match: "ffmpeg *" }        # 命令规则（命令前缀，末尾 * = 其后任意）
  - { action: ask,   match: "curl *" }          # 收紧
  - { action: allow, path: "D:/AI/videos/out" } # 路径规则（= 工作区外的可写根）
  - { action: allow, path: "~/.ssh/**" }        # 敏感路径的长期放通（可见、可撤）
readOnlyRemove:              # 从出厂只读名单里划掉（设置页删行会写这里）
  - "git config"
```
- 路径规则：`~` 与 `%VAR%` 会展开，`**` 任意层级；**不加通配符 = "该目录及其子目录"**；归一后不区分大小写。
- 出厂清单（数据文件 `command-policy/defaults/policy-defaults.yaml`，四个区）：

| 区 | 内容 | 条数 |
|---|---|---|
| `readOnly` | 只读档名单（由分析器表生成 + 漂移测试） | 240 |
| `ask` | 工作档必问项（远程会话 / git push / 发布 / docker rm / 杀进程…） | 26 |
| `sensitive` | 敏感路径（`~/.ssh/**`、`~/.aws/**`、`**/.env`、`**/*.pem`…，读写都先问） | 19 |
| `writeRoots` | 可写根（npm/pnpm/pip/conda/uv/cargo/go/m2/gradle/dotnet/docker 缓存） | 25 |

- **旧文件自动迁移**（v1 平铺 / v2 物化 → v3 增量）：启动时换算 + 备份 `.bak`。
  v2 里"删掉的必问项"会变成一条 `allow` 覆盖，"删掉的只读条目"变成 `readOnlyRemove`，`writeAllowPaths` 变成路径规则。

## 4. 判定算法（`backend-ts/src/common/services/command-policy/`）

```
scan.ts / flag-eval.ts / posix-rules.ts / powershell-rules.ts   方言分析器（引号感知切分 + 参数级核验）
path-glob.ts         路径规则：~/环境变量展开 + /** 通配 + basename 匹配（`**/.env` 命中裸 `.env`）
builtin-readonly.ts  出厂只读名单（两方言条目合并 / 归一 / 前缀匹配）
policy-defaults.ts   出厂规则文件加载（js-yaml；四个区 → 规则表）
workspace-rules.ts   规则求值（5 趟判定）+ 路径提及收集 + 可写根作用域 + wrapper 解包 + 结构核验
decision.ts          按档位分流：只读档（名单制 + 不弹窗）/ 工作档（例外制）
policy-rules.service 用户文件读写 / 迁移 / 校验 / mtime 缓存
```

**只读档**：T0 → 你的规则（ask/deny 都按拒绝）→ 结构核验（写重定向 / `ls &` 这类未支持构造一律拒绝）
→ 出厂名单逐段命中 + 方言分析器参数核验（`find` 放行、`find -delete` 拒绝；自加条目过**代码风险层**兜底）。

**工作档**：默认执行；只拦四类 —— 灾难级、必问项（出厂 26 条 + 你的规则）、敏感路径、越界写 / 删 / 移动。
后两类之外的一切（`npm install`、`python script.py`、工作区内的 `rm -rf build`、写重定向到工作区内…）都直接跑。

**敏感路径怎么判定**：对命令逐段取 token（**读类命令也算**），展开变量 + 归一后与 `sensitive` 的 glob 比对
（`**/.env`、`**/id_rsa`、`**/*.pem` 这类"只有文件名"的条目额外按 basename 匹配，所以 `cat id_rsa`、`type .env` 也拦得住）。
命中后：工作档弹「敏感文件访问」卡（显示目标路径 + 读/写/删；本次允许 / 本轮内自动放行 / 放通此类（写路径规则）/ 拒绝），
**本会话内记住该目标**（同一个文件第二次不再问）；只读档直接拒绝。

**「本轮内自动放行」**：任意一张审批卡（命令 / 敏感路径 / 越界写入）上都有这个选项。选中后**本回合内**
后续所有审批直接按"允许"通过、不再弹卡，范围包括命令、敏感路径与越界写入；本轮已排队未答的卡也会被
一并放行。它是**回合内存态**（不写 `policy.yaml`、不落盘），下一条用户消息开新回合即恢复逐次询问。
计划审批（`ExitPlanMode`）与 `ask_user` 提问不在自动放行范围内（前者会结束计划模式，后者不是"允许/拒绝"）。

### 放行率（真实数据测量，2367 条历史命令）

| 档位 / 配置 | 放行 | 询问 | 拒绝 |
|---|---|---|---|
| 旧（改造前）：只读白名单 + 工作档未知即问（对照） | 22.4% | 77.6% | 0 |
| 只读档：出厂名单（含敏感路径拒绝 + 结构核验） | 22.0% | 0（名单外直接拒绝） | 78.0% |
| 只读档：出厂名单 + 自加 `ffmpeg` / `curl` | **30.9%** | — | 69.1% |
| 工作档：出厂规则（26 必问项 + 敏感路径 + 可写根） | 87.1% | 12.9% | 0 |
| 工作档：再放通 `ssh`/`taskkill`/`git push` 三条 | **90.4%** | **9.6%** | 0 |

询问分布：越界写/删 93、远程副作用 92、不可核验 36、动态目标 29、无工作区 29、主机动作 16、敏感路径 11。
**结论**：出厂默认把"该问的"压到 12.9%（这 2367 条里 93 条是真正的工作区外路径、92 条是 ssh/scp 部署）；
把常用的两三行删掉/放通后就能到 9.6%。可写根（包管理器缓存）在这份语料里没体现（它的越界写是项目相邻目录，不是缓存），
但对日常 `npm/pip/cargo` 场景是直接消噪的。

## 5. 实现落点

| 位置 | 作用 |
|---|---|
| `command-policy/defaults/policy-defaults.yaml` | 出厂规则（数据文件；`nest-cli.json` assets 拷进 dist，`extraResources` 打包） |
| `common/services/policy-rules.service.ts` | 用户文件：读写 / **旧 schema 迁移** / 校验 / mtime 缓存 / `appendRule` / `resetUser` |
| `modules/policy/policy.controller.ts` | `GET /policy/rules`、`PUT /policy/rules`、`POST /policy/reset`（AuthGuard） |
| `shell.plugin.ts` → `enforceCommandPolicy()` | 策略门 + 审批（敏感路径走「敏感文件访问」卡）+ 规则落盘 + 会话记忆 + 无人值守拒绝 |
| `ask.service.ts` → `requestCommandApproval()` | 五选项审批卡（本次允许 / 本轮内自动放行 / 命令与路径两种规则 / 拒绝；敏感路径卡显示目标与操作） |
| `common/services/turn-approval-memory.ts` | 「本轮内自动放行」状态（按会话、回合内有效；`beginTurn` 清空） |
| `file.plugin.ts` | 写：`evaluateWritePath`（敏感路径 ask/deny → 可写根 → 工作区）+ `ensureWriteApproval`；读：`ensureSensitiveRead`（敏感路径工作档问一次 / 只读档拒绝） |
| `session-context.ts` → `hasAnswerSurface()` | 是否有人能应答（子代理/机器人/无订阅者 → false） |
| 前端 `setting/CommandPolicySettings.vue` | 设置页：只读名单 / 必问项 + 敏感路径 / 可写根 三个视图（都能看到内置行、删除即写一条改动）+ 清空我的改动 |

逃生舱（仅供回归对比）：`SANDBOX_WIN_ENABLE=1`（恢复 Windows OS 沙盒，命令策略层让位）、
`GUADA_SHELL=<path>`（指定执行壳）、`GUADA_GIT_BASH_NO_LOGIN=1`。

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

- 工作档批准即全权执行：**没有路径维度的强制**（越界写只保证"问过你"），档位名不再等于"写入限工作目录"。
- **不限网络**（本轮明确不做网络策略）：所以凭据保护是防外传的唯一闸门。用户选择"凭据只问不拒"，
  于是**一旦点了"放通此类"，那条路径就不再拦**——这是一次显式授权，卡片与本文档都要说清。
- **自己项目里的密钥**（`config/secrets.ts` 之类）不在 `sensitive` glob 里，我们看不见；要闭合这条
  只能上网络策略或资源层拦截（见下）。
- **敏感路径是"提到就拦"**：命令文本或文件名命中就触发（`echo "see ~/.ssh/x" > README.md` 也会问一次），
  少量误判可接受（fail-closed），误判时用 `{ action: allow, path }` 放通即可。
- **自加只读条目没有参数级核验**：往只读名单里加 `ffmpeg` 等价于"任意参数都执行"；兜底只管
  灾难级 / 越界写 / 主机 / 远程四类（不会变成 `rm -rf D:\other` 的后门，但也挡不住 `ffmpeg -y` 覆盖文件）。
- **可写根允许删**：包管理器 / 构建缓存按出厂设置可写可删（对齐主流做法）；IDE 与 Shell 历史目录刻意不加。
- 项目级文件是**手写增量**，不会被重置覆盖；注意别把机器相关绝对路径写进随仓库提交的文件。
- `cmd.exe` 作执行壳（既无 Git Bash 也无 PowerShell，极罕见）没有名单 → 只读档一律拒绝、工作档按规则表。
- 判定是字符串层的保守启发式：**不能**阻止名单命令 + 恶意外部资源的组合（如 `git` 读取被篡改的
  `.git/config` 触发 hook），也不做 syscall 拦截（对标产品 WorkBuddy 用 APC 注入 + Nt\* hook，
  工程量与 AV 风险是另一个量级，本轮明确排除）。
