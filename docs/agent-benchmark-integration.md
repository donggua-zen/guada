# Agent 评测接入方案（B 档：容器类 benchmark）

> **版本**: 1.2
> **日期**: 2026-10-15
> **状态**: 架构已定；容器工作区已落地于产品主线（含真实 TB 镜像实测通过）；评测侧接入未开始
> **目标**: 用容器化的公开 benchmark 给 GuaDa 跑分，并与其它 agent harness 横向对比，
> 从而验收「harness 工程（循环/工具/prompt/压缩/子 agent）对模型能力是提升还是负优化」。

---

## 目录

1. [背景与目标](#1-背景与目标)
2. [选型结论](#2-选型结论)
3. [核心架构决策](#3-核心架构决策)
4. [GuaDa 侧改动清单](#4-guada-侧改动清单)
5. [Harbor 侧 Adapter 设计](#5-harbor-侧-adapter-设计)
6. [运行环境与前置](#6-运行环境与前置)
7. [分阶段里程碑](#7-分阶段里程碑)
8. [SWE-bench 路线](#8-swe-bench-路线)
9. [对照组与指标](#9-对照组与指标)
10. [风险、坑与待核实项](#10-风险坑与待核实项)
11. [快速重测回路](#11-快速重测回路)

---

## 1. 背景与目标

### 1.1 问题

项目目前没有任何 agent 级端到端评测。已有的测试基建都是**组件级**的：

- `backend-ts/test/**`（约 190 个 jest spec）：函数级正确性
- `test/agent-engine/helpers/chunk-replayer.ts` + `fixtures/chunks-*.jsonl`：**录制-回放**，验证的是"给定固定流式 chunk，管线行为是否一致"，不衡量任务完成能力
- `src/scripts/kb-eval.ts`（`pnpm kb:eval`）：知识库检索质量，子能力级
- `docs/browser-snapshot-benchmark.md`：浏览器快照体积/耗时

结论：**无法回答"这次 harness 改动是提升还是负优化"**。且 CI（`.github/workflows/release.yml`）只做打包，不跑任何测试。

### 1.2 评测要分两层

| 层 | 回答的问题 | 工具 |
|---|---|---|
| **对外横向** | 我们的 agent 在别人面前值多少分 | 公共 benchmark（本文档主题） |
| **对内消融** | 本次 harness 改动 +X% 还是 -X% | 自建任务集 + 固定模型对照（另案） |

B 档（容器类）能同时服务两层，因为公共套件本身提供官方 scorer，且预集成了一批竞品 harness 可作对照臂。

### 1.3 为什么选 B 档

A 档（BFCL / τ-bench / Aider Polyglot）测的是"单点工具调用正确性"，对 harness 的整体改动不敏感。
B 档在**真实容器里跑真实任务**（编译、装依赖、改多文件、跑测试），harness 的差异——工具描述质量、报错回传、循环控制、上下文压缩——会直接反映成分数差。这正是要验收的东西。

---

## 2. 选型结论

| 套件 | 结论 | 理由 |
|---|---|---|
| **Terminal-Bench 4.0**（经 Harbor） | **首发** | 容器化终端任务；Harbor 的 agent 接口允许 agent loop 留在宿主侧（我们的形态）；`-e docker` 本地可跑，不需要云 |
| **SWE-bench Verified**（经 Harbor 的 `swe-bench/swe-bench-verified`） | **第二发，复用同一 adapter** | Harbor registry 已收录 500 题；**不需要单独接官方 CLI**（官方 harness 仅作交叉验证） |
| OSWorld / WindowsAgentArena | 暂缓 | 需要 VM 宿主 + 桌面控制链路，工作量最大 |

> **关键结论**：Harbor 是 B 档（甚至 A 档大部分）的**单一入口**。只要 adapter 写好一次，
> 换 `-d <dataset>` 就能跑不同套件，不需要为每个 benchmark 重做接入。

### 2.1 Terminal-Bench 现状（2026-10-15 核实）

- 当前版本 **4.0**，跑法已迁移到 **Harbor** 框架：
  ```bash
  uv tool install harbor          # 或用 'harbor[...]' 装可选依赖
  harbor run -d terminal-bench/terminal-bench@4.0.0 -e docker -a <agent> -m <model> -k 5
  harbor view jobs
  ```
- 沙箱默认就是 `docker`（本地跑，无需云）。`modal`/`daytona` 只是可选云端。
- 官方声明：**benchmark 数据不得进入训练语料**——用于本地模型对比时需注明污染风险。
- 旧的 `tb` CLI（`pip install terminal-bench`）是另一条腿，任务集格式相同（instruction + 测试脚本 + oracle 解），可作参考但不作为主路径。

### 2.2 Harbor registry 可用数据集（2026-10-15 核实，`hub.harborframework.com/datasets`）

B 档及相邻档位的关键数据集与题量：

| 数据集 | 题量 | 档位 / 用途 |
|---|---|---|
| `harbor/hello-world` | 1 | **M0 冒烟首选**（比真任务便宜得多） |
| `terminal-bench/terminal-bench` | **66** | B 档主力（4.0.0） |
| `terminal-bench/terminal-bench-2` / `-2-1` | 89 / 89 | B 档，上一代 |
| `terminal-bench-pro/terminal-bench-pro` | 200 | B 档，更大 |
| `terminal-bench-science/terminal-bench-science` | 70 | 科学计算向 |
| `openthoughts/openthoughts-tblite` | 100 | B 档轻量切片（省时省钱） |
| **`swe-bench/swe-bench-verified`** | **500** | B 档，代码 agent 标准 |
| `swe-rebench/swe-rebench-leaderboard` | 860 | **抗污染**的 SWE 任务（应对训练语料污染） |
| `harbor-index/harbor-index` | 80 | 综合能力指数 |
| `aider/aider-polyglot` | 225 | A 档（编辑格式/patch 能力） |
| `sierra-research/tau3-bench` | 375 | A 档（多轮工具 + 策略遵守） |

> **战略含义**：A 档里我原先推荐单独接的 Aider Polyglot（225 题）和 τ³-bench（375 题），
> Harbor 里都有现成数据集。adapter 写好后，**整个 benchmark 组合都变成换 `-d` 参数**，
> 不必维护多套接入代码。A 档与 B 档的边界因此消失了。

---

## 3. 核心架构决策

### 3.1 关键约束：工具必须落在容器里，不能落在宿主

GuaDa 的 `read/write/edit/glob/grep` 和 `run_command` 默认作用于**宿主机文件系统**：

- `file.plugin.ts` 的每个工具都是"远程分支 / 本地 `fs` 直读"二选一（read `:153-172`、write `:346-382`、edit `:430-487`、grep `:567-575`）
- `shell.plugin.ts:194-199`：`workspace` 参数命中远程连接才走 `runRemoteCommand`，否则 `cwd = session.workspacePath` 后用 `child_process.spawn` 在本机跑

评测任务是"在一个 Linux 容器里改代码并跑通测试"。如果工具落在宿主，agent 会读到宿主机仓库、在宿主机执行命令，分数必然是 0 且不可诊断。**所以第一优先级是把工具执行体指到任务容器。**

### 3.2 选定架构：stdio 直连（项目能力，**已落地**）

> **2026-10-15 更新**：在途工作已完成并入库（`b6781afc` / `4ca165ea` / `42e89df4`，agent 子模块 v0.6.0），
> 本节原"需要自己写 adapter 协议层"的设计全部作废——这条路径变成**纯复用**。
> 方案细节以 [docker容器工作区方案.md](docker容器工作区方案.md) 为准。
>
> | 环节 | 落点 | 对评测的意义 |
> |---|---|---|
> | 传输抽象 | `rpc.ts` 抽出 `RpcTransport`；新增 `rpc-stream-transport.ts`（`StreamRpcTransport`） | 与 `WsRpcTransport` 并列；`RpcClient` 的请求匹配/心跳判死/超时兜底/cancel/onDisconnect **全部不变** |
> | 容器接入 | `docker-agent-connect.ts`：`connectDockerAgent()` | `{kind:"docker", container:"容器名或ID", path, perm, dockerHost}` —— **直接附着既有容器**，正是 Harbor 场景 |
> | agent 注入 | `ensureAgentInContainer()`：`docker inspect` 探平台 → 候选目录 `/tmp`→`/var/tmp`→`/dev/shm` 探测 → `docker cp` + `chmod 755` → `--version` 复验 | **adapter 不必再管二进制注入与架构匹配** |
> | 版本门禁 | `agent-version.ts`，stdio 下限 0.6.0；线上 latest 低于下限时忽略并退回本地缓存 | 不会静默注入旧版导致握手失败（实测旧版收到 `--stdio` 只打印 flag usage 后静默退出） |
> | 路由 | `SshWorkspaceProvider` → `AgentWorkspaceProvider`（scheme 由连接类型决定） | file/shell 工具**零改动** |
> | 连接模型 | `config.kind` 判别（`ssh | docker`），旧数据读时归一，零迁移 | 评测可按需建/删连接 |
>
> 方案文档 §3.1 明确把"绕开『编译期无法给容器加 `-p`』的场景（**如评测容器**）"列为设计目标之一。

```
┌──────────── Windows 宿主 ────────────┐      ┌──────── 任务容器 ─────────┐
│                                      │      │                           │
│  GuaDa 后端 (NestJS, headless)        │      │  /app  任务工作目录        │
│    agent loop ──► ToolExecutor        │      │  bash / python / 测试脚本  │
│         │                             │      │                           │
│         ▼                             │      │  /tmp/.guada-agent/       │
│  RpcClient（传输无关）                 │      │    guada-agent（自动注入） │
│         │                             │      │       ▲                   │
│         ▼                             │      │       │                   │
│  StreamRpcTransport ── spawn ─────────┼──────┼───────┘                   │
│    docker exec -i <容器名|ID> <agent> --stdio │                           │
└──────────────────────────────────────┘      └───────────────────────────┘
```

**协议不存在分叉**：stdio 模式复用**同一个** `RPCHandler.handleMessage`。`rpc.go` 已把它重构为
传输无关的 `handleMessage(raw []byte, send msgSender)`，注释明确写"WebSocket 帧与 stdio NDJSON 行
都汇聚到这里（错误码与日志的唯一来源）"。工具集、错误码、语义完全相同，只是传输从 WS 换成管道。

**对评测的三点意义**：

1. **不需要再写 adapter 的协议层**。原计划 M1（在 Python 里重实现 `readFile/writeFile/grep/glob/execute`
   等十余个 RPC）**整块取消**。Harbor 侧只剩"编排"职责（见 §5）。
2. **原先否决「容器内跑 guada-agent」的唯一理由消失了**——那个理由是"Harbor 创建容器时无法追加 `-p`
   端口映射"。stdio 走 `docker exec -i`，**不需要端口、不需要 sshd、不需要 token**。
3. 生命周期语义已覆盖评测最关心的场景（`main.go` / `stream.go`）：stdin EOF（客户端断开）→ 正常退出；
   写失败（管道断裂）→ `OnTransportFailure` 立即退出不留僵尸进程；收到 SIGTERM → 先广播 `shutdown` 再退出。

**agent 侧已具备的测试覆盖**（`stream_test.go`，275 行 6 组）：并发 ping、超大载荷、畸形帧后恢复、
EOF 退出、shutdown 广播、传输失败钩子。`Run()` 用 `ReadBytes` 而非 `Scanner`，**不设行长上限**，
专门为多 MB 的 `readFile/writeFile` 请求行留了余量。

**协议参考**（stdio 与 WS 共用同一 `dispatch`，方法表完全一致；`guada-agent/rpc.go` 的 dispatch 表）：

```
ping / readFile / readFileRange / writeFile / replaceInFile / stat / readdir / mkdir
/ unlink / rename / glob / grep / execute / cancel / poll / kill / writeStdin
/ drainCompleted / upload|download(+Start/Chunk/End/Abort) / watch / unwatch
```

这就是容器工作区实际可用的**能力面**——评测任务能做什么、不能做什么由它决定
（例如没有 git 专用原语，一切经 `execute` 走 shell；后台进程有 `poll/kill/writeStdin/drainCompleted` 一整套）。

### 3.3 方案对比与取舍

| 方案 | 结论 | 说明 |
|---|---|---|
| **stdio 直连**（`docker exec -i … --stdio`） | **✅ 主路径** | 复用项目在途能力；无端口、无 sshd、协议不分叉。前置是后端侧补 stdio 传输 + 支持"附着既有容器"（详见 §4.1） |
| **反向实现 RPC adapter**（本方案原设计） | 降级为**备选** | 若后端 stdio 支持来不及落地：在 Python 侧实现 guada-agent 协议，转成 Harbor 的 `environment.exec`。依据见下方核实清单，工作量约 1–2 天 |
| `BaseInstalledAgent`：把 GuaDa 装进任务容器 | ❌ 否决 | 需要 Node 运行时 + Prisma/SQLite，每个任务镜像都要加一层，镜像体积与构建时间爆炸；且宿主机看不到会话日志，排障困难 |
| 容器内跑 `guada-agent` + **端口映射** | ❌ 否决（已被 stdio 取代） | 受限点本来是"Harbor 无法给容器追加 `-p`"，属于传输层限制而非方案缺陷——改走 stdio 后限制不复存在 |
| 宿主工作区 + 手动同步进容器 | ❌ 否决 | agent 无法在容器内跑测试验证自己的修改，等于砍掉一半能力，分数严重偏低 |
| 新写 `DockerWorkspaceProvider`（"正统"路线） | ❌ 无需（已对齐范围） | 在途的 Docker 工作区**已落地**（`docs/docker容器工作区方案.md`），且并未新增 provider 实现：它在既有生产链路（`WorkspaceToolRouter` → `RemoteAgentManager` → `AgentWorkspaceProvider`）上**新增一种连接类型**（`config.kind: "docker"`），工具层与 provider 层零改动。`WorkspaceProviderResolver` 仍是未接线的 Phase 1 抽象，评测与产品都不需要它 |

### 3.4 备选捷径：Harbor 的 SSH stream 模式（已评估，已排除）

> **已被 §3.2 的 stdio 直连取代**。stdio 无需在容器内装任何东西，而本方案要求装 openssh-server，
> 因此不再是主路径；保留本节的唯一价值是把它当作**人工调试通道**（进容器看现场）。

Harbor 的 `BaseEnvironment` 有 `connect_ssh(handle)` / `stream_handle`，Docker 环境在 stream 模式下会
**在容器内装 OpenSSH 并起 sshd**（`environments/docker/docker.py:1098`、`environments/docker/ssh.py`）。
如果可用，理论上可以直接把 GuaDa 现成的 SSH 工作区链路指过去，**连 adapter 协议层都不用写**。

实测否决为主路径（源码 `environments/ssh.py:192-205`）：

```python
"if [ ! -x /usr/sbin/sshd ]; then "
"command -v apt-get >/dev/null 2>&1 || exit 127; "
"apt-get update && apt-get install -y --no-install-recommends openssh-server; fi"
```

- **依赖容器内网络 + apt**：离线任务直接失败，非 Debian 镜像（Alpine 等）无 `apt-get`，`exit 127`
- **修改任务环境**：为跑分往被测镜像里装包，是对 benchmark 环境的侵入
- **只存在于 Harbor**：SWE-bench 路线（§8）没有这层，adapter 迟早要写

**结论**：仍按 §3.2 实现 adapter。但 stream 模式值得花 1 小时 spike 一次（命令：`harbor run` 带 stream 相关开关跑 1 题，
看能否拿到 `SSHAccess`）——如果能稳定拿到，可当作**调试通道**（人工进容器看现场），而不是评测主链路。

---

## 4. GuaDa 侧改动清单

按优先级排列。**第 1、2 项是硬前置**，缺了跑不出有意义的分。

### 4.1 传输与附着（硬前置）

> 本节取代原"透传 devMode 直连"方案——改走 stdio 后不再需要 SSH/端口直连；
> 只有当采用 §3.3 的**备选路径**（Python 侧重实现协议）时才用得上原方案。

**(a) 后端侧 stdio 客户端 —— ✅ 已完成（2026-10-15；以下「当前缺失」为历史记录）**

> 实现：`rpc.ts` 抽出 `RpcTransport`（`WsRpcTransport` / `StreamRpcTransport` 两实现，
> `StreamRpcTransport` 在 `rpc-stream-transport.ts`：`spawn` + NDJSON 按行拆帧），
> `RpcClient` 的请求匹配/心跳/超时/cancel/onDisconnect 全部不动；两个调用点均已改道。
> 心跳结论：`RpcClient` 的心跳是**应用层 RPC** `{method:"ping"}`（`rpc.ts` checkHeartbeat），
> 不是 WS 层 ping/pong，因此经 stdio 管道**原样可用**（agent 的 `ping` 方法本就回 pong），
> 无需新增心跳事件行。细节与验证见 `docs/docker容器工作区方案.md` §3.1。

`guada-agent` 侧已完成（§3.2），**后端侧还没有**。已核实：

- `remote-workspace/rpc.ts:75` 的 `RpcClient` **硬绑 `ws`**：`private ws: WebSocket`、`constructor(ws: WebSocket, ...)`、`this.ws.on("message", ...)`，断开一律走 `transportError("WebSocket closed")`（`:142`）
- 全仓 `new RpcClient(...)` 只有从 WS 构造的调用点（`remote-workspace-agent-manager.ts:283`、`agent-deploy.ts:463`）
- 全仓无 `docker exec` / 容器工作区代码（`grep stdio` 只命中 MCP 客户端，与工作区无关）

两条实现路线：

| 路线 | 做法 | 代价 |
|---|---|---|
| **(a1) 传输抽象化**（推荐） | 把 `RpcClient` 拆成"消息进出 + 关闭/错误事件"的传输接口；WS 一份实现，**子进程 stdio 一份实现**（`spawn` + 按行拆 NDJSON） | 改动 rpc.ts + 两个调用点；心跳语义需重做 |
| (a2) 本地 WS 代理 | spawn `docker exec -i` 后在本机起一个仅监听 127.0.0.1 的 WS 服务，把字节泵到管道 | `RpcClient` 一行不改，但多一跳、多一个端口 |

**心跳语义差异（必须处理）**：WS 模式靠 ping/pong 探测连接新鲜度
（`rpc.ts:191`、`HeartbeatOptions{intervalMs, deadlineMs}`，用例见 `rpc.spec.ts:94/113`）。
管道没有 ping/pong——**agent 挂死时不会被判为"连接失效"，只能等单个请求超时**。
两种处理：让 agent 在 stdio 模式周期性输出一条心跳事件行；或由评测 driver 的墙钟预算兜底（§4.5 已要求）。

**(b) 附着既有容器 —— ✅ 已确认：在途工作正是「只附着、不创建」**

> 范围对齐结论（2026-10-15）：Docker 工作区 v1 **只接入已有容器**；`container` 字段接受
> **容器名或 ID**，经 `docker inspect` 直接解析；GuaDa **不创建、不停止、不删除**容器。
> Harbor 侧只要把容器 id 传给连接配置即可（无需「按镜像起一个」的模式），不存在额外一层桥。
> 两个评测相关注意点：① **agent 版本门禁**——容器链路要求 agent ≥ 0.6.0，且线上 latest
> 低于 0.6.0 时会被自动忽略（退回本地缓存），跑分前需确保已发布 0.6.0 或本地缓存就位；
> ② 容器需有可写可执行的 `/tmp`（或 `/var/tmp`、`/dev/shm`）与 `sh`，只读 rootfs / distroless 不支持。

历史原文（当时推测在途工作是「GuaDa 自己创建并持有容器」，故要求先对齐——现已确认相反）：

在途的 Docker 工作区大概是"**GuaDa 自己创建并持有容器**"。评测场景正好相反：
**容器由 Harbor 创建，GuaDa 只是附着上去**。需要 `containerId: <既有容器>` 这种模式，
而不是"按镜像起一个"。这是"接入成本几乎为零"与"还要写一层桥"的分水岭，**必须先对齐**。

Harbor 侧拿到容器 id 的三个办法（按可靠性待实测排序）：

1. 在 adapter（Python，与 Harbor 同进程）里直接读 `DockerEnvironment` 实例的容器句柄（若未开 stream 模式，`stream_handle` 可能不可用——需实测哪些属性稳定可得）
2. 容器内执行 `hostname`——Docker 默认把 hostname 设为短容器 ID；**但 Harbor 若自定义 hostname 则失效**，需实测
3. `environment.exec("cat /proc/self/cgroup")` 解析容器 ID——不依赖约定，但 cgroup v1/v2 格式不同，需分支处理

**二进制注入**：`guada-agent/dist/guada-agent-linux-amd64` 是**静态链接 ELF**（10MB），
用 Harbor 的 `upload_file` 推进容器（如 `/usr/local/bin/guada-agent`）即可。
注意**架构匹配**：本机是 amd64，跑 arm64 镜像需换 `guada-agent-linux-arm64`。

### 4.2 工具路由：会话级默认远端工作区（硬前置）

现状：`workspace-router.ts:55` 按**工具参数** `workspace` 路由，缺省值即"本地"。
模型只要有一次忘了传 `workspace=<conn>`，该次调用就落到宿主 fs，行为不可预测。

> **2026-10-15 核实：这一项仍未实现**。落地的 Docker 工作区方案明确写了
> "连接类型新增 Docker（**workspace 路由语义不变**）"。缓解措施是绑定快照与提示词注入
> （`RemoteBindingStateService` 会把绑定连接写进会话上下文，让模型知道该传什么名字），
> 但**那不构成保证**——评测仍必须在 driver 里断言轨迹中的工具路径前缀。

改动：会话 settings 增加 `defaultWorkspace`，`WorkspaceToolRouter` 解析顺序改为
`工具参数 workspace` → `会话 defaultWorkspace` → `本地`。评测时把 `defaultWorkspace` 设成容器连接。

> 这同时是**产品能力**：用户绑定一个 SSH / 容器工作区后，本来就不该每次手动传 workspace。

### 4.3 无头化：禁用阻塞类工具（硬前置）

- `ask_user`（`builtins/ask-user.plugin.ts:138`）与 `ExitPlanMode`（`builtins/plan-mode.plugin.ts:125`）
  都经 `InteractionWaitService.waitForAnswers`，**无超时、永久挂起**（`interaction-wait.service.ts:45`）
- 无 headless 开关。两条路：
  - **推荐**：agent frontmatter 里 `settings.toolkits_deny` 剔除 `ask-user` / `plan-mode` 两个工具包（`plugin.manager.ts:456-467`）
  - 备选：评测 driver 监听 SSE `stream/ask_requested` 自动应答 `POST /api/v1/chat/respond`（`chat.controller.ts:196-252`）
- **必须保持 SSE 长连接**：审批类逻辑 fail-closed，`hasAnswerSurface()` 为假时直接拒绝
  （`jsonl-session-context.ts:851-855`、`shell.plugin.ts:627`、`file.plugin.ts:1169/1209`）

### 4.4 沙箱：评测期间关闭

建会话时 `settings.sandboxMode = "danger-full-access"` → `sandboxForMode` 返回 `undefined`，沙箱不介入
（`common/services/sandbox-policy.ts:16`）。注意：远程 workspace 链路本来就不经本地沙箱
（`agent-workspace-provider.ts` 的 `execute` 直发 agent RPC），但本地兜底路径会经，关掉以免混入变量。
另外**不要开计划模式**（会强制 read-only）。

### 4.5 循环预算：评测侧兜底

`agent-engine.service.ts:483` 的 `do { ... } while (needToContinue)` **对轮次与总 token 无上限**，
只有续跑拦截器上限 3 次（`:476`）。评测 driver 必须自己做预算：

- 墙钟超时 → `POST /api/v1/chat/stream/:sessionId/stop`（`chat.controller.ts:142`）
- 轮次/token 上限 → 监听 SSE `stream/usage` 累计，越界即 stop
- 判定"一轮结束"：**用 `stream/turn_end`**（或轨迹落盘的 `turn/finish`）。
  ⚠️ **2026-10-15 实测纠正**：普通 SSE 订阅者**收不到** `session/stream_status_changed`
  ——它只发给该流的所属客户端。实测订阅到的事件是
  `stream/turn_start / user_message / block_start / block_end / tool_call_delta / tool_calls_response / text_delta / finish / turn_end`。
  **不要**用 `stream/finish`（那是每条助手消息的，一轮里会出现多次）

> 后续可考虑把 `maxTurns` / `maxTokens` 做成 agent settings 的一等字段，评测与线上都需要。

### 4.6 成本上报（第二阶段）

GuaDa 目前只有 token 统计（`chat/token-meter.service.ts:28`）**没有 $ 折算**。
Harbor 的 leaderboard 是 cost-aware 的（准确率与花费并列），所以 adapter 要在
`populate_context_post_run` 里把 token/成本写回 `AgentContext`，否则横向比较缺一维。

---

## 5. Harbor 侧 Adapter 设计

### 5.1 形态：薄编排（协议层与注入都不需要）

采用 §3.2 的 stdio 直连后，adapter **既不承担协议实现，也不承担二进制注入**，只做三件事：
解析容器标识、让 GuaDa 建一条指向该容器的 stdio 连接并建会话、驱动对话。

```python
from harbor.agents.base import BaseAgent
from harbor.environments.base import BaseEnvironment
from harbor.models.agent.context import AgentContext

class GuaDaAgent(BaseAgent):
    @staticmethod
    def name() -> str: return "guada"

    def version(self) -> str | None: return "0.6.0"

    async def setup(self, environment: BaseEnvironment) -> None:
        # 1) 解析容器标识（§4.1(b)）——推荐用 environment.session_id 匹配容器名
        # 2) POST /api/v1/remote-workspace/connections
        #      {name, config: {kind:"docker", container:<标识>, path:<容器内工作目录>,
        #                      perm:"unrestricted"}}
        #    （注入、平台探测、版本门禁由 GuaDa 侧自动完成）
        # 3) 建会话：POST /api/v1/sessions {agentId, modelId,
        #      workspacePath, settings:{ sandboxMode:"danger-full-access",
        #                                toolkits_deny:[ask-user, plan-mode] }}
        #    并把连接 ID 写入会话绑定 attachments["ssh-connection"]
        ...

    async def run(self, instruction: str, environment: BaseEnvironment,
                  context: AgentContext) -> None:
        # 先挂 SSE，再 POST /api/v1/chat/stream {sessionId, userMessage:{content: instruction}}
        # 等 session/stream_status_changed → completed/error
        # 超预算未完成 → POST /api/v1/chat/stream/:sessionId/stop
        # 结束时删除连接（避免并行 trial 的连接泄漏）
        ...

    def populate_context_post_run(self, context: AgentContext) -> None:
        # 汇总 stream/usage 事件 → token / 成本
        ...
```

注册方式：**不注册名字**，直接把 `module.path:ClassName` 传给 `-a`（Harbor 进程需能 import 到）：

```bash
harbor run -d terminal-bench/terminal-bench@4.0.0 -e docker \
  -a guada_adapter.agent:GuaDaAgent -m <providerId:modelName> \
  -l 3 -k 1 -n 1 --job-name smoke
```

**并发注意**：每个 trial 一个容器 = 一条 stdio 连接 = 一个会话。
`-n 4` 就是 4 条连接并行，需要 GuaDa 侧确认多连接并发与空闲回收行为
（`workspace-provider.resolver.ts` 的 PluginRegistry 工厂 + 空闲回收机制看起来是为此设计的，需实测）。

### 5.2 备选路径的 RPC 映射（仅当不走 stdio 时才需要）

| guada-agent RPC | 实现 |
|---|---|
| `ping` | 常量返回 |
| `execute` | `environment.exec(command, cwd=..., env=..., timeout_sec=..., user=...)` → `ExecResult{stdout, stderr, return_code}`。**Harbor 的字段是 `return_code`，不是 `exitCode`**。后台进程（`kind: backgrounded`，`process.go:118-390`）MVP 可不支持 |
| `readFile` / `readFileRange` | `environment.download_file(path, local_tmp)` 读回宿主；或 `exec("cat ...")`（纯文本场景） |
| `writeFile` | 写宿主临时文件 → `environment.upload_file(local_tmp, target)`；小文件可 base64 + `exec` |
| `replaceInFile` | 读-改-写，保留 `oldString/newString` 语义（与 `file.plugin.ts` edit 工具一致） |
| `glob` / `grep` | 容器内 `find` / `grep -rn`，输出按 `search.go:20`(`pattern/path/maxResults/ignore`)、`glob.go:19` 结构回填 |
| `stat` / `readdir` / `mkdir` / `unlink` / `rename` | 容器内 `ls -la --time-style` / `mkdir -p` / `rm` / `mv`，字段对齐 `file_ops.go` |
| `cancel` / `poll` / `kill` / `writeStdin` / `drainCompleted` | 后台进程管理；MVP 阶段可先只支持前台 `execute`（评测任务的命令多可同步完成），后续补齐 |
| `upload*` / `download*` / `watch` / `unwatch` | MVP 可不实现，收到即返回 `error: unsupported`（file.plugin 对旧 agent 有降级路径） |

**MVP 建议只实现**：`ping / execute / readFile / readFileRange / writeFile / stat / readdir / glob / grep / mkdir / unlink / replaceInFile`。
这套覆盖 `file.plugin.ts` 五个工具 + `shell.run_command` 的全部主路径，足以跑通 Terminal-Bench。

### 5.3 冒烟策略

先不接 GuaDa，用示例客户端验证 adapter 抽象层：写一个 Node/Python 脚本（仿 `smoke-rpc.cjs`）对着
adapter 依次调 `ping → readFile → execute("echo hi") → writeFile → grep`，喂一个 `docker run -d` 的
`ubuntu:24.04` 容器。**这一步不依赖 Harbor**，可以独立调试协议正确性。

### 5.4 已核实的 Harbor SDK 接口（0.24.0，本机实装验证）

从本机安装的 `harbor` 包源码确认（`site-packages/harbor/`），不是文档推断：

```python
# agents/base.py
class BaseAgent(ABC):
    @staticmethod @abstractmethod
    def name() -> str: ...                                  # :325
    @abstractmethod
    def version() -> str | None: ...                        # :330
    @abstractmethod
    async def setup(self, environment: BaseEnvironment) -> None: ...   # :341
    @abstractmethod
    async def run(self, instruction: str,
                  environment: BaseEnvironment,
                  context: AgentContext) -> None: ...       # :357
    def populate_context_post_run(self, context: AgentContext) -> None: ...  # :411

# environments/base.py
class ExecResult(BaseModel):                                # :104
    stdout: str | None
    stderr: str | None
    return_code: int

async def exec(self, command: str, cwd: str | None = None,
               env: dict[str, str] | None = None,
               timeout_sec: int | None = None,
               user: str | int | None = None) -> ExecResult: ...   # :1186

async def upload_file(self, source_path, target_path) ...   # :975
async def upload_dir(self, source_dir, target_dir) ...      # :985
async def download_file(self, source_path, target_path) ... # :995
async def download_dir(self, source_dir, target_dir) ...    # :1005
async def is_file(self, path, user=None) -> bool ...        # :1221
async def is_dir(self, path, user=None) -> bool ...         # :1211
```

两个关键语义：

- `exec` 不传 `user` 时**自动用 `environment.default_user`**（编排器在 `run` 之前设好），不要硬编码 root
- `instruction` 由编排器直接作为 `run()` 的第一个参数传入——不需要自己去读任务文件

### 5.5 驱动接口实录（2026-10-15 实测，零成本端到端打通）

**API 契约**（以下均逐条实测，照此即可写 adapter）：

```text
POST   /api/v1/auth/auto-login                  → {access_token}（免密模式可直接用）
POST   /api/v1/remote-workspace/connections      body {name, config:{kind:"docker", container, path, perm}}
                                                 ← {id, ...}；**连接名唯一，重名返回 500**
POST   /api/v1/sessions                          body {agentId, modelId, workspacePath, settings}
                                                 settings.attachments["ssh-connection"]=[connId] 完成绑定
                                                 **agentId 必传**：DTO 标了 @IsOptional，
                                                 但 service 抛 "agentId is required"（session.service.ts:396）；
                                                 agentId = `~/.guada-dev/agents/` 下的目录名（如 code-analyst）
GET    /api/v1/events/sessions                   SSE；头 x-client-id + Authorization
POST   /api/v1/chat/stream                       body {sessionId, userMessage:{content}}
POST   /api/v1/chat/stream/:id/stop              中止（超预算时用）
DELETE /api/v1/sessions/:id                      收尾
DELETE /api/v1/remote-workspace/connections/:id  ← **trial 结束必须做**，否则并行时连接名冲突
```

**成本数据源（2026-10-15 实测修正）**：轨迹里的 `turn/finish` **字段齐全但计数为 0**——
实测两次（自然结束 `stop` 与被界面中止 `user_cancel`）都是
`promptTokens=0 completionTokens=0 cachedTokens=0`，只有 `usedTokens`（上下文占用，如 45382）
与 `breakdown{systemPrompt,history,tools}` 有值，外加 `finishReason / totalDurationMs / modelName`。

**真正的 token 用量只在实时 SSE 的 `stream/usage` 事件里**（前端显示的 "Prompt 35.6K / Completion 1.1K"
就来自它），**没有落盘**。所以 §4.6 的成本上报不能只读轨迹，需要 adapter 自己订阅 SSE 累加
`stream/usage`；`finishReason` 仍可从轨迹可靠获取（用于区分 `stop` / `user_cancel`）。

**轨迹落盘格式**（`<USERDATA_DIR>/sessions/<sessionId>/seg-0000.jsonl`）：

| type | 关键字段 |
|---|---|
| `session/init` | sessionId, title |
| `turn/start` | turnId |
| `user/message` | messageId, content[] |
| `assistant/message` | content[]，内含 `reasoning` / `text` / `tool-call{toolCallId,name,arguments}` |
| `tool/result` | toolCallId, content（字符串）, metadata |
| `turn/finish` | 见上（token 统计） |

**本仓新增的评测资产**：

| 文件 | 用途 |
|---|---|
| `eval/stub-openai-server.mjs` | **脚本化模型桩**（OpenAI 兼容 SSE）：按下发脚本产出指定的工具调用，零成本、确定性、无随机性 |
| `eval/driver/attach-and-chat.mjs` | **驱动**：建连接 → 建会话（含绑定）→ 驱动一轮 → 从轨迹断言（含 SSE 事件统计） |
| `eval/probe/rpc-probe.mjs` | **分层定位探针**：绕过 GuaDa 后端，直连容器内 agent 发 RPC（用于判断问题在 agent/传输 还是后端封装） |
| `eval/probe/*.steps.json` | 脚本场景（引号矩阵、命令替换矩阵、原文复现） |
| `~/.guada-dev/providers/eval-stub.yaml` | 指向本地桩的 provider 实例（仓库外，需保留） |

> 这套东西就是 §10.3 所说"对内消融"的种子：把 `steps.json` 换成一组任务，
> 把桩换成"最小 ReAct 基线"，即可做 harness 回归——而且**不花一分钱、结果可复现**。

---

## 6. 运行环境与前置

### 6.1 已核实（2026-10-15，本机）

| 项 | 状态 |
|---|---|
| Docker Desktop | 已安装，本次已启动，daemon 29.4.3 |
| Windows 侧 Node / pnpm | v25.2.1 / 11.7.0 ✅ |
| `uv`（Windows） | 0.11.32 ✅ → `uv tool install harbor` 可直接用 |
| 可用磁盘 | D: 439G 空闲 |
| GPU | GTX 1050 Ti（4GB VRAM，偏弱） |
| WSL2 | `Ubuntu-AOSP` 运行中；但 Node **v14.15.4**（太老）、**无 uv**、提示 NAT 模式下 localhost 代理未镜像 |

### 6.2 结论：Harbor 与 GuaDa 后端都放 Windows 侧

理由：两边都在 `127.0.0.1` 上，adapter ↔ GuaDa 后端 ↔ RPC server 的互访零配置。
Docker Desktop 的 Linux 容器由 WSL2 后端提供，`docker exec` 从 Windows 侧调用正常。

**WSL 仅作 fallback**（若 Harbor 在 Windows 宿主遇到兼容问题）：届时需在 WSL 内补 Node 20+（`nvm install 22`）
与 `uv`，并把 GuaDa 后端一并移入 WSL——因为 WSL NAT 模式下从 WSL 访 Windows 侧 localhost 需要额外网关地址，
而 GuaDa 的会话落盘（Prisma/SQLite + JSONL）在 `/mnt/d` 上性能也差。

### 6.3 安装

```bash
uv tool install harbor
harbor --help
```
Harbor 官方要求：本地 runtime 只需容器 runtime 已安装，不需要可选 Python 依赖。

**安装后注意 PATH**：`uv tool install` 会把可执行文件放到 `C:\Users\22071\.local\bin`，
该目录默认不在 PATH 上。跑 `uv tool update-shell` 或临时 `export PATH="$PATH:$HOME/.local/bin"`。
装完得到三个等价入口：`harbor` / `hb` / `hr`。

### 6.4 已实测（2026-10-15，Windows 宿主）

| 检查项 | 结果 |
|---|---|
| `uv tool install harbor` | ✅ 安装 **0.24.0** |
| `harbor --version` / `harbor run --help` | ✅ CLI 在 Windows 正常渲染（非 ASCII 边框、ANSI 均正常） |
| `harbor run -d terminal-bench/terminal-bench@4.0.0 -e docker -a oracle -l 3 --print-config` | ✅ 数据集解析成功，输出 `{"datasets":[{"name":"terminal-bench/terminal-bench","ref":"4.0.0","n_tasks":3}]}`（注意解析结果用 **`ref`** 字段） |
| `harbor run ... --dry-run` | ✅ `Dry run OK — 3 trial(s); nothing was run.` |
| `--dry-run` + `--print-config` | ❌ 二者互斥，会抛 `ValueError`，别一起用 |
| Docker daemon | ✅ 29.4.3（`docker desktop start` 启动） |

已确认可用的 `harbor run` 关键开关：`-d/-t/-p`（数据集/任务来源）、`-a`（agent）、`-m`（模型）、
`-e`（沙箱，默认 docker）、`-k`（每任务尝试次数）、`-n`（并发 trial）、`-l`（任务数上限）、
`-i`/`-x`（glob 包含/排除任务）、`-r`（重试次数）、`-o`（jobs 输出目录）、`--job-name`、
`-c`（config 文件，可重复且后者覆盖前者）、`-y`（自动确认）、`--diff <job 目录>`（对比历史 job，
打印 reuse/regrade/rerun 预览——**重评分不必重跑**）、
`--timeout-multiplier` 及 `--agent/--verifier/--agent-setup/--environment-build-timeout-multiplier`。
另外 `/agents/custom-agents` 里的 `--ak`（agent kwargs）与 `--ae`（agent env）可用于传参。

> 生成完整 config 骨架：`harbor job init <file.yaml> --full`；导出 schema：`harbor job schema`。

**jobs 输出目录建议放在仓库外**（如 `D:\AI\guada-eval\jobs`），避免镜像记录与日志污染工作树；
若要放仓库内，先加 `.gitignore` 条目。

---

## 7. 分阶段里程碑

每个里程碑都有**独立可验收的产出**，且都可以在下一步开始前停下来评估。

### M0 · 环境冒烟（0.5 天）— **部分已完成**

```bash
# 0) 最小任务，验证链路本身（比真任务便宜得多）
harbor run -d harbor/hello-world -e docker -a oracle -n 1 --job-name hello

# 1) 任务集能下载、镜像能构建、测试脚本能跑：oracle（参考解）应满分
harbor run -d terminal-bench/terminal-bench@4.0.0 -e docker -a oracle -l 3 -n 1
# 2) 空 agent 应得 0 分（防"评分器恒真"）
harbor run -d terminal-bench/terminal-bench@4.0.0 -e docker -a nop -l 3 -n 1
# 3) 同模型跑一个预集成竞品 harness，作为首个对照臂
harbor run -d terminal-bench/terminal-bench@4.0.0 -e docker -a mini-swe-agent -m <model> -l 3 -k 1
```

**验收**：oracle ≈ 满分、nop ≈ 0、竞品臂有非零分。三者同时成立才说明评分器与容器链路健康。

**进度记录（2026-10-15）**：

| 步骤 | 状态 | 实测结果 |
|---|---|---|
| `--print-config` / `--dry-run` | ✅ | 数据集解析、配置校验通过 |
| oracle 跑真实任务（1 题） | ✅ | **Mean = 1.000，Reward 1.0，0 异常**；总耗时 **20m23s** |
| nop 下界 | ✅ | **3/3 完成，Mean = 0.0**（2 题均 0.0，验证器不会白送分）；总耗时 13m49s |
| 竞品对照臂 | ⬜ 待跑 | 需要真实模型；provider 已就绪（见 §10.2） |

> **nop 顺带暴露的问题**：3 题里有 1 题（`mp-checkpoint-consolidation`）**环境启动超时**
> （`EnvironmentStartTimeoutError`）——任务容器根本没起来。这说明本机存在**资源/超时边界**，
> 需要：跑分前先统计有多少题属于此类（可能与 GPU、内存、镜像大小有关），并用
> `--environment-build-timeout-multiplier` / `--timeout-multiplier` 放宽，或把这类题单列报告。

> **耗时构成提示**：单题 20 分钟绝大部分是**冷启动拉镜像**（环境镜像 1.7GB + 验证器镜像各一份）。
> 镜像命中缓存后会显著变快，但每题的环境镜像不同（按 task 命名），所以**必须预留预热时间**。
> 先用 `harbor/hello-world` 打通，再上真实任务，能省掉一轮长等待。
> 查看结果：`harbor view <jobs-dir>`；上传：`harbor upload <job-dir>`。

### M1 · 容器工作区链路验收（0.5 天）

**后端侧已落地**（§3.2），所以这一步不是"实现"，而是**把现成的验收入口对着 Harbor 造的容器跑一遍**：

```bash
# ① agent 侧协议电池（注入/文件/搜索/执行/后台/权限）
node scripts/test-docker-stdio-agent.cjs <容器>
# ② 真实模块链路（注入 → stdio 连接 → 原语电池 → 路由/会话绑定 → 断线重建 → 只读 rootfs 负例）
npx ts-node backend-ts/src/scripts/docker-workspace-smoke.ts <容器>
```

唯一**未被验证过的接缝**是：这两个脚本此前跑的都是手工起的容器，而 Harbor 造的容器
（命名、非 root 用户、网络策略、镜像构成都不同）能否同样通过——这正是 M1 要回答的。

前置（已核实就位）：本地 agent 缓存需有当前 linux 构建 →
`~/.guada/agent/guada-agent-linux-amd64-v0.6.0` 已存在（10MB，2026-10-15）。

**进度记录（2026-10-15，已对真实 TB 镜像实测）**：

| 检查项 | 结果 |
|---|---|
| TB 环境镜像满足 v1 边界 | ✅ `sh` 存在、`/tmp` **可写且可执行**（非 noexec）、无独立 `/tmp` 挂载、rootfs 可写、root 用户 |
| `docker cp` 注入 + `chmod 755` + `--version` | ✅ 输出 **0.6.0** |
| stdio RPC 全链路 | ✅ `ping → {"pong":"ok","root":"/tmp","version":"0.6.0"}`；`execute → {"exitCode":0,"kind":"completed","output":"hi-from-container\nx86_64\n","uptimeMs":4}`；`readdir` 结构正确 |
| 断开后残留 | ✅ 容器内 `guada-agent` 进程数 **0**；FS 净变化只有 `/tmp/.guada-agent/` |

> **手工冒烟写法警告**：用管道喂请求时**必须保持 stdin 打开**，例如
> `{ printf '…'; sleep 4; } | docker exec -i <c> <agent> --stdio`。
> agent 读到 EOF **立即退出且不 drain 在途请求**（`stream.go` 的设计：EOF 视为客户端拆除链路，
> 响应已无意义），所以"printf 完所有请求就立刻关管道"会看到**空响应**，容易被误判成协议故障。
> 产品链路是长驻连接，不受影响。

**验收**：两个脚本在 Harbor 容器上全绿；断开后容器内无残留 agent 进程；
容器 FS 的净变化只有 `/tmp/.guada-agent/`（一个二进制 + 一个 chmod）。

> 原 M1（在 Python 里重实现十余个 RPC 方法）**已取消**（§3.2/§3.3）；
> 原"手工注入二进制到 `/usr/local/bin`"也不再需要——注入由 `ensureAgentInContainer()` 自动完成。

### M2 · Harbor 端到端打通（1–2 天）

写 adapter 的 `setup/run`（§5.1）；跑 1 个最简单的 Terminal-Bench 任务。

**验收**：agent 在容器内完成任务，任务测试脚本判定通过；会话 JSONL 里能看到工具调用落在容器路径上
（而非宿主机路径——这是防"工具落点漂移"的关键断言）。

**进度记录（2026-10-15）：GuaDa 侧已零成本打通，只剩 Harbor 侧封装**

| 检查项 | 结果 |
|---|---|
| 建连接 / 建会话 / 绑定连接 | ✅（API 契约见 §5.5） |
| `run_command` 落在容器内 | ✅ 输出 `pwd=/tmp`、`host=272a91688012`、根目录列表含 **`.dockerenv`** |
| 文件工具落在容器内 | ✅ `read /etc/hostname` → 返回**容器 hostname**（宿主机根本没有此文件） |
| 工具调用携带 `workspace` 参数 | ✅ 2/2、4/4（两轮独立验证） |
| 路由日志佐证 | ✅ `[WorkspaceToolRouter] Tool target resolved: workspace='eval-container' (docker)` |
| 零残留 | ✅ 连接/会话由 driver 删除；容器内 agent 随管道关闭退出 |
| 成本 | ✅ **0 元**（用脚本化桩替代真实模型） |

> **结论**：M2 的技术风险已经从"整条链路"收敛到"Harbor 侧拿容器标识"这一个点。
> 剩下要做的是把 `eval/driver/attach-and-chat.mjs` 的三步包进 Harbor 的 `BaseAgent.setup/run`，
> 并把 `--container` 的值换成从 `environment.session_id`（或 `docker ps` 名字匹配）推出来的容器名。

### M3 · 首个真实分数（2026-10-15 首次实测）

**第一次真实跑分**：1 题（`layout-config-recreation2`），模型 `<providerId>:deepseek-v4.1-flash`，
**reward = 0.0**，0 异常。链路完全正常，失败在 agent 行为。

| 环节 | 证据 |
|---|---|
| Harbor → adapter | ✅ 容器名 `layout-config-recreation2__sgwuqvg__env-main-1`（与 `sanitize(session_id)-main-1` 预测一致） |
| adapter → GuaDa | ✅ 连接 `harbor-task` + 会话 + 绑定；`WorkingDir=/app` |
| GuaDa → 容器 | ✅ 122 次工具调用全部经 `workspace='harbor-task' (docker)` 落在容器内 |
| 验证器 | ✅ 9 项测试跑完（8 项 FAIL）——**评分链路可信** |

**失败根因（验证器 + 轨迹互证）**：

- 验证器从 `test_output_file_exists` 起连续失败：**`/app/output/config.json` 不存在**
- 轨迹：**122 次工具调用，`write` / `edit` **0 次**，`config.json` **0 次提及****
- 工具分布：`run_command` 75、**`image_view` 25**、**`remote_transfer` 12**、`process` 8、`read` 2
- 它**一开始是找对的**（`ls -la /app/` → `read /app/render.py` → `ls /app/output/`），
  之后 30 分钟全在 `/tmp/work` 里自研像素分析脚本；最后一条思考仍停在
  "Now let me set up the analysis pipeline"

**归因（不夸大）**：轮次是被 **adapter 的 30 分钟上限** stop 打断的（`turn/finish` 缺失），
所以"它最终能否收敛"未证。但到第 30 分钟它连一次 `write` 都没有、也从未提到过
`config.json`——**交付物意识缺失是主因，不是单纯时间不够**。
（下一轮已把 `turn_timeout_sec` 放宽到 3600，让 Harbor 自身的预算生效，保证与竞品对比公平。）

**harness 层面暴露的三条可疑点**（待更多样本确认）：

1. **无交付物收敛压力**：循环既无轮次/预算上限（§4.5），也无"交付前自检"，模型可以无限探索
2. **媒体往返重**：`image_view` 25 + `remote_transfer` 12，图像经 RPC 往返进上下文，可能挤占预算
3. 30 分钟内 75 次 `run_command` 反复自研同类脚本，缺少"复用已得结论"的收敛提示

> 这三条正是评测要回答的问题——**而且它们是 harness 可改的**，不是模型能力问题。

### M4 · 全量 + 上报（2 天）

全量任务 + 多 seed；`populate_context_post_run` 上报成本；结果归档到 `-o jobs/<date>`。
可选：上传 Harbor Hub 取得对外公开排名。

---

## 8. SWE-bench 路线

与 Terminal-Bench 互补：TB 测"终端环境里能不能把事办成"，SWE-bench 测"真实仓库里能不能修对 bug 并过测试"。

### 8.1 两条路线（推荐 A）

**路线 A（推荐）：走 Harbor 数据集**

Harbor registry 已收录 `swe-bench/swe-bench-verified`（500 题）。这意味着 **SWE-bench 与 Terminal-Bench
共用同一个 adapter，零额外接入成本**：

```bash
harbor run -d swe-bench/swe-bench-verified -e docker \
  -a <adapter module>:GuaDaAgent -m <model> -l 20 -k 1 -n 2 -o jobs/sweb
```

容器起停、环境准备、patch 应用、测试判定全部由 Harbor 负责。

**路线 B（交叉验证用）：官方 `swebench` CLI**

只在需要与公开榜单严格对齐、或怀疑 Harbor 封装引入了偏差时使用。流程：

```
对每个 instance:
  1) 起该 instance 的官方镜像（含已装好的 conda 环境）
  2) 用同一个 adapter（§5）把会话工作目录指到容器 /testbed
  3) 喂 problem_statement，跑完一轮
  4) 容器内 git diff → model_patch
  5) 写 predictions.jsonl: {instance_id, model_name_or_path, model_patch}
官方评分:
  swebench eval verified -p predictions.jsonl --run-id <run> -j 4
  swebench report ...
```

### 8.2 要点

- 先跑 20 题切片（`-l 20`）再决定是否全量 500 题——**镜像体积与拉取时间是主要成本**
- 官方 harness 环境要求（路线 B 才需要）：x86_64、≥120GB 空闲磁盘、16GB RAM、8 核；
  `-j` 取 `min(0.75*核数, 24)`，本机 6 核 → `-j 4`
- 路线 B 的环境自检：`swebench eval verified --gold -i <one_instance> --run-id validate-gold`（gold patch 应满分）
- 路线 B 的 ARM64 支持是实验性的；Windows 宿主建议在 WSL2 内跑（Docker 已在 WSL 侧可用）

### 8.3 抗污染备选

SWE-bench Verified 的部分题目已进入训练语料。若怀疑污染影响结论，换用
`swe-rebench/swe-rebench-leaderboard`（860 题，持续更新的抗污染版本），命令完全同构（只换 `-d`）。

---

## 9. 对照组与指标

### 9.1 三条对照臂（缺一不可）

| 臂 | 命令 | 作用 |
|---|---|---|
| **oracle** | `-a oracle` | 环境自检：非满分说明任务/镜像/评分链路有问题 |
| **nop** | `-a nop` | 下界：非 0 分说明评分器被"骗过" |
| **同模型竞品 harness** | `-a mini-swe-agent` / `-a openhands` / `-a claude-code`，`-m` 与我们完全相同 | **这就是"提升还是负优化"的答案**：同一模型、同一任务、官方评分器，唯一变量是 harness |
| **GuaDa** | `-a <module>:GuaDaAgent` | 被测对象 |

Harbor 预集成 agent（`-a` 可选项）中与我们对位的：`mini-swe-agent`（极简基线，最有参考价值）、
`openhands`、`swe-agent`、`claude-code`、`cline-cli`、`opencode`、`goose`、`aider`。

### 9.2 指标

| 指标 | 来源 |
|---|---|
| pass@1 / pass@k（k≥3 降方差） | Harbor job 结果 |
| **成本（$）** | adapter `populate_context_post_run` 上报 |
| 回合数、工具调用数 | GuaDa 侧 `tools/tool-executor.service.ts:200` 插桩 |
| 工具错误率、重试次数 | 同上 |
| 上下文压缩触发次数 | `chat/compaction/compaction.service.ts:90` |
| 墙钟耗时 | driver |
| 超预算未完成率 | driver（stop 次数） |

**方差警告**：agent 评测方差极大（长轨迹 + 工具随机性）。`-k 1` 的差异没有意义，
起步就用 `-k 3`，结论性对比用 `-k 5`，且同一批任务做配对比较（McNemar / bootstrap）。
成本随 `k` 线性增长，先估预算。

### 9.3 建议的 config 文件（可重复、可 version）

```yaml
# eval/terminal-bench.yaml
job_name: guada-tb-ablation
n_attempts: 3
n_concurrent_trials: 4
datasets:
  - name: terminal-bench/terminal-bench
    version: 4.0.0
agents:
  - import_path: guada_adapter.agent:GuaDaAgent
    model_name: <providerId:modelName>
    kwargs:
      backendUrl: http://127.0.0.1:<port>
  - name: mini-swe-agent          # 对照臂，同模型
    model_name: <providerId:modelName>
environment:
  type: docker
```

跑：`harbor run -c eval/terminal-bench.yaml -o jobs/2026-10-15-ablation`
`harbor job init ... --full` 可打印全部可用字段；`harbor job schema` 出 JSON Schema。

---

## 10. 风险、坑与待核实项

### 10.1 必须注意

1. **工具落点漂移**（最高风险）：任何一次"忘了传 workspace"的调用都会静默落到宿主 fs，
   产生看似合理实则无效的轨迹。§4.2 的会话级默认工作区是防御手段，同时建议在 driver 里断言
   轨迹中的路径前缀。
2. **无 maxTurns**：坏掉的 harness 会跑飞并烧掉预算。driver 侧墙钟 + token 双预算，缺一不可。
3. **SSE 长连接不可断**：断了 → `hasAnswerSurface()` 为假 → 审批类工具 fail-closed 直接拒绝，轨迹被污染。
4. **任务污染**：SWE-bench Verified 部分题已进训练语料，Terminal-Bench 官方明确要求数据不入训练语料。
   本地模型对比时排名参考价值下降，报告需注明。
5. **GPU**：部分任务需要 GPU。本机 1050 Ti 4GB 偏弱，建议先跑切片统计 GPU 依赖比例，
   把 GPU 任务单列（计入"未通过"或单独报告），不要静默丢弃。
6. **磁盘**：镜像会持续累积。定期 `docker system prune`；SWE-bench 全量需 ≥120GB。
7. **注入的 agent 二进制**：为跑分往任务容器里写一个文件
   （`<候选目录>/.guada-agent/guada-agent`，实测优先 `/tmp`），不落任务工作目录；
   架构由 `docker inspect` 自动匹配（amd64/arm64 无需人工指定）。风险很低，但应在报告里注明这一偏差。
   注意断开后二进制会保留以便复用（方案文档 §6），试毕容器即销毁，无清理负担。
8. **并行 trial 的连接生命周期**：`-n 4` = 4 条 stdio 连接 + 4 个会话 + 4 个容器内 agent 进程。
   平台侧已有**连接缓存 + 2h 空闲回收 + 断线自动重建**（`onDisconnect` 清缓存，下次调用重建），
   容错较好；但 adapter 仍应在 trial 结束（**含异常/超时路径**）时删除连接，避免无谓占用。
9. **v1 能力边界 vs 任务镜像**（**当前最大的技术不确定项**）：容器工作区要求可用的 `sh` +
   可写且可执行的 `/tmp`（或 `/var/tmp`、`/dev/shm`）；**只读 rootfs / distroless / scratch 不支持**，
   仅 linux/amd64 与 linux/arm64。这类镜像在 Terminal-Bench 里占多少**尚未统计**——
   它直接决定可用题量，需在 M1/M2 期间先摸清。
10. **Git Bash 路径改写**：在 MSYS（Git Bash）里手工执行 `docker exec … /tmp/xxx` 会被改写成
    Windows 路径（容器内会真的出现 `C:/Users/...` 目录）。手工冒烟务必加 `MSYS_NO_PATHCONV=1`。
    产品链路走 Node `spawn`（参数不经 shell）不受影响——**但若评测 driver 用 shell 脚本包装
    docker 命令，同样要加**。
11. **stdio 读吞吐**（项目实测，方案文档 §7）：5MB 单次读 16–17MB/s，对比端口转发 33–49MB/s
    （**慢 1.4–2.8 倍**）；1MB 分块读（工具层真实读法）25–36MB/s；写方向无差异；建连更快（38–68ms vs 78ms）。
    对**分数**无影响，但大文件读场景会略微拉长墙钟耗时，评估超时预算时计入。
12. **一次不可复现的 sh 语法错误（待观察）**：首轮验证中 `run_command` 报
    `sh: 1: Syntax error: Unterminated quoted string`（exit 2）。随后**原文重放同一条命令通过**，
    并另测 9 种命令形态（无引号 / 双引号 / 单引号 / 复合单引号 / 命令替换 / 管道 / 字面 `\n` / 重定向）
    **全部 exit 0**；分层隔离（`eval/probe/rpc-probe.mjs` 直连 agent RPC）也显示命令原样到达、quotes 完好。
    结论：**不可复现，暂记为待观察**，不作为已确认缺陷。若后续再遇，先停止用探针分层定位。
13. **凭据泄露面（运维提醒）**：`GET /api/v1/remote-workspace/connections` 会**明文返回连接密码**。
    adapter / driver **绝不能**原样打印该接口的响应体；本仓的 `eval/driver` 只打印连接 id 与名字，
    保持这个约束。
14. **`remote_transfer` 是未经约束的宿主写入通道（实测发现）**：
    `remote-workspace-agent-manager.ts:893` 的 `download()` 把 `local_path` **原样**交给
    `fs.mkdir(dirname)` + `fs.open(localPath, "w")`——不做会话工作区解析、不做边界校验。
    实测：某次跑分中 agent 用它把容器里的 `/app/data/layout.png` 拉到了
    **`backend-ts/work/`**（后端进程 cwd），污染了仓库工作树。
    对评测的含义：**"一切都发生在容器里"的隔离并不成立**，agent 可以随时往宿主机任意路径写文件
    （也可用本地 `read` 读回来）。缓解：① 评测时用 agent settings 的 `toolkits_deny` 禁掉该工具包；
    ② 已在 `.gitignore` 忽略 `backend-ts/work/`；③ driver 侧可加"轨迹之外出现宿主写入"的断言。
    产品层面则需评估是否需要把 `local_path` 收敛到会话工作区内。

### 10.2 待核实（下一步先做）

- [x] ~~Harbor 在 Windows 宿主的兼容性~~ → **已实测通过**（见 §6.4、§7 M0）
- [x] ~~Terminal-Bench 任务总数~~ → **66 题**（`terminal-bench/terminal-bench@4.0.0`，见 §2.2）
- [x] ~~SWE-bench 是否需要单独接入~~ → **不需要**，Harbor 有 `swe-bench/swe-bench-verified`（500 题）
- [x] ~~在途 Docker 工作区是否支持"附着既有容器"~~ → **支持**：`container` 接受**容器名或 ID**，只接入不托管（§4.1(b)）
- [x] ~~后端是否已有 stdio 客户端~~ → **已有**：`RpcTransport` 抽象 + `StreamRpcTransport`（§4.1(a)）
- [x] ~~M0 的 nop 下界~~ → **Mean = 0.0，0 异常**（§7 M0）
- [x] ~~驱动链路（建连接→建会话→驱动→断言）~~ → **已零成本打通**（§5.5、§7 M2）
- [ ] **Harbor 侧容器标识**：命名规则已从源码确认（compose 项目名 = `_sanitize_docker_compose_project_name(session_id)`，
  `session_id` 形如 `<task>__<rand>__env`，与 trial 目录名同源），仍需**实跑一次验证**名字匹配可行
- [ ] **TB 任务镜像与 v1 能力边界的匹配率**：抽样 1 个真实环境镜像**已通过**（§7 M1 进度记录）；仍需统计**其余 66 题镜像**里 distroless / 只读 rootfs / 无 `sh` 的占比
- [ ] 会话级默认工作区（§4.2）是否落地——决定"工具落点漂移"的风险等级
- [ ] Terminal-Bench 的 **GPU 依赖任务比例**（本机 1050 Ti 4GB 偏弱，需统计后再定切片策略）
- [ ] 单次全量（66 题 × k=1）的**耗时与成本**量级（已知单题冷启动约 20 分钟）
- [ ] GuaDa 多连接并发与空闲回收在 `-n 4` 下的实际行为（§5.1）
- [ ] 竞品对照臂：真实模型已配置（用户 provider 目录下已有实例），跑一次 `mini-swe-agent` 同模型对照

### 10.3 与"对内消融"的关系

本文档解决**对外横向**。**对内消融**（本次 harness 改动 ±X%）需要另一条腿：
自建 30–60 题任务集（含"工具失败恢复"类）+ 极简 ReAct 基线 + 上一版 harness 三方对照。
两者共用 §5 的 adapter 与 §9.2 的指标体系，但消融套件要能**在一个小时内跑完**才有回归价值。
建议在 M3 之后启动。→ 实际已提前落地，见 §11。

---

## 11. 快速重测回路

**问题**：改完 harness 后，怎样最快知道"好了还是坏了"？
直接用真题是最慢的路径——一轮 20–60 分钟，而且真题是长尾难点，改动的信号会被任务难度淹没。

**方案：三档反馈，一条命令。** `./eval/retest.sh {oracle|smoke|tb}`（完整说明见 `eval/README.md`）

| 档 | 命令 | 实测耗时 | 成本 | 回答的问题 |
|---|---|---|---|---|
| **T0 管线自检** | `retest.sh oracle` | **22–36 秒/题** | 0 | 任务/验证器/容器链路健康吗？（**不需要后端与模型**） |
| **T1 冒烟跑分** | `retest.sh smoke` | **41–52 秒/题** | 几分钱 | 模型 + harness 能否完成一个明确的小任务？（带官方式判分） |
| **T2 真题跑分** | `retest.sh tb 1` | 20–60 分钟/题 | 视题而定 | 真实 benchmark 分数 |

**一次完整 T1（两个任务）= 1 分 57 秒**——这才是可以"边改边跑"的速度。

### 11.1 为什么 T0/T1 能这么快

本地任务的镜像刻意用**已缓存的基础镜像（`debian:bookworm`）且不装任何包**：构建秒级、零网络依赖；
验证器也是纯 bash（不装 pytest / uv）。真题做不到这点——每个任务的镜像都是 1.7GB 级且各不相同，
首次运行的主要成本就是拉镜像。

### 11.2 两个冒烟任务（本身就是回归用例）

| 任务 | 考察 | 实测（GuaDa + `deepseek-v4.1-flash`） |
|---|---|---|
| `smoke-01-write` | 按指定路径产出交付物（**交付物意识**） | ✅ **1.000**，41 秒，4 次工具调用 |
| `smoke-02-fix` | 读代码 → 定位缺陷 → 修好 → 跑通验收（**自检闭环**） | ✅ **1.000**，52 秒，6 次工具调用 |

> **这两个任务 GuaDa 是能过的**——说明前两道真题的 0 分不是链路问题，而是"题目难度 + agent 发散探索"。
> 这个区分很关键：**先确认基座能过简单题，再去攻真题**，否则会把链路故障和能力不足混为一谈。

### 11.3 三条纪律

1. **先跑 T0**：oracle 参考解都拿不到 1.000 的任务是**坏任务**，别在坏任务上烧模型额度
2. **验证器要防作弊**：`smoke-02` 故意用三个不同名字（含空格与非 ASCII）验证，就是为了挡"把输出写死"
3. **失败要能一眼归因**：`tests/test.sh` 里多打 `ls -la` / `cat -A`，区分"没产出交付物"与"产出得不对"

### 11.4 怎么看解题过程（三条路）

| 方式 | 命令/入口 | 特点 |
|---|---|---|
| **⓪ 实时围观（推荐）** | `./eval/watch.sh smoke`（或 `tb 1`） | 起后端+界面+开跑，并**自动打开本次运行的会话**；边跑边看，发现问题当场停 |
| **① GuaDa 自己的界面** | `GUADA_KEEP=1 ./eval/retest.sh smoke` → 会话列表点 `harbor guada HH:MM:SS` | 跑完回看：推理链、工具调用、结果、图片均有渲染 |
| **② `harbor view`** | `harbor view D:/AI/guada-eval/jobs -p 8080` | benchmark 视角：多任务/多 agent 的分数与耗时汇总 |
| **③ 轨迹查看器（本仓自带）** | `eval/viewer/trajectory.html`（拖入 JSONL） | 可分享/可归档；不需要启动应用 |

**实时停止的实测行为**（2026-10-15）：界面上点停止 → GuaDa 落 `turn/finish` 且
`finishReason=user_cancel` → adapter 轮询到后立即返回 → **Harbor 按当前容器状态判分**。
实测 22:46:43 点击停止 → 22:47:24 出分，**全程 41 秒**（agent 实际工作 157 秒被中止）。
这条链路让"发现跑偏就停"成为可用的迭代手段，而不是等几十分钟。

**会话直达链接**：`http://localhost:5173/chat/<sessionId>`（前端支持，可直接收藏/分享）。

> **关键事实**：评测会话就是**普通的 GuaDa 会话**——它们写在与日常相同的 `USERDATA_DIR` 里，
> 所以应用界面天然就能看。唯一的门槛是 adapter 默认 `keep_session=false`（避免污染会话列表），
> 想看要显式打开：`--ak keep_session=true`（或脚本的 `GUADA_KEEP=1`）。

**轨迹导出位置**：Harbor 每次 trial 都会把完整轨迹写到
`jobs/<job>/<trial>/agent/guada-transcript.jsonl`——这是 §11.4 第 ③ 条的数据源，也是出问题时唯一的现场。

### 11.5 下一步该加什么任务

按首次真题失败的形态扩充（§7 M3 的诊断）：加"**必须改动多个文件**""**必须跑测试才算完**"
"**工具会报错、要恢复**"三类。它们正对应真题里失败的三种形态，比再加十道真题更有分辨力。
