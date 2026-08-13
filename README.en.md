# ⚡ GuaDa AI — Turn Your Computer into an AI Workstation

> **A visible, tangible, and interactive** desktop AI workstation. Built on ReAct Agent + Sub-Agent hierarchical architecture, one engine serves **Web / Desktop / IM** through a unified interface.

<p align="center">
  <a href="https://gitee.com/zhendongdong/guada_ai/stargazers"><img src="https://gitee.com/zhendongdong/guada_ai/badge/star.svg?theme=dark" alt="stars"></a>
  <a href="https://gitee.com/zhendongdong/guada_ai/members"><img src="https://gitee.com/zhendongdong/guada_ai/badge/fork.svg?theme=dark" alt="forks"></a>
  <img src="https://img.shields.io/badge/NestJS-11.x-red.svg" alt="NestJS">
  <img src="https://img.shields.io/badge/Vue-3.x-4FC08D?logo=vue.js&logoColor=white" alt="Vue">
  <img src="https://img.shields.io/badge/TypeScript-6.x-blue.svg" alt="TypeScript">
  <img src="https://img.shields.io/badge/Electron-latest-47848F?logo=electron&logoColor=white" alt="Electron">
  <img src="https://img.shields.io/badge/license-MIT-brightgreen.svg" alt="MIT">
</p>

<p align="center">
  <a href="#-quick-start-5-minute-setup"><b> Quick Start</b></a> ·
  <a href="#-core-capabilities"><b> Core Capabilities</b></a> ·
  <a href="https://gitee.com/zhendongdong/guada_ai/issues"><b> Feedback</b></a> ·
  <a href="#-community"><b> Join Community</b></a>
</p>

<p align="center">
  <b>English</b> ·
  <a href="README.md">中文</a>
</p>

---

##   Quick Start (5-Minute Setup)

```bash
# Clone the repository
git clone https://gitee.com/zhendongdong/guada_ai.git
cd guada_ai

# One-click deployment (Docker)
cp .env.example .env
./deploy.sh

# Open your browser at http://localhost:3000
# Start chatting with your AI assistant!
```

> You can also choose the [Electron Desktop](docs/ELECTRON_DEPLOYMENT.md) or [Traditional Web Deployment](docs/PRODUCTION_DEPLOYMENT.md).

---

##   What Can It Do for You?

<table>
<tr>
  <td width="25%" align="center">
    <h3>   Content Creator</h3>
    <sub>Social media · Copywriting · Scriptwriting</sub>
    <br><br>
    Write scripts, craft copy, track trends. Agents automatically scrape competitor updates, organize material libraries, and even open the browser to crawl data for you.
  </td>
  <td width="25%" align="center">
    <h3>   Developer</h3>
    <sub>Coding · Architecture · DevOps</sub>
    <br><br>
    Analyze code, write technical proposals, review PRs. Drop your project into the knowledge base and ask questions anytime — let the Agent handle the scripting.
  </td>
  <td width="25%" align="center">
    <h3>✍️ Writer</h3>
    <sub>Creative writing · Storytelling · Brainstorming</sub>
    <br><br>
    Develop characters, build story worlds, brainstorm plots. GuaDa remembers your settings — no more "it forgot what was said earlier."
  </td>
  <td width="25%" align="center">
    <h3>   Teams & Enterprises</h3>
    <sub>Internal AI · Knowledge base · Customer service</sub>
    <br><br>
    Set up an internal AI assistant, connect your knowledge base, let AI answer employee questions automatically. Integrate with QQ/WeCom.
    <br><br>
    <b>Data stays on your machine — safe and controllable.</b>
  </td>
</tr>
</table>

---

##   Core Capabilities

| Capability | Highlights | Docs |
|------|---------|------|
| **⚡ Agent** | ReAct multi-turn autonomous loop + Sub-Agent hierarchical delegation. Supports session locks, streaming, interruption handling, and regeneration mode | [→ Details](docs/agent-engine.md) |
| **   Sub-Agent System** | Main Agent auto-decomposes complex tasks → delegates sub-agents to execute independently → results auto-collected | [→ Details](docs/sub-agent.md) |
| **   Knowledge Base (RAG)** | Semantic + keyword hybrid retrieval, Agent self-service multi-round search and write, supports **40+ file formats** | [→ Details](docs/knowledge-base.md) |
| **   Long-Term Memory** | Two-level compression (trim → semantic), editable, reversible, with history tracking — non-destructive compression | [→ Details](docs/memory.md) |
| **   Skills Management** | Files-as-skills, hot-pluggable with instant effect, progressive loading saves tokens | [→ Details](docs/skills.md) |
| **⏰ Scheduled Tasks** | Agent runs automatically on Cron schedules, independent session isolation, complete execution logs | [→ Details](docs/scheduler.md) |
| **   Bot Gateway** | Unified access to **QQ / WeCom** and other IM platforms. Auto-reconnect, message merging, dynamic start/stop | [→ Details](docs/bot-gateway.md) |
| **   Browser Automation** | Electron-embedded Chromium, Agent controls the browser directly. **6-layer smart compression**, saves 70%+ tokens without losing structure | [→ Details](docs/browser-automation.md) |
| **   Multi-Model Management** | Unified adapters for OpenAI / Anthropic / Azure / Google etc. Role-level / session-level / global-level configuration | [→ Details](docs/models.md) |
| **   Multiple Deployment Options** | Electron desktop + Web app + Docker containerization, ready out of the box | [→ Deployment Guide](#-quick-start-5-minute-setup) |
| **️ Enterprise-Grade Data** | SQLite by default, Prisma ORM for seamless switch to MySQL / PostgreSQL | — |
| **   Custom Wallpaper** | Custom backgrounds, transparency, glassmorphism — create your own workstation | — |

---

## ️ Product Screenshots

<p align="center">
  <img src="./images/image_001.png" width="45%" alt="Screenshot 1">
  <img src="./images/image_002.png" width="45%" alt="Screenshot 2">
</p>
<p align="center">
  <img src="./images/image_003.png" width="45%" alt="Screenshot 3">
  <img src="./images/image_004.png" width="45%" alt="Screenshot 4">
</p>
<p align="center">
  <img src="./images/image_005.png" width="45%" alt="Knowledge Base">
  <img src="./images/image_006.png" width="45%" alt="Browser Automation">
</p>

---

## ️ System Architecture

![System Architecture](./images/system-architecture.png)

**Four layers:** `Frontend Entry → Entry Layer → Core Service Layer → Data Layer`

| Layer | Responsibility | Core Components |
|------|------|----------|
| **Frontend Entry** | User interaction | Vue 3, Electron, QQ/WeCom Bot |
| **Entry Layer** | Routing & protocol conversion | REST + SSE API, Bot Gateway |
| **Core Service Layer** | Agent engine + Sub-Agent + RAG + Tools + Skills + LLM adapters | Agent Engine, Sub-Agent Manager, Context Compression, RAG, MCP, Skills Framework, LLM Adapters |
| **Data Layer** | Persistent storage | SQLite (Prisma ORM, switchable to MySQL/PostgreSQL), sqlite-vec + FTS5, file system |

---

## ️ Project Structure

```
ai_chat/
├── backend-ts/                  # NestJS Backend
│   ├── prisma/schema.prisma     # Database Schema
│   ├── src/
│   │   ├── common/              # Infrastructure (database, vector, MCP, utils)
│   │   └── modules/
│   │       ├── chat/            # ⭐ Core dialogue (Agent engine, compression, context, approval)
│   │       ├── tools/           # ⭐ Tool invocation system (scheduler, MCP, context)
│   │       ├── skills/          # ⭐ Skills framework
│   │       ├── sub-agent/       # ⭐ Sub-Agent system
│   │       ├── knowledge-base/  # ⭐ Knowledge base (RAG)
│   │       ├── llm-core/        # LLM adapter layer
│   │       ├── bot-gateway/     # Bot gateway
│   │       ├── characters/      # Character management
│   │       ├── scheduler/       # Scheduled tasks
│   │       └── ...              # auth, files, models, settings, users
│   └── main.ts
├── frontend/                    # Vue 3 Frontend
├── electron/                    # Electron Desktop
├── docs/                        # Documentation
└── LICENSE
```

---

##   Development Roadmap

| Feature | Status | Description |
|------|:----:|------|
| **Sub-Agent System** | ✅ Done | Hierarchical Agent system, complex task auto-decomposition |
| **Agent Workflow** | ✅ Done | Multi-step Agent orchestration, task decomposition & collaboration |
| **Sub-accounts** |   Backend done | Data isolation, shared configuration, suitable for family/team use |
| **Sandbox** |   Planning | Secure code execution environment, Agent writes and runs scripts |
| **Agent Workflow Visualization** |   Planning | Visual display of Agent reasoning, tool calls, and sub-agent execution chains |

---

##   Community

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
      <img src="./images/wx_public_qrcode.jpeg" width="180" height="180" alt="WeChat Account QR"/><br>
      <b>📱 WeChat Official Account: 冬瓜编程实验室</b>
    </td>
  </tr>
</table>

<p align="center" style="margin-top: 30px;">
  <a href="https://gitee.com/zhendongdong/guada_ai"><b>⭐ Give a Star to Support the Project</b></a> (Your encouragement is the fuel for continuous updates ❤️)
</p>

---

##   License

This project is open-sourced under the [MIT License](LICENSE). Free to use, modify, and for commercial purposes.

---

<p align="center">
  <b>If GuaDa helps you, consider giving it a Star on Gitee ⭐</b><br>
  <sub>Every Star is the motivation to make this project even better</sub>
</p>