# WSL 发行版工作区方案

> 版本 1.0 / 日期 2026-10-16 / 状态：**已实施**（后端 + 前端 + 真机验收全链路）
>
> 本文档是[统一工作目录操作接口](统一工作目录操作接口-合并远程工作目录方案.md)的第三种连接类型
> **WSL 发行版**（本机 Windows Subsystem for Linux）的设计与实施记录。与
> [Docker 容器工作区方案](docker容器工作区方案.md)互为对偶实现。

---

## 1. 目标与边界

**目标定位（与 Docker 一致）：接入已有环境，不管理目标生命周期。**

- 把本机 WSL 发行版作为附加工作目录绑定到会话：**无需在发行版内配置 sshd**（WSL 默认不装/不启动
  sshd，且 WSL2 NAT 网络下从 Windows 访问还需端口转发，这正是"挑配置"的典型）。
- agent 自动注入发行版并走 `wsl.exe` stdio 管道；文件原语、搜索、命令执行、后台进程、权限三档
  与 SSH/Docker 链路语义完全一致。

**v1 明确不做**（与 Docker 文档同构）：

| 边界 | 说明 |
|---|---|
| 发行版生命周期 | GuaDa 绝不 terminate/shutdown/unregister/安装/删除发行版。**注意与 Docker 的差异**：任何 `wsl.exe` 调用都会自动拉起已停止的发行版——这是 wsl.exe 的固有语义（与用户在终端敲 `wsl` 一致），无法规避，故本链路**允许**隐式启动（已决策），但绝不主动终止 |
| 平台 | 仅 Windows 宿主（`wsl.exe`）。非 Windows：前端隐藏入口、后端 `listWslDistros` 返回 `available:false` + reason |
| WSL1 | 未验证（不阻断、不承诺；发行版列表会显示版本列，建议使用 WSL2） |
| 交互式终端（PTY） | 不提供（与 SSH/Docker 现状一致） |
| 无 `sh` 的裁剪发行版 | 不支持（agent 的 execute/browse 依赖 `sh -c`） |

---

## 2. 与 SSH / Docker 链路的对应关系

WSL 是"没有容器的 Docker"：只差"谁来提供 stdin/stdout"与"怎么把二进制放进目标"。

| 环节 | SSH | Docker | WSL |
|---|---|---|---|
| 传输 | `ssh exec '<agent> --stdio'`；< 0.6.0 回退端口转发 + WS | `docker exec -i <c> <agent> --stdio` | `wsl.exe [-d <distro>] --exec <agent> --stdio`（NDJSON 管道，免 token） |
| 目标列表 | —（手填主机） | `docker ps --format` | `wsl.exe -l -v`（`*` 标记默认发行版；UTF-16/UTF-8 双解码） |
| 就绪/平台探测 | `uname -s/-m` | `docker inspect` + `docker image inspect` | 一次发行版内探针：`uname -s/-m; id -un; $HOME; command -v sh` |
| 推送二进制 | SFTP `fastPut`，失败回退 `cat >` + 字节校验 | `docker cp` | **stdin 直传**（`cat > tmp`，sha256 双向实测一致）+ `chmod` + `mv -f` 落位；`/mnt/<盘>` cp 为兜底 |
| 起进程 | `ssh exec` 长驻通道（stdin EOF = 退出） | 长驻 `docker exec -i` | 长驻 `wsl.exe --exec`（stdin EOF = 退出；实测无孤儿） |
| 权限 | agent `--perm` 三档 | 同左 | 同左（同一 agent、同一套服务端强制；**路径判定**，发行版默认用户是 root 时同样拦截 root 外写入） |
| 版本门禁 | ≥ 0.6.0（< 0.6.0 回退 legacy 传输） | ≥ 0.6.0，latest 低于下限时忽略 | ≥ 0.6.0，latest 低于下限时忽略（与 Docker 同一常量、同一实现） |
| 已停止目标 | 报错/由 sshd 决定 | 报错（要求 `docker start`） | **自动拉起**（冷启动预留 60s 超时 + 日志提示） |

**完全复用、零改动**的层：`RemoteAgent` 包装、`AgentWorkspaceProvider`、`WorkspaceToolRouter`
（`workspace` 参数路由 + 会话绑定校验）、`r:<连接名>:<pid>` 进程命名空间、turn.stopping 后台收割、
`outputB64` 编码链、连接缓存与 2h 空闲回收、断线自动重建、绑定快照与提示词注入、
`buildBrowseCommand/parseBrowseOutput`（POSIX browse）、`ensureLocalBinary`（本地 Linux 二进制缓存）。

与 Docker 的**共享内核**（本次新增，见 §3.5）：候选安装目录探测、stdio 版本下限门禁、注入后复验、
握手校验、聚合错误——Docker 与 WSL 单点共用，避免两份实现漂移。

---

## 3. 关键设计决策

### 3.1 传输：`wsl.exe --exec` + stdio（NDJSON）

- `--exec`（`-e`）语义为"不经默认 Linux shell"直接 exec，argv 直传不经 shell 展开——与
  `docker exec -i` 完全同构，复用 `StreamRpcTransport`（子进程 stdio + NDJSON 分帧）。
- 释放路径：`stdin.end()` → agent 读到 EOF 自行退出（实测 `exit=0`）；transport 超时强杀
  Windows 侧 `wsl.exe` 后，发行版内 agent 也随管道关闭退出（`/proc` 扫描实测**无孤儿**）。
- 环境变量统一设置 `WSL_UTF8=1`：wsl.exe 的**管理类**输出（`-l -v`/`--status` 等）默认 UTF-16LE，
  归一为 UTF-8；`decodeWslOutput` 仍保留 utf16le 兜底（老版本可能忽略该变量）。
- 长连接不依赖 `wsl.exe --help` 退出码（实测其退出码为 -1/127，不可作为可用性判据）。

### 3.2 注入与落位（与 Docker 的差异点）

1. **主通道 stdin 直传**：`wsl.exe --exec sh -c 'cat > /tmp/.guada-agent/guada-agent.tmp'`，
   stdin 写入本地缓存的 Linux 二进制（~10MB），随后 `wc -c` 校验字节数。
   P0 实测：10MB sha256 **双向一致**（写入 190ms / 读回 183ms），不依赖盘符挂载、不受编码影响。
2. **兜底通道 `/mnt/<盘>` cp**：本地缓存路径（如 `C:\Users\x\.guada\agent\...`）转为
   `/mnt/c/Users/x/.guada/agent/...` 后发行版内直接 `cp`；仅在该盘符已挂载时可用。
3. **落位用 tmp + `mv -f`**（rename 替换 inode）：覆盖正在执行的 agent 时不会命中
   `ETXTBSY`（"Text file busy"），因此 WSL 链路**无需**注入前 `pkill` 清场（Docker 保持原行为）。
4. 安装目录候选：**`$HOME/.guada-agent` 优先**（属主稳定），其后 `/tmp` → `/var/tmp` → `/dev/shm`
   （本机 Ubuntu 发行版 `/tmp` 为 ext4 而非 tmpfs，注入结果跨发行版重启保留；其他发行版可能
   tmpfs 挂载 `/tmp`，故 `$HOME` 优先）。

### 3.3 agent 版本门禁（与 Docker 共用同一常量与实现）

- 下限 `MIN_STDIO_AGENT_VERSION = 0.6.0`（stdio 模式引入版本）；`MIN_AGENT_VERSION_FOR_WSL` 为其别名。
- 复用发行版内既有二进制前先 `--version` 校验：满足下限且与期望版本一致 → 直接复用（实测重连
  日志 `Agent v0.6.0 already present`，不重复注入）；低于下限 → 重新注入。
- latest 接口指向的版本低于下限时**忽略**并退回本地缓存（防止把无 `--stdio` 的旧版注入目标）。

### 3.4 连接模型与展示

连接配置以 `kind` 为判别字段（`SshConnectionConfig | DockerConnectionConfig | WslConnectionConfig`）：

```jsonc
// WSL
{ "kind": "wsl", "distro": "Ubuntu-AOSP", "path": "/home/you/proj", "perm": "workspace" }
```

- `distro` 为空 = 系统默认发行版（省略 `-d`）；`path` 缺省 = 发行版默认用户 `$HOME`
  （连接时探测并回写，与 Docker 回写容器 WorkingDir 同构）；
- 会话绑定键沿用 `attachments["ssh-connection"]`（连接 ID 列表，与类型无关，零迁移）；
- 展示渲染：`WSL 发行版 "Ubuntu-AOSP" (path: /home/you/proj)`（提示词清单/绑定快照/信息卡）；
  chip 图标用桌面图标（`Desktop16Regular`，与本机环境语义相符）；
- 设置向导第 0 步「连接类型」第三项（**仅 Windows 显示**），WSL 表单含**发行版下拉**
  （`GET /remote-workspace/wsl/distros`，标注"默认"与运行状态）+ 刷新；第 2 步目录浏览提示
  可填发行版内路径或 `/mnt/<盘>` 挂载路径。

### 3.5 共享内核抽取（cli-agent-install.ts）

Docker 与 WSL 的链路差异只有三处（命令执行前缀、二进制注入方式、长连接 spawn），
其余流程抽为 `CliAgentEnv` 适配器接口 + 共享实现：`ensureAgentInCliEnv`（候选目录循环 / 下限门禁 /
注入 / chmod / 复验 / 聚合错误）、`getAgentVersionInCliEnv`、`assertDirInCliEnv`、`browseCliPath`、
`startCliAgentStdio`、`mapLinuxArch`。

`docker-agent-connect.ts` 重构为 docker 适配器（**对外导出与签名不变**：12 个 spec、冒烟脚本
与 cjs 协议脚本零修改），重构后回归：后端全量 201 套件 / 2984 测试全绿 + Docker 冒烟 22/22 +
stdio 协议 21/21。

---

## 4. 代码地图

| 文件 | 职责 |
|---|---|
| `backend-ts/src/modules/remote-workspace/wsl-agent-connect.ts` | WSL 适配器：`runWsl`（WSL_UTF8/双解码/冷启动超时）、`parseDistroList`、`listWslDistros`、`inspectWslTarget`、`ensureAgentInWsl`、`connectWslAgent`、`browseWslPath`、`testWslConnection`、`verifyAndDeployWslAgent`、`toWslPath`、`wslAgentDirCandidates` |
| `backend-ts/src/modules/remote-workspace/cli-agent-install.ts` | Docker/WSL 共享内核（§3.5） |
| `backend-ts/src/modules/remote-workspace/docker-agent-connect.ts` | Docker 适配器（重构后，导出签名不变） |
| `backend-ts/src/modules/remote-workspace/remote-workspace.service.ts` | 连接 CRUD + 按 kind 分派 test/deploy/browse；`listWslDistros()` |
| `backend-ts/src/modules/remote-workspace/remote-workspace.controller.ts` | `GET /remote-workspace/wsl/distros` |
| `backend-ts/src/modules/remote-workspace/remote-workspace-agent-manager.ts` | `deployAndConnect` 三分支 + `connectWsl` + `connectionKind` |
| `backend-ts/src/modules/remote-workspace/remote-binding-state.service.ts` | WSL 描述渲染 |
| `frontend/src/services/modules/remote-workspace.api.ts` | `kind: "wsl"`、`distro` 字段、`connectionTargetLine`、`listWslDistros` |
| `frontend/src/components/setting/ConnectionSettings.vue` | 类型选择器第三项（仅 Windows）+ 发行版下拉 + WSL 文案 |
| `frontend/src/components/chat/workspace/WorkingDirBar.vue`、`components/chat/chat-input/ConnectionBindingMenu.vue` | WSL chip/菜单行图标 |
| `frontend/src/locales/{zh-CN,en-US}/settings.ts` | `typeWsl` / `distro*` / `browse*Wsl` 等文案 |

---

## 5. 验收与测试入口

| 入口 | 内容 | 最近一次结果（2026-10-16，本机 Ubuntu-AOSP / WSL 2.7.3.0） |
|---|---|---|
| `npx jest src/modules/remote-workspace/wsl-agent-connect` | 编码解码/列表解析/参数组装/路径转换/候选目录/平台门禁（17 用例） | 全绿 |
| `npx jest src/modules/remote-workspace/cli-agent-install` | 共享内核：复用/低于下限重注/latest 下限过滤/聚合错误/复验（13 用例，假环境驱动） | 全绿 |
| `npx ts-node src/scripts/wsl-workspace-smoke.ts [--distro=<名>] [--root=<路径>]` | 真机全链路：连接握手 → 文件原语 → 搜索 → execute/outputB64/后台 → perm 负例 → 断线重连复用 → 工具路由器（scheme=wsl）→ **无孤儿进程** → 负例（假发行版名/不存在目录） | **26/26 PASS** |
| `npx ts-node src/scripts/docker-workspace-smoke.ts` | Docker 回归（内核抽取后） | **22/22 PASS** |
| `node scripts/test-docker-stdio-agent.cjs` | stdio 协议回归 | **21/21 PASS** |
| `npx jest`（backend-ts 全量） | 无回归 | **201 套件 / 2984 测试全绿** |

GUI 验收（真机 Ubuntu-AOSP，向导全流程）：设置页出现 WSL 类型 → 发行版下拉加载真实列表
（`Ubuntu-AOSP 默认 · Running`）→ 测试连接成功（日志含 `WSL distro 'Ubuntu-AOSP' is available`、
`Agent v0.6.0 already present`）→ 目录浏览（`/root`、`/tmp` 正常）→ 部署验证成功 → 保存后列表卡片
显示 `WSL` 徽标与 `WSL 发行版 Ubuntu-AOSP` → 聊天侧绑定菜单行显示桌面图标与 `WSL 发行版 …` 描述 →
删除正常。

---

## 6. 运维与坑位

1. **编码**：wsl.exe 管理类输出默认 UTF-16LE（无 BOM，CRLF）。所有管理命令统一经 `runWsl`
   （spawn env 设 `WSL_UTF8=1`，含 NUL 判定 utf16le 兜底），产品代码不做散落解码。
2. **stderr 噪音无害**：NAT 模式下每次调用都会在 stderr 打印 `wsl: 检测到 localhost 代理配置…`；
   stdout 实测干净，NDJSON 解析不受影响（stderr 仅进 tail 诊断）。
3. **`wsl.exe --help` 退出码非零**：不得以退出码判断 WSL 可用性；发行版列表以 `-l -v` 的
   输出解析为准（表头按"最后一列非数字"跳过，发行版名可能含空格 → 从右往左按列解析）。
4. **冷启动**：已停止的发行版在首个命令时自动拉起（可能数十秒），探测类调用超时为 60s，
   普通调用 30s，注入 120s；日志会提示正在连接。
5. **跨边界项目（`/mnt/<盘>`）**：工作目录可以是 Windows 盘挂载路径（9p，性能弱于 ext4；
   文件监听本就是 no-op）。另外发行版自身若开启 `appendWindowsPath`，`execute` 的 `node` 等
   可能命中 Windows 版本——这是发行版配置行为，与在终端里执行一致。
6. **`/tmp` 是否 tmpfs 因发行版而异**：安装目录以 `$HOME/.guada-agent` 优先，避免每次发行版
   重启后重新注入 10MB。
7. **Git Bash 下驱动 wsl.exe**：MSYS 会把 `/tmp/...` 之类参数改写为 Windows 路径，直连命令行
   验证时需 `MSYS_NO_PATHCONV=1`（Node spawn 不受影响）。
8. **Docker Desktop 的 WSL 发行版**（`docker-desktop`）会出现在列表中：它是工具 VM，无用户
   工具链；GuaDa 不做过滤（与"列出全部已有环境"原则一致），连接它通常没有意义。
9. 遗留测试脚本 `backend-ts/scripts/wsl-*.js` 是早期"SSH 到一台 WSL 主机"的 SSH 链路测试
   （与本次 WSL 适配无关，本方案不依赖它们）。其凭据文件 `backend-ts/.wsl-test-config.json`
   曾误入库（含明文口令），已从版本控制移除并加入 `.gitignore`；本地如需运行这些脚本请自建该文件
   （注意：已进历史的旧口令仍在 git 历史中，建议同时轮换）。

---

## 7. P0 门禁实测记录（写入产品代码前完成）

| 项 | 方法 | 结果 |
|---|---|---|
| stdin/stdout 字节保真 | 10,036,150B 真实 agent 二进制经 `wsl.exe --exec sh -c 'cat > …'` 写入、`cat` 读回，双向 sha256 对比 | **一致**（190ms / 183ms） |
| 长连接生命周期 | 真实 agent `--stdio` → ping → `stdin.end()` | wsl.exe `exit=0`；发行版内无残留进程 |
| 强杀客户端 | `child.kill()`（TerminateProcess）后 2s 扫描 `/proc/*/cmdline` | **无孤儿**（管道关闭 → agent 自行退出） |
| 空格路径 | `--root '/tmp/guada smoke dir'` 经 Node → wsl.exe → argv 往返 | root 一致；空格路径下 writeFile/readFile 正常 |
| 编码与解析 | `-l -v` 在设/不设 `WSL_UTF8` 两种环境下解析 | 同一列表（含 `*` 默认标记） |
| `/mnt` 兜底通道 | `cp /mnt/c/... /tmp/... && chmod 755 && --version` | 成功（208ms，含执行） |

探测脚本留档：`.zcode/tmp/wsl-p0-probe.cjs`（仓库外跟踪目录，不入库）。

---

## 8. 后续可扩展（未实施）

- WSL1 发行版的实测与承诺（当前 best-effort）；
- 发行版内多用户（`wsl -u <user>`）选择；
- 与 Docker 的进一步统一：把"候选目录 + 注入"抽象同时用于远程 Docker 主机（`docker -H`）场景的
  本地缓存校验（现已可用，未额外优化）；
- 工作目录指向 `/mnt/<盘>` 时的 9p 性能提示与可选建议（如把项目移到发行版内 ext4）。
