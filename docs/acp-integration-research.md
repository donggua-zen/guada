# ACP 集成调研报告

> 调研日期：2026-11-08
> 状态：调研结论 + 实现蓝图（未实施）
> 参考项目：D:\AI\nomifun-desktop（NomiFun，本项目前身生态，曾实现 ACP 双端）

## 0. 结论先行

| 问题 | 结论 |
|---|---|
| 本项目能否实现 ACP？ | **能，且两条线都能。** 关键接入缝（引擎调度点、外部输入驱动范式、审批 UI、SSE 事件流）全部现成 |
| 协议层要自研吗？ | 不用。官方 TS SDK `@agentclientprotocol/sdk`（原 `@zed-industries/agent-client-protocol`）提供 `AgentSideConnection` / `ClientSideConnection` 两端封装 |
| 参考项目能抄代码吗？ | **不能**。nomifun 在 v0.6.4（2026-08-18）"引擎收敛"时把 ACP 连同 ~19 个第三方 CLI 适配整体删除，本地仓库是 shallow clone 无历史。能借鉴的是它的架构决策与教训 |
| 先做哪条线？ | **线 A（被控制：GuaDa as ACP Agent）先行**。nomifun 删掉的正是"控制别人"线（成本原因），保留的是"被控制"方向——实践检验过的一条经验 |
| 进程形态？ | 线 A 用**薄适配器**：stdio 入口经 HTTP+SSE 连本机运行中的 GuaDa 后端，不拉 headless |

---

## 1. ACP 协议概述

ACP（Agent Client Protocol）是 Zed 编辑器团队发起、Google 联合落地的开放标准，定位"AI 编程智能体界的 LSP"。规范站：[agentclientprotocol.com](https://agentclientprotocol.com)。

### 1.1 两种角色

```
┌─────────────────┐   JSON-RPC 2.0 (stdio)   ┌──────────────────┐
│  Client（宿主）   │ ◄──────────────────────► │  Agent（智能体）    │
│  Zed / JetBrains │  initialize / session/*  │ Claude Code 等    │
│  或任意编辑器     │  fs/* / terminal/*       │ / GuaDa           │
└─────────────────┘                          └──────────────────┘
```

- **Client**：编辑器/宿主。掌管**文件系统与终端**（agent 要读写文件须经 client 中转），负责 UI 呈现、diff 审查、权限审批。拉起 agent 子进程。
- **Agent**：被 client 通过 stdio 拉起的子进程，完成握手后接收 prompt、流式回吐结果。

### 1.2 核心方法表

| 方向 | 方法 | 作用 |
|---|---|---|
| C→A | `initialize` | 握手，交换协议版本与能力目录（authMethods、promptCapabilities、loadSession 支持、_meta 厂商扩展） |
| C→A | `session/new` | 新建会话，agent 返回 sessionId；**cwd、mcpServers 在此传入** |
| C→A | `session/prompt` | 提交一轮用户输入（content blocks 数组），返回 `{stopReason}` |
| A→C | `session/update`（通知流） | 流式回吐：`agent_message_chunk` / `agent_thought_chunk` / `tool_call` / `tool_call_update` / `plan` / `available_commands_update` |
| A→C | `session/request_permission` | 请求权限（`allow_once` / `allow_always` / `reject_once`…），client 弹 UI，阻塞等待 |
| C→A | `session/cancel` | 取消当前轮 |
| C→A | `session/load` | （可选能力）恢复既有会话上下文 |
| A→C | `fs/read_text_file` / `fs/write_text_file` | agent 请求 client 读写文件（文件系统归 client 掌管的核心体现） |
| A→C | `terminal/create` / `terminal/output` / `terminal/wait_for_exit` | agent 请求 client 代跑终端命令（可选能力） |

### 1.3 官方 TS SDK

npm 包 `@agentclientprotocol/sdk`（`@zed-industries/agent-client-protocol` 已更名迁移，最新 0.4.x 系列）。两个核心类：

- `AgentSideConnection` — 实现 agent 一侧：包装 stdio 的 JSON-RPC，注册 `newSession` / `loadSession` / `prompt` / `cancel` 等 handler，拿到 `AgentConnection` 句柄用于主动发 `session/update` 与请求 `fs/*`。
- `ClientSideConnection` — 实现 client 一侧：spawn agent 子进程、发 `initialize` / `session/new` / `session/prompt`，接收 update 通知与权限请求回调。

生态内还有官方桥接包 `@zed-industries/claude-code-acp`，把 Claude Code CLI 包装成 ACP agent（Claude Code 原生只说自家 SDK，不说 ACP）；Gemini CLI 原生支持（`gemini --experimental-acp`）。

---

## 2. nomifun-desktop 考古与教训

### 2.1 时间线

| 版本 | 事件 |
|---|---|
| v0.5.x 及以前 | ACP 全功能在线：ACP client 引擎 + ~19 个 CLI 适配（Claude Code / Codex / Gemini CLI / Qwen / Kimi / Cursor / Copilot / Goose / OpenCode / Droid / CodeBuddy…），以"ACP adapter 扩展"从 Agent Hub 市场安装 |
| v0.6.0 | ACP 引擎代码移入 `guada-agent` 独立子模块仓库 |
| **v0.6.4（2026-08-18）** | **"引擎收敛"：ACP、OpenClaw Gateway、Nanobot、Remote Agent 一次性删除，not deprecated, not feature-flagged**。CHANGELOG 原话："with ACP go the ~19 third-party CLI integrations" |
| 现状 | 对外暴露方向改走 MCP（`/mcp` 入口，`open/turn/observe/cancel` 四工具），作者原话："**That is the opposite arrow and was never part of ACP.**" |

> 注：本地 `D:\AI\nomifun-desktop` 是 2026-11-08 的 shallow clone（单 commit），历史需 `git fetch origin --unshallow` 从 gitee（5746 commits）拉取后 checkout v0.6.3 以前才能读到 ACP 源码。本次调研基于现存"架构化石"（CHANGELOG、残留类型、迁移脚本注释）还原。

### 2.2 为什么删（教训）

CHANGELOG 自述（v0.6.4 段，约 :306-421）：每个能力设计五次、降级四次、测试矩阵爆炸；每家 CLI 的 ACP 实现质量参差（`session/load` 支持度、`_meta` 扩展、模型切换粘性各不相同），per-vendor 特判无底洞。

### 2.3 留下来可借鉴的设计化石

- **Agent 注册表**：`AgentMetadata { agent_id, command, args, env, backend, agent_source_info }` + `probe_resolved_command()`（PATH 探测，区分 `BridgeMissing` / `PrimaryMissing`）→ 线 B 的注册表字段设计直接参考。
- **厂商兼容策略记录**：`BehaviorPolicy` 中 `session/set_model`（`self_identity_sticky`）、`session/load` 不支持时走 `session/new` + `_meta.<vendor>.options.resume`（`session_load_via_meta_field`）——线 B 遇到兼容性问题的解法先例。
- **错误分类词汇表**：`UserAgentAcpInitFailed` / `HandshakeFailed` / `ProtocolMismatch` / `AuthRequired` / `SessionNotFound` / `Disconnected` → 线 B 的错误处理直接沿用这套语义。
- **transport 无关复用**：同一 handler 同时供 HTTP/WS/stdio 三形态 → 本项目的对位物是 `bot-gateway` 的适配器层（见 §3.1）。

---

## 3. 本项目接入缝盘点

本项目（GuaDa）架构对 ACP 双端意外地友好，四条缝全部现成：

### 3.1 外部驱动对话的成熟范式：bot-gateway

`backend-ts/src/modules/bot-gateway/` 已实现"外部平台消息进来 → 驱动会话 → 事件回流"完整链路，线 A 与它是**同构问题**：

- 平台适配器（`adapters/wechat-personal-bot.adapter.ts`、`discord-bot.adapter.ts`、`qq-bot.adapter.ts`…）把各家协议翻译成统一入站消息；
- `services/bot-orchestrator.service.ts:88 enqueueMessage` → `chatRunner.startStream`（`chat-runner.service.ts:470` 附近有调用对位）驱动引擎；
- `services/session-mapper.service.ts:35 SessionMapperService` 维护"外部平台 ID ↔ GuaDa 会话 ID"映射——ACP 的 `session/new`/`session/load` 会话映射是同一问题；
- 事件回流：订阅 `SessionEventsService` 的全局 SSE。

### 3.2 引擎调度单点与 sessionType 扩展位

- `chat-runner.service.ts:814 runAgentEngine` 是**唯一引擎调度点**：引擎直发模式，`agentEngine.run()`（`agent-engine.service.ts:328`）内部经 `sessionContext.publishStream` 发布流事件，chat-runner 只做流生命周期收尾。线 B 的分流点就在这里。
- `session-context.ts:109`：`sessionType: "web" | "bot" | "sub_agent"` —— 新增 `"acp"` 类型有明确扩展位。

### 3.3 流事件全集与审批闭环

- 流事件契约：`modules/chat/types/event-chunk.types.ts:315 SessionStreamEvent`（`message_chunk` / `tool_calls_response` / `ask_requested` / `ask_resolved` / `turn_start` / `turn_end` / `context_stats` …），带 `seq` + `streamBootId` 幂等游标——与 ACP `session/update` 通知流的语义一一对应。
- 审批闭环：`common/types/ask.types.ts:78 AskRequest` / `:55 AskCardKind`；后端 `AskService` 发 `ask_requested` SSE 帧并原地阻塞，前端 `components/chat/SessionCards.vue` 渲染审批卡，`POST /api/v1/chat/respond` 唤醒。ACP `session/request_permission` ↔ 这套机制是同构问题。
- 权限策略：`modules/policy` + `toolPolicy` 白名单 + `shell/process-manager.service.ts` 的进程管控（Win32 Job）。

### 3.4 前端零改动的前提

前端 `services/modules/streamProjector.ts` 把 `SessionStreamEvent` 投影成消息树，`MessageToolCalls.vue` / `ToolDiffView.vue` / `SessionCards.vue` 已具备工具调用、diff、审批卡渲染。**只要线 B 把 ACP update 正确映射成 SessionStreamEvent，前端现有 UI 原样可用。**

---

## 4. 线 A 设计：被控制（GuaDa as ACP Agent）— Phase 1

> 目标：让 Zed（或任何 ACP client）通过 `guada-acp-agent` 命令拉起 GuaDa 的智能体能力。GuaDa 桌面应用需在运行（已确认接受此形态）。

### 4.1 形态：薄适配器

```
Zed ──stdio──► guada-acp-agent (Node, ~300 行) ──HTTP/SSE──► GuaDa 后端 (NestJS, 已运行)
                    ▲ ACP 协议翻译层                              ▲ 复用全部现有引擎
```

- 新增 stdio 入口：`backend-ts/src/bin/acp-agent.ts`，npm script `acp:agent`。
- 连接方式：HTTP REST + SSE 连 `LISTEN_HOST:PORT` 的本机后端，JWT token 经环境变量 `GUADA_ACP_TOKEN` 传入（用户在 GuaDa 设置页生成专用 token）。
- GuaDa 未运行 / token 无效 → 握手阶段返回清晰 ACP error（可探测 `/api/v1/health` 后失败退出，Zed 侧显示连接错误）。

### 4.2 方法映射表（核心设计）

| ACP 方法 | GuaDa 动作 | 说明 |
|---|---|---|
| `initialize` | 探测后端健康 + token 校验 | 声明 `loadSession: true`、promptCapabilities 含 `image`（视后端支持） |
| `session/new` | `POST /api/v1/sessions` 建会话（sessionType 用 `bot` 或新增 `acp`）；workspace cwd 写入会话 | 记入适配器内的 sessionId 映射 |
| `session/load` | 按映射找到既有 GuaDa 会话 | 映射表落盘在 `~/.guada/acp-agent-mapping.json` |
| `session/prompt` | `POST /api/v1/chat/stream`（带 `await`，拿到 `stopReason` 才返回） | content blocks 直通（text/image） |
| `session/update` ← | 订阅 `/api/v1/events/sessions` SSE，按 sessionId 过滤投影：`message_chunk`→`agent_message_chunk`、`tool_calls_response`→`tool_call`/`tool_call_update`、`turn_end`→本轮结束信号 | `ask_requested` 特殊处理，见 4.3 |
| `session/cancel` | `POST /api/v1/chat/stream/:sessionId/stop` | |
| `fs/read_text_file` / `fs/write_text_file` | **适配器直接读写本地磁盘**（Zed 把 cwd 交给 agent，文件系统本来就在同一台机器上） | 不经 GuaDa 后端 |
| `session/request_permission` ← | 把 GuaDa `ask_requested` 审批请求**反桥接**成 ACP 权限请求发给 Zed | 用户在编辑器里点批，双端审批体验二选一，见 4.3 |

### 4.3 审批桥接的关键决策

`ask_requested`（AskService 在 GuaDa 前端弹卡并原地阻塞）与 ACP `session/request_permission`（发给 Zed 弹 UI 并阻塞）不能同时生效，否则一个工具调用两处审批。两条路：

- **方案 a（MVP 推荐）**：线 A 会话的审批卡走 ACP 侧——适配器拦截 `ask_requested` SSE 帧，翻译成 `session/request_permission` 发给 Zed，用户在编辑器里批。GuaDa 前端不弹卡（可通过 sessionType 区分）。
- **方案 b**：GuaDa 桌面弹卡审批，ACP 侧不发权限请求（声明 read-only 能力降级）。适合"GuaDa 主导、编辑器只是窗口"的定位。

MVP 选 a：编辑器用户心智上 expects 权限审批在编辑器内；且方案 b 需要改动 AskService 的分发逻辑，动作更大。

### 4.4 Zed 侧接入示例

```jsonc
// Zed settings.json
{
  "agent": {
    "agent_servers": {
      "GuaDa": {
        "command": "node",
        "args": ["D:/AI/ai_chat/backend-ts/dist/bin/acp-agent.js"],
        "env": { "GUADA_ACP_PORT": "3000", "GUADA_ACP_TOKEN": "..." }
      }
    }
  }
}
```

### 4.5 Phase 1 文件清单（预估）

| 文件 | 职责 |
|---|---|
| `backend-ts/src/bin/acp-agent.ts`（新） | stdio 入口，`AgentSideConnection` 装配 |
| `backend-ts/src/bin/acp/session-bridge.ts`（新） | SSE 订阅 + SessionStreamEvent→session/update 投影 |
| `backend-ts/src/bin/acp/session-mapping.ts`（新） | ACP sessionId ↔ GuaDa sessionId 落盘映射 |
| `backend-ts/src/bin/acp/api-client.ts`（新） | 后端 REST/SSE 客户端（token 认证） |
| `backend-ts/package.json` | 加 `acp:agent` script + `@agentclientprotocol/sdk` 依赖 |

现有代码**零改动或仅注册级改动**（如 sessionType 联合类型加 `"acp"`）。

---

## 5. 线 B 设计：控制别人（GuaDa as ACP Client/Host）— Phase 2

> 目标：在 GuaDa 的聊天 UI 里驱动 Claude Code / Gemini CLI 等外部 agent，像用自家引擎一样。**nomifun 删除的就是这条线，需要以更克制的形态做。**

### 5.1 对冲 nomifun 教训的三条纪律

1. **通用注册表，不做 per-vendor 特判**：所有外部 agent 一律 `command/args/env` 配置描述，严格按 SDK 类型走协议；厂商差异（如 `session/load` 不支持）统一走 `_meta` 兼容策略，不写 if (vendor === 'claude')。
2. **单一降级路径**：能力协商失败 → 明确报错并禁用该 agent，不做静默降级重试（nomifun 的"降级四次"即成本来源）。
3. **引擎并列而非侵入**：ACP 会话是独立引擎路径，不与 `AgentEngine` 共享内部状态，只共享流事件契约。

### 5.2 架构

```
ChatRunner.runAgentEngine ──sessionType==="acp"──► AcpSessionEngine（新）
                                                      │
                                          ClientSideConnection.spawn
                                                      │
                                    ┌─────────────────┼─────────────────┐
                                    ▼                 ▼                 ▼
                                Gemini CLI      claude-code-acp    任意自定义 agent
                             (原生 --experimental-acp) (@zed-industries 桥)   (注册表配置)
```

- `sessionType` 新增 `"acp"`（`session-context.ts:109` 扩展）。
- `chat-runner.service.ts:814 runAgentEngine` 分流：`sessionType === "acp"` 时不调 `agentEngine.run`，改调 `AcpSessionEngine.run(sessionContext, userMessage, signal)`，返回对齐现有 `{ finishReason, followUpUserInput }` 形状。
- 会话存储复用 JSONL 体系（turn/message 照常落库），LLM 相关的 promptAssembler/compaction 对 acp 会话短路。

### 5.3 外部 Agent 注册表

- 配置文件：`<USERDATA_DIR>/agents-acp/config.json`（或沿用 agents 目录的 markdown frontmatter 风格，`agent-file.store.ts` 同款）：
  ```jsonc
  {
    "id": "gemini-cli",
    "name": "Gemini CLI",
    "command": "gemini",
    "args": ["--experimental-acp"],
    "env": {},
    "enabled": true,
    "probe": { "kind": "path" }   // 启动前 PATH 探测，缺失时前端明确置灰（参考 nomifun probe_resolved_command）
  }
  ```
- 内置预设两个：`gemini-cli`（原生 ACP）、`claude-code`（`npx @zed-industries/claude-code-acp` 桥接）。
- 设置页新增 tab（`components/setting/` 下加 `AcpAgentSettings.vue`，对位 `ComputerUseSettings.vue` 的模式）。

### 5.4 事件回流映射（前端零改动的关键）

| ACP `session/update` | GuaDa `SessionStreamEvent` |
|---|---|
| `agent_message_chunk` | `message_chunk`（delta 文本） |
| `agent_thought_chunk` | `message_chunk`（reasoning 块，前端已有 ThinkingSection） |
| `tool_call` / `tool_call_update` | `tool_calls_response`（含 completed 状态与 rawInput/rawOutput） |
| `plan` | `message_chunk`（plan markdown）或复用 PlanPanel 事件 |
| `available_commands_update` | 暂忽略（或注入 slash 命令补全，二期） |

写文件类 tool_call 的 diff：从 `tool_call.kind === "edit"` + `rawInput` 提取 old/new，映射进 `tool_calls_response` 的事件负载，`ToolDiffView.vue` 现成渲染。

### 5.5 权限与生命周期

- 外部 agent 的 `session/request_permission` → 复用 `AskService` 发 `ask_requested`（cardKind 建议新增 `acp-permission`）→ 前端 `SessionCards.vue` 渲染 → `POST /chat/respond` 唤醒 → 翻译回 ACP permission outcome（`allow_once` / `reject_once`…）。
- 取消：现有 `POST /chat/stream/:sessionId/stop` → abortController → 映射 ACP `session/cancel` 通知。
- 进程托管：spawn 模式参考 `shell/process-manager.service.ts`（Windows 下 Win32 Job 防孤儿）；进程意外退出 → 错误分类沿用 nomifun 词汇表（`HandshakeFailed` / `ProtocolMismatch` / `Disconnected`）发布 `error` 事件。
- 每轮一连接 vs 长连接：MVP 用**每轮 spawn + prompt 完即收**（stateless，nomifun `TurnBoundaryRecycle` 同款），规避长连接状态同步复杂度；`session/load` 支持的 agent 可在配置里开 `keepAlive`。

---

## 6. 分期路线图

| 阶段 | 内容 | 规模 | 依赖 |
|---|---|---|---|
| **Phase 1** | 线 A 薄适配器 + Zed 实测 | ~5 个新文件，零现有改动 | `@agentclientprotocol/sdk` |
| **Phase 2a** | 线 B 骨架：sessionType `"acp"` + `AcpSessionEngine` + Gemini CLI 预设跑通握手与流式 | 新增 1 个 service + 注册表，`runAgentEngine` 加一个分支 | SDK + Gemini CLI |
| **Phase 2b** | 线 B 补全：claude-code-acp 预设、权限卡桥接、diff 映射、取消、错误分类、设置 UI | 叠加 | Phase 2a |
| （远期） | 线 A headless 自拉起模式；available_commands 注入；多 agent 并行会话面板 | — | — |

## 7. 风险清单

| 风险 | 影响 | 对策 |
|---|---|---|
| GuaDa 未运行时线 A 不可用 | 编辑器侧体验断 | 已接受的形态决策；握手期清晰报错 + 后续可加 headless（远期项） |
| 审批跨进程时延（线 A 方案 a：Zed↔适配器↔后端↔GuaDa 前端） | 工具调用卡顿感 | MVP 选方案 a 后链路其实只有 Zed 侧一处 UI，无跨端双审批 |
| SDK 与协议双端并发演进 | 版本漂移 | 锁定 minor 版本；AC `initialize` 里做协议版本协商（SDK 内置） |
| Windows stdio 编码/换行 | 子进程通信乱码 | 参考本项目已有的 `computer-sidecar-client.ts` stdio JSON-RPC 经验（`electron/computer-sidecar-client.ts`） |
| 外部 CLI agent 质量参差（nomifun 删除主因） | 线 B 维护面膨胀 | §5.1 三条纪律；能力缺失一律显式报错 |
| token 管理不当导致本地提权面 | 安全 | 专用 token + 默认只绑 127.0.0.1 + 文档明示 |

## 8. 验证方案

### 线 A（Phase 1）

1. **ACP 官方 harness**：SDK 仓库提供 amplet/测试工具，先离线校验适配器协议符合性。
2. **Zed 实测**（§4.4 配置）：用例清单——
   - 握手（initialize 返回能力目录）
   - `session/new` 后发送 prompt，Zed 收到流式回复
   - 让 agent 写一个文件 → Zed 内 diff 审查
   - 触发一次需要审批的操作 → Zed 弹权限 UI，allow/reject 两路
   - `session/cancel` 中断长任务
   - GuaDa 后端停止后重新发起 prompt → 清晰错误
3. **单测**：投影层（SessionStreamEvent → session/update）纯函数单测，参考 `bot-gateway/services/*.spec.ts` 体例。

### 线 B（Phase 2）

1. 手动配置 Gemini CLI，验证：握手、流式回复进 GuaDa 消息树、JSONL 落库。
2. 挂 claude-code-acp 预设，验证：初始化失败（命令不存在）的错误分类、权限审批卡弹起与唤醒、取消中断、进程中途被杀的 `Disconnected` 处理。
3. 前端回归：现有 web 会话零感知（sessionType 隔离）。

---

## 附录：调研中核实的参考

- 协议规范：agentclientprotocol.com；Zed ACP 博客（zed.dev/blog/bring-your-own-agent-to-zed）
- SDK：npm `@agentclientprotocol/sdk`（`@zed-industries/agent-client-protocol` 的更名延续，0.4.x）
- Claude Code 桥：npm `@zed-industries/claude-code-acp`
- 本项目关键文件：`chat-runner.service.ts`（startStream :157 / enqueueMessage :313 / runAgentEngine :814）、`session-context.ts:109`、`agent-engine.service.ts:328`、`event-chunk.types.ts:315`、`ask.types.ts:55/78`、`bot-gateway/services/session-mapper.service.ts:35`、`session-events.controller.ts:22`
- nomifun-desktop：v0.6.4 CHANGELOG（:306-421）、`nomifun-api-types/src/agent_discovery.rs`（BehaviorPolicy）、`agent_error.rs:41`
