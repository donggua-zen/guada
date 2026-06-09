# GuaDa — Desktop AI Workstation

> A visible, tangible, and interactive desktop AI workstation. Built on ReAct Agent, integrating browser automation, RAG knowledge base, IM bots, MCP tools, and the Skills framework. One engine serves Web, Desktop, and IM through a unified interface. **Currently in early development; some features are evolving rapidly.**

[![NestJS](https://img.shields.io/badge/NestJS-11.x-red.svg)](https://nestjs.com)
[![Vue](https://img.shields.io/badge/Vue-3.x-4FC08D?logo=vue.js&logoColor=white)](https://vuejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-6.x-blue.svg)](https://www.typescriptlang.org)
[![Prisma](https://img.shields.io/badge/Prisma-7.x-2D3748?logo=prisma&logoColor=white)](https://www.prisma.io)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

[中文](README.md) | English

---

## Repositories

- **GitHub**: https://github.com/donggua-zen/guada
- **Gitee**: https://gitee.com/zhendongdong/guada_ai

---

For questions, feedback, technical discussions, or pre-built client downloads, join:
- QQ Group: 1047993501
- WeChat Official Account: 冬瓜编程实验室 (Winter Melon Programming Lab)

## Table of Contents

- [What Can It Do?](#what-can-it-do)
- [Target Audience & Why GuaDa](#target-audience--why-guada)
- [Core Strengths](#core-strengths)
- [Overall Architecture](#overall-architecture)
- [Core Engine](#core-engine)
  - [Agent Dialogue Engine](#agent-dialogue-engine)
  - [Context Management & Compression](#context-management--compression)
- [Knowledge Base (RAG)](#knowledge-base-rag)
- [Skills Framework](#skills-framework)
- [Bot Gateway](#bot-gateway)
- [Scheduled Tasks](#scheduled-tasks)
- [Browser Automation](#browser-automation)
- [Multi-Model Management](#multi-model-management)
- [Tech Stack](#tech-stack)
- [Development Roadmap](#development-roadmap)
- [Quick Start](#quick-start)
- [Project Structure](#project-structure)
- [License](#license)

---

## What Can It Do?

### Suitable Scenarios

| Scenario | Description |
|------|------|
| **Chat & Q&A** | Daily conversations, answering questions, information retrieval, with multi-model switching support |
| **Private Knowledge Base** | Upload PDFs/documents; AI answers based on your materials, data stays on your machine |
| **Intelligent Customer Service** | Connect to QQ / WeCom, bind knowledge bases, AI auto-replies to customer messages, 24/7 online |
| **Office Automation** | Data analysis, document translation, meeting summaries, email drafting, desktop client ready anytime |
| **Browser Automation** | "Help me scrape data from this webpage", "Take daily screenshots of the admin panel", "Auto-tip popular Bilibili videos" — Agent controls the browser directly |
| **Creative Writing** | Novel writing, copywriting, script creation, brainstorming |
| **Productivity Tools** | Project architecture analysis, code review, technical solution evaluation |

### Unsuitable Scenarios

| Scenario | Recommendation |
|------|------|
| **Large-scale Project Coding** | Use Claude Code, Cursor, or other professional coding agents |
| **Video / Short Film Generation** | Use GuaDa for script and storyboard creation, then import into professional platforms like Jimeng or Sora for best results |

---

## Target Audience & Why GuaDa

### Who Is It For?

| Audience | Typical Scenarios |
|------|---------|
| **Individual Developers / Geeks** | Deploy private AI assistant locally, customize skills and knowledge bases, data never leaves your machine |
| **Enterprise Teams** | Build internal AI hub, connect to IM for intelligent customer service, private deployment ensures data security |
| **AI Product Enthusiasts** | One-stop experience of cutting-edge technologies: Agent autonomous loops, RAG retrieval, MCP protocol, Skills framework |

> **In one sentence**: Desktop AI Workstation. Browser automation + Knowledge base + IM bot + Skills framework, one engine serves Web / Desktop / IM through a unified interface, lightweight, private, and ready to use out of the box.

---

## Core Strengths

| Capability | Key Highlights |
|------|---------|
| **Agent** | Multi-turn autonomous loop based on ReAct pattern, can autonomously schedule knowledge retrieval, tool execution, and skill invocation. Supports session locks, streaming, interruption handling, and regeneration modes |
| **Knowledge Base** | Semantic + keyword dual-match search (sqlite-vec + FTS5 + jieba + BM25), directory-level management, Agent autonomous multi-round search and self-service document addition |
| **Bot** | Unified access for QQ, WeCom, and other IM platforms. Build intelligent customer service with knowledge bases. Supports auto-reconnect, message merging, and session mapping |
| **Long-term Memory** | Dialogue memory persistence, two-level compression strategy (prioritize trimming tool results, then semantic compression), checkpoint persistence and compression rollback, protection for last 5 messages / latest 3 tool results |
| **Skill Management** | File-as-skill, anyone can write and share. Supports hot-plugging (changes take effect immediately), compatible with the vast Skills market ecosystem |
| **Multiple Deployment Methods** | Supports Electron desktop, Web application, and Docker containerization |
| **Enterprise-grade Data Support** | Default SQLite, seamlessly switchable to MySQL or PostgreSQL via Prisma ORM |
| **Scheduled Tasks** | Agent executes automatically on schedule, supports Cron expressions and fixed intervals, role inheritance and session isolation, complete execution logs |
| **Browser Automation** | Embedded Chromium in Electron desktop, Agent can control the browser directly. Smart compression optimization preserves overall page architecture while significantly reducing Token consumption — AI sees the big picture while saving costs |
| **Multi-Model Management** | Unified access to mainstream LLMs including OpenAI, Anthropic, Azure, Google, with dynamic switching and hierarchical model configuration |
| **Custom Wallpaper** | Custom background wallpaper, transparency, glassmorphism effects, create a personalized workstation |

### Product Screenshots

| ![Screenshot 1](./images/image_001.png) | ![Screenshot 2](./images/image_002.png) |
|:---:|:---:|
| ![Screenshot 3](./images/image_003.png) | ![Screenshot 4](./images/image_004.png) |
| ![Knowledge Base](./images/image_005.png) | ![Browser Automation](./images/image_006.png) |
| ![Bot Knowledge Base](./images/image_007.png) | ![Scheduled Tasks](./images/image_008.png) |

---

## Overall Architecture

![System Architecture](./images/system-architecture.png)

### Architecture Layers

| Layer | Responsibility | Core Components |
|------|------|----------|
| **Frontend Entry** | User interaction layer, providing three access methods: Web app, Electron desktop app, IM platform clients | Vue 3 Web, Electron Desktop, QQ/Feishu/WeCom and other IM platforms |
| **Entry Layer** | Request processing and routing, converting requests from different sources into a unified internal protocol | REST + SSE API (for Web/Electron), Bot Gateway (for IM platforms) |
| **Core Service Layer** | Business logic hub, with Agent Engine uniformly scheduling dialogue, knowledge retrieval, tool invocation, and other capabilities | Agent Engine, Context Compression, Knowledge Base RAG, Tools & MCP, Skills Framework, LLM Adapters |
| **Data Layer** | Persistence storage infrastructure, managing relational data, vector indexes, and file resources | SQLite (Prisma), sqlite-vec + FTS5, filesystem storage |

---

## Core Engine

### Agent Dialogue Engine

GuaDa's core is a multi-turn autonomous loop engine implementing the **ReAct (Reasoning + Acting) pattern**:

**Key Designs**:

| Mechanism | Description |
|------|------|
| **Session Lock** | Memory Map-based exclusive lock, only one request processed per session at a time, preventing concurrent conflicts |
| **Streaming (SSE)** | Async generator yields chunks of events, frontend renders text, thought chains, and tool invocation progress in real-time |
| **ReAct Loop** | LLM reasoning → Tool invocation → Result injection → Re-reasoning |
| **Interruption Handling** | `AbortSignal` propagated to LLM request layer, auto-aborts when client disconnects, saving Token costs |
| **Regeneration Mode** | Supports `overwrite` (replace) and `multi_version` (multiple versions coexist) message regeneration strategies |
| **Thinking Tracking** | Records reasoning start/end timestamps, calculates thought chain duration, stored in message metadata |

---

### Context Management & Compression

Adopts a **two-level compression strategy** (prioritize trimming tool results → then semantic compression), balancing Token limits and information fidelity.

Unlike traditional solutions, GuaDa's compression is **non-destructive and reversible**:

- **Editable**: When AI-generated summaries are inaccurate, content can be manually modified
- **Reversible**: Delete any compression record to automatically restore corresponding historical messages, returning the dialogue to pre-compression state
- **Historical**: All compression records are visible, supporting retrospective review of each compression detail
- **Protection**: Last 5 messages are forcibly retained, latest 3 tool results are exempt from trimming

| Mode | Description |
|------|------|
| **Drop** | Directly discard old messages, fastest but loses history |
| **Fast Compression** | Single LLM call generates summary, efficiency prioritized |
| **Iterative Compression** | Agent self-check optimization (up to 3 rounds), highest quality, used by default |

Default is `iterative`, automatically falls back to `fast` on failure.

---

## Knowledge Base (RAG)

Complete **Retrieval-Augmented Generation (RAG)** pipeline. → [Detailed Documentation](docs/knowledge-base.md)

**Key Highlight — Agent Self-Service Management** (different from conventional RAG):

- **Self-Service Multi-Round Search**: Agent autonomously decides search strategy, rounds, and file combinations, rather than system pre-sorting
- **Self-Service Write**: Agent reads local files and automatically parses, chunks, vectorizes, and stores them in the knowledge base

**Document Processing**: PDF/DOCX/TXT and 40+ formats → Smart Token chunking → Vector embedding, async processing with automatic recovery from interruptions

**Hybrid Retrieval**: Semantic search (sqlite-vec) + keyword search (FTS5 + jieba + BM25) weighted fusion, configurable weights, supports file filtering and partitioned storage

**File Management**: Hierarchical directory structure, supports creating folders, batch upload, move, rename

---

## Skills Framework

Designed based on the **Anthropic Skills protocol**, using the filesystem for storage. A skill is just a Markdown file + optional scripts, anyone can write and share.

**Core Advantages**:

- **Progressive Loading**: L1 metadata injected into System Prompt, Agent activates full instructions on demand, avoiding one-time Token consumption
- **Hot-Plugging**: Add, modify, or delete skills for immediate effect without restarting the system
- **Agent-Native Scheduling**: Skills registered as `skill__` namespace tools, Agent invokes on demand within the ReAct loop

---

## Bot Gateway

The Bot Gateway extends AI dialogue capabilities to instant messaging platforms, achieving multi-platform seamless access through a unified adapter interface.

![Bot Architecture](./images/bot-architecture.png)

- **Unified Adapter Interface (`IBotPlatform`)**: Strategy pattern design, new platforms only need to implement the interface
- **Auto-Reconnect**: Exponential backoff retry after WebSocket disconnection
- **Message Merging**: Multiple messages within a 1.5-second window are merged into one for processing
- **Session Mapping**: Establishes mapping from external users to internal Sessions via `(platform, type, nativeId)` triplet
- **Lifecycle Management**: Supports dynamic start, stop, and restart of bot instances

---

## Scheduled Tasks

Built-in scheduled task scheduling capability, Agent can automatically execute dialogue tasks according to configured cycles:

- **Cycle Configuration**: Supports both Cron expressions and fixed interval scheduling
- **Role Inheritance**: Scheduled tasks can bind to specific roles, reusing existing session configurations and model parameters
- **Session Isolation**: Each scheduled task has independent session context, avoiding conflicts with human dialogues
- **Execution Logs**: Complete records of each execution result and logs, facilitating auditing and troubleshooting

---

## Browser Automation

The Electron desktop client embeds a Chromium browser engine, which the Agent can directly control:

- **Page Control**: Click, input, scroll, screenshot, and other common operations
- **Data Collection**: Extract page elements, tables, and text content
- **Multi-Tab Management**: Supports opening multiple tabs simultaneously and switching contexts
- **Agent Integration**: Browser operations as part of the tool invocation chain, results directly injected into dialogue context

---

## Multi-Model Management

Unified LLM adapter layer, flexibly connecting to multiple model providers:

- **Provider Abstraction**: Unified encapsulation of different provider API differences through the `LLMProvider` interface
- **Dynamic Switching**: Multi-level model configuration at role, session, and global levels
- **Thinking Configuration**: Supports reasoning intensity control and dedicated compression model configuration
- **Accurate Token Counting**: Uses `@huggingface/tokenizers` for precise Token counting, avoiding character estimation errors


## Tech Stack

| Layer | Technology |
|------|---------|
| **Backend Framework** | NestJS 11 + TypeScript |
| **Frontend Framework** | Vue 3 + TypeScript |
| **Desktop** | Electron |
| **Database** | SQLite (default, Prisma ORM), switchable to MySQL / PostgreSQL |
| **Vector Retrieval** | sqlite-vec + FTS5 full-text search + jieba segmentation + BM25 reranking |
| **AI Models** | OpenAI / Anthropic / Azure / Google and other mainstream LLMs |
| **Containerization** | Docker + Docker Compose |
| **Reverse Proxy** | Nginx |

---

## Quick Start

### Requirements

- Node.js >= 18.x (Recommended 20.x LTS)
- npm >= 9.x

### Start Backend

```bash
cd backend-ts
npm install              # Automatically runs prisma generate
npm run db:seed:force    # Initialize seed data (default account guada / guada)
npm run start:dev        # Development mode -> http://localhost:3000
```

### Start Frontend

```bash
cd frontend
npm install
npm run dev              # Development mode -> http://localhost:5173
```

### Production Deployment

#### Docker Deployment (Recommended)
For detailed Docker containerization deployment guide, see: [Docker Deployment Documentation](docs/DOCKER_DEPLOYMENT.md)

Quick start:
```bash
# 1. Configure environment variables (file located in backend-ts directory)
cp backend-ts/.env.example backend-ts/.env
# Edit backend-ts/.env file, modify JWT_SECRET

# 2. One-click deployment
chmod +x deploy.sh
./deploy.sh

# 3. Access the application
# Frontend: http://localhost:8787 (if inaccessible, try http://127.0.0.1:8787)
# Backend API: http://localhost:8787/api/v1 (proxied through Nginx)
# Note: By default the backend port is not exposed; for debugging please refer to the Docker deployment documentation
```

Advantages:
- One-click deployment, no manual dependency installation
- Environment isolation, avoids dependency conflicts
- Automatic health checks and restart
- Data persistence, no loss on upgrade
- Resource limits, prevents memory leaks

#### Web Version (Traditional Deployment)
For detailed production environment deployment guide, see: [Production Deployment Documentation](docs/PRODUCTION_DEPLOYMENT.md)

Main steps include:
1. Configure environment variables (copy `.env.example` to `.env`)
2. Build production version (`npm run build`)
3. Use PM2 process daemon
4. Configure Nginx reverse proxy
5. Set up HTTPS certificates

#### Electron Version
For detailed Electron deployment guide, see: [Electron Deployment Documentation](docs/ELECTRON_DEPLOYMENT.md)

Main contents include:
1. Development environment setup
2. Production build and packaging
3. Data persistence and backup
4. Troubleshooting and log viewing
5. Updates and upgrades

### FAQ

For issues please see: [Troubleshooting Guide](docs/TROUBLESHOOTING.md)

Common issues include:
- Database table does not exist
- Prisma Client not generated
- Port conflicts
- Environment variable configuration errors
- Permission issues

---

## Project Structure

```
ai_chat/
├── backend-ts/                  # NestJS Backend
│   ├── prisma/
│   │   └── schema.prisma        # Database Schema
│   ├── src/
│   │   ├── common/              # Infrastructure (database, vector-db, mcp, utils, etc.)
│   │   ├── modules/
│   │   │   ├── chat/            # Core dialogue module (Agent engine, compression, context, messages)
│   │   │   ├── tools/           # Tool invocation system
│   │   │   ├── skills/          # Skills framework
│   │   │   ├── knowledge-base/  # Knowledge base module (RAG)
│   │   │   ├── llm-core/        # LLM adapter layer
│   │   │   ├── bot-gateway/     # Multi-platform bot gateway
│   │   │   ├── characters/      # Role management
│   │   │   ├── files/           # File management
│   │   │   ├── mcp-servers/     # MCP server management
│   │   │   ├── auth/            # JWT authentication
│   │   │   ├── models/          # Model management
│   │   │   ├── settings/        # System settings
│   │   │   └── users/           # User management
│   │   └── main.ts              # Application entry
│   └── skills/                  # Skills directory
├── frontend/                    # Vue 3 Frontend
│   ├── src/
│   │   ├── components/          # Components (chat, knowledge-base, plugins, bot, setting, etc.)
│   │   ├── composables/         # Composables
│   │   ├── stores/              # Pinia state management
│   │   ├── services/            # API service layer
│   │   ├── types/               # TypeScript type definitions
│   │   └── utils/               # Utility functions
│   └── package.json
├── electron/                    # Electron Desktop
├── docs/                        # Project documentation
└── LICENSE
```

---

## Development Roadmap

| Feature | Status | Description |
|------|------|------|
| **Agent Workflow** | Planned | Multi-step Agent orchestration and sub-Agent collaboration |
| **Sub-Agent** | Planned | Hierarchical Agent system, complex task decomposition and distribution |
| **Sandbox** | Planned | Secure code execution environment, Agent can write and run scripts |
| **Sub-accounts** | Backend Complete | Data isolation, configuration sharing, suitable for family / team shared use |

---

## License

This project is open-sourced under the [MIT License](LICENSE).

---
