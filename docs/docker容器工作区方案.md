# Docker 容器工作区方案

> **版本**: 1.0
> **日期**: 2026-10-15
> **状态**: 已实施（agent 0.6.0 + 后端/前端全链路）
> **定位**: 《[统一工作目录操作接口-合并远程工作目录方案](统一工作目录操作接口-合并远程工作目录方案.md)》的第二种连接类型：
> 在 SSH 远程主机之外，把**运行中的 Docker 容器**挂成附加工作目录。

---

## 1. 目标与边界

**目标**：用户在同一个会话里，除了本地主工作目录与 SSH 远端，还能把一台**正在运行的容器**
（VS Code devcontainer、`docker compose` 起的服务、手工 `docker run` 的调试容器）挂进来，
AI 直接用 `workspace="连接名"` 在容器内读写文件、搜索与执行命令。

**v1 边界（明确不支持，均有明确报错）**：

| 类别 | 边界 | 原因 |
|---|---|---|
| 容器来源 | 只**接入**已有容器，GuaDa 不创建、不停止、不删除 | 容器是用户的资源；托管创建属后续独立能力 |
| 镜像 | 需要可用的 shell（`sh`）与可写、可执行的 `/tmp`（或 `/var/tmp`、`/dev/shm`） | agent 的 `execute` 依赖 `sh -c`；注入需要可写目录 |
| 只读 rootfs / distroless / scratch | 不支持 | 无法注入可执行文件或无法执行命令（实测报错：`Read-only file system`） |
| 平台 | 仅 linux/amd64 与 linux/arm64 容器 | agent 是 POSIX 静态二进制；Windows 容器请改用 SSH 工作区 |
| 交互终端（PTY） | 暂不提供 | 与 SSH 现状一致（远程终端为工具层能力，非 xterm 面板） |

---

## 2. 与 SSH 链路的对应关系（为什么复用面这么大）

工作区功能的"传输缝"极窄：后端与目标端之间最终只有一条 JSON-RPC 连接。SSH 只承担
**推二进制 / 起进程 / 端口转发**三件事，Docker 上前两件有原生替代（`docker cp` / `docker exec`），
第三件由 stdio 管道直接省掉：

| 环节 | SSH | Docker | WSL 发行版（第三种类型，见 [WSL 工作区方案](wsl工作区方案.md)） |
|---|---|---|---|
| 传输 | **agent ≥ 0.6.0：`ssh exec '<agent> --stdio'`（NDJSON over exec channel）**；< 0.6.0：端口转发 → `ws://127.0.0.1:<port>/ws`（Bearer token，legacy 回退） | `docker exec -i <c> <agent> --stdio`（NDJSON 管道，免 token） | `wsl.exe -d <distro> --exec <agent> --stdio`（NDJSON 管道，免 token） |
| 推送二进制 | SFTP `fastPut`，失败回退 `cat >` + 字节校验 | `docker cp`，失败回退 `docker exec -i sh -c 'cat >'` | stdin 直传（`cat >`，sha256 实测一致）→ `mv -f` 落位；`/mnt/<盘>` cp 兜底 |
| 起进程 | `ssh exec` 长驻通道（stdin EOF = 退出）；legacy 为 `nohup agent --port 0` | 长驻 `docker exec -i`（stdin EOF = 退出） | 长驻 `wsl.exe --exec`（stdin EOF = 退出，实测无孤儿） |
| 版本/架构探测 | `uname -s/-m`（+ 本地二进制 `--version` 校验） | `docker inspect` + `docker image inspect`（不经容器内任何命令） | 发行版内一次探针：`uname -s/-m; id -un; $HOME; command -v sh` |
| 权限 | agent `--perm readonly/workspace/unrestricted` | 同左（同一 agent、同一套服务端强制） | 同左 |
| 版本门禁 | 远端 < 0.6.0 自动回退端口转发；latest 低于 0.6.0 时忽略（不降级） | 要求 ≥ 0.6.0；latest 低于下限时忽略并退回本地缓存 | 同左（与 Docker **共用同一实现**：`cli-agent-install.ts`） |

两侧都改走 stdio 后，**容器与 SSH 共用同一个传输实现**（`rpc-stream-transport.ts` 的 NDJSON 分帧 +
`ssh-stdio-transport.ts` 的通道生命周期），差别只在"谁来提供 stdin/stdout"（子进程 vs SSH exec channel）；
WSL 上线时进一步把 Docker/WSL 的"候选目录 + 版本门禁 + 注入复验 + 握手"抽为共享内核
`cli-agent-install.ts`（Docker 侧导出签名保持不变，回归见 [WSL 工作区方案](wsl工作区方案.md) §3.5）。

**完全复用、零改动**的层：`RemoteAgent` 包装、`AgentWorkspaceProvider`（原 `SshWorkspaceProvider`）、
`WorkspaceToolRouter` 的 `workspace` 参数路由与会话绑定校验、`r:<连接名>:<pid>` 进程命名空间、
turn.stopping 后台进程收割、输出编码（`outputB64` + iconv）、连接缓存与 2h 空闲回收、
断线自动重建、绑定快照与提示词注入（`RemoteBindingStateService`）、连接配置的 AES-256-GCM 加密存储。

---

## 3. 关键设计决策

### 3.1 传输：stdio（NDJSON）而非端口映射

容器内 agent 以 `--stdio` 在 stdin/stdout 上提供与 WebSocket **完全相同**的 JSON-RPC
（`guada-agent/stream.go`，复用同一 `dispatch`）：

- 无需容器端口映射，因此对用户容器零网络改动；也绕开了"编译期无法给容器加 `-p`"的场景（如评测容器）；
- 无需容器内有 sshd，也不往镜像里装任何依赖；
- 管道仅宿主侧 docker 客户端可达，天然隔离（等价 SSH 链路里 Bearer token 的防护目的）。

协议要点：一行一条 JSON 消息（`json.Marshal` 输出天然单行）；读侧不设行长上限
（`readFile`/`writeFile` 的请求行可达数 MB）；写侧每条消息立即 Flush。**不要给 `docker exec`
加 `-t`**：TTY 会做 CRLF 转换并缓冲，破坏二进制安全与实时性。

后端侧抽象为 `RpcTransport` 接口（`rpc.ts`）：`WsRpcTransport`（SSH）与
`StreamRpcTransport`（容器，`rpc-stream-transport.ts`）两种实现，`RpcClient` 的
请求匹配、心跳判死、超时兜底、cancel、shutdown 推送、onDisconnect 全部不变。

### 3.2 注入与生命周期

`docker-agent-connect.ts` 的流程（每个连接按需执行一次，之后走缓存）：

```
docker inspect（运行状态 + 镜像 Os/Architecture + WorkingDir）
  → 候选目录探测：/tmp → /var/tmp → /dev/shm（mkdir + 版本检查 + 注入后 --version 校验）
  → 需注入时：本地缓存/下载二进制 → docker cp → chmod 755 → 再校验可执行
  → 工作目录校验（容器内 test -d）
  → docker exec -i <c> <agent> --stdio --root <path> --perm <perm>
  → ping 握手（校验 pong.root，不一致仅告警）
```

- **容器归用户**：GuaDa 只写 `<目录>/.guada-agent/` 并运行 agent 进程，绝不 stop/rm 容器。
- **断开即退出**：agent 读到 stdin EOF 即自行退出（实测：本地 docker 客户端被强杀时，
  docker 守护进程关闭 exec 流 → agent 退出，无孤儿进程）；`StreamRpcTransport.close()`
  先关 stdin，3s 未退出则 kill 本地客户端兜底。
- **重连/重建**：容器被重启或删除 → 传输关闭 → 现有 `onDisconnect` 清缓存，下次调用自动重建；
  容器未运行时报错明确提示 `docker start`，不会被笼统的传输错误掩盖。

### 3.3 agent 版本门禁（重要）

容器工作区要求 **agent ≥ 0.6.0**（`--stdio` 能力）。实测教训：若按既有"跟随线上 latest"
策略把 0.4.5 注入容器，旧版 agent 收到 `--stdio` 会打印 flag usage 并退出，握手静默失败。
因此 Docker 链路的版本规则是：

1. latest 接口返回的版本 **低于 0.6.0 时忽略之**（日志说明），退回本地缓存二进制；
2. 复用容器内既有 agent 前先校验版本 ≥ 0.6.0，否则重新注入；
3. 注入后仍低于下限 → 明确报错（提示更新下载地址或本地缓存），不留必然失败的连接。

> 发布顺序要求：主程序带 Docker 工作区发版时，agent 需同步发布 ≥ 0.6.0 并更新线上 latest.json
> （`guada-agent/release.sh`）。在线上未更新前，容器链路会自动使用本地缓存二进制。

### 3.4 连接模型与展示

连接配置以 `kind` 为判别字段（现有实现为 `SshConnectionConfig | DockerConnectionConfig | WslConnectionConfig`）。

```jsonc
// SSH（旧数据无 kind，读时归一为 "ssh"，零迁移）
{ "kind": "ssh", "host": "...", "port": 22, "username": "...", "authMethod": "password|privateKey", "path": "...", "perm": "workspace" }
// Docker
{ "kind": "docker", "container": "容器名或 ID", "path": "/容器内/工作目录", "perm": "workspace", "dockerHost": "可选，docker -H" }
// WSL（第三种连接类型，详见 docs/wsl工作区方案.md）
{ "kind": "wsl", "distro": "Ubuntu-22.04", "path": "/发行版内/工作目录", "perm": "workspace" }
```

- 会话绑定键沿用 `attachments["ssh-connection"]`（存的是连接 ID 列表，本就与类型无关，零迁移）；
- 提示词 / 绑定快照 / 信息卡按类型渲染：SSH → `user@host:port`，Docker → `容器名（容器内路径）`；
- 设置向导第 0 步为「连接类型」选择，Docker 表单含**运行中容器下拉**（`GET /remote-workspace/docker/containers`，
  即 `docker ps`）与可选 Docker 主机；第 2 步目录浏览复用同一 POSIX browse 命令，经 `docker exec sh -c` 执行。

---

## 4. 代码地图

| 层 | 文件 | 说明 |
|---|---|---|
| agent（Go，子模块 `guada-agent`） | `stream.go` / `rpc.go` / `main.go` | `--stdio` NDJSON 传输；`HandleConnection` 与 stdio 共用 `handleMessage` |
| 连接层 | `backend-ts/src/modules/remote-workspace/docker-agent-connect.ts` | Docker 适配器：inspect / 注入 / 连接 / 浏览 / 容器列表 + 纯函数（解析、平台映射、版本比较）；"候选目录 + 版本门禁 + 注入复验 + 握手"通用流程在 `cli-agent-install.ts` |
| 共享内核 | `.../cli-agent-install.ts` | Docker / WSL 共用的 `CliAgentEnv` 适配器接口与实现（`ensureAgentInCliEnv` 等；见 [WSL 工作区方案](wsl工作区方案.md) §3.5） |
| WSL 适配器 | `.../wsl-agent-connect.ts` | 发行版列表/探测、stdin 注入（`/mnt` cp 兜底）、`wsl.exe --exec --stdio` 长连接（第三种连接类型，见 [WSL 工作区方案](wsl工作区方案.md)） |
| 传输层 | `.../rpc.ts`、`.../rpc-stream-transport.ts` | `RpcTransport` 抽象；WS 与 stdio 两种实现 |
| 连接管理 | `.../remote-workspace-agent-manager.ts` | `getAgent` 校验/缓存/回收不变；`connectSsh` / `connectDocker` / `connectWsl` 分派 |
| 路由 | `.../workspace-router.ts`、`.../agent-workspace-provider.ts` | 按连接的 `kind` 决定 `provider.scheme`；工具层无感 |
| 服务/接口 | `.../remote-workspace.service.ts`、`.../remote-workspace.controller.ts` | test/deploy/browse 按 `kind` 分派；容器列表接口 |
| 前端 | `frontend/src/components/setting/ConnectionSettings.vue`、`services/modules/remote-workspace.api.ts`、`stores/remoteWorkspace.ts`、`components/chat/workspace/WorkingDirBar.vue` 等 | 类型选择、容器下拉、按类型图标（SSH 云 / 容器方块）与文案 |

---

## 5. 验收与测试入口

| 层 | 入口 | 覆盖 |
|---|---|---|
| Go 单测 | `cd guada-agent && go test ./...`（`stream_test.go`） | NDJSON 分帧、并发分发、大消息（2MB）、坏行容错、EOF 退出、shutdown 广播、写失败钩子 |
| 后端单测 | `npx jest src/modules/remote-workspace` | 既有 54 项 + `docker-agent-connect.spec.ts`（inspect 解析、平台映射、版本下限、`-H` 组装） |
| 容器协议冒烟 | `node scripts/test-docker-stdio-agent.cjs [容器]` | 直接对容器内 agent 跑全部 RPC 方法（注入/文件/搜索/执行/后台/权限） |
| 后端链路冒烟 | `npx ts-node src/scripts/docker-workspace-smoke.ts [容器]` | 真实模块链路：注入 → stdio 连接 → 原语电池 → 路由/会话绑定校验 → 断线重建 → 只读 rootfs 负例 |
| 前端 | `npx vue-tsc --noEmit`、`npx vitest run` | 类型与 421 项单测；向导全流程已人工走通（新建→测试→浏览→部署→保存→删除） |

前置：本地 agent 缓存需存在当前构建的 linux 二进制（`cd guada-agent && make linux-amd64 && cp dist/guada-agent-linux-amd64 ~/.guada/agent/`）。

---

## 6. 运维与坑位

- **Git Bash 下的路径改写**：在 MSYS（Git Bash）里执行 `docker exec ... /tmp/xxx` 会被改写成
  Windows 路径（出现容器内 `C:/Users/...` 目录）。开发调试请加 `MSYS_NO_PATHCONV=1`；
  产品链路走 Node `spawn`（参数不经 shell），不受影响。
- **Docker 权限面**：能访问 Docker socket 等价宿主高权限。桌面形态为用户本机可接受；
  Web/服务端部署形态如需开放容器连接，应自行评估（后端能访问 daemon 才有此能力）。
- **Docker 主机**：连接配置可填 `dockerHost`（`tcp://host:2375`、`ssh://user@host` 或 context 名），
  依赖本机 `docker` CLI 与该主机可达。
- **/tmp 被 noexec 挂载**的加固镜像：注入后无法执行 → 自动回退 `/var/tmp`、`/dev/shm`，
  全部失败时报错列出每个候选的原因。
- **容器内残留**：断开后 agent 自行退出；`<目录>/.guada-agent/` 二进制会被保留以便下次复用
  （与 SSH 链路一致），需要清理可手动删除该目录。

---

## 7. 传输形态对比（端口转发 vs stdio，实测）

本机 loopback（Alpine 容器 + sshd，同一 agent 二进制、同一 RPC 电池）：

| 指标 | 端口转发 + WS | ssh exec + stdio |
|---|---|---|
| 小 RPC（stat ×300） | p50 ≈ 1.06ms | p50 ≈ 0.89–1.09ms（两次运行翻转，**无实质差异**） |
| 单条 5MB 读 | 33–49 MB/s | **16–17 MB/s**（exec 的 stdout 是管道，sshd 需多一层拷贝进 channel） |
| 1MB 分块读 ×5（工具层真实读法） | 42–45 MB/s | 25–36 MB/s |
| 5MB 写（1MB 分块） | 19–24 MB/s | 21–26 MB/s（无差异） |
| 连接建立 / 重连 | 78ms / 106ms | 38–68ms / 39–68ms |

结论：时延与写方向无差别，读方向 stdio 慢 1.4–2.8 倍（工具层本就是 1MB 分块读，且真实网络下
由链路带宽与 SSH 加密主导，差距被稀释）；换来的是**不再要求端口转发**——实测 Alpine 的 openssh
默认 `AllowTcpForwarding no`，旧链路在该环境下直接失败，stdio 不受影响。
对比脚本：`backend-ts/src/scripts/ssh-stdio-vs-forward-bench.ts`。

## 8. 后续可扩展（未实施）

- **GuaDa 托管容器**：按镜像 + 挂载创建会话级容器（挂载项目目录到 `/workspace`），连接即建即用；
  需要额外的容器命名、回收与 `--rm` 策略（属独立能力，本方案已为其留出连接层插入点）。
- **PTY 终端**：`docker exec -it` 接入 xterm 面板（后端已有本地 node-pty 通道，需并列一条远端通道）。
- **原生 exec 原语模式**：对 distroless / 只读 rootfs 容器，用 `docker exec`/`docker cp` 直接实现
  WorkspaceProvider（无需注入二进制）；代价是重造分块/编码/后台进程语义，仅在明确需要时做。
- 容器内 `git`、文件树面板等周边能力，与 SSH 链路同属"可经同一 provider 抽象逐个接入"的范畴。
