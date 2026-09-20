# MEMORY.md

长期记忆（仅主会话读取）。日常流水在 `memory/YYYY-MM-DD.md`，这里只放蒸馏后的事实。

## 环境路径

- **测试环境数据路径：`C:\Users\22071\.guada-dev`**（用户 2026-09-10 明确指定）

  | 路径 | 内容 |
  |---|---|
  | `data/ai_chat.db` | SQLite 主库。**仅供测试**：数据不再新增/维护，只在测试损坏后用它还原，上线前会正式删除 |
  | `providers/*.yaml` | 供应商实例配置——模型/供应商的唯一权威来源 |
  | `agents/<id>/AGENT.md` | 智能体（角色）定义——**唯一权威来源**，含头像 `avatar.<ext>` |
  | `sessions/_meta.db` | 会话元数据 SQLite 库——**唯一权威来源**（WAL；含 parent_id/root_id/分组/归档；通用 `data` 扩展列，settings 折叠为受管键 data.settings；`_bootstrap` 表记「已从主库转换」标记，**删库即下次启动自动重转**；schema v3，迁移步骤按列存在性幂等判断） |
  | `sessions/<id>/` | 会话目录：JSONL 事件日志 + workflows/ + 图片附件。**没有 meta.json**（2026-09-20 起彻底不读写文件形态） |
  | `bots/<id>.yaml` | 机器人实例——**唯一权威来源** |
  | `<KB根>/<kbId>/kb.json` | 知识库配置 |
  | `<KB根>/<kbId>/kb.db` | KB 条目 + 分块 + 向量 + FTS（每库一个 SQLite） |
  | `<KB根>/<kbId>/raw/<itemId>/` | KB 原件副本（上传即写入） |
  | `models.json` | models 设置组（默认对话/标题/视觉/压缩模型等） |
  | `scheduler/tasks.json` | 定时任务（含 modelId / characterId 引用） |
  | `plugins/` `skills/` `workspaces/` | 插件、技能、工作目录 |

- 仓库内 `backend-ts/data/`（含 `ai_chat.db`、`.config/models.json`）**不是测试环境**，是直接跑后端时的本地开发残留；`backend-ts/.env` 的 `DATABASE_URL=file:./data/ai_chat.db` 只在这种场景生效。经 Electron 启动时数据路径由主进程注入为 `.guada-dev`。

## 模型/供应商（文件化后的约定）

- 模型 id = `{供应商实例id}:{模型名}`，实例 id 即 `providers/` 下的文件名。
- 供应商类型卡（`bundled-providers/*.yaml`）提供 thinking wire 拼法与默认档位，实例文件可覆盖；模型级 > 实例级 > 类型卡。
- 引用解析不到一律 fail-loud（`MODEL_NOT_RESOLVED`），不回退到全局默认模型——静默换模型会让成本与行为在用户不知情时改变。
- DB 的 `model` / `model_provider` 表已降级为还原快照，运行时不读写。
- 一次性迁移标记：`providers/.migrated-from-db`（导出实例文件 + 改写存量模型引用，共用此标记；删掉再启动即可幂等重跑）。

## 智能体/角色（文件化后的约定）

- **权威来源 = `agents/<id>/AGENT.md`**（YAML frontmatter + Markdown 正文）。**目录名即 id**，`title` 已统一改名 `name`，改 name 不改目录名 → 会话引用不会断。
- **id 必须是 ASCII slug**（`^[a-z0-9][a-z0-9-]*$`），**禁止中文**（2026-09-18 起强制）。显示名写在 `name` 字段，与 id 完全解耦（内置 `assistant-agent` ↔ name「智能助手」）。新建时前端「标识符」字段可显式指定，**非法值返回 HTTP 400**；**留空一律生成 `agent-<uuid v4>`**，不从 name 派生（中文名无法转写为可读 slug，派生只会产出不可辨认的目录名）。规则实现见 `agent-file.mapper.ts` 的 `AGENT_ID_PREFIX` / `AGENT_ID_PATTERN` / `isValidAgentId`，id 解析集中在 `AgentFileStore.resolveCreateId`，HTTP 边界校验在 `AgentService.createAgent`。
- **DB 迁移的旧角色 id = 原 cuid（恒等映射，2026-09-18 起）**：`AgentFileBootstrapService` 导出时 `dirId = rekey[row.id] ?? this.uniqueId(row.id, taken)`，**不再 slugify**。理由：`session.character_id` / `bot_instance.default_character_id` / `scheduler/tasks.json` 里绑的就是 cuid，沿用则**引用零改写、零断链**；cuid 天然是小写字母数字，符合 `AGENT_ID_PATTERN`。旧角色一律视为「用户自建」，与 bundled 模板 id 不同故二者并存——**即使显示名重复（出现两个「智能助手」）也保留**，以免误删用户自定义提示词/头像。副作用：`rekey` 退化为恒等映射 → `rewriteAgentWhitelists`/`rewriteExternalRefs`/`rewriteSchedulerTasks` 全部空跑。
- **引用一致性排查以正式库为准**：`agents/<id>/` 目录名必须与 DB 的 `session.character_id` 取值一致。注意 `.guada-dev.bak-20260913` 的 DB 曾被历史迁移（`rewriteExternalRefs`）把引用从 cuid 改写成**中文名**；**正式库 `.guada/data/ai_chat.db` 保留的是原始 cuid**。换数据源或重建后，务必核对 `_meta.db` 的 `sessions.agent_id` 分布是否与 `agents/` 目录名一一对应。
- **内置助手 = `bundled-agents/<id>/`，当前两个**：`assistant-agent`（name「智能助手」）、`code-analyst`（name「代码分析师」）。已移除 `产品经理`、`剧本编剧` 模板。DB `character` 表的导出路径（`agent-file-bootstrap.service.ts:113`）同样产出 ASCII id；若 DB 中仍有中文 character，会退化成一堆 `agent`/`agent-2`，需要时应在该处补显式映射表。
- **`assistant-agent` 两条强约束 + 全局 id 不可变（2026-09-18 起强制）**：① `AgentFileStore.listAgents` 排序时 `DEFAULT_AGENT_ID`（`agent-file.mapper.ts`）恒排第一——顺带使「新建会话回退 agents[0]」的默认选中确定性地落在它身上；② 禁止删除：`AgentService.deleteAgent` HTTP 边界抛 400 + `AgentFileStore.delete` 防御性拦截，永不进墓碑、补种永远有效；③ **所有智能体 id 创建后不可修改**：`updateAgent` 对请求体中与路径 id 不一致的 `id` 抛 400。前端 `AgentListTab.vue` 的 `canDelete()` 同步隐藏 assistant-agent 删除按钮。
- 头像在角色目录内（`avatar.<ext>`，约定文件名），删目录即删头像，无孤儿文件。
- 字段只有 `name` / `description` / `model` / `settings`（+ 正文即 systemPrompt）。`id`=目录名，时间用文件系统，**没有** `public`、`group`、`createdAt`（分组功能与 isPublic 已彻底移除）。
- `bundled-agents/<id>/` 是随包内置模板，启动补种到用户目录（**已存在不覆盖**）。UI 删除 → 移入 `.trash/` + 写 `.tombstones.json`（不复活）；文件管理器误删且无墓碑 → 下次启动补种（恢复默认版本）。
- **不要手动重命名角色目录**（=改 id），会断 `session.character_id`、`bot_instance.default_character_id`、`tasks.json`、其他角色的 `settings.agents` 白名单，以及历史 JSONL 里不可改写的旧 id。改显示名请改 `name` 字段。
- DB `character` / `character_group` 表已冻结（仅供回滚，上线前删除）；迁移 0004 已解除 `session → character` 外键。一次性标记：`agents/.migrated-from-db`，旧 id 映射在 `agents/.rekey.json`。
- 资源 URL 前缀：`/agents`（`AGENTS_URL_PREFIX`），由 main.ts 静态挂载。

## 会话/机器人/知识库（文件化后的约定，2026-09）

- **会话元数据权威 = `sessions/_meta.db`（SQLite，2026-09-20 起）**：唯一实现是 `SessionMetaStore`（`src/modules/chat/session-meta.store.ts`，契约+类型+迁移助手+SQLite 实现同一模块）。**没有任何文件兼容层**——文件版（meta.json/_groups.json）从未上线、客户只有主库数据，故一次性转换走「冻结主库 → _meta.db」直转（`common/database/bootstrap/metadata-file-bootstrap.service.ts` 的会话步，12ms/219 会话）。messages 仍是 JSONL 事件溯源（迁移成果不动）。转换门控在库内 `_bootstrap.migrated_from_db_at`：**删掉 `_meta.db` 即下次启动自动重转**（唯一重转入口，无需清 marker）。`root_id` 列由 create 依 parentId 自动解析、转换时按链回填。启动自愈双规则：目录有 seg 无行 → 从 seg-0000 重建（含真实消息才救）；行无目录 → 删行。
- **会话目录 = `sessions/<id>/`**（JSONL 事件日志、workflows、附件同目录）。**删除会话 = 删整个 `<id>/` 目录**（meta + 消息 + 工作流一起走）。id 有两种来源：**存量迁移 = 原 DB cuid**（25 字符，零重键 → tasks.json 里的 sessionId、JSONL 目录名全部无需改）；**新建 = `session-<uuid v4>`**（44 字符，DSH 同款，前缀常量 `SESSION_ID_PREFIX`）。`create` 缺 id 时自行铸造并对 id 做路径安全校验（`assertValidId`）。
- **排序键是业务数据**（`lastActiveAt`/`updatedAt`/`createdAt` 落在 _meta.db），**不要**改成读文件系统时间：`lastActiveAt` 每消息都变（现为单字段 UPDATE，0.1ms 级），且 Electron 数据目录迁移整目录拷贝不保留 mtime。排序 = SQL ORDER BY + 确定性 id tiebreak（结构化过滤 `SessionQueryFilter`/`SessionSortKey` 定义在 session-meta.store，groupId tri-state：null=仅未分组、undefined=不过滤）。
- **fork/branch 复制子会话（2026-09-20 起）**：`branchSession` 对子代理子会话做整目录克隆 + 元数据行克隆（新 id、parentId=新分支、closedAt 保留冻结态），目录内 `*.json/*.jsonl` 做文本级 `sessions/<旧id>/`→`sessions/<新id>/` 引用改写（**自引用与对原父的引用都要改**）；任一子会话流式中 409；失败回滚克隆行+目录。主会话自身 workflows/ 仍不复制。
- **会话分组**：已迁入 _meta.db 的 `session_groups` 表；删分组在单事务内解绑该组会话（groupId 置 null）。
- **机器人 = `bots/<id>.yaml`**（同 providers 范式）。`status`/`lastStartedAt`/`lastError` 是三个持久化点；运行中真实状态在内存。
- **知识库 = 一个自包含目录**：`<KB根>/<kbId>/{kb.json, kb.db, raw/}`（2026-09-14 从「file.json + chunks.jsonl + 全局 vector_db.sqlite」改为每库一个 SQLite，设计见 `docs/design/kb-storage.md`）。删库 = 关连接 + `rm -rf <kbId>/`；**改名不搬字节**（raw 目录用 itemId 命名）；**改名/移动 = 1 条 UPDATE**（原先文件夹改名要 N+1 次整写 file.json 并触发全量重扫）。
  - **知识库根**解析：`kbStorageRoot` 设置 → `KB_DATA_DIR` → `USERDATA_DIR/data/kb` → `./data/kb`。设置由 `kb-database.service` 的 `resolveKbRoot()` **直接读 `<SETTINGS_DIR>/system.json`**（进程内只读一次），**不要改回"由 SettingsService 启动时注入"**——`SettingsService` 排在 DatabaseModule 之后，而 KB 迁移在 DatabaseModule 的 hook 里先跑，实测会按默认根迁移、设置随后才注入，用户设了根却"知识库不见了"。设置页入口：通用 → 知识库（带目录选择器）。改根需重启生效，不自动搬数据（新根为空而默认根有库时启动告警）。
  - **连接管理（`KbDatabaseService`）**：懒开 + LRU 8 + 打开即按 `user_version` 迁移（版本过高拒绝打开）+ WAL/`synchronous=NORMAL` + 关闭前 `wal_checkpoint(TRUNCATE)`。**删除库目录前必须先 `close(kbId)`**（Windows 句柄占用会让 rm 失败）。
  - **FTS 不能用 external-content**：`chunk_fts.content` 存 jieba **分词后**文本、`chunk.content` 是原文，external-content 会回读原文导致中文检索静默失效。写入/查询分词必须同源（`kb-tokenizer.ts`）；而 BM25 重排**刻意**用另一套不过滤空 token 的分词（它们计入文档长度），别"顺手统一"——`test/knowledge-base/kb-search.service.spec.ts` 的黄金基线会抓住。
  - **规模实测（单库 4551 条目 + 20000 分块 + 20000 向量，kb.db 21.6MB）**：打开库 8ms（不随条目数增长）、**文件夹改名级联 17.6ms（影响 4550 行，一条 UPDATE）**、平铺列表首页 1ms / 深页 skip=4000 为 4ms、目录树 1ms、语义检索（暴力扫 2 万向量）32ms、关键词检索 36ms、混合检索 67ms、进度上报 0.14ms、删条目（含 50 分块）1.7ms、关闭后 -wal 残留 0 字节。对照旧实现：文件夹改名是 N+1 次整文件重写 + 触发全量重扫（千级条目下数秒）。
  - **DI 两个坑（实测启动才发现，单测因手工 new 而漏掉）**：① 仓储构造函数的形参类型是**接口**（`KbDbAccess`）——接口在运行期被擦除，Nest 解析成 `Object` 直接启动失败；必须写显式 token `@Inject(KbDatabaseService)`。② `KbDatabaseService`/`KbMetaStore`/`KbSearchService`/三个仓储**只能注册一次**（在 `@Global` 的 DatabaseModule）；KnowledgeBaseModule 再注册一次会造出第二个实例、两套句柄注册表互不知情，一条路径打开的库另一条路径 `close()` 关不掉 → 删库时 Windows 报占用。**改 DI 装配后必须真启动一次**（`node scripts/...` 或 `pnpm start:dev`），单测与 tsc 都抓不到这类错。
  - **这是"不落盘持久索引"原则的例外**：KB 确实落了持久索引，代价是单库损坏爆炸半径 = 整个库的元信息与分块；恢复靠 `raw/` 重处理、`.pre-sqlite/` 回滚、或 `pnpm kb:reembed`（只重嵌入，不重解析/OCR）。行业依据：Cherry Studio 同为每库 `raw/ + index.sqlite`；Dify/RAGFlow/Open WebUI 等用共享对象存储 + 键引用（多租户场景）。
- **启动门控（关键，别拆）**：`MetadataBootstrapGate` 确保一次性导出完成前各 FileStore 不读索引——否则导出未完成时读到空目录会把数据"变没"。新增文件化 store 时务必在 `initialize()` 里 `await gate.wait(域)`。
- **一次性导出标记**：`sessions/.migrated-sessions`、`bots/.migrated-bots`、`data/kb/.migrated-kb`（旧 file.json 形态）、`data/kb/.migrated-kb-sqlite`（每库 kb.db 形态；**新标记名**，已写过 `.migrated-kb` 的安装必须仍执行本次导入）（分域独立重试；导出失败不落 marker）。删 marker 重启可幂等重跑。
- **KB 导入器实测踩到的三个坑（都已修 + 有回归测试）**：① 判"已迁移"不能只看 `kb.db` 存在——被中断的启动会留下**空库**，会永久阻断导入，判据必须是"库里已有条目行"；② 冻结表任何一张读失败，旧写法会吞掉**整批**数据，必须逐表独立容错；③ 冻结行可能是 camelCase（Prisma）或 snake_case（直接 open sqlite），只认一种会因 `row.knowledgeBaseId === undefined` **静默丢条目**。另外原件缺失的历史残留行现在以 `failed` 导入并在 `errorMessage` 写明原因（界面可见可删），不再静默丢弃。
- **孤儿自愈**：有 JSONL 但库内无行的会话目录，启动时从 `session/init` 重建骨架行；**只救含真实消息的**（纯空壳目录是历史遗留，复活会产生幽灵会话）。
- DB 的 `session`/`session_group`/`bot_instance`/`knowledge_base`/`kb_file`/`kb_chunk`/`memory`/`user_setting`/`mcp_server` 表已冻结（schema 有 `已冻结` 标注）。**这些表不删除**：安装/升级时仍要读它们做用户数据迁移，只停止运行时读写。`user` 同理（认证已改读 `account.json`）。
- 冷启动实测（233 会话）：约 0.7-1.2s 建索引，启动期一次性，已在启动日志打点。若未来会话数上万再考虑派生缓存（纯内部改动，无数据迁移）。

## MCP 服务器（文件化后，2026-09）

- **权威来源 = `<MCP根>/<id>.yaml`**（`MCP_DATA_DIR` → `USERDATA_DIR/mcp-servers` → `./data/mcp-servers`）；工具缓存（list_tools 结果）在同目录 `<id>.tools.json`（派生，删了可重抓）。
- **id 不可改名**：角色设置里 `plugins.mcp.toolkits_deny`/`toolkits_allow` 存的是 `mcp_<id>`，改 id 会静默失效该角色的 MCP 工具过滤。id 沿用原 cuid，文件名即 id，文件内不写 id。
- **不做实时监听（与其它 store 的刻意差异）**：内存缓存是盘的只读视图，外部手改 YAML/tools.json **重启后生效**。API 写后主动刷新缓存并显式 `reloadPlugin("mcp")` 同步工具包注册。
- 导出标记 `<MCP根>/.migrated-mcp`。

## 迁移脚手架集中化（2026-09-13，临时——预计两个版本后随主库整体移除）

- **全部启动期迁移集中在 `src/common/database/bootstrap/`**：character / provider / account / metadata 四个 bootstrap 服务 + `model-reference-migration.ts` + 编排器 `MigrationBootstrapService`。各服务只有 `run()`，唯一 `OnModuleInit` 在编排器，**执行顺序是代码显式的**：connect → DB migration → 角色 rekey → 供应商 rekey → 账户 → 元信息导出 → store 预热。
- **为什么必须编排（别改回去）**：早期分散在 DatabaseModule/ModelsModule/CharactersModule 时按 Nest 初始化顺序「导出先于 rekey」，跳版升级（旧库首迁）会把旧 cuid 引用写进会话元数据/yaml/kb.json 且永不自愈；provider rekey 改 AGENT.md frontmatter 也因角色文件未导入而落空。顺带还踩出一个潜伏 bug：`bot_instance.defaultCharacterId` 非空列不能用 `{ not: null }` 过滤（PrismaClientValidationError，dev 环境 marker 一直在所以从未跑过该路径）。
- **配套验证工具**：`scripts/verify-migration.cjs <数据根>`——逐域断言 DB（只读）↔ 文件一致。跳版升级 runbook（含两条手动脚本）见 `docs/design/metadata-file-format.md`。
- **package.json 死脚本已删**：db:verify / test:pdf-extract / test:mock-bot（目标文件不存在）。CharactersModule/ModelsModule 的本地 PrismaService provider 已随 bootstrap 迁走一并删除（误导性「收尾提交时移除」注释同去）。
- **`~/.guada-dev` 已全量重建实测**（用户授权）：旧环境整体移到 `~/.guada-dev.bak-20260913` 保留；playground 只播种 DB + file_stores + 设置 json + scheduler，一次启动全链路导出成功（233 会话/3 角色 rekey/11 供应商/40 模型/3 bot/2 kb/3 mcp/账户密码保留），三次启动幂等，断言 60/60。**注意**：`.bak` 里含 DB 冻结后的活会话增量（只存在于旧 JSONL），playbook 环境没有；`.bak` 处置待用户确认。
- **审计结论（主库残留，2026-09-13）**：运行期 16 个模型零 DB 访问，allowlist（bootstrap 脚手架 / 手动脚本）外零 Prisma、零 `$transaction`/`$executeRaw`（PRAGMA 除外）、无绕过 Prisma 直连。冻结表写入仅剩 bootstrap 一次性 rekey（编排顺序保证导出读的是改写后数据）。**2026-09-14 更新**：`kb-chunk.repository.ts` 的 prisma `findByFileId` fallback 已删除（它改为 kb.db 的正式分块仓储，Prisma **已退出知识库全链路**），允许触碰冻结表的只剩 4 个 bootstrap 服务、`src/scripts/*` 与 MigrationRunner。

- **2026-09-14 二次修正（存储根 + 校验）**：① `kbStorageRoot` 原先靠 `SettingsService.onModuleInit` 注入，但它在 AppModule 导入序里晚于 `DatabaseModule`，而 KB 迁移在前者 hook 里先跑 → 实测**迁移按默认根执行、设置随后才注入**（用户设了根会"知识库不见了"）。改为 `resolveKbRoot()` 直接读设置文件、进程内只读一次（换根需重启，避免半个进程读新根）。② `assertUsableKbRoot` 原先**先 `path.resolve()` 再判 `isAbsolute()`**，判断恒为真，"必须是绝对路径"这条规则从未生效；改为先判原始入参再 resolve，相对路径与 UNC 都被拒。③ 前端补上设置入口（通用 → 知识库，带目录选择器）——原计划里写了但首轮只做了后端。④ 保存时的日志改为**仅在值真变化时**告警（设置页是自动保存且每次回写整组，否则刷屏）。

## 已修的三个 KB/附件真 bug（2026-09，勿回退）

- **KB 文件夹改名/移动**：原先只写冻结表 `kb_file`（`$transaction + $executeRawUnsafe`），file.json 永不更新 → 迁移后新建文件夹改名会错乱。改用 `KbFileStore.rewriteRelativePathPrefix`（该方法早已写好却零调用方）。只重写 relativePath 前缀，**不动 parentFolderId**。
- **删知识库漏删物理文件**：`KnowledgeBaseService.remove()` 原先从冻结表列 filePath。已改为读 `KbFileStore.queryFiles`。
- **附件定时清理会误删**：`FileService.onModuleInit` 的两个 30 分钟定时任务（`cleanupOrphanFiles` 查询漏了孤儿条件、`clearExpiredToolImages`）作用在早已停写的 `file` 表上，会把 JSONL 仍引用的物理附件删掉。已整体删除，连同 `copyFile`/`deleteFile`/`PUT /files/:fileId` 路由与 `FileRepository`。**附件只由上传产出内联 FileRef，无 DB 记录**。

## 单账户模型（2026-09）

- **账户权威来源 = `<SETTINGS_DIR>/account.json`**（Electron 下 `~/.guada/account.json`）：username / passwordHash(可空) / nickname / avatarUrl / wallpaperUrl。**不存 id**（单账户无需主键）。
- **密码存在与否 = 免登录开关**：`passwordHash` 为 null → 免登录直通；有值 → 必须登录。已删除独立的 `autoLoginEnabled` 设置（语义重叠）。
- **这不是安全边界**：数据明文躺在磁盘上，密码只为公网部署挡路人。不做复杂度策略/限流/token 吊销——别按安全需求去加固它。
- **遗忘密码**：编辑 account.json 删掉 `passwordHash` 重启即可（刻意保留的逃生通道）。
- ⚠️ **`AuthGuard` 必须先 `await accountStore.ensureReady()`**：预热前读到空账户会把"已设密码"误判为免登录而放行（已踩过，属安全语义 bug）。
- **升级不丢密码**：`AccountBootstrapService` 启动时若 account.json 不存在且 DB user 表有行 → 导入该行（passwordHash 原样搬运）。若改成"文件缺失就写默认值"，老用户密码会丢、实例变敞开。
- **userId 已彻底移除**（数据不再按用户隔离）：文件格式不写 userId（旧文件残留字段读时忽略，零迁移）；仓储签名 `findByUserId`→`findAll`、`listWebSessionIds()`；SSE 订阅不再按 userId 分区（单表按 clientId）；全部归属校验删除，**但 AuthGuard 鉴权保留**——删的是"是不是你的"，不是"能不能访问"。
- **2026-09-14 收尾（代码级全清）**：`ISessionContext.userId`/`AskSession.userId`/`ToolUsingEvent.userId`/`RpcHandler.ctx.userId` 等接口字段删除；70 处 `@CurrentUser()` 参数全删（鉴权装饰器与 AuthGuard 未动）；事件与 SSE wire 上的 `userId` 字段删除（`stream.events.ts` 8 处 + `SessionEvent` + `plugins_changed` 的 `"*"` 哨兵）；前端 6 个死类型字段 + 2 处占位初始化删除。**顺带修好 3 个由死管道造成的真故障**：① `scheduler_create_task` 工具（原先 `if (!userId) throw` → 恒失败）；② `kb_add_document` 工具（同因恒失败）；③ UI 后台进程列表恒空（进程归属原先比对 `entry.userId("") === user.id(undefined)` 恒 false → 现改为**按 sessionId 归属**：`listRunningBySession`/`killIfOwned(pid, sessionId)`/`readLogTail(pid, sessionId)`）。另删 `kb-search` 的死归属校验（双方 undefined 恒放行）。
- **tasks.json 归一化**：`TaskStorageService` 加载/保存均按 `ScheduledTask` 白名单剔除历史字段（存量 8 条的 `userId` 已随一次保存落盘清零）。DB 冻结表（含 `model_provider.user_id`）的 `user_id` 列**保留**——安装期迁移源 + 回滚快照；bot-gateway 适配器里的 `to_user_id`/`ilink_user_id` 是**外部平台协议字段**，与租户无关，禁止一起清。
- 迁移 `0005_drop_user_dimension` 移除 `mcp_server.user_id`（NOT NULL 阻塞写入）与 `file.upload_user_id`；`user`/`user_setting` 表**冻结保留**作回滚快照。
- 遗留清理：`password_is_set.txt`（安装目录标记文件，升级即丢）已删除；前端 `UserSubaccounts.vue`/`PasswordPage.vue` 与其路由/文案已删除。多租户时代的方案文档（SSE 断点续传、SUBAGENTS.md、merge-single-sse-design.md）已删除。
- **YAML 时间戳坑（2026-09-14 修复）**：js-yaml 会把**未加引号**的 ISO 时间解析成 `Date` 对象；`bot-file.store`/`mcp-file.store` 的 parse 原先只认字符串（`this.str(raw.createdAt) ?? now`），手改 YAML 会让时间静默变成"当前时间"（也是 mcp store 测试间歇失败的根因）。已加 `iso()` 做 Date/number/string 容错。store 自己 `yaml.dump` 时会给时间加引号，故只有手改文件会踩。

## Repository 兼容层移除（2026-09-16 第一阶段执行）

- **已删除 4 个纯转发 shim**（`CharacterRepository` / `SessionRepository` / `SessionGroupRepository` / `KnowledgeBaseRepository`）：它们只是迁移期「保 Prisma 签名、稳调用方」的兼容层，实现早已委托 FileStore。调用方（14 文件 / ~78 处）改为**直连 FileStore 领域方法**。
- **SessionRepository 的四职责拆解**（唯一有设计量的部分）：存储动词 → `SessionFileStore` 同名能力；索引查询（`findByParentId`/`countByParentId`/`findByBotAndExternalId`/`listWebSessionIds`/`getManyByIds`/`getSessionType`/`deleteChildrenOf`）→ **补进 SessionFileStore**；用例查询（`findAll`/`findArchived` 的过滤+分页）与视图水合（补 `session.character`）→ **上移 session.service** 私有方法（`querySessions`/`queryArchivedSessions`/`hydrateSession`/`hydrateMany`）。
- **KB 双仓储不动**（`KBFileRepository`/`KBChunkRepository` 是 kb.db 的持久化本体，非 shim）：仅从 `common/database/` **归位到 `modules/knowledge-base/`**。
- **`common/database/` 现仅剩**：`database.module.ts`（改名 `PERSISTENCE_PROVIDERS` + 头注释说明现实）、`prisma.service.ts`、`migration-runner.service.ts`、`migration.interface.ts`、`metadata-bootstrap.gate.ts` + `bootstrap/`（迁移脚手架，待主库退役）。
- **契约保持**：HTTP 形状与前端零改动（`hydrate` 视图形状逐字段保留、`createSession` 返回类型用局部 `any` 承接 store 的 `Record<string,any>` 展开）；分组 CRUD 的 cuid 风格 id 与整表重写语义原样搬进 store。
- **验证门禁**：`tsc --noEmit` 0 错误 + 非 KB 套件 97/97、1256 用例全绿 + dev server 重启后 `/api/v1/health` 200（DI 装配正确）。KB 5 个套件因 better-sqlite3 ABI 不匹配（module 编译于 ABI 141，系统 node=127 / electron 41=145）仍不可跑，属**环境问题**（审计报告 P1-3），与本次改动无关。
- **测试债修正**：`bot-admin.dto.spec.ts` 与 `session-search-sessions.spec.ts` 原 mock 了被删的 Repository，已改为 mock `CharacterFileStore` / `SessionFileStore`。

## 协作偏好

- 用户会直接指出设计里的多余假设（例："除了测试环境没有老用户"），此时应重新评估该设计是否还有依据，而不是只改措辞。
- 涉及真实数据的操作（迁移、还原）先说清楚会动到什么；dev server 热重载会自动执行启动期迁移，改迁移代码时要注意这一点。
- **热重载误标记事故（2026-09-20）**：dev server（ts-node-dev --respawn）会在编辑中途加载瞬时代码。当时分批编辑 _meta.db 迁移代码，服务器在"VERSION 已升、迁移步骤未加"的窗口热重载，把 `user_version` 盖到超前值而实际没跑迁移 → 纯版本门控永久跳过 → 崩溃循环（后升 v3 按列存在性自愈）。**schema 迁移步骤必须按物理状态（table_info 列存在性等）判断且幂等，版本戳只做粗门控**；编辑迁移代码期间要意识到服务器在持续热重载中间态。
