# 存储后端可插拔架构

> 面向企业版：把「会话元信息 + 对话轨迹」换成数据库或 HTTP 服务，核心代码不改。

## 一、分层

```
领域层（SessionService / ChatRunner / CompressionEngine / SubAgentManager …）
   │  只依赖门面与端口，不感知介质
   ▼
门面层 SessionStoreFacade（SESSION_STORE_TOKEN）
   │  跨端口编配：删除=删资产+删行+删用量；创建=建行+建资产容器
   ▼
端口层（全部 async、无 SQL 形状、无目录概念）
   ├─ SessionMetaPort     会话行 CRUD/查询/分页
   ├─ SessionGroupPort    会话分组（删分组要解绑成员）
   ├─ ProjectGroupPort    目录分组（成员关系派生，删分组不回写）
   ├─ UsagePort           用量账本（禁止 JOIN）
   ├─ SessionAssetPort    会话资产容器（附件/图片/workflow）
   └─ MessageEventLog     事件日志（append 由后端分配 seq）
   ▼
驱动层（按 GUADA_STORE_DRIVER* 选择）
   sqlite / jsonl（核心发货） · postgres / http（企业版注入）
```

## 二、关键设计决定

### 1. seq 由后端分配

`MessageEventLog.appendEvents` 接收**不带 seq** 的事件，返回带 seq 的定稿事件。

- JSONL 驱动：读活跃段末 seq + 连续分配，写路径由上层每会话写互斥串行化
- 数据库驱动：事务内 `SELECT MAX(seq)` + `INSERT ... RETURNING`
- HTTP 驱动：服务端分配后回传

这样多实例写同一会话也不会撞号（旧实现由 service 读内存游标分配，多写者必撞）。

### 2. 「通用桶」从 SQL 子查询提升为语义值

旧实现：`workspace_key IS NULL OR workspace_key NOT IN (SELECT path_key FROM project_groups)`

端口：`WorkspaceScope { scope: 'exact' | 'general' | 'all', workspaceKey? }`

SQL 驱动内部还原成子查询；HTTP 驱动在服务端按已注册分组求差集。接口上不再出现跨表语义。

### 3. 用量聚合不再 JOIN sessions

`UsagePort.query` 只回 `sessionId` + 用量列；标题/类型由 `UsageService.decorateSessionRows`
经 `SessionMetaPort.getManyByIds` 补齐。多一次往返换来跨介质一致。

### 4. 可选能力必须优雅退化

`MessageEventLog.snapshot` / `.maintenance` 是**可选**的：

- JSONL 靠它们做快照加速与 torn 尾修复
- 数据库/HTTP 驱动不实现（事务保证原子性，读全量即可）

调用方（`JsonlMessageService`）在缺失时退化，不假设它们存在。

### 5. 个人版自愈留在驱动里

`healOrphanRows` / `removeGhostRows` / `backfillWorkspaceKeys` 只活在
`SqliteSessionMetaDriver.startup()`——这是「目录即会话」的个人版语义，
端口不暴露任何目录概念。

## 三、换后端怎么做

### 企业版接入步骤

1. **实现端口**（按需全量或部分）：

```ts
// @acme/guada-store-postgres
export class PgSessionMetaDriver implements SessionMetaPort { /* … */ }
export class PgEventLog implements MessageEventLog { /* … */ }
```

2. **注册驱动**（在企业版自己的应用入口、Nest 容器创建之前）：

```ts
import { registerStoreDriver } from '.../common/store/driver-registry';

// 一个域一个实例：该实例需实现该域的全部端口
registerStoreDriver('sessions', 'postgres', () =>
  new PgSessionStore(dsn),          // SessionMetaPort + SessionGroupPort + ProjectGroupPort
);
registerStoreDriver('assets', 's3', () => new S3AssetStore(cfg)); // SessionAssetPort
registerStoreDriver('messages', 'postgres', () => new PgEventLog(dsn)); // MessageEventLog
registerStoreDriver('usage', 'postgres', () => new PgUsageStore(dsn));  // UsagePort
```

3. **选择驱动**（环境变量，按域独立解析）：

```bash
GUADA_STORE_DRIVER=postgres              # 全局回退
GUADA_STORE_DRIVER_SESSIONS=postgres     # 会话行/分组/目录分组
GUADA_STORE_DRIVER_ASSETS=s3             # 附件/图片
GUADA_STORE_DRIVER_MESSAGES=postgres     # 轨迹
GUADA_STORE_DRIVER_USAGE=postgres        # 用量
```

| 域 | 环境变量 | 默认 | 装配位置 |
|---|---|---|---|
| 会话行/分组/目录分组 | `GUADA_STORE_DRIVER_SESSIONS` | `sqlite` | `StoreModule` |
| 会话资产（容器） | `GUADA_STORE_DRIVER_ASSETS` | `fs` | `StoreModule` |
| 用量账本 | `GUADA_STORE_DRIVER_USAGE` | `sqlite` | `StoreModule` |
| 事件日志（轨迹） | `GUADA_STORE_DRIVER_MESSAGES` | `jsonl` | `PersistenceModule` |

**驱动名 = 介质，不是模块名**：

| 驱动名 | 介质 | 用于 |
|---|---|---|
| `sqlite` | `_meta.db` | sessions / usage |
| `jsonl` | 事件日志文件 | messages |
| `fs` | 纯文件系统目录 | assets |

四个域各自独立解析，互不影响；`GUADA_STORE_DRIVER` 只作未设域变量时的回退。

> **实例共享契约**：同一 `(域, 驱动名)` 只构造一次并缓存。这是必需的——`sessions`
> 域会被会话行/分组/目录分组三个端口 provider 各解析一次，若每次调工厂，企业驱动
> 会构造多份（多套连接池、内存状态互不可见）。因此注册的工厂必须返回
> **一个实现该域全部端口的对象**，且必须是幂等可复用的（不要在里面持有每次调用
> 都应该重建的临时状态）。

4. **跑契约测试**证明行为等价（这是唯一的等价性保证手段）：

```ts
runSessionMetaContract('postgres', async () => makePgDriver());
runSessionGroupContract('postgres', async () => makePgGroupDriver());
runProjectGroupContract('postgres', async () => makePgProjectDriver());
runEventLogContract('postgres', async () => makePgEventLog());
```

### 依赖方向

```
企业产品入口 ──依赖──▶ 基座（端口/注册表/契约套件）
基座 ──✗──▶ 企业实现（源码里不出现任何企业包名）
```

## 四、代码地图

| 作用 | 路径 |
|---|---|
| 端口类型 | `src/common/store/ports/types.ts` |
| 会话行端口 | `src/common/store/ports/session-meta.port.ts` |
| 分组端口 | `src/common/store/ports/group.port.ts` |
| 用量端口 | `src/common/store/ports/usage.port.ts` |
| 事件日志端口 | `src/common/persistence/event-log.port.ts` |
| 驱动注册表 | `src/common/store/driver-registry.ts` |
| 存储模块（装配） | `src/common/store/store.module.ts` |
| SQLite schema/迁移 | `src/common/store/drivers/sqlite/meta-schema.ts` |
| SQLite 会话行驱动 | `src/common/store/drivers/sqlite/sqlite-session-meta.driver.ts` |
| SQLite 分组驱动 | `src/common/store/drivers/sqlite/sqlite-group.driver.ts` |
| 文件系统资产驱动 | `src/common/store/drivers/fs/fs-session-asset.driver.ts` |
| JSONL 事件日志 | `src/common/persistence/jsonl-backend.ts` |
| 门面 | `src/modules/chat/session-store.facade.ts` |
| 消息业务实现 | `src/common/persistence/jsonl-message.service.ts` |
| 契约测试套件 | `test/store/contracts/store.contract.ts` |
| 契约测试装配 | `test/store/contracts/sqlite-jsonl.contract.spec.ts` |
| 驱动选择回归 | `test/store/driver-selection.spec.ts` |

## 五、与企业版的关系：两条独立产品线

企业版**不是**个人版的数据上门版，两者对外是独立产品，只是共用同一份基座。

由此产生三条明确结论：

1. **没有数据迁移过程**。企业版从空库起步，不读取个人版的 `_meta.db` / `seg-*.jsonl`。
   基座里因此不提供 `store-migrate` 之类的搬运工具；任何「从个人版导入」的需求
   都应作为企业版自己的功能实现，而不是基座的启动路径。

2. **个人版的存储实现不随企业版发货**。`sqlite` / `jsonl` 驱动是基座对个人版的
   默认实现；企业版可以完全不注册它们，只注册自己的四个域驱动。

3. **等价性靠契约测试而非数据兼容**。因为没有迁移可以「对照校验」，新驱动的正确性
   只能由 `test/store/contracts/` 的行为契约保证。企业版接入前必须先跑通全部
   `run*Contract`。

### 基座不该出现的东西

| 不该有 | 原因 |
|---|---|
| 迁移/双写/回填脚本 | 产品间无数据继承关系 |
| 企业专属表结构或字段 | 基座保持介质中立 |
| 企业包名出现在源码里 | 依赖方向必须单向（企业 → 基座） |
| 「企业版模式」开关 | 差异通过驱动注册表达，不用 feature flag |

## 六、附件与轨迹的域边界

企业版的确定拓扑是：**每台用户机器跑完整后端**（Agent loop / 工具执行 / 读图都在本地），
只把 `sessions` / `messages` / `usage` 写入中央数据库；**附件仅本机可见**，删会话时
附件与记录一起删。

这个拓扑下，资产域不需要对象存储、不需要跨机寻址，但有一条必须守死的边界。

### 6.1 会话目录里住着两个域

```
<sessionsBase>/<sessionId>/
├── seg-0000.jsonl   manifest.json   snapshot.json   ← messages 域
└── images/  previews/  workflows/                  ← assets 域
```

`FsSessionAssetDriver` 只允许操作**白名单子目录**（`ASSET_SUBDIRS`），
`remove` / `copy` 都不得碰整目录：

| 操作 | 若整目录操作会怎样 |
|---|---|
| `remove` 整目录 `rm -rf` | 越权删除 messages 域数据。企业版下这些文件属另一个驱动，删了就是丢数据 |
| `copy` 整目录 `cp -r` | 把事件日志复制一份；分支克隆随后又 `importEvents` 重放，出现重复 seq |

删会话的完整语义仍由上层编配保证：

```
SessionStoreFacade.deleteSession
  → assets.remove(id)        只删 images/previews/workflows
  → meta.deleteRows([id])
  → usage.deleteBySession(id)
SessionService.deleteSession
  → contextManager.clearSessionTurns(id)   删事件日志目录（messages 域自己的事）
```

`assets.remove` 删完资产后会尝试 `rmdir` 会话目录：目录已空（无事件日志）则收掉，
非空时 `rmdir` 必然失败并静默跳过 —— 不会误删轨迹。

### 6.2 内容读写刻意不进端口

四个写入方仍直连文件系统：`SessionImageStore.save`、`FileService.upload*`、
`AgentEngine.materializeImageRef`、`WorkflowFileStore.saveRunSnapshot`。

这是**当前拓扑下的有意选择**：附件天然在本地盘，把内容读写搬进端口只会增加抽象税，
换不来任何可替换性。只有当拓扑变成「中央服务器跑 Agent」时才需要重新评估。

### 6.3 明确不做

| 不做 | 原因 |
|---|---|
| 附件内容寻址（sha256 去重） | DSH 的做法，但与本项目「目录即会话」语义冲突，收益不足 |
| 对象存储驱动 / presigned URL | 「仅本机可见」不需要 |
| 跨机附件寻址（引用带 host） | 拓扑已排除；前端 `toResourceUrl` 与后端 `attachmentToPart` 的绝对 URL 通道保留但不启用 |
| 附件孤儿 GC | DSH 亦 deferred（`attachment-local/README.md:146-148` 明确 "Both directions are undecided"）；当前删会话即删附件，不产生孤儿 |
| 混合部署下的附件同步 | 若将来要「A 机器看 B 机器的图」，须先改拓扑（中央服务器 + 本地 sidecar），属架构变更而非接缝改造 |

### 6.4 若拓扑将来改变

「中央服务器跑 Agent + 附件留用户机器」在当前架构下**不成立**：
服务器进程访问不到用户磁盘，`assets.remove` 删的是服务器目录，模型读图也会失败。
届时的选项只有两个：

1. 中央服务器 + 每台机器的本地 sidecar（新增进程间协议与鉴权）
2. 附件上传到对象存储，`assets` 域换驱动，且内容读写必须一并纳入端口

## 七、已知约束

| 约束 | 说明 |
|---|---|
| `queryPaged` 的 `total` 必须精确 | 前端用它算 `hasMore`；数据库驱动需索引支持 COUNT |
| 无批量查询 | 侧栏 N 个分组会发 N 次 `queryPaged`；企业版如需优化可加可选批量能力 |
| 事件无删除 API | 事件溯源语义下删除靠遮蔽事件（`turn/delete`）；物理清理由驱动带外做 |
| `JsonlMessageService` 是唯一业务实现 | 换介质不产生第二套折叠逻辑；seq/折叠/快照/写互斥都在这里 |
| 附件内容读写不经端口 | 当前拓扑（本机跑后端、附件本机可见）下无收益；见第六节 |
| 资产驱动只能动白名单子目录 | `remove`/`copy` 碰整目录会越权删/复制 messages 域数据 |
