# ⚡ GuaDa AI — 把你的电脑变成 AI 工作站

> **看得见、摸得着、能动手**的桌面 AI 工作站。基于 ReAct Agent + 子 Agent 分层架构，一个引擎统一服务 **Web / 桌面 / IM** 三大入口。

<p align="center">
  <a href="https://gitee.com/zhendongdong/guada_ai/stargazers"><img src="https://gitee.com/zhendongdong/guada_ai/badge/star.svg?theme=dark" alt="stars"></a>
  <a href="https://gitee.com/zhendongdong/guada_ai/members"><img src="https://gitee.com/zhendongdong/guada_ai/badge/fork.svg?theme=dark" alt="forks"></a>
  <a href="https://gitee.com/zhendongdong/guada_ai/watchers"><img src="https://gitee.com/zhendongdong/guada_ai/badge/watchers.svg?theme=dark" alt="watchers"></a>
  <img src="https://img.shields.io/badge/NestJS-11.x-red.svg" alt="NestJS">
  <img src="https://img.shields.io/badge/Vue-3.x-4FC08D?logo=vue.js&logoColor=white" alt="Vue">
  <img src="https://img.shields.io/badge/TypeScript-6.x-blue.svg" alt="TypeScript">
  <img src="https://img.shields.io/badge/Electron-latest-47848F?logo=electron&logoColor=white" alt="Electron">
  <img src="https://img.shields.io/badge/license-MIT-brightgreen.svg" alt="MIT">
</p>

<p align="center">
  <a href="#-快速开始-5分钟上手"><b> 快速开始</b></a> ·
  <a href="#-核心能力"><b> 核心能力</b></a> ·
  <a href="https://gitee.com/zhendongdong/guada_ai/issues"><b> 反馈</b></a> ·
  <a href="#%EF%B8%8F-社区"><b> 加入社区</b></a>
</p>

<p align="center">
  <a href="README.en.md">English</a> · 
  <b>Gitee</b> ·
  <a href="https://github.com/donggua-zen/guada">GitHub</a> ·
  <a href="https://atomgit.com/donggua_sherlock/GuaDaAI">GitCode</a>
</p>

---

##  快速开始（5分钟上手）

```bash
# 克隆项目
git clone https://gitee.com/zhendongdong/guada_ai.git
cd guada_ai

# 一键部署（Docker）
cp .env.example .env
./deploy.sh

# 打开浏览器访问 http://localhost:3000
# 开始跟你的 AI 助手对话！
```

> 也可选择 [Electron 桌面端](docs/ELECTRON_DEPLOYMENT.md) 或 [传统 Web 部署](docs/PRODUCTION_DEPLOYMENT.md)。

---

## 🔥 这项目能帮你做什么？

<table>
<tr>
  <td width="25%" align="center">
    <h3>📱 新媒体人</h3>
    <sub>运营 · 文案 · 编导</sub>
    <br><br>
    写脚本、出文案、追热点，Agent 定时抓取竞品动态、自动整理素材库，还能打开浏览器帮你爬数据。
  </td>
  <td width="25%" align="center">
    <h3>💻 程序员</h3>
    <sub>开发 · 架构 · 运维</sub>
    <br><br>
    分析代码、写技术方案、审 PR，丢项目进知识库随时问，写脚本的事交给 Agent 自动完成。
  </td>
  <td width="25%" align="center">
    <h3>✍️ 作者/编剧</h3>
    <sub>创作 · 构思 · 脑暴</sub>
    <br><br>
    构思人物、搭建世界观、头脑风暴情节，GuaDa 记得住你的设定，不会"忘记前面说过什么"。
  </td>
  <td width="25%" align="center">
    <h3>🏢 团队/企业</h3>
    <sub>内部AI · 知识库 · 客服</sub>
    <br><br>
    搭内部AI客服，绑定知识库，员工问问题AI自动答，还能接入 QQ/企业微信。
    <br><br>
    <b>数据不出本机，安全可控。</b>
  </td>
</tr>
</table>

---

##  核心能力

| 能力 | 亮点说明 | 文档 |
|------|---------|------|
| **🤖 智能体（Agent）** | ReAct 多轮自治循环 + 子 Agent 分层委派，支持会话锁、流式传输、中断处理与再生模式 | [→ 详情](docs/agent-engine.md) |
| **🧩 子 Agent 系统** | 主 Agent 自动拆解复杂任务 → 委派子 Agent 独立执行 → 结果自动归集 | [→ 详情](docs/sub-agent.md) |
| **📚 知识库 (RAG)** | 语义 + 关键词双混合检索，Agent 自助多轮搜索与写入，支持 **40+ 文件格式** | [→ 详情](docs/knowledge-base.md) |
| **🧠 长期记忆** | 两级压缩（裁剪→语义），可编辑、可回退、有历史，非破坏性压缩 | [→ 详情](docs/memory.md) |
| **🔧 技能管理** | 文件即技能，热插拔即时生效，渐进式加载省 Token | [→ 详情](docs/skills.md) |
| **⏰ 定时任务** | Agent 按 Cron 自动执行，独立会话隔离，完整执行记录 | [→ 详情](docs/scheduler.md) |
| **🤝 Bot 网关** | 统一接入 **QQ/企业微信**等 IM 平台，自动重连、消息合并、动态启停 | [→ 详情](docs/bot-gateway.md) |
| **🌐 浏览器自动化** | Electron 内嵌 Chromium，Agent 直接操控浏览器。**6 层智能压缩**，省 70%+ Token 不丢结构 | [→ 详情](docs/browser-automation.md) |
| **🧠 多模型管理** | 统一适配 OpenAI / Anthropic / Azure / Google 等，角色级/会话级/全局级配置 | [→ 详情](docs/models.md) |
| **🚀 多部署方式** | Electron 桌面 + Web 应用 + Docker 容器化，开箱即用 | [→ 部署指南](#-快速开始-5分钟上手) |
| **🗄️ 企业级数据** | 默认 SQLite，Prisma ORM 可无缝切换 MySQL / PostgreSQL | — |
| **🎨 自定义壁纸** | 自定义背景、透明度、毛玻璃效果，打造你的专属工作站 | — |

---

## 🖼️ 产品截图

<p align="center">
  <img src="./images/image_001.png" width="45%" alt="截图1">
  <img src="./images/image_002.png" width="45%" alt="截图2">
</p>
<p align="center">
  <img src="./images/image_003.png" width="45%" alt="截图3">
  <img src="./images/image_004.png" width="45%" alt="截图4">
</p>
<p align="center">
  <img src="./images/image_005.png" width="45%" alt="知识库">
  <img src="./images/image_006.png" width="45%" alt="浏览器自动化">
</p>

---

## 🏗️ 系统架构

![系统架构](./images/system-architecture.png)

```mermaid
graph TB
    subgraph FE["前端入口"]
        Web["Vue 3 Web 应用"]
        Electron["Electron 桌面应用"]
        IM["QQ / 企微等 IM 客户端"]
    end
    subgraph GW["入口层"]
        API["REST + SSE API"]
        BOT["Bot Gateway"]
    end
    subgraph CORE["核心服务层"]
        AE["Agent Engine<br/>ReAct 循环 · 会话锁 · 流式传输"]
        SUB["Sub-Agent Manager<br/>子 Agent 创建 · 委派 · 结果归集"]
        CTX["Context Manager<br/>两级压缩 · 检查点 · 快照回退"]
        KB["Knowledge Base / RAG<br/>混合检索 · Agent 自助搜索/写入"]
        TOOL["Tool Orchestrator<br/>工具调度 · MCP 协议 · 审批"]
        SKILL["Skills 框架<br/>渐进式加载 · 热插拔 · 命名空间"]
        LLM["LLM Adapter<br/>多供应商 · Token 计数 · Thinking"]
    end
    subgraph DATA["数据层"]
        DB[("关系数据库<br/>SQLite / PostgreSQL")]
        VEC[("向量索引<br/>sqlite-vec + FTS5")]
        FS["文件系统"]
    end
    Web -->|HTTP / SSE| API
    Electron -->|HTTP / SSE| API
    IM -->|WebSocket| BOT
    API --> AE
    BOT --> AE
    AE --> SUB
    AE --> CTX
    AE --> KB
    AE --> TOOL
    AE --> SKILL
    AE --> LLM
    SUB --> TOOL
    SUB --> LLM
    KB --> VEC
    CTX --> DB
    TOOL --> LLM
```

**架构四层：** `前端入口 → 入口层 → 核心服务层 → 数据层`

| 层级 | 职责 | 核心组件 |
|------|------|----------|
| **前端入口** | 用户交互 | Vue 3、Electron、QQ/企微 Bot |
| **入口层** | 路由与协议转换 | REST + SSE API、Bot Gateway |
| **核心服务层** | Agent 引擎 + 子 Agent + RAG + 工具调度 + Skills + LLM 适配 | Agent Engine、Sub-Agent Manager、上下文压缩、RAG、MCP、Skills 框架、LLM 适配器 |
| **数据层** | 持久化存储 | SQLite（Prisma ORM，可切换 MySQL/PostgreSQL）、sqlite-vec + FTS5、文件系统 |

---

## 🛠️ 项目结构

```
ai_chat/
├── backend-ts/                  # NestJS 后端
│   ├── prisma/schema.prisma     # 数据库 Schema
│   ├── src/
│   │   ├── common/              # 基础设施（数据库、向量、MCP、工具函数）
│   │   └── modules/
│   │       ├── chat/            # ⭐ 核心对话（Agent 引擎、压缩、上下文、审批）
│   │       ├── tools/           # ⭐ 工具调用系统（调度、MCP、上下文）
│   │       ├── skills/          # ⭐ Skills 技能框架
│   │       ├── sub-agent/       # ⭐ 子 Agent 系统
│   │       ├── knowledge-base/  # ⭐ 知识库（RAG）
│   │       ├── llm-core/        # LLM 适配层
│   │       ├── bot-gateway/     # 机器人网关
│   │       ├── characters/      # 角色管理
│   │       ├── scheduler/       # 定时任务
│   │       └── ...              # auth、files、models、settings、users
│   └── main.ts
├── frontend/                    # Vue 3 前端
├── electron/                    # Electron 桌面端
├── docs/                        # 文档
└── LICENSE
```

---

## 📋 开发计划

| 功能 | 状态 | 说明 |
|------|:----:|------|
| **子 Agent 系统** | ✅ 已完成 | 分层 Agent 体系，复杂任务自动拆解分发 |
| **Agent 工作流** | ✅ 已完成 | 多步骤 Agent 编排，任务拆解与协作 |
| **子账户** | 🔧 后端完成 | 数据隔离、配置共享，适合家庭/团队 |
| **沙箱** | 📅 规划中 | 安全的代码执行环境，Agent 可编写并运行脚本 |
| **Agent 工作流可视化** | 📅 规划中 | 图形化展示 Agent 推理、工具调用、子 Agent 执行链 |

---

## 🫂 社区

**遇到问题？想交流技术？下载预编译客户端？来这里：**

| 渠道 | 直达 |
|:----|:----|
| 💬 **QQ 群** | **1047993501** |
| 📢 **公众号** | **冬瓜编程实验室** |
| 🐛 **反馈 Issue** | [Gitee Issues](https://gitee.com/zhendongdong/guada_ai/issues) |
| ⭐ **支持项目** | [点个 Star](https://gitee.com/zhendongdong/guada_ai)（你的鼓励是持续更新的动力 ❤️） |

---

## 📄 许可证

本项目基于 [MIT License](LICENSE) 开源，可自由使用、修改和商用。

---

<p align="center">
  <b>如果 GuaDa 对你有帮助，欢迎在 Gitee 上点个 Star ⭐</b><br>
  <sub>你的每一次 Star，都是让这个项目变得更好的动力</sub>
</p>