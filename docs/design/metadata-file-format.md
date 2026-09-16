# 元信息文件格式（会话 / 机器人 / 知识库 / MCP）

本文档描述会话 / 机器人 / 知识库 / MCP 四个数据域从 SQLite 迁到本地后的存储格式。
角色/智能体定义见 [character-file-format.md](./character-file-format.md)。

> 知识库已进一步改为「每库一个自包含目录（原件 + 元信息 + 分块 + 向量）」，细节见
> [kb-storage.md](./kb-storage.md)。本文只保留其与其余三域共有的文件化约定。

## 总览

| 域 | 权威来源 | 布局 |
|---|---|---|
| 会话 | `<sessions根>/<sessionId>/meta.json` | 一目录一会话（与 JSONL 事件日志同址） |
| 会话分组 | `<sessions根>/_groups.json` | 整表一份 |
| 机器人 | `<BOTS根>/<botId>.yaml` | 一实例一文件 |
| 知识库配置 | `<KB根>/<kbId>/kb.json` | 一库一份 |
| KB 条目/分块/向量 | `<KB根>/<kbId>/kb.db` | 每库一个 SQLite（含 raw/ 原件） |
| MCP 服务器 | `<MCP根>/<id>.yaml` | 一实例一文件；工具缓存同目录 `<id>.tools.json` |

**迁移期所有 id 保持原 cuid 不变** → 无需重键，`tasks.json` 的 sessionId、
JSONL 目录名、bot externalId 映射全部原样有效，零引用改写。
（KB 的条目 id 仍是原 cuid，但已成为 `kb.db` 的**主键**而不是目录名——`raw/` 目录名用了
itemId，所以改名不需要搬字节。）

> 新建实体则不再沿用 cuid：会话 id 由 `SessionFileStore.create` 铸造为
> `session-<uuid v4>`（DSH 同款，前缀常量 `SESSION_ID_PREFIX`），bot/mcp/分组沿用
> `c` + base36 短 id。id 只被精确字符串匹配，无任何格式/长度假设，新旧形态可长期共存；
> store 侧统一做路径安全校验（拒绝分隔符、`..`、字面量 `undefined`/`null`）。

目录解析规则与既有一致：
- sessions 根：`SESSION_DATA_DIR` → `USERDATA_DIR/sessions` → `UPLOAD_ROOT_DIR` 父级 `/sessions` → `./data/sessions`
- BOTS 根：`BOT_DATA_DIR` → `USERDATA_DIR/bots` → `./data/bots`
- KB 根：`kbStorageRoot` 设置 → `KB_DATA_DIR` → `USERDATA_DIR/data/kb` → `./data/kb`
- MCP 根：`MCP_DATA_DIR` → `USERDATA_DIR/mcp-servers` → `./data/mcp-servers`

## 会话：`meta.json`

```json
{
  "id": "cmophqvcd0000vckz8xo3hfk1",
  "title": "会话标题",
  "avatarUrl": null,
  "description": null,
  "modelId": "deepseek:deepseek-chat",
  "characterId": "智能助手",
  "groupId": null,
  "settings": { "memory": { "summaryMode": "memory_sync" } },
  "sessionType": "web",
  "archived": false,
  "botId": null,
  "platform": null,
  "externalId": null,
  "workspacePath": "C:/Users/x/.guada/workspaces/WORK-xxx",
  "parentId": null,
  "closedAt": null,
  "closeReason": null,
  "createdAt": "2026-05-03T09:09:49.832Z",
  "updatedAt": "2026-05-03T09:09:49.832Z",
  "lastActiveAt": "2026-05-03T09:09:49.832Z"
}
```

字段与原因：

- `id` / `createdAt` / `lastActiveAt` **必须落盘**，不用文件系统时间。这是与角色格式的
  刻意差异：角色的"创建时间"基本不变，可用目录 birthtime；而 `lastActiveAt` 是**每条消息
  都在变的业务数据**，是侧边栏排序的产品契约。且文件时间不可移植——Electron 数据目录
  迁移是整目录拷贝，`copyFileSync` 不保留 mtime，迁移一次全部会话顺序就乱。
- `sessionType`：`web` / `bot` / `sub_agent`。
- `parentId`：子代理/workflow 成员的父会话（**扁平字段，非目录嵌套**）。
- `closedAt` / `closeReason`：子代理冻结标记（NULL=活跃，非空=已结束仅供回放）。
- `externalId`：Bot 会话的外部标识；"清空会话"= 追加 `@<时间戳>` 标记（旧会话保留）。
- `settings`：会话级配置（`memory` / `plugins` / `skills` / `agents` 等），原样透传。

### 与会话目录共存的其它文件

```
<sessions根>/<sessionId>/
  meta.json        ← 本文档描述（元信息权威）
  manifest.json    ← JSONL 分卷清单（既有）
  seg-0000.jsonl   ← 事件日志（既有，追问消息）
  snapshot.json    ← 回放快照（既有）
  workflows/       ← 工作流终态快照（既有）
```

**删除会话 = 删除整个 `<sessionId>/` 目录**，meta 与消息、工作流天然一起走。

## 会话分组：`_groups.json`

```json
[
  { "id": "cmq6b5ywo0000lkkz9e2o55up", "name": "开发", "sortOrder": 1,
    "createdAt": "2026-06-09T07:18:22.200Z", "updatedAt": "2026-06-09T07:18:22.200Z" }
]
```

整表一份，每次变更整文件原子重写。删除分组时同步把该分组下会话的 `groupId` 置 `null`
（等价原 DB 的 `onDelete: SetNull`）。

## 机器人：`bots/<botId>.yaml`

```yaml
id: cmoinuwji0000xwkzhq1yf29d
platform: wecom
name: 企业微信测试
enabled: true
platformConfig:
  corpId: ww123
  agentId: '1000002'
reconnectEnabled: true
maxRetries: 5
retryInterval: 5000
defaultCharacterId: 智能助手
defaultModelId: deepseek:deepseek-chat
defaultThinkingEffort: null
status: running
lastStartedAt: '2026-09-12T03:39:20.123Z'
lastError: null
additionalKwargs:
  knowledgeBaseIds: []
createdAt: '2026-06-09T07:18:22.200Z'
updatedAt: '2026-09-12T03:39:20.123Z'
```

运行时状态语义（与 DB 版一致）：
- `status` / `lastStartedAt` / `lastError` 是三个持久化点，仅由 start / stop / 重连耗尽写入
- 运行中真实状态（CONNECTING / CONNECTED / 重连计数）在内存，不落盘
- 重启自启只读 `enabled: true` 的实例

## 知识库：`kb.json` + `kb.db` + `raw/`（每库自包含）

```
<KB根>/
  <kbId>/
    kb.json                     库配置（列表页只读它，空库不建 kb.db）
    kb.db                       条目 + 分块正文 + 向量 + FTS
    raw/<itemId>/<文件名>        原件副本
```

知识库**不再只是元信息文件化**：它把条目、分块、向量和原件都收进一个目录，
所以删库 = 删目录，改名不搬字节，分块与向量同一个事务写入。
完整设计（不变式、连接管理、迁移与回滚、备份注意）见
[kb-storage.md](./kb-storage.md)。

`kb.json` 字段：`id` / `name` / `description` / `embeddingModelId` /
`chunkMaxSize` / `chunkOverlapSize` / `chunkMinSize` / `isActive` / `isPublic` /
`metadataConfig` / `createdAt` / `updatedAt`。

`item` 表字段（等价于原 `kb_file` 行）：`id` / `fileName` / `displayName` / `fileSize` /
`fileType` / `fileExtension` / `contentHash` / `rawName` / `sourcePath` / `relativePath` /
`parentFolderId` / `isDirectory` / `processingStatus` / `progressPercentage` /
`currentStep` / `errorMessage` / `totalChunks` / `totalTokens` / `uploadedAt` / `processedAt`。
（`knowledgeBaseId` 由所在库隐含，读取时补回，保证调用方字段不变。）

- 文件夹即 `isDirectory: 1` 的条目（无分块）
- 前端批量轮询的 `processingStatus` / `progressPercentage` 按进度写 `item` 行（单条 UPDATE）
- 文件夹改名/移动 = 一条 `UPDATE item SET relative_path = ... WHERE substr(...) = ...`
- **知识库是「不落盘持久索引」原则的例外**：它确实落盘持久索引了，代价（单库损坏
  爆炸半径 = 整个库）与恢复手段见 kb-storage.md

## MCP 服务器：`<id>.yaml` + `<id>.tools.json`

```
<MCP根>/
  <id>.yaml                 配置正本（人类/AI 可直接编辑）
  <id>.tools.json           list_tools 抓取结果（派生缓存，删掉可重抓）
  .migrated-mcp             一次性导出标记
```

配置正本示例（空值字段省略——stdio 的 `command/args/env` 与 HTTP 的 `url/headers` 互斥）：

```yaml
name: 阿里云百炼_联网搜索
url: https://dashscope.aliyuncs.com/api/v1/mcps/WebSearch/mcp
type: streamableHttp
headers:
  Authorization: Bearer sk-xxx
enabled: false
createdAt: '2026-04-27T06:03:24.856Z'
updatedAt: '2026-07-13T10:42:22.304Z'
```

**为什么 tools 拆成独立文件**：tools 是「工具名 → `{description, inputSchema}`」的字典，
几十个工具会让 YAML 膨胀几百行、把配置淹没。拆开后配置永远清爽，缓存坏了直接删（下次
`refresh-tools` 或重新连接时重抓）。这与「角色目录 AGENT.md + avatar」「KB 的
`item` 行 + `raw/` 原件」是同一取舍：正本与派生物分离。

- `id` **不写进文件**——文件名（去扩展名）即 id（同 AGENT.md 以目录名为 id）。
- **id 不可改名**：角色设置里的 `plugins.mcp.toolkits_deny` / `toolkits_allow` 存的是
  `mcp_<id>`，改 id 会静默失效该角色的 MCP 工具过滤。
- 新建实例用 cuid 形状的生成 id（`c` + base36 时间戳 + 随机）。
- 解析时**文件名优先**于 YAML 内声明的 `id`（同 bots/providers）。
- 非法 YAML 单文件隔离：只记 `listLoadErrors()` 并告警，不崩服务、不挤占其它实例。
- **不做实时监听**（与其它 store 的刻意差异）：内存缓存是盘的只读视图，外部手改
  YAML/**tools.json 重启后生效**；写路径只有 API 与迁移导出，两者写后主动刷新缓存。
  API 写操作完成后显式 `reloadPlugin("mcp")`，使工具包注册立即同步。

`<id>.tools.json` 结构：

```json
{
  "fetchedAt": "2026-09-12T09:02:58.640Z",
  "tools": {
    "bailian_web_search": {
      "name": "bailian_web_search",
      "description": "搜索可用于查询百科知识、时事新闻、天气等信息",
      "inputSchema": { "type": "object", "properties": { "query": { "type": "string" } } }
    }
  }
}
```

## 顺序与一致性

**顺序不是存储属性，是查询时算出来的**：

| API 契约 | 排序 | 来源 |
|---|---|---|
| 会话列表 / 侧边栏 | `lastActiveAt desc` | meta.json + 内存排序 |
| 归档列表 | `updatedAt desc` | meta.json |
| children / 子代理列表 | `createdAt asc` | meta.json 的 parentId 过滤 |
| KB 文件树 | 文件夹优先 + `displayName asc` | `kb.db` 的 `item` 表（树排序在 JS 做，保 `localeCompare` 语义） |

排序都带**确定性 id tiebreak**（`lastActiveAt` 相同时按 id），保证两次相同查询顺序一致，
否则侧边栏会闪烁。

写路径：`每会话/每实例写互斥 → 改内存副本 → 原子写盘 → 更新内存索引`。
内存索引是盘的缓存而非独立真相；重启全量重扫自愈。**不落盘持久索引文件**
（有持久索引就会有 drift）。

## 高频写与健壮性

- **每消息写 `lastActiveAt`**：meta.json 约 1KB 原子重写（tmp + rename）。Windows 下
  rename 会因杀毒/索引服务短暂持有而 EPERM/EBUSY，故带退避重试（3 次）——静默失败会让
  会话在侧边栏不跳顶。
- **watcher 严格过滤**：只认 `meta.json` / `<id>.yaml`（KB 已改为 `kb.db`，不再需要
  watcher —— 它的索引在库内，不存在「外部改文件要重扫」的场景）；
  排除 `seg-*.jsonl`、`snapshot.json`、`manifest.json`、`.tmp`、点开头条目。
  否则流式输出期间会产生事件风暴。
- **rescan 遇 ENOENT 跳过而非视为删除**：否则恰在原子写窗口内的重扫会把会话误判为已删。
- **非法文件隔离**：JSON/YAML 解析失败仅记录告警，不崩服务、不挤占索引（同 providers 语义）。

## 启动期一次性导出

全部迁移集中为 `src/common/database/bootstrap/` 下的**迁移脚手架**（临时代码，见文末移除清单），
由 `MigrationBootstrapService` 唯一的 `onModuleInit` **显式编排**，顺序是正确性的一部分：

1. `prisma.$connect()` + `MigrationRunner.run()`（0003/0004 解除 model/character 外键，否则 rekey 撞外键）
2. 角色导入 + rekey（建 `agents/<slug>/AGENT.md` 与 `.rekey.json`；改写 DB 的 session.characterId / bot.defaultCharacterId / 调度任务 / 白名单）
3. 供应商导入 + 模型引用 rekey（AGENT.md frontmatter 此刻已存在才生效；改写 DB 的 session.modelId / kb.embeddingModelId / bot.defaultModelId / models 设置组）
4. 账户导入（`user` 表 → `account.json`，passwordHash 原样搬运）
5. 元信息导出（sessions/bots/kb/mcp）——**必须最后跑**：此刻 DB 引用已归一化，导出的
   meta.json / yaml / kb.json 才是新 id。早期分散在各模块时导出先于 rekey，跳版升级会导出旧引用且永不自愈
6. 各 FileStore 预热

分域 marker 独立重试：

| marker | 内容 |
|---|---|
| `<agents根>/.migrated-from-db` | character（含 rekey 映射 `.rekey.json`） |
| `<providers根>/.migrated-from-db` | model_provider + model + 引用改写 |
| `<SETTINGS_DIR>/account.json` 存在即跳过 | user |
| `<sessions根>/.migrated-sessions` | session + session_group |
| `<BOTS根>/.migrated-bots` | bot_instance |
| `<KB根>/.migrated-kb` | knowledge_base + kb_file |
| `<MCP根>/.migrated-mcp` | mcp_server（含 tools 缓存） |

- **导出完成前 FileStore 不得读索引**（由 `MetadataBootstrapGate` 门控）——否则导出未完成时
  读到空目录会把用户数据"变没"。
- 导出失败**不落 marker**，下次启动重试；重跑幂等（已存在文件不覆盖）。
- 还原旧快照后想重跑：删掉对应 marker 重启即可。

### 跳版升级 runbook（旧库 → 当前版本）

自动导出只覆盖**元信息域**（上表全部）。消息与分块是手动脚本，升级后执行一次（幂等可重跑）：

```bash
# 1. 启动一次应用（自动导出各域元信息 + 角色/供应商 rekey）
# 2. 消息/附件 → JSONL（SESSION_DATA_DIR 指向数据根）
DATABASE_URL="file:<数据根>/data/ai_chat.db" SESSION_DATA_DIR=<数据根> \
  npx ts-node src/scripts/migrate-messages.ts --all
# 3. kb_chunk → chunks.jsonl（未迁移的存量才需要；已迁过则 0 写入）
DATABASE_URL="file:<数据根>/data/ai_chat.db" USERDATA_DIR=<数据根> \
  npx ts-node src/scripts/migrate-kb-chunks.ts
# 4. 逐域断言 DB ↔ 文件一致（只读）
node scripts/verify-migration.cjs <数据根>
```

**无导出路径、升级即弃的四张表**：`user_setting`（设置早已在 `<SETTINGS_DIR>/*.json`）、
`memory`（记忆走插件文件）、`character_group`（死模型）、`session_context_state`
（压缩历史由 JSONL compaction 事件承载）。保留表结构仅作存档。

### 孤儿自愈

若 `<sessions根>/<id>/` 有 JSONL 事件日志但缺 `meta.json`（手删 / 导出中断），启动时从
`session/init` 事件重建骨架 meta，避免会话从列表消失。

只救**含真实往来消息**的会话：仅 `session/init` 的空壳目录是历史遗留产物（建了目录但从未
对话），复活它们会在侧边栏产生幽灵会话，故跳过。

KB 侧同理：导出可能从冻结 DB 复活「文件侧早已删除」的项（DB 行残留）。这类行现在会以
`failed` 状态导入并在 `errorMessage` 里写明「迁移时未找到原件」，**在界面上可见可删**——
不再静默丢弃，也不再自动清理（避免误删用户数据）。

## 环境变量

| 变量 | 说明 |
|---|---|
| `SESSION_DATA_DIR` | 会话根（其下为 `sessions/`，与既有 JSONL 根共用） |
| `BOT_DATA_DIR` | 机器人实例目录 |
| `kbStorageRoot`（设置项） | 知识库根，优先于下列环境变量 |
| `KB_DATA_DIR` | 知识库根（环境变量回退项） |
| `MCP_DATA_DIR` | MCP 服务器目录 |

## 与 DB 的关系

四域迁完后对 DB **只读不写**，相关表已冻结（schema 内有 `已冻结` 标注），作为回滚快照保留，
**安装/升级时仍要读它们做用户数据迁移，故不删除**。**无需 DB migration**：id 未变更故无引用
改写，外键不会触发。

保留在 SQLite 的：`user`（认证，单账户下已改读 `account.json`）、`file`（附件绑定，上传已改为
内联 FileRef 写进 JSONL）、`message*`。

`kb_chunk` 的 prisma fallback 已随本次改造**删除**：分块从冻结库、旧 `chunks.jsonl`、旧全局
向量库三源一并导入 `kb.db`，因此不再需要"JSONL 缺失时回读主库"的兜底路径。
未迁移存量安装仍需这些表。

### 脚手架移除清单（预计两个版本后执行）

主库彻底退役时一次性删除，不留中间态：

- `src/common/database/bootstrap/` 整个目录（bootstrap 服务 + 编排器 + model-reference-migration；
  其中 `kb-migration-bootstrap.service.ts` 负责旧 KB 三源导入，主库退役同批删除）
- `kb-meta.store.ts` 的旧形态读取分支（若有）与 `.migrated-kb` / `.migrated-kb-sqlite` marker
- `scripts/verify-migration.cjs`
- `src/common/database/` 下的 PrismaService、MigrationRunner、migrations/（`kb-chunk.repository.ts`
  已不再依赖 Prisma，成为正式的 kb.db 分块仓储，**保留**）
- `prisma/`（schema + client 依赖）、`@prisma/client` / `prisma` / `better-sqlite3` 依赖、`.env` 的 `DATABASE_URL`
- `package.json` 的 `db:seed` / `db:seed:force` / `db:migrate:gen` / `db:generate-baseline` / `db:rollback`、`postinstall` 的 `prisma generate`
- 各域 marker 检查与 `.rekey.json`（历史存档，可留可删）
- `src/scripts/`（seed / rollback / migrate-messages / fix-bot-instances；`kb-reembed.ts` **保留**
  ——它是向量重建的常规运维手段，不依赖主库）
