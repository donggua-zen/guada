# ⚡ GuaDa AI — Turn Your Computer into an AI Workstation

> **A visible, tangible, and interactive** desktop AI workstation. Built on ReAct Agent + Sub-Agent hierarchical architecture, one engine serves **Web / Desktop / IM** through a unified interface.

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
  <a href="#-project-introduction"><b>💡 Introduction</b></a> ·
  <a href="#-comparison"><b>📊 Comparison</b></a> ·
  <a href="#-core-capabilities"><b>🧠 Core Capabilities</b></a> ·
  <a href="#-remote-workspace-local-brain-remote-hands"><b>🖥️ Remote Workspace</b></a> ·
  <a href="#-quick-start-5-minute-setup"><b>🚀 Quick Start</b></a> ·
  <a href="https://gitee.com/zhendongdong/guada_ai/issues"><b>💬 Feedback</b></a> ·
  <a href="#-community"><b>🤝 Community</b></a>
</p>

<p align="center">
  <b>English</b> ·
  <a href="README.md">中文</a> ·
  <a href="https://gitee.com/zhendongdong/guada_ai">Gitee</a> ·
  <a href="https://github.com/donggua-zen/guada">GitHub</a> ·
  <a href="https://gitcode.com/donggua_sherlock/GuaDaAI">GitCode</a>
</p>

---

## 📖 Project Introduction

GuaDa is a **local-first** open-source AI workstation — it's not just a chat box, but an AI workbench that can actually get things done: reading/writing files, executing commands, and controlling an embedded browser. Tasks go from planning to execution in a fully automated loop.

**One Agent engine, three ways to use it:** the **Desktop** app works out of the box, the **Web** version supports private deployment, and you can summon it directly in **QQ / WeCom / Feishu / Discord / WeChat** groups. Combined with the RAG knowledge base, long-term memory, and scheduled tasks, it remembers your materials, works the way you do, and keeps going while you sleep. Data stays on your own machine by default — safe and controllable.

When the work lives on a **server, NAS, VM, or dev board**, it can mount several of them into the same session over SSH — or attach a **running Docker container** — while the AI stays on your machine and just reaches in. See [🖥️ Remote Workspace](#-remote-workspace-local-brain-remote-hands).

Whether you're a **content creator** writing scripts and chasing trends, a **programmer** who wants the Agent to write code, a **writer** who needs it to remember character settings, or a **team** that wants an internal AI assistant with a bound knowledge base and IM integration — GuaDa is ready to use out of the box. If this project helps you, please light up the Star ⭐ — your support keeps the updates coming.

---

## 🖼️ Product Screenshots

<p align="center">
  <img src="./images/demo_task.gif" width="45%" alt="Scheduled task demo">
  <img src="./images/demo_solar.gif" width="45%" alt="Browser automation: collecting solar system data">
</p>
<p align="center">
  <img src="./images/demo_game.gif" width="45%" alt="Agent playing a game">
  <img src="./images/demo_kb.gif" width="45%" alt="Knowledge base usage">
</p>
<p align="center">
  <img src="./images/themes_1.png" width="45%" alt="Knowledge base interface">
  <img src="./images/themes_2.png" width="45%" alt="Browser automation interface">
</p>

---

## 📊 Comparison with Similar Tools

| Dimension | **GuaDa** | Claude Code | Codex | Trae Work |
|------|:---------:|:-----------:|:-----:|:---------:|
| **Product Positioning** | 🏠 General AI Workstation | 💻 Coding Agent | 💻 Coding Agent | 📋 AI Task Platform |
| **Open Source** | ✅ | ❌ | ✅ CLI | ❌ |
| **Self-hosted Web Deployment** | ✅ | ❌ | ❌ | ❌ |
| **Desktop App** | ✅ | ✅ | ✅ | ✅ |
| **CLI** | ❌ | ✅ | ✅ | ⚠️ |
| **Bot / IM Integration** | ✅ QQ·WeCom·Feishu·Discord·WeChat | ❌ | ❌ | ❌ |
| **Knowledge Base (RAG)** | ✅ Hybrid retrieval·40+ formats | ❌ | ❌ | ⚠️ Code index |
| **Browser Automation** | ✅ Embedded·Visual control | ✅ Embedded·Visual control (2026.7) | ⚠️ Needs Chrome extension·Preview only | ⚠️ Remote screen·Preview only |
| **Sandbox** | ✅ Lightweight sandbox | ✅ File+network isolation | ✅ Cloud container+local | ✅ Cloud container+local file permissions |
| **Remote / Multi-Machine Dev** | ✅ Direct SSH to your own servers·NAS·VMs·dev boards; local + multiple remotes in one session | ⚠️ No remote directory (run the whole CLI there) | ⚠️ Cloud sandbox·code upload | ⚠️ Cloud container |
| **Long-term Memory** | ✅ Editable & reversible | ⚠️ File-based | ⚠️ File-based | ❌ |
| **Scheduled Tasks** | ✅ | ❌ | ❌ | ❌ |
| **Multi-Agent** | ✅ Full independent config (character/model/tools/knowledge base) | ⚠️ Sub-agents only·Claude only·No nesting | ⚠️ Sub-agents only·No nesting | ❌ |
| **Multi-Model Support** | ✅ 17 vendors·incl. domestic models | ❌ Claude only | ❌ OpenAI only | ⚠️ |
| **Local Data Control** | ✅ | ❌ | ❌ | ❌ |
| **Setup Difficulty** | ⭐⭐⭐⭐ Out of the box | ⭐⭐⭐ Login and use | ⭐⭐⭐ API Key and use | ⭐⭐⭐⭐⭐ Login and use |
| **Cost** | Free (bring your own Key) | $20+/mo | $20+/mo | Free during beta |

## 🧠 Core Capabilities

| Capability | Highlights | Docs |
|------|---------|------|
| **🤖 Agent** | ReAct multi-turn autonomous loop + Sub-Agent hierarchical delegation, session locks, streaming, interruption handling, and three regeneration modes | [→ Details](docs/agent-engine.md) |
| **👥 Sub-Agent System** | Full independent configuration (character/model/tools/knowledge base), complex tasks auto-decompose → delegate → collect results | [→ Details](docs/sub-agent.md) |
| **🧭 Workflow Orchestration** | Type `/workflow` to explicitly start multi-sub-agent orchestration: the model writes a script that schedules sub-agents in parallel/stages and summarizes results | [→ Details](docs/workflow-subagent-plan.md) |
| **🔌 Plugin System** | All core features are pluginized (browser/file/search/memory/scheduled tasks/characters), PluginBase lifecycle + hot-swap with instant effect, toolkit-level permission filtering | — |
| **📚 Knowledge Base (RAG)** | Semantic + keyword hybrid retrieval, Agent self-service multi-round search and write, supports **40+ file formats** (incl. OCR) | [→ Details](docs/knowledge-base.md) |
| **🧠 Long-Term Memory** | Two-level compression (trim → semantic), editable, reversible, with history — non-destructive compression | [→ Details](docs/memory.md) |
| **🛠️ Skills Management** | Files-as-skills, chokidar hot-reload with instant effect, progressive loading saves tokens | [→ Details](docs/skills.md) |
| **⏰ Scheduled Tasks** | Agent runs automatically on Cron schedules, independent session isolation, complete execution logs | [→ Details](docs/scheduler.md) |
| **🤖 Bot Gateway** | Unified access to **QQ / WeCom / Feishu / Discord / personal WeChat**, auto-reconnect, message merging, dynamic start/stop | [→ Details](docs/bot-gateway.md) |
| **🌐 Browser Automation** | Electron-embedded Chromium, Agent real-time visual control | [→ Details](docs/browser-automation.md) |
| **🧩 Multi-Model Management** | 5 protocol adapters × **17 vendors** (OpenAI / Claude / Gemini / Azure / DeepSeek / Qwen / ERNIE / Zhipu / Kimi / Volcano / MiniMax etc.), role-level/session-level/global-level config | [→ Details](docs/models.md) |
| **🛡️ Sandbox Mode** | Shell commands execute in an isolated sandbox process, Agent acts more safely | [→ Details](docs/windows-sandbox-isolation-design.md) |
| **🖥️ Remote Workspace** | Attach servers·NAS·VMs·dev boards (SSH), **running Docker containers**, and **local WSL distros** as "additional working directories"; local + multiple remotes in one session, remote needs only a ~10 MB static binary, containers and distros stay untouched | [→ Details](#-remote-workspace-local-brain-remote-hands) |
| **🔗 MCP Integration** | Native MCP protocol support, connect to external tool ecosystem | — |
| **📦 Multiple Deployment Options** | Electron desktop + Web app + Docker containerization, ready out of the box | [→ Deployment Guide](#-quick-start-5-minute-setup) |
| **🗄️ Enterprise-Grade Data** | SQLite by default, Prisma 7 ORM for seamless switch to MySQL / PostgreSQL | — |
| **🎨 Custom Wallpaper** | Custom backgrounds, transparency, glassmorphism — create your own workstation | — |

---

## 🖥️ Remote Workspace: Local Brain, Remote Hands

**Don't move your dev environment onto the server — just let the AI reach in.** The primary working directory always stays local; remote directories are attached to the same session as "additional working directories", so the local machine and several remotes are **usable at the same time**. The Agent picks a target with `workspace="connection-name"`.

Three kinds of attachable targets: **SSH hosts** (server / NAS / VM / dev board), **running Docker containers** (devcontainers, `docker compose` services, and so on), and **local WSL distros** (Windows Subsystem for Linux — no sshd setup needed inside the distro).

Embedded Linux development is where this design shines: a Windows host for editing, serial console and flashing tools; one Linux VM per project for cross-compilation; the target board at runtime — all three are needed at once, and the AI only needs one entry point.

| The three layers of embedded development | What it does | In GuaDa |
|------|------|------|
| **Windows host** | IDE, serial console, flashing & debugging tools | **Primary working directory** — the AI is right there, your flashing scripts and debug tools within reach |
| **Per-project Linux VM** | Cross-compilation, SDK/BSP, kernel sources | **Additional remote directory** — edit sources and run `make` without installing anything in the VM |
| **Target board** | Device tree, rootfs, kernel modules, serial logs | **Additional remote directory** — read `dmesg`, swap `.ko` files, optionally read-only |

- **Zero remote dependencies**: the execution agent is a single static binary (~10 MB, no cgo, no Node or glibc required); current builds cover linux / macOS × amd64 / arm64, so lean systems with older glibc work too.
- **Zero container intrusion**: the agent is injected into an existing container's `/tmp` via `docker cp` and talks over a stdio pipe — no image changes, no published ports, automatic reconnect after a container restart, and GuaDa never stops or removes your container.
- **Zero-config WSL**: a local WSL distro works the same way — the agent is streamed in over stdin (into `$HOME/.guada-agent`, ~10 MB) and talks over a `wsl.exe --exec` stdio pipe, so **no sshd is needed inside the distro**. A stopped distro is auto-started on connect (exactly like typing `wsl` in a terminal), and GuaDa never terminates or unregisters it. The working directory can be a distro path (`/home/you/proj`) or a mounted Windows drive (`/mnt/d/proj`).
- **One session, many machines**: local plus multiple remotes mounted together — cross-machine diffs, patch porting, and log-vs-source analysis all happen in one conversation.
- **Model keys never leave your machine**: the remote side holds only a Bearer token; scheduled tasks and sub-agents inherit the session's remote bindings, so unattended runs work as well.
- **Permissions enforced on the server side**: `readonly / workspace / unrestricted`, defaulting to "read-write inside the working directory, read-only outside", with symlink-escape protection before any write.
- **No special sshd configuration**: with agent ≥ 0.6.0 the client speaks stdio over an SSH exec channel, so port forwarding does not need to be enabled (stock Alpine openssh ships `AllowTcpForwarding no`); older agents fall back to the port-forward transport automatically — no forced upgrade.
- **Zero footprint on the remote**: the agent exits as soon as the connection closes — no resident daemon; real-world NAS quirks (missing `$HOME`, chrooted SFTP) already have built-in fallbacks (automatic install-dir fallback, byte-verified upload over the exec channel).

> Design docs: [Unified interface for primary and additional working directories](docs/统一工作目录操作接口-合并远程工作目录方案.md) · [Docker container workspace](docs/docker容器工作区方案.md) · [WSL workspace](docs/wsl工作区方案.md)

---

## 🚀 Quick Start (5-Minute Setup)

### Option 1: Docker One-Click Deployment (Recommended)

```bash
git clone https://gitee.com/zhendongdong/guada_ai.git
cd guada_ai
docker compose up -d --build

# Open your browser at http://localhost:8787
# Start chatting with your AI assistant!
```

### Option 2: Electron Desktop

Download the pre-built installer (see the [QQ Group 1047993501](#-community)), or build from source:

```bash
pnpm install
pnpm run build:electron   # Installer output in release/
```

### Option 3: Develop from Source

```bash
# Terminal 1: Start the backend (initialize DB on first run)
cd backend-ts
pnpm install
pnpm run db:seed:force
pnpm run start:dev

# Terminal 2: Start the frontend
cd frontend
pnpm install
pnpm run dev
# Visit http://localhost:5173
```

> More deployment details: [Docker Deployment](docs/DOCKER_DEPLOYMENT.md) · [Electron Deployment](docs/ELECTRON_DEPLOYMENT.md) · [Production Deployment](docs/PRODUCTION_DEPLOYMENT.md) · [Quick Start](QUICK_START.md)

---

## 🏗️ System Architecture

![System Architecture](./images/system-architecture.png)

**Four layers:** `Frontend Entry → Entry Layer → Core Service Layer → Data Layer`

| Layer | Responsibility | Core Components |
|------|------|----------|
| **Frontend Entry** | User interaction | Vue 3, Electron (embedded Chromium), QQ/WeCom/Feishu/Discord/WeChat Bot |
| **Entry Layer** | Routing & protocol conversion | REST + SSE API, Bot Gateway, Bridge (named pipe ↔ Electron) |
| **Core Service Layer** | Agent engine + Sub-Agent + Plugins + RAG + Skills + LLM adapters | Agent Engine (ReAct loop), Sub-Agent Manager, Plugin System, Skills Framework, Context Compression, RAG, MCP, Scheduled Tasks, Shell Sandbox, Remote Workspace (SSH / Docker containers / WSL distros), LLM Adapters |
| **Data Layer** | Persistent storage | SQLite (Prisma 7, switchable to MySQL/PostgreSQL), sqlite-vec + FTS5, file system |

**Browser automation chain:** Agent decision (backend) → named-pipe Bridge → Electron controls embedded Chromium → accessibility snapshot compressed in 6 layers back → Agent continues reasoning.

---

## 🗂️ Project Structure

```
ai_chat/
├── backend-ts/                  # NestJS Backend
│   ├── prisma/schema.prisma     # Database Schema
│   ├── src/
│   │   ├── common/              # Infrastructure (database, vector DB, MCP, logging, utils)
│   │   └── modules/
│   │       ├── chat/            # ⭐ Core dialogue (Agent engine, compression, context, approval)
│   │       ├── sub-agent/       # ⭐ Sub-Agent system (hierarchical delegation, foreground/background)
│   │       ├── plugins/         # ⭐ Plugin system (PluginBase, hot-swap, toolkit-level permissions)
│   │       ├── skills/          # ⭐ Skills framework (files-as-skills, hot-reload)
│   │       ├── knowledge-base/  # ⭐ Knowledge base (RAG, chunking, vectorization, OCR)
│   │       ├── llm-core/        # LLM adapter layer (5 protocols × 17 vendors)
│   │       ├── bot-gateway/     # Bot gateway (QQ/WeCom/Feishu/Discord/WeChat)
│   │       ├── scheduler/       # Scheduled tasks (Cron, session isolation)
│   │       ├── shell/           # Shell execution + lightweight sandbox
│   │       ├── remote-workspace/ # ⭐ Remote workspace (SSH / Docker / WSL attached dirs, tool routing, deploy & RPC)
│   │       ├── bridge/          # Named-pipe communication (↔ Electron)
│   │       ├── tools/           # Tool orchestration
│   │       ├── mcp-servers/     # MCP server integration
│   │       ├── commands/        # Slash commands
│   │       ├── characters/      # Character management
│   │       └── ...              # auth, files, models, settings, users, remote-workspace
│   └── main.ts
├── frontend/                    # Vue 3 Frontend (Vite + Pinia + Element Plus + Tailwind 4)
├── electron/                    # Electron Desktop (embedded Chromium browser automation)
├── sandbox/                     # Sandbox process (sandbox executable)
├── guada-agent/                 # Independent Go project (not tracked here; often placed alongside for development): remote execution agent
├── docs/                        # Documentation
└── LICENSE
```

---

## 🤝 Community

**Got questions? Want to discuss tech? Download pre-built clients? Come here:**

<table align="center">
  <tr>
    <td align="center" width="33%">
      <img src="./images/qq_qrcode.png" width="180" height="180" alt="QQ Group QR"/><br>
      <b>🐧 QQ Group: 1047993501</b>
    </td>
    <td align="center" width="33%">
      <img src="./images/wx_qun_qrcode.png" width="180" height="180" alt="WeChat Group QR"/><br>
      <b>💬 WeChat Group</b>
    </td>
    <td align="center" width="33%">
      <img src="./images/wx_public_qrcode.png" width="180" height="180" alt="WeChat Group QR"/><br>
      <b>📱 WeChat: GuaDa User Group</b>
    </td>
  </tr>
</table>

> The WeChat group invite expires periodically; the QR above points to a permanent landing page: <https://wxhm.dingd.cn/q/ifa4qwg7df> (scans land on the currently valid group).

<p align="center" style="margin-top: 30px;">
  <a href="https://gitee.com/zhendongdong/guada_ai"><b>⭐ Give a Star to Support the Project</b></a> (Your encouragement is the fuel for continuous updates ❤️)
</p>

---

## 📄 License

This project is open-sourced under the [MIT License](LICENSE). Free to use, modify, and for commercial purposes.

---

<p align="center">
  <b>If GuaDa helps you, consider giving it a Star on Gitee ⭐</b><br>
  <sub>Every Star is the motivation to make this project even better</sub>
</p>
