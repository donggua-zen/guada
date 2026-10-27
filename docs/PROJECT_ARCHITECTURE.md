# GuaDa 项目架构分析报告

> 生成时间：会话内 workflow 实战分析（9 个 AI 代理协作）
> 方法：8 个代理并行分层审查 → 流水线加工（风险分类 + 健康度评分）→ 总架构师汇总
> 材料来源：根/backend-ts/frontend/electron 的 package.json、app.module.ts、main.ts、目录结构、文档索引等真实项目文件
> ⚠️ 说明：报告中标注「推测」的发现基于材料推断，标注「事实/材料级证据」的有明确文件佐证，落地前建议人工复核关键结论。
> **更新（2026-10）**：Prisma 主库与 DB→文件迁移脚手架已整体移除，运行时只使用 JSONL + 本地 SQLite（`_meta.db` / `kb.db`）。下文涉及 Prisma/主库的段落为历史记录。

---

## 1. 项目概览

- **产品**：GuaDa —— 以 Electron 桌面端为核心的全栈 AI 助手（含 Web 形态）
- **版本**：0.5.6
- **技术栈**：Electron 41 + NestJS 11 + Vue 3.5 + SQLite + pnpm monorepo
- **三端结构**：
  - `backend-ts/` — NestJS 模块化单体 API 服务（全局前缀 `api/v1`）
  - `frontend/` — Vue3 + Vite7 + Pinia + Element Plus 组件化 SPA（约 298 文件）
  - `electron/` — Electron 外壳（窗口/托盘/桥接/浏览器自动化）
- **打包**：electron-builder 24 —— win NSIS / mac dmg (x64+arm64) / linux AppImage+deb，asar smartUnpack + extraResources 注入后端运行时（后端随包资源清单与"必须 `to === from`"的契约见 `backend-ts/test/packaging/electron-packaging.spec.ts`；漏打包会被该测试拦住）。**后端 node_modules 打进 `app.asar`**——安装耗时按盘上文件数计（实测 ≈18ms/文件，1.5 万个小文件 ≈ 5 分钟，与包体字节数无关）；四处约束与校验见 `docs/ELECTRON_DEPLOYMENT.md` 2.2 与 `scripts/verify-asar-layout.js`

---

## 2. 整体架构评估（总架构师结论）

> **headline**：
> GuaDa 是一款功能野心大、分层架构清晰但治理明显滞后的桌面 AI 助手：8 个层面健康度全部处于堪忧区间（其中集成层仅 30 分），属于"功能先行、工程治理与安全加固欠账"的形态，需系统性重构与加固后才适合规模化发布。

> **verdict**：需要重构

**总体描述**：后端以模块化单体（13 全局 + 18 业务模块）内聚多厂商 LLM 接入（provider-hub 门面 + 适配器）、SQLite+sqlite-vec 持久化检索、MCP/skills/plugins 扩展生态、多平台机器人网关、子代理/工作流/调度执行编排与 RAG 知识库；前端为 Electron/Web 双端适配 SPA；外壳层通过命名管道 token 鉴权桥接、webview+CDP 浏览器自动化与 electron-builder 多平台打包。整体分层清晰、设计模式运用得当（门面/适配器/事件总线/SPI）、文档与方案先行，但安全执行面薄弱、文档与实现漂移、进程内易失状态无恢复、数据双轨一致性欠缺、工程化缺 CI 与产物级验证。

### 分层健康度总表

| 层面 | 健康度 | 结论 |
|---|---|---|
| 后端核心架构 | 52 | 堪忧 |
| 数据层与持久化 | 52 | 堪忧 |
| LLM 模型层 | 52 | 堪忧 |
| **集成层（网关/MCP/Skills/插件）** | **30** | **堪忧（最薄弱）** |
| 执行层（子代理/工作流/调度/终端） | 52 | 堪忧 |
| 前端架构 | 52 | 堪忧 |
| Electron 外壳与打包 | 52 | 堪忧 |
| 工程化与部署 | 52 | 堪忧 |

---

## 3. 分层详情

### 3.1 后端核心架构（health 52）

**总览**：NestJS 11 模块化单体，13 全局模块 + 18 业务模块（另有 24 个 modules 目录 + 16 个 common 子层），承载 LLM 接入、SQLite+向量检索、MCP 工具生态、文档解析/知识库、沙箱命令执行，并作为 Electron 唯一的 Bridge 后端进程。

**关键组件**：app.module 装配中枢、main.ts（Winston/ValidationPipe/全局过滤器拦截器/CORS/静态与上传目录/PORT=0 自动端口/Bridge port_ready 上报与优雅关闭）、DatabaseModule(Prisma7+better-sqlite3)+sqlite-vec、LlmCoreModule（openai/anthropic/google SDK）、MCP 生态、BotGateway、知识处理链路（pdfjs-dist/mammoth/sharp/jieba）、执行与编排（Shell/Terminal/Commands/Git + sandbox.exe）。

**设计模式**：模块化+DI、适配器（多 SDK 归一）、事件驱动/观察者（EventEmitterModule）、AOP 管道（校验/异常/埋点）、进程间桥接（Bridge + 随机端口）、插件化扩展点。

**主要风险**：
1. 模块规模与依赖图膨胀（13+18 模块集中在 AppModule，Commands/Shell/Terminal/Git 业务域重叠，易循环依赖）— 推测中
2. 6 个原生依赖（better-sqlite3/sqlite-vec/sharp/node-pty/jieba）跨平台 ABI 打包风险 — 推测低（材料明确）
3. 沙箱与远程执行安全（sandbox.exe 承载命令执行，ACL/鉴权边界需严控）— 推测高
4. SQLite 并发写 + Bridge 单点握手无回退 — 推测中
5. 文档解析同步执行的内存/CPU 峰值 + tokenizer 版本漂移 — 推测中

**改进建议**：AppModule 分层注册并启用循环依赖检测；SQLite 开 WAL + 集中写队列；Bridge 握手超时重试 + `/healthz`；命令执行统一收敛鉴权 + ACL 白名单；文档解析异步队列化 + 多平台 CI 打包矩阵。

### 3.2 数据层与持久化（health 52）

**总览（历史段落，Prisma 已移除）**：早期 SQLite 存储底座 = Prisma 7 + better-sqlite3 adapter + sqlite-vec 向量扩展 + FTS5 全文搜索 + 自研 MigrationRunner。当前运行时已无 Prisma：会话元数据走 `sessions/_meta.db`（`SessionMetaStore`），知识库走每库 `kb.db`，消息走 JSONL。

**去主库化分层（知识库已改为每库自包含目录）**：会话消息主存储 = JSONL 事件日志（sessions/<id>/seg-*.jsonl + snapshot）；知识库 = `<知识库根>/<kbId>/{kb.json, kb.db, raw/}`，条目元信息、分块正文、向量与 FTS 全在 `kb.db` 内（`KbDatabaseService` 管每库连接：懒开 + LRU + `user_version` schema 迁移，删除前必须关闭句柄），原件副本存 `raw/<itemId>/`，检索走 `KbSearchService`（语义 + FTS + BM25 重排 + RRF，库内暴力余弦）；删库 = 关连接 + 删目录。Prisma 主库已整体移除，旧 `ai_chat.db` 仅作为磁盘上的回滚快照保留。详见 [design/kb-storage.md](design/kb-storage.md)。

**角色/智能体定义已文件化（2026-09）**：权威来源 = `agents/<id>/AGENT.md`（YAML frontmatter + Markdown 正文，目录名即 id，头像在同目录内）。`AgentFileStore` 双根解析（`AGENTS_DATA_DIR` → `USERDATA_DIR/agents` → `cwd()/data/agents`）+ chokidar 热重载 + 原子写；`bundled-agents/` 为随包内置模板，启动补种（已存在不覆盖、有墓碑不复活），UI 删除走 `.trash/` 回收站 + 墓碑。早期 DB `character`/`character_group` 表已随 Prisma 主库移除；角色分组功能与 `isPublic` 已移除，`title` 统一更名为 `name`。格式详见 `docs/design/character-file-format.md`。

**会话/机器人/知识库元信息已文件化（2026-09，后续收敛为 `_meta.db`）**：当前权威来源 = `sessions/_meta.db`（会话元信息与分组，`SessionMetaStore`）、`bots/<id>.yaml`（机器人实例，同 providers 范式）、`data/kb/<kbId>/kb.json`（KB 配置；条目/分块/向量在 `kb.db`）。早期文件形态 `meta.json` / `_groups.json` 从未上线。各域 id 均保持原 cuid → 零引用改写。`SessionMetaStore` 启动时做孤儿/幽灵收敛；`BotFileStore` 为「启动全量扫文件建内存索引 + chokidar + 原子写 + 每 id 写互斥」。排序键（`lastActiveAt`/`updatedAt`/`createdAt`）落库而非用文件系统时间。启动期已无 `MetadataFileBootstrapService` / `MetadataBootstrapGate`（随 Prisma 主库一起删除）。格式详见 `docs/design/metadata-file-format.md`。

**单账户模型（2026-09）**：多账户体系已彻底移除——子账户接口（本已损坏）、`role`/`parentId`、前端子账户 UI（零引用死代码）全部删除。账户权威来源改为 `<SETTINGS_DIR>/account.json`（单一账户：用户名/可选密码/昵称/头像/壁纸），密码存在与否即免登录开关（取代原 `autoLoginEnabled` 设置，两者语义重叠）。`userId` 作为数据归属维度**彻底移除**：文件格式不再写 userId（旧文件残留字段读时忽略，零数据迁移）、仓储签名与 SSR 订阅分区去维度、全部归属校验删除（**鉴权守卫保留**，删的是"是不是你的"而非"能不能访问"）。迁移 `0005` 移除 `mcp_server.user_id` 与 `file.upload_user_id`；`user`/`user_setting` 表冻结为回滚快照。定位说明：数据本身明文存储，账户仅用于公网部署挡住路人，非安全边界。详见 `docs/design/single-account.md`。

**设计模式**：适配器（better-sqlite3 → Prisma 7）、仓储/存储抽象（IMessageStore）、策略模式（jsonl 与 SQLite 可替换）、SPI 接口-实现分离（search/vector-db）、代码生成+模板（迁移）、邻接表自引用（Session.parentId 父子层级）。

**主要风险**：
1. SQLite 与 jsonl 双轨持久化无对账机制，存在数据分叉 — 推测
2. 自研迁移体系自动执行无回滚/checksum，schema 漂移风险 — 推测
3. FTS5 独立库跨库无事务原子性、索引滞后 — 推测
4. Prisma 7 非官方 adapter + sqlite-vec 原生扩展跨端（Electron/Web）加载失败 — 推测
5. Message 多版本 + reasoningContent 大字段无清理策略致库体膨胀 — 推测

**改进建议**：明确 jsonl = 备份/导出通道 + 对账机制；迁移加 checksum/事务/up-down 回滚并纳入 CI；统一检索契约 + 幂等写入；锁定原生模块版本按平台验证预编译产物；多版本数据生命周期管理（版本上限/归档）。

### 3.3 LLM 模型层（health 52）

> 2026-09 供应商配置文件化重构：供应商实例/模型目录/思考档位的权威来源是
> providers/*.yaml（PROVIDERS_DIR，Electron 注入 ~/.guada/providers），启动时
> 从 bundled-providers/ 补种并做 DB→文件一次性迁移；ProviderHub 与 17 个
> provider 类退役，协议适配器收敛为 AdapterRegistry（5 协议单例），thinking
> 差异经 thinkingStyle 枚举 + 中立档位词表收敛（见 bundled-providers/README.md）。

**总览**：llm-core 为核心，ProviderFileStore 读取 providers/*.yaml 供应商实例（对齐 DSH「供应商就是数据」），AdapterRegistry 按 wire 协议注册 5 个适配器单例（openai/openai-response/anthropic/gemini/mock），ProviderTypeCatalogService 保留类型静态事实（metadata/模型目录兜底），LLMService 唯一运行时 seam，thinkingStyle 枚举收敛各家思考参数拼法，SSE + StreamChunk 统一词汇流式输出。

**设计模式**：门面+注册表（provider-hub）、适配器（多厂商 SDK 收敛）、策略模式（按 provider 选择实现）、NestJS DI、观察者/事件体系（SSE 事件化）。

**主要风险**：
1. 统一抽象与厂商能力差异鸿沟（无能力协商 → 静默降级）— 推测
2. tiktoken 对非 OpenAI 系（Anthropic/Gemini/MiniMax）统计不准，影响上下文预算与计费 — 推测
3. MiniMax OpenAI 兼容适配层语义偏差（工具调用/流式事件/错误码）— 推测
4. partial-json-parser 对纯 JSON 流强依赖，非 JSON 块致断流 — 推测
5. 多份 plan 文档（SSE 断点续传/消息管道规范化/dsh 信封/上下文缓存）与实现漂移 — 推测

**改进建议**：provider-hub 增加能力特性矩阵并在入口校验；按厂商替换官方 tokenizer；定义统一内部流式事件契约再归一化；建立 provider 契约/黄金测试并把 plan 固化为验收测试；方案拆小落地 + 可观测性验证。

### 3.4 集成层（机器人网关 / MCP / Skills / 插件）（health 30 — 最薄弱）

**总览**：bot-gateway 多平台适配（自研 iLink 个人微信 SDK / Discord / 企业微信 / 飞书）；MCP 双向角色（common/mcp 客户端 + modules/mcp-servers 服务器，配置存 `<MCP根>/<id>.yaml`，工具缓存同目录 `<id>.tools.json`；客户端连接由 `mcp-connection-manager.service.ts` 池化复用并按空闲回收，配置变更按连接键自动换代）；skills 动态能力扩展（版本管理/文件监听/元数据校验）；plugins 插件生态（后端 plugins/ 目录 + 前端 PluginSlot）。

**设计模式**：适配器（多 IM 协议）、插件/扩展点架构（前后端双扩展点）、观察者/事件驱动（skill-watcher）、MCP 协议双向角色、连接池 + 引用/空闲回收 + 单飞建连。

**主要风险**（该层风险最集中）：
1. 个人微信通道：自研协议映射依赖逆向维护，违反平台条款、易封号、协议变更即失效 — 合规与稳定性风险最高
2. 多平台适配器一致性缺乏统一抽象证据：无事件归一化/幂等去重/重试限流 — 推测
3. MCP 连接为**全应用共享**（每服务器一条，非按会话隔离）：有状态服务器（浏览器自动化类）被多个会话共用同一份服务器状态；MCP 服务器无来源白名单/信任分级 — 推测
4. skills 动态加载无代码级校验/沙箱，第三方 skill 任意代码执行风险 — 推测
5. 前端插件插槽无 Manifest/权限白名单/CSP 隔离，XSS 与供应链风险 — 推测

**改进建议**：定义统一平台无关 BotAdapter/ChannelPort 契约；个人微信通道隔离部署 + 健康检查/断线重连/协议升级熔断 + ADR 记录合规决策；MCP 补 `isolation` 配置项以支持按会话隔离 + 服务器来源白名单（连接池本身已落地：复用/单飞建连/空闲回收/进程树终止/取消透传）；skills 加载加代码级校验 + 非信任 skill 沙箱运行 + 可回滚；前端插件定义 Manifest + 受限 iframe/CSP。

### 3.5 执行层（子代理 / 工作流 / 调度 / 终端 / 工具）（health 52）

**总览**：NestJS 模块化 + 事件总线的编排中枢。SubAgentManager 持久化子代理会话；WorkflowEngineService 在 worker_thread + vm 沙箱执行模型生成脚本；node-cron 调度器；node-pty/WS 终端；进程托管 shell；可插拔工具/命令注册体系。

**关键组件**：sub-agent manager（spawn/sendMessage/waitForComplete/closeSubAgent、running/completed 状态机、one_shot/persist 生命周期、JSONL 回放、父子权限继承）；workflow-engine（并发槽 min(8,max(2,cores-1))≤32、总代理上限 100、FIFO、live+replay 双通道事件、runs 内存注册表、vm 沙箱 worker、abort→5s→terminate、3 万字符结果截断）；scheduler（node-cron+cron-parser、Asia/Shanghai、cron/once、tasks.json/logs.json 整表重写）；terminal（node-pty ConPTY、transcript 1MB、MAX_UI_TERMINALS=3、孤儿 5 分钟回收、WS JWT query.token）；shell process-manager（drainCompleted、流式 sanitizer、ANSI 剥离、sandbox.exe 可选）；tools（executeBatch MAX_CONCURRENCY=10、大结果落盘 .guada/tools_output）；commands registry。

**设计模式**：DI 模块化、注册表/适配器（PluginManager/CommandProviderRegistry/toFlatToolDefs）、观察者/事件总线（EventBusService、双通道 seq 去重、system_reminder 注入）、状态机与生命周期管理、策略/命令模式（ICommandProvider trigger）、沙箱隔离 + 结构化序列化边界（vm + postMessage 结构化克隆）。

**主要风险**：
1. **文档与实现漂移（材料级证据）**：docs/scheduler.md 声明 interval 调度 + node-schedule + 3 种 scheduleType，实际代码仅 cron/once + node-cron —— 按文档配置会得到完全不同的行为
2. 工作流 vm 沙箱执行无内置单次超时，挂死脚本持续占用 worker 线程与并发槽 — 推测
3. 进程/终端/工作流/调度器注册表全为内存态，进程重启即丢失，崩溃后 DB 中 persist 子代理滞留 running 态 — 推测
4. 子代理生命周期语义未收口（材料级证据）：sidebar-tabs-plan 明确 close≠delete，而 closeSubAgent 仍硬删除
5. 执行边界安全：shell 默认任意 PowerShell 命令、沙箱可选非强制、终端 WS 用 query.token 传 JWT（日志泄露面）、PTY 上限仅约束 UI 侧 — 推测

**改进建议**：修订 scheduler 文档或补齐实现并做原子写；工作流加 run/agent 级硬超时 + 引擎可强制终止；易失注册表落盘或启动清扫 + 崩溃恢复；按 sidebar-tabs-plan 完成 close≠delete 重构；默认强制沙箱 + 命令白名单 + WS 鉴权改 subprotocol/首帧。

### 3.6 前端架构（health 52）

**总览**：Vue 3.5 + Vite 7 + Pinia + Element Plus + vue-router（Electron→hash / Web→history）+ vue-i18n（zh-CN/en-US）+ Tailwind 4 + CodeMirror + TipTap + xterm。四层组织：components / composables / stores / services，约 298 个文件。

**设计模式**：服务/仓储式封装（services/modules 按领域分 API）、组合式函数复用（useSessionChat/useDiffDOM/usePerfMonitor…）、集中式状态管理（Pinia 按域分 store）、平台适配条件分支（isElectron）、开发期 Mock（MockControlPanel）。

**主要风险**：
1. 会话状态多来源（组件本地 + composable + store）双写不一致 — 推测
2. 298 文件分散十余个 components 目录，dev 组件与正式组件混排，缺 feature 边界 — 推测
3. 双端平台逻辑散落（托盘统计/右键菜单直接在 App.vue 挂载 isElectron 分支）— 推测
4. services 手写 API 封装无统一错误处理/类型生成，前后端契约漂移 — 推测
5. CodeMirror/xterm/TipTap/marked 等重型依赖若静态全局引入推高首屏体积 — 推测

**改进建议**：feature 化目录（src/features/*）；统一请求层 + OpenAPI/类型生成；会话状态收敛单一 store；重型依赖按需加载/代码分割；平台差异抽象为独立 platform adapter。

### 3.7 Electron 外壳与打包（health 52）

**总览**：主进程承担窗口/托盘/悬浮窗/单实例锁/更新轮询/后端子进程生命周期；命名管道(UDS) + crypto 随机 token 首包鉴权 + JSON-Lines RPC 桥接后端；内嵌 webview+CDP 浏览器自动化子层；electron-builder 多平台打包。

**关键组件**：main.ts（约 2300 行）、preload.ts（contextBridge 白名单，主窗口 sandbox:true + contextIsolation:true + nodeIntegration:false）、bridge-server + 后端 BridgeModule/BridgeClient（指数退避重连 1s→15s）、browser-tab-manager（webview 多窗口 FIFO 配对 + 共享 partition）、browser-automation-service（20+ browser_* 工具、快照锁、capturePage→CDP 回退、executeJavaScript 30s 超时不可取消）、accessibility-snapshot（CDP AX 树→DOM fallback）。

**设计模式**：适配器/传输解耦（BrowserAutomationService 可被 IPC/TCP/UDP 复用）、观察者/事件总线（broadcast + Set 监听者）、一次性 Promise 握手（backendReadyPromise/port_ready/FIFO pendingResolvers）、门面/最小权限桥（双 preload 分层）、回退链（截图/快照/点击多级降级）、防御式子进程生命周期（环形缓冲 + backend-crash.log + 重启弹窗）。

**主要风险**：
1. **安全基线不一致（事实）**：主窗口 sandbox:true，但托盘悬浮窗 floatWindow 用 nodeIntegration:true + contextIsolation:false + data: URL 内联脚本 —— 纵深防御缺失，一旦浮窗内容被污染即成为 Node 权限执行面（风险等级应视为高）
2. 崩溃吞除策略（事实+推测）：uncaughtException 全局记录后不退出，带病运行无自愈路径
3. 陈旧编译产物入生产包（事实）：dist 含 browser-shell-preload.js（源码已删/废弃）、orig_main.js/orig_aut.js 旧备份，打包以 `electron/dist/**/*` 整目录收录
4. 自动化资源不可回收（事实）：executeJavaScript 超时不可取消、webview 隐藏仅 CSS 不销毁
5. 迁移与退出链路薄弱（事实）：同步递归复制阻塞窗口、taskkill /F 与 shutdown 广播双路径耦合、startBackend 60s 定时器未清理

**改进建议**：floatWindow 对齐主窗口安全基线 + CSP + 落盘静态文件；构建前清理 dist + dist↔源码清单校验；异常区分可恢复/不可恢复 + 服务健康检查重建；自动化资源治理（可取消执行 + 并发上限 + webview 超时回收）；迁移异步流式 + 校验和 + 退出统一走 shutdown 广播。

### 3.8 工程化与部署（health 52）

**总览**：pnpm monorepo（root + backend-ts + frontend，pnpm@11.7.0 + postinstall 链式安装）；根级脚本一键开发/五段构建流水线/部署脚本；electron-builder 多平台打包 + github+generic 双发布目标；docker-compose + nginx 容器化部署；jest30/vitest4/浏览器快照测试；30+ 架构文档 + 10+ design 方案文档。

**设计模式**：Monorepo 工作区、构建流水线（clean→tsc→并发→package）、并行构建策略、发布目标抽象（多平台多格式 + 多源分发）、隔离进程注入（sandbox.exe）、文档驱动工程化。

**主要风险**：
1. 发布依赖本地脚本、未见 CI 佐证，win/mac/linux × 多格式矩阵易不一致 — 推测
2. 测试覆盖不平衡：后端/前端单元测试为主，无打包产物级冒烟/e2e — 推测
3. 数据修复脚本一次性化（*_repair_*.js + .guada_db_repair_backup*.json 散落根目录，历史孤儿数据问题）— 推测
4. 多平台原生依赖 ABI 与 sandbox.exe 跨平台注入/签名需持续验证 — 部分推测
5. 根目录资产膨胀：文档/脚本/数据/发布产物 + 9 个 AI 工具目录（.atomcode/.codely/.openclaw/.trae/.workbuddy/.zcode/.codely-cli 等）混放 — 推测

**改进建议**：引入 CI（GitHub Actions）承载构建矩阵与自动发布；产物级冒烟「安装→启动→加载 webview→退出」最小链路；修复脚本版本化迁入 scripts/repair；electron-builder 配置版本化 + 代码签名 + 沙箱哈希校验；根目录与工具链分层规整。

---

## 4. TOP 跨层风险

1. **【安全执行面整体偏弱 · 最高严重度】跨 4 层叠加**：自研个人微信协议通道（封号/合规/逆向维护）+ skills/plugins 动态加载无代码级沙箱 + Electron floatWindow 的 nodeIntegration RCE 纵深缺口 + 终端 WS 以 query.token 传 JWT + sandbox.exe 仅可选非强制 —— 任一被攻破即形成执行面。
2. **【文档与实现漂移 + 生命周期语义未收敛】（材料级证据）**：scheduler 文档声明 interval/node-schedule 而实现仅 cron/once/node-cron；closeSubAgent 仍硬删除 vs sidebar-tabs-plan 的 close≠delete；多份 plan 未固化为测试契约。
3. **【进程内易失状态无恢复机制】**：进程/终端/工作流 runs/调度器 activeJobs 全为内存态，重启即丢失；崩溃后 DB 中 persist 子代理滞留 running 态；工作流无内置单次超时。
4. **【数据一致性风险】**：SQLite 与 jsonl 双轨无对账；自研 MigrationRunner 无回滚/checksum；FTS5 独立库跨库无事务原子性；Message 多版本与 reasoningContent 大字段无清理策略。
5. **【部署与可观测性缺口】**：发布依赖本地脚本无 CI；无产物级冒烟/e2e；崩溃策略全局吞异常无自愈；Bridge port_ready 单点握手无超时重试与回退。

## 5. TOP 改进建议

1. **统一并加固安全基线（最高优先级）**：floatWindow 对齐 sandbox+contextIsolation+CSP；终端 WS 鉴权改 subprotocol/首帧；sandbox.exe 默认强制 + 命令白名单/速率限制；skills 加代码级校验与沙箱、前端插件 Manifest+受限 iframe/CSP。
2. **隔离与治理高风险通道**：bot-gateway 定义统一平台无关契约（事件归一化/幂等去重/重试限流）；个人微信通道独立部署 + 健康检查/断线重连/协议升级熔断 + 合规写入 ADR。
3. **收敛生命周期与文档一致性**：按 sidebar-tabs-plan 完成 close≠delete 重构；修订 scheduler 文档对齐实现；多份 plan 固化为验收测试契约。
4. **补齐状态恢复与数据一致性**：关键注册表落盘或启动清扫；工作流加 run/agent 级硬超时并可强制终止；jsonl 定位备份/导出通道 + 对账；迁移加 checksum+事务+回滚。
5. **引入 CI 与产物级质量门禁**：GitHub Actions 多平台构建矩阵与自动发布；构建前清理 dist 陈旧产物 + 清单 diff；补最小冒烟/e2e；修复脚本版本化；规整根目录与 AI 工具链目录。

---

*报告由 workflow（9 代理：8 层并行审查 + 总架构师汇总）自动生成；分层健康度由「风险等级 + 风险数量」启发式计算（low=82 / medium=62 / high=40 基准，每条风险 -3，下限 20）。*