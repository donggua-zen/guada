# ⚡ GuaDa AI — Turn Your Computer into an AI Workstation

> **A visible, tangible, hands-on** local-first AI workstation. Use it out of the box on desktop, self-host it on the web, or take over remotely from your phone's browser — one Agent engine serves **Web / Desktop / IM / Mobile**.

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
  <a href="#-introduction"><b>💡 Introduction</b></a> ·
  <a href="#-comparison-with-similar-tools"><b>📊 Comparison</b></a> ·
  <a href="#-core-capabilities"><b>🧠 Core Capabilities</b></a> ·
  <a href="#-mobile-remote-control"><b>📱 Mobile</b></a> ·
  <a href="#-remote-workspace-local-brain-remote-hands"><b>🖥️ Remote Workspace</b></a> ·
  <a href="#-quick-start-5-minute-setup"><b>🚀 Quick Start</b></a> ·
  <a href="#-documentation"><b>📚 Documentation</b></a> ·
  <a href="#-faq"><b>❓ FAQ</b></a> ·
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

## 📖 Introduction

GuaDa is a **local-first** open-source AI workstation — not just a chat box, but an AI workbench that gets things done: reading and writing files, running commands, driving an embedded browser, and on Windows, capturing the screen, clicking, and typing to operate desktop apps. Tasks go from planning to execution in a closed loop.

One Agent engine, four ways to use it: **Desktop** out of the box, **Web** for private deployment, **phone/tablet browser** for remote control, and **QQ / WeCom / Feishu / Discord / WeChat** groups. With a RAG knowledge base, Skills, and scheduled tasks, it can search your materials, work the way you do, and keep going while you sleep. Model access is not tied to a single vendor: OpenAI / Anthropic / Gemini protocols plus a range of built-in provider templates. Data stays on your own machine by default — safe and controllable.

When the work lives on a **server, NAS, VM, or dev board**, it can mount several of them into the same session — the AI stays on your machine and just reaches in. See [🖥️ Remote Workspace](#-remote-workspace-local-brain-remote-hands).

Whether you're a **content creator** writing scripts and chasing trends, a **programmer** who wants the Agent to write code, a **creator** turning materials into a knowledge base, or a **team** building an internal AI assistant with a knowledge base and IM integration — GuaDa is ready to use. If this project helps you, please light up the Star ⭐ — your support keeps the updates coming.

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
  <img src="./images/themes_1.png" width="45%" alt="Light theme interface">
  <img src="./images/themes_2.png" width="45%" alt="Dark theme interface">
</p>

---

## 📊 Comparison with Similar Tools

| Dimension | **GuaDa** | Claude Code | Codex | Trae Work |
|------|:---------:|:-----------:|:-----:|:---------:|
| **Product Positioning** | 🏠 General AI Workstation | 💻 Coding Agent | 💻 Coding Agent | 📋 AI Task Platform |
| **Open Source** | ✅ MIT | ❌ | ✅ CLI | ❌ |
| **Self-hosted Web Deployment** | ✅ | ❌ | ❌ | ❌ |
| **Desktop App** | ✅ | ✅ | ✅ | ✅ |
| **Bot / IM Integration** | ✅ QQ·WeCom·Feishu·Discord·WeChat | ❌ | ❌ | ❌ |
| **Knowledge Base (RAG)** | ✅ Hybrid retrieval·40+ formats | ❌ | ❌ | ⚠️ Code index |
| **Browser Automation** | ✅ Embedded·Visual control | ✅ | ⚠️ | ⚠️ |
| **Remote / Multi-Machine Dev** | ✅ SSH·Docker·WSL, one session | ⚠️ | ⚠️ | ⚠️ |
| **Mobile Remote Control** | ✅ Phone browser takes over the workstation | — | — | — |
| **Multi-Agent** | ✅ Independent config·Nested | ⚠️ Sub-agents only | ⚠️ Sub-agents only | ❌ |
| **Local Data Control** | ✅ | ❌ | ❌ | ❌ |

> `—` means the capability is not offered or not verified; the comparison keeps only dimensions relevant to GuaDa's positioning.

---

## 🧠 Core Capabilities

| Capability | Highlights | Docs |
|------|---------|------|
| **🤖 Agent** | ReAct multi-turn autonomous loop + Sub-Agent hierarchical delegation, session locks, streaming, interruption and overwrite regeneration | [→ Details](docs/agent-engine.md) |
| **👥 Sub-Agent System** | Independent config for role/model/tools/MCP/Skills; complex tasks auto-decompose → delegate → collect results | [→ Details](docs/sub-agent.md) |
| **🧭 Workflow Orchestration** | Type `/workflow` to start multi-sub-agent orchestration: the model writes a script that schedules sub-agents in parallel/stages and summarizes results | [→ Design doc](docs/workflow-subagent-plan.md) |
| **📱 Mobile Remote Control** | Phone/tablet browser takes over the full desktop Web UI: chat, approvals, terminal, files, sessions; LAN QR or public SSH reverse tunnel, with auto-reconnect after screen lock/network loss | [→ Details](docs/mobile-access.md) |
| **🖥️ Computer Use (Windows)** | Agent captures the screen, clicks, types, and operates windows; off by default, actions require approval, Windows x64 only | [→ Details](docs/COMPUTER_USE.md) |
| **🔌 Plugin System** | Core features are pluginized (browser/file/search/scheduler/Computer Use, etc.), PluginBase lifecycle + hot-swap, toolkit-level permission filtering | — |
| **📚 Knowledge Base (RAG)** | Semantic + keyword hybrid retrieval, Agent self-service multi-round search and write, **40+ file formats** (incl. OCR) | [→ Details](docs/knowledge-base.md) |
| **🛠️ Skills Management** | Files-as-skills, chokidar hot-reload, progressive loading saves tokens | [→ Details](docs/skills.md) |
| **⏰ Scheduled Tasks** | Agent runs on Cron or one-shot schedules, independent session isolation, complete execution logs | [→ Details](docs/scheduler.md) |
| **🤖 Bot Gateway** | Unified access to **QQ / WeCom AI Bot / Feishu / Discord / personal WeChat**, auto-reconnect, message merging, dynamic start/stop | [→ Details](docs/bot-gateway.md) |
| **🌐 Browser Automation** | Electron-embedded Chromium, scripted `browser_run`, locators resolved at action time, AX semantic snapshot returned | [→ Details](docs/browser-script.md) |
| **🖥️ Remote Workspace** | Attach **servers·NAS·VMs·dev boards (SSH)**, **running Docker containers**, and **local WSL distros** as additional working directories; local + multiple remotes in one session | [→ Details](#-remote-workspace-local-brain-remote-hands) |
| **🛡️ Security & Approval** | OS sandbox on Linux/macOS (Landlock/Seatbelt); command policy + approval on Windows (user modes: workspace-write / danger-full-access; read-only is provided by plan mode); mandatory password for mobile access | [→ Details](docs/windows-command-policy.md) |
| **🔗 MCP Integration** | Native MCP support (stdio / SSE / streamableHttp) | — |
| **📦 Multiple Deployment Options** | Electron desktop + Web app + Docker containerization, ready out of the box | [→ Deployment Guide](#-quick-start-5-minute-setup) |

---

## 📱 Mobile Remote Control

**Your phone is the remote.** Leave GuaDa running on your computer and take over from a phone or tablet browser. You get the full Web UI, not just chat:

| On your phone | What you can do |
|---|---|
| Chat & streaming | Use the same sessions as the desktop; tasks keep running on the computer |
| Tool approvals | Approve or reject sensitive Agent actions |
| Terminal | Run shell commands in the workspace terminal |
| Files | Browse, preview, and edit workspace files |
| Sessions & tasks | Switch sessions and check scheduled tasks, sub-agents, and workflow status |

Two ways to connect:

- **LAN**: put your phone and computer on the same Wi-Fi, enable LAN access in **Settings → Mobile Access**, restart the app, then scan the QR code.
- **Public network**: your computer connects out to your own server over SSH and opens an `ssh -R` reverse tunnel — no public IP, router port forwarding, or DDNS required. Binding the remote side to `127.0.0.1` and fronting it with nginx is the safest setup; binding to `0.0.0.0` requires `GatewayPorts clientspecified` in sshd.

Mobile-specific handling:

- Drawer sidebar, single-column chat, and full-screen workspace keep touch interaction comfortable;
- SSE reconnects automatically after screen lock, backgrounding, or network changes; when the page becomes visible again it reconciles session state and reloads history instead of getting stuck in "streaming";
- A password is mandatory: access cannot be enabled without one; while public access is on, passwords must be 12+ characters with letters, digits, and symbols; SSH passwords are encrypted at rest with AES-256-GCM, and host keys use TOFU.

**Scope**: this is "operate the GuaDa workstation remotely from your phone", not screen mirroring or a remote desktop — there is no live screen stream. To let the Agent operate a Windows desktop directly (screen capture, click, type, switch windows), use **Computer Use**: off by default, mouse/keyboard actions require approval, Windows x64 only.

Docs: [Mobile Access](docs/mobile-access.md) · [Computer Use](docs/COMPUTER_USE.md)

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

> Before production use, copy `backend-ts/.env.example` to `backend-ts/.env` and at least change `JWT_SECRET`; the default is for local trials only. See [DOCKER_QUICKSTART.md](DOCKER_QUICKSTART.md) for ports, volumes, and environment variables.

### Option 2: Electron Desktop

Download the pre-built installer: [GitHub Releases](https://github.com/donggua-zen/guada/releases) · [Gitee Releases](https://gitee.com/zhendongdong/guada_ai/releases) (or get it from the [QQ Group](#-community)), or build from source:

```bash
pnpm install
pnpm run build:electron   # Installer output in release/
```

**macOS (Apple Silicon) installation note**: the installer is self-signed but **not notarized by Apple**, so the first launch after downloading from a browser will be blocked by Gatekeeper ("unidentified developer" or "is damaged and can't be opened"). This is not a corrupted file. After dragging GuaDa into Applications, run:

```bash
xattr -cr /Applications/GuaDa.app
```

Then open it normally. If macOS still reports "damaged", add a local ad-hoc re-sign (no certificate required):

```bash
codesign --force --deep --sign - /Applications/GuaDa.app
```

> See [Electron Deployment 4.1 / 4.2](docs/ELECTRON_DEPLOYMENT.md#41-安装步骤用户侧) for details.

**Windows**: run the installer directly; an unsigned build may trigger SmartScreen ("Windows protected your PC") — choose "More info → Run anyway".

### Option 3: Develop from Source

```bash
# Terminal 1: Start the backend (initialize the DB on first run)
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

---

## 📚 Documentation

| Scenario | Document |
|------|------|
| Docker quick start | [DOCKER_QUICKSTART.md](DOCKER_QUICKSTART.md) |
| Docker deployment (ports, volumes, env vars) | [docs/DOCKER_DEPLOYMENT.md](docs/DOCKER_DEPLOYMENT.md) |
| Electron packaging & installation | [docs/ELECTRON_DEPLOYMENT.md](docs/ELECTRON_DEPLOYMENT.md) |
| Production deployment (reverse proxy, HTTPS, backup) | [docs/PRODUCTION_DEPLOYMENT.md](docs/PRODUCTION_DEPLOYMENT.md) |
| Source development & Electron debugging | [QUICK_START.md](QUICK_START.md) |
| Mobile remote control (LAN / public SSH tunnel) | [docs/mobile-access.md](docs/mobile-access.md) |
| Windows desktop automation (Computer Use) | [docs/COMPUTER_USE.md](docs/COMPUTER_USE.md) |
| Scripted browser automation (`browser_run`) | [docs/browser-script.md](docs/browser-script.md) |
| Troubleshooting | [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) |

---

## 🏗️ System Architecture

![System Architecture](./images/system-architecture.png)

> The diagram is illustrative; the project structure and code are the source of truth for the complete module list.

**Four layers:** `Frontend Entry → Entry Layer → Core Service Layer → Data Layer`

| Layer | Responsibility | Core Components |
|------|------|----------|
| **Frontend Entry** | User interaction | Vue 3, Electron (embedded Chromium), phone/tablet browser (mobile web), QQ/WeCom/Feishu/Discord/WeChat Bot |
| **Entry Layer** | Routing & protocol conversion | REST + SSE API, Bot Gateway, Bridge (named pipe ↔ Electron), Mobile Access (LAN / SSH reverse tunnel), SPA hosting |
| **Core Service Layer** | Agent engine + Sub-Agent + Plugins + RAG + Skills + LLM adapters | Agent Engine (ReAct loop), Sub-Agent Manager, Workflow, Plugin System, Skills Framework, Context Compression, RAG, MCP, Scheduled Tasks, Shell Sandbox/Command Policy, Computer Use, Remote Workspace (SSH / Docker containers / WSL distros), LLM Adapters |
| **Data Layer** | Persistent storage | SQLite (Prisma 7 + better-sqlite3), sqlite-vec + FTS5, file system |

**Browser automation chain:** Agent decision (backend) → named-pipe Bridge → Electron controls embedded Chromium → AX semantic snapshot compressed and returned → Agent continues reasoning. The entry point is the `browser_run` script.

---

## 🗂️ Project Structure

```
ai_chat/
├── backend-ts/                  # NestJS backend
│   ├── prisma/schema.prisma     # Database schema (SQLite)
│   ├── bundled-providers/       # Built-in provider templates
│   ├── src/
│   │   ├── common/              # Infrastructure (database, vector DB, MCP, logging, command policy)
│   │   ├── modules/
│   │   │   ├── chat/            # ⭐ Core dialogue (Agent engine, compression, context, approval)
│   │   │   ├── sub-agent/       # ⭐ Sub-Agent system (hierarchical delegation, foreground/background)
│   │   │   ├── workflow/        # ⭐ Workflow orchestration (/workflow multi-sub-agent)
│   │   │   ├── plugins/         # ⭐ Plugin system (PluginBase, hot-swap, toolkit-level permissions)
│   │   │   ├── skills/          # ⭐ Skills framework (files-as-skills, hot-reload)
│   │   │   ├── knowledge-base/  # ⭐ Knowledge base (RAG, chunking, vectorization, OCR)
│   │   │   ├── llm-core/        # LLM adapter layer (OpenAI / Anthropic / Gemini protocols)
│   │   │   ├── mobile-access/   # ⭐ Mobile access (LAN + SSH reverse tunnel)
│   │   │   ├── bot-gateway/     # Bot gateway (QQ/WeCom/Feishu/Discord/WeChat)
│   │   │   ├── scheduler/       # Scheduled tasks (Cron / one-shot, session isolation)
│   │   │   ├── terminal/        # Interactive terminal (PTY over WebSocket)
│   │   │   ├── git/             # Git changes panel
│   │   │   ├── jobs/            # Background jobs (job_read / list / stop / send)
│   │   │   ├── usage/           # Token usage stats
│   │   │   ├── policy/          # Command policy
│   │   │   ├── shell/           # Shell execution + sandbox/policy
│   │   │   ├── remote-workspace/ # ⭐ Remote workspace (SSH / Docker / WSL, tool routing, deploy & RPC)
│   │   │   ├── bridge/          # Named-pipe communication (↔ Electron)
│   │   │   ├── tools/           # Tool orchestration
│   │   │   ├── mcp-servers/     # MCP server integration
│   │   │   ├── commands/        # Slash commands
│   │   │   ├── agents/          # Agent management (AGENT.md)
│   │   │   └── ...              # auth, files, models, settings, users
│   │   └── main.ts
│   └── test/                    # Backend tests
├── frontend/                    # Vue 3 frontend (Vite + Pinia + Element Plus + Tailwind 4)
├── electron/                    # Electron desktop (embedded Chromium browser automation)
├── sandbox/                     # Linux/macOS sandbox binaries (Windows uses command policy)
├── guada-computer/              # Windows Computer Use sidecar (independent Rust project, not tracked)
├── guada-agent/                 # Independent Go project (not tracked; often placed alongside): remote execution agent
├── plugins/                     # External plugin examples
├── docs/                        # Documentation
└── LICENSE
```

---

## ❓ FAQ

**Can my phone control the computer?**
Yes. Open the desktop GuaDa Web UI in a phone/tablet browser to chat, approve tool calls, run terminal commands, and read/write files over LAN or a public SSH tunnel. It is not screen mirroring or a remote desktop; to let the Agent operate a Windows desktop directly, use Computer Use.

**The LAN address doesn't open on my phone.**
Make sure both devices are on the same Wi-Fi and the computer firewall allows the port; restart the app after toggling LAN access; if there are multiple network adapters, pick the IP your phone can actually reach.

**Is public access safe?**
Public access uses a reverse SSH tunnel to your own server, not a third-party relay. A password is mandatory, and public mode requires a strong one; binding the remote side to `127.0.0.1` and fronting it with nginx HTTPS and rate limiting is recommended. External devices get the same permissions as the desktop, so only enable it on a trusted server.

**The 8787 port is already in use after Docker deployment.**
Change the port mapping in `docker-compose.yml` to a free host port on the left (keep Nginx's port 80 in the container on the right), for example `"8788:80"`, then run `docker compose up -d` again.

**macOS says "is damaged and can't be opened".**
Gatekeeper is blocking an unnotarized app, not a corrupted file. See the `xattr -cr` and ad-hoc re-sign steps in [Option 2: Electron Desktop](#option-2-electron-desktop).

**Docker or Electron?**
Choose Docker to run on a server/NAS and let multiple people access it via a browser; choose Electron for full local desktop capabilities (browser automation, shell and command policy, local files, mobile access, Computer Use).

---

## 🛠️ Contributing

Issues and pull requests are welcome. Before you start, please read [CONTRIBUTING.md](CONTRIBUTING.md) for branch conventions, commit message format, and the local development workflow.

- 🐛 **Found a bug**: [open an issue](https://github.com/donggua-zen/guada/issues)
- 🔧 **Want to contribute code**: fork the repo → branch from `develop` → submit a PR
- 📝 **Commit messages**: use `feat:` / `fix:` / `docs:` / `chore:` prefixes

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
