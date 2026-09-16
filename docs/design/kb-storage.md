# 知识库存储形态：每库一个自包含目录

> 面向维护者。改动前请先读「不变式」一节——这些是踩过坑之后定下来的。

## 一句话

一个知识库 = 一个目录，目录里装齐它的**全部**东西：配置、条目元信息、分块正文、向量、原件。
删库就是删目录。

```
<知识库根>/
  <kbId>/
    kb.json                 KB 身份与配置（名称、向量模型、分块参数）
    kb.db                   条目 + 分块正文 + 向量 + FTS 全文索引
    raw/<itemId>/<文件名>    原件副本（上传时写入）
```

`<知识库根>` 解析优先级：`kbStorageRoot` 设置 → `KB_DATA_DIR` 环境变量 →
`USERDATA_DIR/data/kb` → `./data/kb`。启动日志会打印实际生效的根（设置页「通用 → 知识库」
可改，带目录选择器）。

**设置是直接读 `<SETTINGS_DIR>/system.json` 得到的，进程内只解析一次。** 这条不要改回
"由 SettingsService 启动时注入"：`SettingsService` 在 AppModule 导入序里排在
`DatabaseModule` 之后，而知识库迁移在 `DatabaseModule` 的 hook 里先跑——实测结果是
迁移按**默认根**执行、设置随后才注入，用户设了根却"知识库不见了"。被启动期迁移依赖的
配置必须自给自足，不能依赖另一个模块的 hook 顺序。

换根**需重启生效**（进程内只读一次是刻意的：否则会出现"一部分连接在旧根、新解析指向新根"
的半程状态）。已有知识库**不会自动搬迁**；若新根为空而默认根下有库，启动会打醒目告警
列出数量。修改时校验：必须绝对路径、拒绝 UNC（WAL 在网络共享上锁不可靠）。

## 为什么是这个形态

参考了同类产品的实际做法（源码/文档可查）：

| 产品 | 原件位置 | 索引位置 |
|---|---|---|
| Cherry Studio（本地桌面，最接近本项目） | `{userData}/Data/KnowledgeBase/{baseId}/raw/`，**复制**进库 | 同目录 `.cherry/index.sqlite`（每库一个 better-sqlite3 + sqlite-vec） |
| Dify | 共享对象存储，键为 `upload_files/<tenant>/<uuid>.<ext>` | 每数据集一个向量集合 |
| RAGFlow | 对象存储，桶 = 数据集 id | 每租户一个 ES 索引，带 kb_id 过滤 |
| Open WebUI / AnythingLLM / FastGPT | 共享上传池 / 对象存储，DB 只存**键** | 每库一集合或单集合带 id 过滤 |

结论：**服务端产品用共享存储 + 键引用**（因为要多租户、要用对象存储）；**本地优先应用用每库一个自包含目录**
（因为要能整体备份/拷走、删库要真的释放空间）。本项目是本地优先，故选后者。

Cherry 还专门有一个「找出没有归属行的知识库目录」扫描器（`orphanBaseArtifacts.ts`）
和「vectors → files → rows」的删除顺序——说明**目录孤儿是这类设计的固有失败模式**，
本项目因此也保留了 `raw/` 孤儿扫描（只报告，见下）。

## 不变式（改代码时不要破坏）

1. **库自包含**：`<kbId>/` 目录可整体拷到另一个数据根直接可用。所以禁止把库里任何
   必需数据放到目录之外（原件必须有库内副本，不能只存外部绝对路径）。
2. **改名不搬字节**：`raw/` 用 **itemId** 做目录名，不用显示名。所以重命名/移动只改
   数据库列。反过来，如果哪天改成按路径存原件目录，文件名变更就会变成搬文件操作。
3. **FTS 不能用 external-content**：`chunk_fts.content` 存的是 **jieba 分词后**的文本，
   而 `chunk.content` 是原文。external-content 会让 FTS 回读原文，中文检索直接失效
   （不报错、只是搜不到，极难发现）。见 `kb-schema.ts` 顶部注释。
4. **分词口径唯一**：写入（`kb-tokenizer.tokenizeForSearch`）与查询
   （`tokenizeQuery`）必须同源。BM25 重排另有一套**刻意不同**的分词（不过滤空 token，
   因为它们计入文档长度），见 `kb-search.service.ts` 的注释——黄金基线会抓住任何"顺手统一"。
5. **删库前先关连接**：`KbDatabaseService.close(kbId)` → 再 `rm -rf`。
   Windows 上未释放的句柄会让删除失败（文件被占用）。Cherry 踩过同一个坑。
6. **向量可重建**：`chunk.embedding` 是派生数据，正文正本在 `chunk.content`（以及原件）。
   向量缺失/损坏时用 `pnpm kb:reembed` 从正文重算，**不需要**重新解析/OCR。

## kb.db 结构

```sql
-- v1
CREATE TABLE item (
  id TEXT PRIMARY KEY, file_name TEXT NOT NULL, display_name TEXT NOT NULL,
  file_size INTEGER NOT NULL DEFAULT 0, file_type TEXT NOT NULL DEFAULT '',
  file_extension TEXT NOT NULL DEFAULT '', content_hash TEXT NOT NULL DEFAULT '',
  raw_name TEXT,            -- raw/<itemId>/ 内的文件名；无原件为 NULL
  source_path TEXT,         -- 上传时来源绝对路径，仅作"重新摄取"提示
  relative_path TEXT, parent_folder_id TEXT,
  is_directory INTEGER NOT NULL DEFAULT 0,
  processing_status TEXT NOT NULL DEFAULT 'pending', progress_percentage INTEGER NOT NULL DEFAULT 0,
  current_step TEXT, error_message TEXT, total_chunks INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0, uploaded_at TEXT NOT NULL, processed_at TEXT
);
CREATE INDEX item_parent ON item(parent_folder_id);
CREATE INDEX item_relpath ON item(relative_path);
CREATE INDEX item_status ON item(processing_status);

CREATE TABLE chunk (
  id TEXT PRIMARY KEY, item_id TEXT NOT NULL, chunk_index INTEGER NOT NULL,
  content TEXT NOT NULL, token_count INTEGER NOT NULL DEFAULT 0,
  embedding BLOB,               -- Float32 小端，维度见 embedding_dimensions
  embedding_dimensions INTEGER, metadata_json TEXT, created_at TEXT NOT NULL
);
CREATE INDEX chunk_item ON chunk(item_id, chunk_index);
CREATE VIRTUAL TABLE chunk_fts USING fts5(content, content_rowid='rowid');
```

**没有 `knowledge_base_id` 列**：库即作用域。同理，`KBFileRepository` 的**点查询都需要
kbId**（`findById(kbId, id)`）——全局 id 空间已不存在。跨库方法（`findByStatus`、
`listItems` 省略 kbId）是为了启动期对账需要跨库视图。

时间列存 ISO 字符串：与文件时代的 `meta.json` 口径一致，字典序即时间序，且可读。

## 连接管理（KbDatabaseService）

- **惰性打开**：只有真正访问某库才建 `kb.db`；列出知识库只读 `kb.json`，空库不产生库文件。
- **LRU 上限 8**：超出按最近使用时间关闭最旧的句柄。
- **打开即迁移**：按 `PRAGMA user_version` 在事务内升级；**版本高于程序则拒绝打开**
  （降级安装不写坏数据），并把该库隔离、只记一次日志。
- **PRAGMA**：`journal_mode=WAL`、`busy_timeout=5000`、`synchronous=NORMAL`
  （WAL 下不必每次 fsync，进度上报这类高频写变廉价）。
- **关闭前 `wal_checkpoint(TRUNCATE)`**：空闲后目录只留单个 `kb.db`，备份/拷贝更省心。

`KbMetaStore` 管 `kb.json`（读时缓存），并负责启动期的「生效根日志 + 改根误配告警」。

## 写路径与代价

| 操作 | 现在 | 改造前 |
|---|---|---|
| 改名（文件/文件夹） | **1 条 UPDATE** | 文件夹要 N+1 次整写 file.json + 触发全量重扫 |
| 处理进度上报 | 1 条 WAL 事务 | 每个百分点一次整文件原子写（OCR 大文件 60-80 次）+ 触发重扫 |
| 启动 | 不做全量条目扫描 | 读全部 file.json 建内存索引 |
| 删条目 | 1 个事务 + 删一个目录 | 向量库删 + JSONL 删 + 元信息删 + 物理文件删（跨 4 处，无事务） |

条目写入（`replaceChunks`）把「旧分块、旧 FTS、新分块、新向量」放进**同一个事务**，
所以重新处理失败不会留下半套数据（旧实现是「先写向量库、再写 JSONL」，中间崩溃即不一致）。

## 并发与单库损坏

- 进程内单线程 + better-sqlite3 同步 API，天然串行；跨进程靠 WAL + `busy_timeout`。
- 单库损坏的爆炸半径 = **整个知识库的元信息与分块**（这是文件方案没有的代价）。
  恢复手段：`raw/` 原件仍在 → 重新处理；或从 `.pre-sqlite/` 回滚；或 `kb:reembed` 修向量。
- 不做自动 `integrity_check`（大库是 O(pages)，启动不该背这个成本）。

## 备份、迁移与回滚

- **备份**：退出应用后整目录拷贝即可。若应用在运行，`kb.db-wal` 里可能有未合并数据，
  要么一并拷贝 `-wal`/`-shm`，要么先退出（退出时会 checkpoint）。
- **换存储根**：设置页「通用 → 知识库 → 知识库存储根」改 → **重启生效**（运行期不热切换）。
  然后把旧根下的库目录整体移过去。若新根为空而默认根下有库，启动会打醒目告警列出数量。
  校验规则：必须绝对路径、拒绝 UNC 网络路径（`assertUsableKbRoot`）。
- **迁移来源**（`KbMigrationBootstrapService`）：S1 冻结主库（`knowledge_base`/`kb_file`/`kb_chunk`）、
  S2 旧文件形态（`kb.json` + `<itemId>/file.json` + `<itemId>/chunks.jsonl`）、
  S3 旧全局 `vector_db.sqlite`（补向量，按 chunk id 对齐）。
  切换方式：逐库在 `<kbId>.new` 建好 → 校验 → 旧目录 rename 到 `.pre-sqlite/<kbId>`。
  旧向量库改名保留为 `vector_db.sqlite.pre-sqlite`，确认无误后可手动删。
- **导入器的三个坑（都已在实测中修掉并加测试）**：
  1. 「已有 kb.db」不足以判定已迁移——被中断的启动可能留下**空库**，会永久阻断导入。
     判据是「库里有条目行」。
  2. 冻结表任何一张读失败，旧实现会吞掉**整批**数据。现在逐表独立容错。
  3. 冻结行可能是 camelCase（Prisma）也可能是 snake_case（直接 open sqlite），
     只认一种会因 `row.knowledgeBaseId === undefined` **静默丢条目**。现在两种都认。
- **只报告不删**：`raw/` 下无人认领的目录（崩在"原件已写、行未插"之间）与共享上传目录里
  没有任何元信息引用的历史文件，都只写清单/日志，绝不自动删除——那是用户的字节。

## FTS 分页与检索

`chunk` 表按 `(item_id, chunk_index)` 建索引，分页直接 `LIMIT/OFFSET`
（旧实现要流式扫完整个 JSONL 才能 skip）。检索是库内暴力余弦（`vec_distance_cosine`），
单库万级分块为数十毫秒量级；因为**维度按库隔离**，将来要上 `vec0` 虚拟表不需要跨库迁移。

搜索结果里的 `fileName` 取 `item.display_name` 的**当前值**（旧实现用处理时快照，改名后是陈旧名）。

## 相关文件

- `kb-schema.ts` DDL 与版本迁移（`LATEST` + 有序 `MIGRATIONS`）
- `kb-database.service.ts` 连接注册表、根解析、id 校验
- `kb-meta.store.ts` `kb.json`（KB 配置）
- `kb-tokenizer.ts` 分词（写入/查询同源）
- `kb-search.service.ts` 语义 / FTS / BM25 重排 / RRF 融合
- `../../common/database/kb-file.repository.ts`、`kb-chunk.repository.ts` 仓储
- `../../common/database/bootstrap/kb-migration-bootstrap.service.ts` 迁移导入器
- `kb:reembed` 从正文重建向量
- 测试：`test/knowledge-base/kb-*.spec.ts`，搜索回归基线 `fixtures/kb-search-golden.json`
