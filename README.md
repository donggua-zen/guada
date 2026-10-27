# ⚡ GuaDa AI — 把你的电脑变成 AI 工作站

> **看得见、摸得着、能动手**的本地优先 AI 工作站。桌面端开箱即用，Web 端私有部署，手机浏览器随时远程接管；一个 Agent 引擎统一服务 **Web / 桌面 / IM / 移动端**。

<p align="center">
  <a href="https://gitee.com/zhendongdong/guada_ai/stargazers"><img src="https://gitee.com/zhendongdong/guada_ai/badge/star.svg?theme=dark" alt="stars"></a>
  <a href="https://gitee.com/zhendongdong/guada_ai/members"><img src="https://gitee.com/zhendongdong/guada_ai/badge/fork.svg?theme=dark" alt="forks"></a>
  <img src="https://img.shields.io/badge/NestJS-11.x-red.svg" alt="NestJS">
  <img src="https://img.shields.io/badge/Vue-3.x-4FC08D?logo=vue.js&logoColor=white" alt="Vue">
  <img src="https://img.shields.io/badge/TypeScript-6.x-blue.svg" alt="TypeScript">
  <img src="https://img.shields.io/badge/Electron-41-47848F?logo=electron&logoColor=white" alt="Electron">
  <img src="https://img.shields.io/badge/Prisma-7.x-2D3748?logo=prisma&logoColor=white" alt="Prisma">
  <img src="https://img.shields.io/badge/license-MIT-brightgreen.svg" alt="MIT">
</p>

<p align="center">
  <a href="#-项目介绍"><b>💡 项目介绍</b></a> ·
  <a href="#-与同类工具对比"><b>📊 对比</b></a> ·
  <a href="#-核心能力"><b>🧠 核心能力</b></a> ·
  <a href="#-移动端远程控制"><b>📱 移动端</b></a> ·
  <a href="#-远程工作区本地大脑远程手脚"><b>🖥️ 远程工作区</b></a> ·
  <a href="#-快速开始5分钟上手"><b>🚀 快速开始</b></a> ·
  <a href="#-文档索引"><b>📚 文档索引</b></a> ·
  <a href="#-常见问题"><b>❓ 常见问题</b></a> ·
  <a href="https://gitee.com/zhendongdong/guada_ai/issues"><b>💬 反馈</b></a> ·
  <a href="#-社区"><b>🤝 加入社区</b></a>
</p>

<p align="center">
  <a href="README.en.md">English</a> · 
  <a href="https://gitee.com/zhendongdong/guada_ai">Gitee</a> ·
  <a href="https://github.com/donggua-zen/guada">GitHub</a> ·
  <a href="https://gitcode.com/donggua_sherlock/GuaDaAI">GitCode</a>
</p>

---

## 📖 项目介绍

GuaDa 是一个**本地优先**的开源 AI 工作站——它不只是聊天框，而是一个能动手干活的 AI 工作台：读写文件、执行命令、操控内嵌浏览器，在 Windows 上还能截屏、点击、输入，替你操作桌面应用。任务从规划到执行自动闭环。

一套 Agent 引擎，四种使用方式：**桌面端**开箱即用，**Web 端**可私有化部署，**手机/平板浏览器**随时远程接管，**QQ / 企业微信 / 飞书 / Discord / 微信** 群里也能直接召唤。配合 RAG 知识库、Skills 技能和定时任务，它能查你的资料、按你的习惯工作、在你睡觉时继续干活。模型接入不绑定单一厂商，支持 OpenAI / Anthropic / Gemini 协议与多家国内外供应商模板。数据默认存在你自己的机器上，安全可控。

需要动用**服务器、NAS、虚拟机、开发板**上的文件时，它还能在同一个会话里把多台机器挂载进来——AI 留在本机，只把手伸进去。详见 [🖥️ 远程工作区](#-远程工作区本地大脑远程手脚)。

无论你是写脚本追热点的**新媒体人**、想让 Agent 代写代码的**程序员**、需要把资料沉淀成知识库的**创作者**，还是想搭一个绑定知识库、接入 IM 的内部 AI 助手的**团队**——GuaDa 都能直接上手。如果这个项目对你有帮助，欢迎点亮 Star ⭐，你的支持是持续更新的动力。

---

## 🖼️ 产品截图

<p align="center">
  <img src="./images/demo_task.gif" width="45%" alt="定时任务演示">
  <img src="./images/demo_solar.gif" width="45%" alt="浏览器自动化：采集太阳系数据">
</p>
<p align="center">
  <img src="./images/demo_game.gif" width="45%" alt="Agent 操控游戏">
  <img src="./images/demo_kb.gif" width="45%" alt="知识库使用">
</p>
<p align="center">
  <img src="./images/themes_1.png" width="45%" alt="浅色主题界面">
  <img src="./images/themes_2.png" width="45%" alt="深色主题界面">
</p>

---

## 📊 与同类工具对比

| 维度 | **GuaDa** | Claude Code | Codex | Trae Work |
|------|:---------:|:-----------:|:-----:|:---------:|
| **产品定位** | 🏠 通用 AI 工作站 | 💻 编程 Agent | 💻 编程 Agent | 📋 AI 任务执行平台 |
| **开源** | ✅ MIT | ❌ | ✅ CLI | ❌ |
| **自托管 Web 部署** | ✅ | ❌ | ❌ | ❌ |
| **Desktop 桌面端** | ✅ | ✅ | ✅ | ✅ |
| **Bot / IM 接入** | ✅ QQ·企微·飞书·Discord·微信 | ❌ | ❌ | ❌ |
| **知识库 (RAG)** | ✅ 混合检索·40+ 格式 | ❌ | ❌ | ⚠️ 代码索引 |
| **浏览器自动化** | ✅ 内嵌·可视操控 | ✅ | ⚠️ | ⚠️ |
| **远程 / 多机开发** | ✅ SSH·Docker·WSL，同一会话 | ⚠️ | ⚠️ | ⚠️ |
| **移动端远程控制** | ✅ 手机浏览器接管工作台 | — | — | — |
| **多 Agent** | ✅ 独立配置·可嵌套 | ⚠️ 仅子代理 | ⚠️ 仅子代理 | ❌ |
| **数据本地可控** | ✅ | ❌ | ❌ | ❌ |

> `—` 表示未提供同类能力或未核实；对比仅保留与 GuaDa 定位相关的维度。

---

## 🧠 核心能力

| 能力 | 亮点说明 | 文档 |
|------|---------|------|
| **🤖 智能体（Agent）** | ReAct 多轮自治循环 + 子 Agent 分层委派，支持会话锁、流式输出、中断与重答覆盖 | [→ 详情](docs/agent-engine.md) |
| **👥 子 Agent 系统** | 角色/模型/工具/MCP/Skills 独立配置，复杂任务自动拆解 → 委派执行 → 结果归集 | [→ 详情](docs/sub-agent.md) |
| **🧭 工作流编排** | 输入 `/workflow` 显式发起多子代理编排：模型现场生成脚本，按阶段并行/串行调度并汇总结果 | [→ 设计文档](docs/workflow-subagent-plan.md) |
| **📱 移动端远程控制** | 手机/平板浏览器接管桌面端完整 Web UI：对话、审批、终端、文件、会话；局域网扫码或公网 SSH 反向隧道，息屏/断网自动重连 | [→ 详情](docs/mobile-access.md) |
| **🖥️ Computer Use（Windows）** | Agent 截屏、点击、输入、操作窗口；默认关闭，动作需审批，仅 Windows x64 | [→ 详情](docs/COMPUTER_USE.md) |
| **🔌 插件系统** | 核心功能插件化（浏览器/文件/搜索/定时任务/Computer Use 等），PluginBase 生命周期 + 热插拔即时生效，工具包级权限过滤 | — |
| **📚 知识库 (RAG)** | 语义 + 关键词双混合检索，Agent 自助多轮搜索与写入，支持 **40+ 文件格式**（含 OCR） | [→ 详情](docs/knowledge-base.md) |
| **🛠️ 技能管理** | 文件即技能，chokidar 热更新即时生效，渐进式加载省 Token | [→ 详情](docs/skills.md) |
| **⏰ 定时任务** | Agent 按 Cron 或一次性计划自动执行，独立会话隔离，完整执行记录 | [→ 详情](docs/scheduler.md) |
| **🤖 Bot 网关** | 统一接入 **QQ / 企业微信 AI Bot / 飞书 / Discord / 个人微信**，自动重连、消息合并、动态启停 | [→ 详情](docs/bot-gateway.md) |
| **🌐 浏览器自动化** | Electron 内嵌 Chromium，`browser_run` 脚本化驱动，locator 动作时实时解析，AX 语义快照回传 | [→ 详情](docs/browser-script.md) |
| **🖥️ 远程工作区** | 把**服务器·NAS·虚拟机·开发板（SSH）**、**运行中的 Docker 容器**与**本机 WSL 发行版**挂成「附加工作目录」，本地与多台远程同一会话 | [→ 详情](#-远程工作区本地大脑远程手脚) |
| **🛡️ 安全与审批** | Linux/macOS 走 OS 沙箱（Landlock/Seatbelt）；Windows 走命令策略 + 审批（用户档位为工作区可写/自由编辑，只读由计划模式提供）；移动访问强制密码 | [→ 详情](docs/windows-command-policy.md) |
| **🔗 MCP 集成** | 原生支持 MCP 协议（stdio / SSE / streamableHttp），接入外部工具生态 | — |
| **📦 多部署方式** | Electron 桌面 + Web 应用 + Docker 容器化，开箱即用 | [→ 部署指南](#-快速开始5分钟上手) |

---

## 📱 移动端远程控制

**手机就是遥控器。** 电脑上的 GuaDa 不用关，手机或平板浏览器扫码就能接管。手机拿到的是完整 Web UI，不只是聊天：

| 手机上可以 | 说明 |
|---|---|
| 对话与流式输出 | 和桌面端同一套会话，任务在电脑上继续跑 |
| 审批工具调用 | 批准或拒绝 Agent 的敏感操作 |
| 终端命令 | 在工作区终端执行 shell |
| 文件读写 | 浏览、预览、编辑工作区文件 |
| 会话与任务 | 切换会话，查看定时任务、子 Agent、工作流状态 |

两种连法：

- **局域网**：手机和电脑连同一个 Wi-Fi，在「设置 → 移动访问」开启局域网访问，重启应用后扫码打开。
- **公网**：本机主动 SSH 连到你自己的服务器，建立 `ssh -R` 反向隧道；不需要公网 IP、路由器端口映射或 DDNS。远端监听 `127.0.0.1` 配合 nginx 最稳；绑 `0.0.0.0` 需要 sshd 开启 `GatewayPorts clientspecified`。

移动端专门处理了这些细节：

- 侧栏抽屉、聊天单列、工作区全屏，触屏操作不挤；
- 息屏、切后台或断网后 SSE 自动重连；恢复可见时校准会话状态并重拉历史，不会卡在「流式中」；
- 强制访问密码：未设密码不能开启；公网期间要求 12 位以上、字母/数字/符号三类齐全；SSH 密码 AES-256-GCM 加密落盘，主机指纹 TOFU。

**边界**：这是「手机远程操作 GuaDa 工作台」，不是投屏或远程桌面，没有实时屏幕流。要让 Agent 直接操作 Windows 桌面（截屏、点击、输入、切换窗口），用 **Computer Use**：默认关闭，鼠标键盘动作默认需要审批，目前仅支持 Windows x64。

文档：[移动访问](docs/mobile-access.md) · [Computer Use](docs/COMPUTER_USE.md)

---

## 🖥️ 远程工作区：本地大脑，远程手脚

**不把开发环境搬到服务器上，只把 AI 的手伸进去。** 主工作目录始终在本地，远程目录作为「附加工作目录」挂进同一个会话——本地和多台远程机器**同时可用**，AI 用 `workspace="连接名"` 指定在哪台机器上动手。

三种可挂载的目标：**SSH 远程主机**（服务器 / NAS / 虚拟机 / 开发板）、**运行中的 Docker 容器**（devcontainer、`docker compose` 起的服务等）与**本机 WSL 发行版**（Windows Subsystem for Linux，发行版里不用配 sshd）。

嵌入式 Linux 开发是这套设计的典型主场：Windows 上位机管编辑、串口与烧写，每个项目一台 Linux 虚拟机管交叉编译，板端管运行——三层缺一不可，而 AI 只需要一个入口。

| 嵌入式开发的三层 | 它承担什么 | 在 GuaDa 里 |
|------|------|------|
| **Windows 上位机** | IDE、串口工具、烧写与调试工具 | **主工作目录**：AI 就在本机，烧写脚本与调试工具随手可调 |
| **每个项目的 Linux 虚拟机** | 交叉编译、SDK/BSP、内核源码 | **附加远程目录**：直接改源码、跑 `make`，虚拟机里不用装任何东西 |
| **板端 / 目标设备** | 设备树、rootfs、内核模块、串口日志 | **附加远程目录**：读 `dmesg`、换 `.ko`，可设为只读 |

- **远端零依赖**：执行代理是单个静态二进制（约 10MB，无 cgo，不依赖 Node 与 glibc），现有构建覆盖 linux / macOS × amd64 / arm64，老 glibc 的精简系统同样能跑。
- **容器零侵入**：接入已有容器（如 VS Code devcontainer）时，代理经 `docker cp` 注入容器内 `/tmp` 并以 stdio 管道通信——不改镜像、不加端口映射、容器重启即自动重连，GuaDa 也绝不停止或删除你的容器。
- **WSL 免配置**：本机 WSL 发行版同样零侵入——代理经 stdin 直传注入发行版内（`$HOME/.guada-agent`，约 10MB），走 `wsl.exe --exec` 的 stdio 管道；**发行版里不用装/起 sshd**，已停止的发行版连接时自动拉起（与在终端敲 `wsl` 一致），GuaDa 绝不终止或卸载发行版。工作目录既可以是发行版内路径（`/home/you/proj`），也可以是 Windows 盘挂载路径（`/mnt/d/proj`）。
- **一个会话，多台机器**：本地 + 多台远程同时挂载，跨机器对比、补丁移植、日志与源码对照都在一轮对话里完成。
- **模型与密钥不出本机**：远端只握有一个 Bearer token；定时任务与子 Agent 会自动继承会话的远程绑定，无人值守也照样跑。
- **权限在服务器侧强制**：`readonly / workspace / unrestricted` 三档，默认「工作目录内可读写、目录外只读」，写操作前解析符号链接防逃逸。
- **不挑 sshd 配置**：agent ≥ 0.6.0 时走 SSH exec 通道（stdio 管道），**不再要求 sshd 允许端口转发**——实测 Alpine 的 openssh 默认关闭转发，旧方案在这种环境下直接连不上；旧版 agent 自动回退端口转发链路，不做强制升级。
- **对远端零侵入**：连接断开即退出、不留常驻进程；NAS 的 `$HOME` 不存在、SFTP 被 chroot 等实际坑位已内置回退（安装目录自动降级、改走 exec 通道上传并校验字节数）。

> 设计文档：[主工作目录与附加工作目录统一操作接口](docs/统一工作目录操作接口-合并远程工作目录方案.md) · [Docker 容器工作区方案](docs/docker容器工作区方案.md) · [WSL 工作区方案](docs/wsl工作区方案.md)

---

## 🚀 快速开始（5分钟上手）

### 方式一：Docker 一键部署（推荐）

```bash
git clone https://gitee.com/zhendongdong/guada_ai.git
cd guada_ai
docker compose up -d --build

# 打开浏览器访问 http://localhost:8787
# 开始跟你的 AI 助手对话！
```

> 生产使用前请先复制 `backend-ts/.env.example` 为 `backend-ts/.env`，至少修改 `JWT_SECRET`；默认值只适合本地试用。更完整的端口、数据卷与环境变量说明见 [DOCKER_QUICKSTART.md](DOCKER_QUICKSTART.md)。

### 方式二：Electron 桌面端

下载预编译安装包：[GitHub Releases](https://github.com/donggua-zen/guada/releases) · [Gitee 发行版](https://gitee.com/zhendongdong/guada_ai/releases)（也可在 [QQ 群](#-社区) 获取），或从源码构建：

```bash
pnpm install
pnpm run build:electron   # 安装包输出在 release/ 目录
```

**macOS（Apple Silicon）安装注意**：安装包带自签名证书、但**未做 Apple 公证**，从浏览器
下载后**首次打开会被系统拦截**（提示「无法验证开发者」，或「已损坏，无法打开」）——
这是 Gatekeeper 的拦截，不是文件损坏。把 GuaDa 拖进「应用程序」后，先在「终端」执行：

```bash
xattr -cr /Applications/GuaDa.app
```

再正常双击打开即可。若仍提示「已损坏」，追加一次本机 ad-hoc 重签（无需任何证书）：

```bash
codesign --force --deep --sign - /Applications/GuaDa.app
```

> 原理与更多细节见 [Electron 部署文档 4.1 / 4.2](docs/ELECTRON_DEPLOYMENT.md#41-安装步骤用户侧)。

**Windows**：直接运行安装包即可；未签名的安装包可能触发 SmartScreen 提示
（「Windows 已保护你的电脑」），选择「更多信息 → 仍要运行」继续。

### 方式三：源码开发

```bash
# 终端 1：启动后端（首次需初始化数据库）
cd backend-ts
pnpm install
pnpm run db:seed:force
pnpm run start:dev

# 终端 2：启动前端
cd frontend
pnpm install
pnpm run dev
# 访问 http://localhost:5173
```

---

## 📚 文档索引

按场景挑一份看即可：

| 场景 | 文档 |
|------|------|
| Docker 快速上手 | [DOCKER_QUICKSTART.md](DOCKER_QUICKSTART.md) |
| Docker 完整部署（端口、数据卷、环境变量） | [docs/DOCKER_DEPLOYMENT.md](docs/DOCKER_DEPLOYMENT.md) |
| Electron 桌面端打包与安装 | [docs/ELECTRON_DEPLOYMENT.md](docs/ELECTRON_DEPLOYMENT.md) |
| 生产环境部署（反向代理、HTTPS、备份） | [docs/PRODUCTION_DEPLOYMENT.md](docs/PRODUCTION_DEPLOYMENT.md) |
| 源码开发与 Electron 调试 | [QUICK_START.md](QUICK_START.md) |
| 移动端远程控制（局域网 / 公网 SSH 隧道） | [docs/mobile-access.md](docs/mobile-access.md) |
| Windows 桌面操作（Computer Use） | [docs/COMPUTER_USE.md](docs/COMPUTER_USE.md) |
| 脚本化浏览器自动化（`browser_run`） | [docs/browser-script.md](docs/browser-script.md) |
| 故障排查 | [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) |

---

## 🏗️ 系统架构

![系统架构](./images/system-architecture.png)

> 架构图为示意图，完整模块以「项目结构」与代码为准。

**架构四层：** `前端入口 → 入口层 → 核心服务层 → 数据层`

| 层级 | 职责 | 核心组件 |
|------|------|----------|
| **前端入口** | 用户交互 | Vue 3、Electron（内嵌 Chromium）、手机/平板浏览器（移动端 Web）、QQ/企微/飞书/Discord/微信 Bot |
| **入口层** | 路由与协议转换 | REST + SSE API、Bot Gateway、Bridge（命名管道 ↔ Electron）、移动访问（局域网 / SSH 反向隧道）、SPA 托管 |
| **核心服务层** | Agent 引擎 + 子 Agent + 插件 + RAG + Skills + LLM 适配 | Agent Engine（ReAct 循环）、Sub-Agent Manager、Workflow、插件系统、Skills 框架、上下文压缩、RAG、MCP、定时任务、Shell 沙箱/命令策略、Computer Use、远程工作区（SSH / Docker 容器 / WSL 发行版）、LLM 适配器 |
| **数据层** | 持久化存储 | SQLite（Prisma 7 + better-sqlite3）、sqlite-vec + FTS5、文件系统 |

**浏览器自动化链路**：Agent 决策（后端）→ 命名管道 Bridge → Electron 操控内嵌 Chromium → AX 语义快照压缩回传 → Agent 继续推理。入口为 `browser_run` 脚本。

---

## 🗂️ 项目结构

```
ai_chat/
├── backend-ts/                  # NestJS 后端
│   ├── prisma/schema.prisma     # 数据库 Schema（SQLite）
│   ├── bundled-providers/       # 内置供应商模板
│   ├── src/
│   │   ├── common/              # 基础设施（数据库、向量库、MCP、日志、命令策略）
│   │   ├── modules/
│   │   │   ├── chat/            # ⭐ 核心对话（Agent 引擎、压缩、上下文、审批）
│   │   │   ├── sub-agent/       # ⭐ 子 Agent 系统（分层委派、前台/后台）
│   │   │   ├── workflow/        # ⭐ 工作流编排（/workflow 多子代理）
│   │   │   ├── plugins/         # ⭐ 插件系统（PluginBase、热插拔、工具包级权限）
│   │   │   ├── skills/          # ⭐ Skills 技能框架（文件即技能、热更新）
│   │   │   ├── knowledge-base/  # ⭐ 知识库（RAG、分块、向量化、OCR）
│   │   │   ├── llm-core/        # LLM 适配层（OpenAI / Anthropic / Gemini 协议）
│   │   │   ├── mobile-access/   # ⭐ 移动访问（局域网 + SSH 反向隧道）
│   │   │   ├── bot-gateway/     # 机器人网关（QQ/企微/飞书/Discord/微信）
│   │   │   ├── scheduler/       # 定时任务（Cron / 一次性、会话隔离）
│   │   │   ├── terminal/        # 交互式终端（PTY over WebSocket）
│   │   │   ├── git/             # Git 变更面板
│   │   │   ├── jobs/            # 后台任务（job_read / list / stop / send）
│   │   │   ├── usage/           # Token 用量统计
│   │   │   ├── policy/          # 命令策略
│   │   │   ├── shell/           # Shell 执行 + 沙箱/策略
│   │   │   ├── remote-workspace/ # ⭐ 远程工作区（SSH / Docker / WSL、工具路由、部署与 RPC）
│   │   │   ├── bridge/          # 命名管道通信（↔ Electron）
│   │   │   ├── tools/           # 工具编排
│   │   │   ├── mcp-servers/     # MCP 服务器集成
│   │   │   ├── commands/        # 斜杠命令
│   │   │   ├── agents/          # 智能体管理（AGENT.md）
│   │   │   └── ...              # auth、files、models、settings、users
│   │   └── main.ts
│   └── test/                    # 后端测试
├── frontend/                    # Vue 3 前端（Vite + Pinia + Element Plus + Tailwind 4）
├── electron/                    # Electron 桌面端（内嵌 Chromium 浏览器自动化）
├── sandbox/                     # Linux/macOS 沙箱二进制（Windows 走命令策略）
├── guada-computer/              # Windows Computer Use sidecar（独立 Rust 项目，未跟踪）
├── guada-agent/                 # 独立 Go 项目（未跟踪，开发时常放在同目录）：远程执行代理
├── plugins/                     # 外部插件示例
├── docs/                        # 文档
└── LICENSE
```

---

## ❓ 常见问题

**手机能控制电脑吗？**
能。手机/平板浏览器打开桌面端 GuaDa 的 Web UI，可以对话、审批工具调用、执行终端命令、读写文件；局域网扫码或公网 SSH 隧道都行。它不是投屏/远程桌面；如果要让 Agent 直接操作 Windows 桌面，用 Computer Use。

**手机打不开局域网地址？**
确认手机和电脑在同一 Wi-Fi、电脑防火墙放行对应端口；开启/关闭局域网访问后需要重启应用；多网卡时选手机实际可达的那个 IP。

**公网访问安全吗？**
公网走你自己的 SSH 服务器反向隧道，不经过第三方中继。开启前必须设置访问密码，公网期间要求强密码；建议远端只监听 `127.0.0.1` 并配合 nginx HTTPS 与限流。外部设备登录后拥有与桌面端相同的权限，请只在可信服务器上开启。

**Docker 部署后 8787 端口被占用怎么办？**
改 `docker-compose.yml` 里的端口映射，把左侧宿主机端口换成空闲端口（右侧保持容器内 Nginx 的 80），例如 `"8788:80"`，再 `docker compose up -d` 重启。

**macOS 提示「已损坏，无法打开」？**
这是 Gatekeeper 对未公证应用的拦截，不是文件损坏。处理办法见
[方式二：Electron 桌面端](#方式二electron-桌面端) 里的 `xattr -cr` 与 ad-hoc 重签步骤。

**该选 Docker 还是 Electron 桌面端？**
想跑在服务器 / NAS 上、多人用浏览器访问，选 Docker；想在本机用完整桌面能力
（浏览器自动化、Shell 与命令策略、本地文件、移动访问、Computer Use），选 Electron 桌面端。

---

## 🛠️ 参与贡献

欢迎提交 Issue 和 Pull Request。动手之前建议先读一遍 [CONTRIBUTING.md](CONTRIBUTING.md)，
里面有分支约定、提交信息格式和本地开发流程。

- 🐛 **发现问题**：[提交 Issue](https://github.com/donggua-zen/guada/issues)
- 🔧 **想改代码**：Fork 仓库 → 从 `develop` 切出功能分支 → 提交 PR
- 📝 **提交信息**：建议使用 `feat:` / `fix:` / `docs:` / `chore:` 前缀，便于整理更新日志

---

## 🤝 社区

**遇到问题？想交流技术？下载预编译客户端？来这里：**

<table align="center">
  <tr>
    <td align="center" width="33%">
      <img src="./images/qq_qrcode.png" width="180" height="180" alt="QQ群二维码"/><br>
      <b>🐧 QQ 群：1047993501</b>
    </td>
    <td align="center" width="33%">
      <img src="./images/wx_qun_qrcode.png" width="180" height="180" alt="微信群二维码"/><br>
      <b>💬 微信群</b>
    </td>
    <td align="center" width="33%">
      <img src="./images/wx_public_qrcode.png" width="180" height="180" alt="交流群二维码"/><br>
      <b>📱 微信群：GuaDa 用户交流群</b>
    </td>
  </tr>
</table>

> 微信群二维码会过期，表中图片指向长期有效的活码页：<https://wxhm.dingd.cn/q/ifa4qwg7df>（扫码后自动进入当前有效的群）。

<p align="center" style="margin-top: 30px;">
  <a href="https://gitee.com/zhendongdong/guada_ai"><b>⭐ 点个 Star 支持项目</b></a>（你的鼓励是持续更新的动力 ❤️）
</p>

---

## 📄 许可证

本项目基于 [MIT License](LICENSE) 开源，可自由使用、修改和商用。

---

<p align="center">
  <b>如果 GuaDa 对你有帮助，欢迎在 Gitee 上点个 Star ⭐</b><br>
  <sub>你的每一次 Star，都是让这个项目变得更好的动力</sub>
</p>
