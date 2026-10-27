# GuaDa 对话记录 JSONL 持久化方案 — 详细设计

> 版本：2.0 | 日期：2026-08-20 | 状态：已确认（事件溯源方案）
>
> **更新（2026-10）**：Prisma 主库已移除。文中 `ai_chat.db` / Prisma schema / MigrationRunner
> 等描述是当时的历史方案；当前元数据走 `sessions/_meta.db`，消息仍走 JSONL。

---

## 1. 项目背景与目标

### 1.1 当前痛点

| 问题 | 现状 | 影响 |
|------|------|------|
| 消息膨胀 | 所有消息存 SQLite，单会话可达数万条 | 数据库体积持续增长，备份/迁移困难 |
| 无需索引 | 历史消息几乎不需要关系型查询 | 数据库的索引能力被浪费，写入开销白费 |
| 版本迁移 | Prisma schema 变更需 migration | 每次迭代升级数据库是负担 |
| 多端同步 | SQLite 文件同步复杂 | 跨设备同步难以实现 |

### 1.2 设计目标

1. **对话记录文件化**：消息以 append-only JSONL 日志存储，数据库退化为元数据/配置存储
2. **事件溯源（Event Sourcing）**：所有变更以事件形式追加，永不修改已写入事件
3. **分卷管理**：以压缩事件为边界分卷，每 **5 次压缩**分新卷，控制单文件体积
4. **API 兼容**：保持现有 REST API 不变，前端无感知
5. **彻底迁移**：不做双写，直接抛弃旧 Message 表，通过迁移脚本一次性导入
6. **搜索解耦**：搜索本来就是独立 SQLite，只需适配同步接口，初期可暂不实现
7. **三阶段路线**：短期纯日志 → 中期活跃日志+归档快照 → 长期彻底摆脱数据库

### 1.3 设计原则

- **Append-only**：事件只追加，永不修改/删除已写入事件
- **Compaction 边界 = 分卷边界 = 读取窗口**：三者统一
- **一卷一世界**：当前卷从头 fold 即可重建当前状态
- **后者胜（Last-wins）**：envelope、version switch 是状态而非历史

---

## 2. 现状分析

### 2.1 数据模型

```
Message（message 表）
├── id: String (cuid)                    // 消息唯一标识
├── sessionId: String → Session          // 所属会话
├── role: String (user/assistant)         // 角色
├── parentId: String? → Message          // assistant 指向对应 user
├── currentVersionId: String? → Message  // user 指向当前激活的 assistant 版本
├── metadata: Json?                      // 元数据
├── contents: MessageContent[]           // 内容版本

MessageContent（message_content 表）
├── id: String (cuid)
├── messageId: String → Message
├── turnsId: String                      // 轮次标识（同轮共享）
├── role: String?
├── content: String
├── reasoningContent: String?            // 思维链
├── additionalKwargs: Json?
├── metadata: Json?                      // toolCalls, finishReason 等
├── files: File[]                        // 附件
```

### 2.2 版本系统

| 字段 | 含义 | 关系 |
|------|------|------|
| `parentId` | assistant → user | 消息对关联 |
| `currentVersionId` | user → 当前激活的 assistant | 版本指针 |
| `turnsId` | 同轮共享 | 轮次标识 |

**版本创建**：每次 AI 回复创建新 assistant 消息 + 更新 `currentVersionId`。

**版本切换**：前端左右箭头 → 修改 `currentVersionId` → API 更新 DB。

**编辑处理**：**物理删除**旧消息及其所有 assistant 回复 → 创建全新消息。旧版本**不保留**。

**重新生成**：创建新版本，最多 5 个（`MAX_REGENERATE_VERSIONS = 5`）。

### 2.3 两级压缩

#### 一级压缩：Pruning（裁剪）

- **触发**：`compressionTriggerRatio >= 0.8`
- **目标**：工具结果 > 1000 字符的消息
- **策略**：头尾各保留 500 字符，中间标记 `[omitted N characters]`
- **保护**：最近 3 条 tool 消息、`tool_learn`、`todo` 不裁剪
- **记录**：`pruningMetadata` 记录原始长度、裁剪后长度、时间戳

#### 二级压缩：Compaction（摘要）

- **触发**：裁剪后仍超阈值
- **策略**：消息分组 → 滑动窗口保留最近 3 组 → LLM 生成摘要
- **摘要模式**：`disabled` / `fast` / `memory_sync`
- **注入**：摘要作为 user 消息注入 `[CONTEXT COMPACTION — REFERENCE ONLY]`
- **检查点**：`CompressionCheckpoint` 持久化到 DB

### 2.4 API 层

- **消息加载**：`GET /sessions/:sessionId/messages?limit=30&beforeMessageId=xxx`
- **分页**：基于 ID 的游标分页，分批查询（规避 SQLite 999 参数限制）
- **LLM 上下文**：`loadMessages()` → `transformContentStructure()` → `MessageRecord[]`
- **搜索**：独立 FTS5 索引库（`search_index.db`）+ jieba 分词

### 2.5 前端

- **消息列表**：`ChatPanel.vue` → `TurnItem.vue`（按 user 分组，assistant 通过 parentId 关联）
- **版本切换**：`MessageActions.vue` 左右箭头 → `switchContent()` → API 更新 `currentVersionId`
- **流式输出**：SSE + 50ms 防抖 flush
- **编辑**：`useMessageOperations.ts` 编辑模式 → 删除旧消息 + 重新发送

---

## 3. 整体架构设计

### 3.1 分层架构

```
┌─────────────────────────────────────────────────────────────┐
│                       前端 (Vue 3)                           │
│  ChatPanel → TurnItem → MessageActions                      │
│  （无感知，API 兼容层保证接口不变）                            │
└──────────────────────────┬──────────────────────────────────┘
                           │ REST API / SSE
┌──────────────────────────▼──────────────────────────────────┐
│                     API 兼容层                               │
│  MessagesController / ChatController                        │
│  （保持现有接口签名，内部路由到 JSONL 或 DB）                   │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│                  持久化抽象层                                 │
│  interface PersistenceBackend                               │
│  ├── JsonlBackend（默认）                                    │
│  └── SqliteBackend（兼容旧版）                               │
└──────────┬───────────────────────────────┬──────────────────┘
           │                               │
┌──────────▼──────────┐      ┌─────────────▼──────────────────┐
│   JSONL 文件存储     │      │   SQLite（元数据/配置）            │
│   sessions/         │      │   Session/User/Model/Character   │
│   └── <sessionId>/  │      │   Memory/KnowledgeBase/File      │
│       ├── seg-0000  │      │   McpServer/BotInstance          │
│       ├── seg-0001  │      │                                  │
│       ├── seg-0002  │      │                                  │
│       └── manifest  │      │                                  │
└─────────────────────┘      └──────────────────────────────────┘
```

### 3.2 存储切分

| 数据 | 存储 | 理由 |
|------|------|------|
| 对话消息 | JSONL 文件 | 时间序列、append-only、无需索引 |
| 会话元数据 | SQLite | 关系查询、配置关联 |
| 用户/模型/角色 | SQLite | 强关系、跨会话引用 |
| 知识库元数据 | SQLite | 关系查询 |
| 记忆 | SQLite | 跨会话引用 |
| 文件元数据 | SQLite | 关系查询 |
| 搜索索引 | FTS5 独立库 | 全文搜索（与主存储解耦）|

### 3.3 文件结构

**存储位置决策**（已确认）：
- 会话数据存**全局数据目录**，由环境变量指定
- Electron 实际数据根目录为 `~/.guada/`（由 `USERDATA_DIR` 传给后端，见 electron/main.ts `computeDataPaths`）
- 文件沿用现有 `UPLOAD_ROOT_DIR`（Electron 为 `~/.guada/file_stores/`）
- 附件元数据内嵌 JSONL 消息事件（self-contained）
- **不做自动 GC**，后续做"上传文件管理"界面，用户手动清理

**路径解析优先级**：`SESSION_DATA_DIR` → `USERDATA_DIR` → `UPLOAD_ROOT_DIR` 父目录 → `./data`

```
~/.guada/                       ← USERDATA_DIR（Electron 数据根目录）
├── data/                       // 数据库/向量库（沿用）
├── file_stores/                ← UPLOAD_ROOT_DIR（沿用，上传文件）
├── workspaces/                 // 会话工作区（沿用）
├── sessions/                   ← 会话 JSONL（本方案新增）
│   └── <sessionId>/
│       ├── manifest.json       // 分卷元数据
│       ├── seg-0000.jsonl      // 归档卷
│       ├── seg-0001.jsonl      // 归档卷
│       └── seg-0002.jsonl      // 活跃卷
├── search_index.db             // 全文搜索索引
└── ai_chat.db                  // 元数据/配置（原数据库瘦身）
```

**文件引用**（内嵌 JSONL 事件，参考 dsh）：
```json
"files": [{
  "fileId": "f_abc123",
  "fileName": "architecture.png",
  "displayName": "架构图.png",
  "fileSize": 102400,
  "fileType": "image/png",
  "fileExtension": "png",
  "url": "file_stores/xxx/architecture.png",   // 相对路径，非 base64
  "previewUrl": "file_stores/xxx/thumb.png",
  "contentHash": "hash_xyz"
}]
```
- **不存 base64**（膨胀 33%、无法去重）——dsh 明确禁止
- 物理文件在磁盘，消息存相对路径 + 完整元数据
- 未来可升级内容寻址（contentHash 定位，天然去重）

---

## 4. JSONL 事件 Schema 设计

### 4.1 事件类型总览

| 事件类型 | 作用 | 可见性影响 | 分卷 |
|---------|------|----------|------|
| `session/init` | 会话初始化 | — | — |
| `envelope` | 请求封装（system/tools/model）| — | — |
| `message/create` | 消息创建 | 可见 | — |
| `message/prune` | 一级压缩：裁剪内容 | 不影响 | ❌ |
| `message/compact` | 二级压缩：摘要 | 遮蔽旧范围 | ✅ |
| `version/switch` | 版本切换 | 不影响 | — |
| `usage/report` | provider token 真值 | — | — |

### 4.2 事件基础结构

```typescript
interface BaseEvent {
  type: string;           // 事件类型
  seq: number;            // 连续递增序列号（从 0 开始）
  time: number;           // Unix 毫秒时间戳
  data: Record<string, unknown>;  // 事件载荷
}
```

### 4.3 各事件详细 Schema

#### session/init

```json
{
  "type": "session/init",
  "seq": 0,
  "time": 1723456789000,
  "data": {
    "sessionId": "cuid_xxx",
    "title": "新对话",
    "createdAt": "2026-08-20T10:00:00.000Z"
  }
}
```

#### envelope

```json
{
  "type": "envelope",
  "seq": 1,
  "time": 1723456789001,
  "data": {
    "reason": "initial|resume|change|post-compaction",
    "system": "你是一个AI助手...",
    "tools": [
      {"name": "web_search", "description": "...", "parameters": {...}}
    ],
    "model": "deepseek-chat",
    "provider": "deepseek"
  }
}
```

**reason 说明**：
- `initial`：会话首次请求
- `resume`：会话恢复（日志已有 header，但本轮 agent 新建）
- `change`：本轮内 header 变化
- `post-compaction`：压缩后重写（必须，否则原 header 在死范围丢失）

#### message/create

```json
{
  "type": "message/create",
  "seq": 2,
  "time": 1723456789002,
  "data": {
    "messageId": "msg_xxx",
    "role": "user|assistant|tool",
    "content": "你好",
    "reasoningContent": null,
    "parentId": null,
    "metadata": {
      "model": "deepseek-chat",
      "usage": {"promptTokens": 100, "completionTokens": 50, "cachedTokens": 0},
      "finishReason": "stop",
      "toolCalls": [...]
    },
    "files": [{"fileId": "f_xxx", "name": "image.png"}]
  }
}
```

#### message/prune

```json
{
  "type": "message/prune",
  "seq": 501,
  "time": 1723456789501,
  "data": {
    "targetMessageId": "msg_xxx",
    "targetContentId": "content_xxx",
    "previousContent": "...5000字符原始内容...",
    "newContent": "...前500字...[omitted 4000 characters]...后500字",
    "prunedBytes": 4000,
    "strategy": "head_tail_500"
  }
}
```

#### message/compact

```json
{
  "type": "message/compact",
  "seq": 1001,
  "time": 1723456790001,
  "data": {
    "shadows": [0, 500],
    "summary": "用户之前讨论了...",
    "retained": [501, 1000],
    "summaryTokens": 200,
    "mode": "memory_sync"
  }
}
```

#### version/switch

```json
{
  "type": "version/switch",
  "seq": 42,
  "time": 1723456789042,
  "data": {
    "messageId": "msg_user_xxx",
    "fromVersion": "msg_assistant_v1",
    "toVersion": "msg_assistant_v2"
  }
}
```

#### usage/report

```json
{
  "type": "usage/report",
  "seq": 50,
  "time": 1723456789050,
  "data": {
    "messageId": "msg_xxx",
    "promptTokens": 10000,
    "completionTokens": 500,
    "cachedTokens": 2000,
    "totalTokens": 10500
  }
}
```

### 4.4 事件约束

1. **seq 严格连续**：0, 1, 2, ... 不允许间隙（crash 修复时截断尾部）
2. **append-only**：已写入事件永不修改
3. **后者胜**：envelope、version switch 以最后一次为准
4. **compaction 边界**：`message/compact` 事件是分卷的自然分界

---

## 5. 存储层设计

### 5.1 分卷策略

**触发条件**：每 N 次 compaction 后（或段大小超阈值），关闭当前段 → 开新段。

**分卷规则**：
- 新卷第一条 = compaction 事件（记录遮蔽范围 + 摘要）
- 紧接着 = 重写的 envelope（post-compaction）
- 然后 = 保留的可见消息（seq 连续）
- 后续新消息追加到活跃卷末尾

**示例**：

```
seg-0000.jsonl（归档）:
  seq 0:   session/init
  seq 1:   envelope (initial)
  seq 2:   message/create (user "你好")
  seq 3:   message/create (assistant "你好！")
  ...
  seq 500: message/create (assistant "...")

seg-0001.jsonl（归档）:
  seq 501: message/compact {shadows: [0, 500], summary: "...", retained: [501, 1000]}
  seq 502: envelope (post-compaction) {system: "...", tools: [...]}
  seq 503: message/create (seq 501 对应的消息)
  seq 504: message/create (seq 502 对应的消息)
  ...
  seq 1000: message/create (seq 1000 对应的消息)

seg-0002.jsonl（活跃）:
  seq 1001: message/compact {shadows: [501, 1000], summary: "...", retained: [1001, 1500]}
  seq 1002: envelope (post-compaction)
  seq 1003: message/create (seq 1001)
  ...
  seq 1500: message/create (seq 1500)
  seq 1501: message/create (新消息)
  ...       （持续追加直到下次 compaction）
```

### 5.2 manifest.json

```json
{
  "sessionId": "cuid_xxx",
  "version": 1,
  "createdAt": "2026-08-20T10:00:00.000Z",
  "segments": [
    {
      "file": "seg-0000.jsonl",
      "startSeq": 0,
      "endSeq": 500,
      "status": "archived",
      "compactedAt": "2026-08-20T12:00:00.000Z"
    },
    {
      "file": "seg-0001.jsonl",
      "startSeq": 501,
      "endSeq": 1000,
      "status": "archived",
      "compactedAt": "2026-08-20T14:00:00.000Z"
    },
    {
      "file": "seg-0002.jsonl",
      "startSeq": 1001,
      "endSeq": null,
      "status": "active",
      "compactedAt": null
    }
  ],
  "compactionBoundaries": [
    {"seq": 501, "shadows": [0, 500]},
    {"seq": 1001, "shadows": [501, 1000]}
  ]
}
```

### 5.3 写入流程

```
用户发送消息
  │
  ▼
appendEvent(event)
  │
  ├── 写入活跃卷 seg-xxx.jsonl（追加一行）
  ├── 更新 manifest.json（endSeq）
  └── 异步写入搜索索引
  │
  ▼
触发压缩判断
  │
  ├── shouldCompress() → false → 结束
  │
  └── shouldCompress() → true
       │
       ▼
    执行压缩
       │
       ├── 一级：pruneMessages → 追加 message/prune 事件
       │
       ├── 仍超阈值 → 二级：compactMessages
       │    ├── 追加 message/compact 事件
       │    ├── 追加 envelope (post-compaction)
       │    └── 关闭当前段 → 开新段
       │
       └── 更新 manifest.json
```

### 5.4 读取流程

```
加载会话消息
  │
  ▼
readManifest(sessionId)
  │
  ├── 冷启动（首次加载）
  │    ├── 读活跃卷 seg-0002.jsonl → fold → 当前 surface
  │    ├── 读上一卷 seg-0001.jsonl → 获取最近摘要
  │    └── 更早卷 → 按需加载（用户翻历史时）
  │
  └── 热更新（新消息到达）
       ├── 读活跃卷的增量事件（从 lastSeq+1 开始）
       └── fold → 更新 surface
```

---

## 6. 回放引擎设计

### 6.1 核心概念

回放引擎负责将 JSONL 事件日志转换为前端可消费的消息列表。

**核心抽象**：

```typescript
interface ReplayState {
  // 当前可见消息（按 surface 顺序）
  surface: SurfaceNode[];
  // 当前生效的 envelope
  envelope: Envelope | null;
  // 消息版本映射
  versions: Map<string, VersionState>;
  // 已处理的 seq
  lastProcessedSeq: number;
}

interface SurfaceNode {
  seq: number;
  messageId: string;
  role: string;
  content: string;
  metadata: Record<string, unknown>;
  visible: boolean;  // 是否被遮蔽
}

interface VersionState {
  userMessageId: string;
  currentVersionId: string;
  allVersions: string[];
}
```

### 6.2 Fold 算法

```typescript
function foldEvents(events: BaseEvent[], state: ReplayState): ReplayState {
  for (const event of events) {
    switch (event.type) {
      case 'session/init':
        // 初始化会话
        break;

      case 'envelope':
        // 后者胜：直接覆盖
        state.envelope = event.data as Envelope;
        break;

      case 'message/create': {
        const data = event.data as MessageCreateData;
        const node: SurfaceNode = {
          seq: event.seq,
          messageId: data.messageId,
          role: data.role,
          content: data.content,
          visible: true,
          metadata: data.metadata,
        };
        state.surface.push(node);

        // 版本管理
        if (data.role === 'assistant' && data.parentId) {
          const version = state.versions.get(data.parentId);
          if (version) {
            version.allVersions.push(data.messageId);
            version.currentVersionId = data.messageId;
          }
        }
        break;
      }

      case 'message/prune': {
        const data = event.data as MessagePruneData;
        // 找到目标消息，替换内容
        const node = state.surface.find(n => n.messageId === data.targetMessageId);
        if (node) {
          node.content = data.newContent;
          node.metadata.pruneInfo = data;
        }
        break;
      }

      case 'message/compact': {
        const data = event.data as MessageCompactData;
        // 遮蔽死范围
        for (const seq of data.shadows) {
          const node = state.surface.find(n => n.seq >= data.shadows[0] && n.seq <= data.shadows[1]);
          if (node) node.visible = false;
        }
        break;
      }

      case 'version/switch': {
        const data = event.data as VersionSwitchData;
        const version = state.versions.get(data.messageId);
        if (version) {
          version.currentVersionId = data.toVersion;
        }
        break;
      }

      case 'usage/report': {
        const data = event.data as UsageReportData;
        const node = state.surface.find(n => n.messageId === data.messageId);
        if (node) {
          node.metadata.usage = data;
        }
        break;
      }
    }

    state.lastProcessedSeq = event.seq;
  }

  return state;
}
```

### 6.3 增量回放

```typescript
class MessageReplayer {
  private state: ReplayState;
  private activeSegment: string;

  constructor(private sessionId: string, private storage: JsonlBackend) {
    this.state = createInitialState();
  }

  // 冷启动：全量回放
  async initialize(): Promise<void> {
    const manifest = await this.storage.readManifest(this.sessionId);
    const activeSeg = manifest.segments.find(s => s.status === 'active');
    const prevSeg = manifest.segments.filter(s => s.status === 'archived').pop();

    // 回放活跃卷
    const events = await this.storage.readSegment(this.sessionId, activeSeg.file);
    this.state = foldEvents(events, this.state);

    // 回放上一卷（获取最近摘要）
    if (prevSeg) {
      const prevEvents = await this.storage.readSegment(this.sessionId, prevSeg.file);
      // 只处理 compact 和 envelope 事件
      const compactEvents = prevEvents.filter(e => 
        e.type === 'message/compact' || e.type === 'envelope'
      );
      this.state = foldEvents(compactEvents, this.state);
    }
  }

  // 热更新：增量回放
  async appendEvents(events: BaseEvent[]): Promise<void> {
    this.state = foldEvents(events, this.state);
  }

  // 获取当前可见消息
  getVisibleMessages(): Message[] {
    return this.state.surface
      .filter(n => n.visible)
      .map(n => this.toMessage(n));
  }

  // 获取版本信息
  getVersionState(userMessageId: string): VersionState | undefined {
    return this.state.versions.get(userMessageId);
  }
}
```

### 6.4 性能优化

| 优化点 | 方案 |
|--------|------|
| 冷启动速度 | 只回放活跃卷 + 上一卷（不加载更早卷）|
| 大文件读取 | 流式读取（逐行 parse），不一次性载入内存 |
| 增量更新 | 记录 `lastProcessedSeq`，只处理新事件 |
| 缓存 | 内存缓存当前 surface，避免重复 fold |
| 搜索 | 独立 FTS5 索引，不依赖 JSONL 扫描 |

---

## 7. 压缩系统设计

### 7.1 两级压缩映射

#### 一级压缩：Pruning → message/prune 事件

**现有逻辑**：`pruneMessages()` 裁剪工具结果 > 1000 字符的消息。

**JSONL 映射**：

```
现有：直接修改 MessageContent.content（原地修改）
JSONL：追加 message/prune 事件（记录前后内容）
```

**事件生成**：

```typescript
function createPruneEvent(message: Message, prunedContent: string): BaseEvent {
  return {
    type: 'message/prune',
    seq: nextSeq(),
    time: Date.now(),
    data: {
      targetMessageId: message.id,
      targetContentId: message.contents[0].id,
      previousContent: message.contents[0].content,
      newContent: prunedContent,
      prunedBytes: message.contents[0].content.length - prunedContent.length,
      strategy: 'head_tail_500',
    },
  };
}
```

**回放处理**：fold 时遇到 `message/prune` → 替换目标消息内容。

#### 二级压缩：Compaction → message/compact 事件

**现有逻辑**：`compactMessages()` 生成摘要 + 保留最近消息 + 更新检查点。

**JSONL 映射**：

```
现有：修改 history 数组 + 更新 tokenBreakdown + 保存检查点到 DB
JSONL：追加 message/compact 事件 + envelope (post-compaction) + 分卷
```

**事件生成**：

```typescript
function createCompactEvent(result: CompressionResult): BaseEvent {
  return {
    type: 'message/compact',
    seq: nextSeq(),
    time: Date.now(),
    data: {
      shadows: [startSeq, endSeq],
      summary: result.summary,
      retained: [retainStartSeq, retainEndSeq],
      summaryTokens: result.summaryTokens,
      mode: result.mode,
    },
  };
}
```

**回放处理**：fold 时遇到 `message/compact` → 遮蔽死范围 + 记录摘要。

### 7.2 压缩触发

```typescript
async function shouldCompress(state: ReplayState, contextWindow: number): Promise<boolean> {
  const total = calculateVisibleTokens(state);
  const ratio = total / contextWindow;
  const triggerRatio = 0.8;
  return ratio >= triggerRatio;
}

function calculateVisibleTokens(state: ReplayState): number {
  // 只计算可见消息的 token
  return state.surface
    .filter(n => n.visible)
    .reduce((sum, n) => sum + estimateTokens(n.content), 0);
}
```

### 7.3 压缩执行

```typescript
async function executeCompaction(
  replayer: MessageReplayer,
  config: CompressionConfig,
): Promise<void> {
  // Stage 1: Pruning
  const pruneEvents = await executePruning(replayer);
  for (const event of pruneEvents) {
    await replayer.appendEvent(event);
  }

  // 检查是否仍需二级压缩
  if (!(await shouldCompress(replayer.getState(), config.contextWindow))) {
    return;
  }

  // Stage 2: Compaction
  const compactEvent = await executeCompaction(replayer, config);
  await replayer.appendEvent(compactEvent);

  // 重写 envelope（必须，否则原 header 在死范围丢失）
  const envelopeEvent = createEnvelopeEvent('post-compaction', config);
  await replayer.appendEvent(envelopeEvent);

  // 分卷
  await replayer.storage.splitSegment(replayer.sessionId);
}
```

---

## 8. 版本切换设计

### 8.1 现有机制

- 一个 user 消息可对应多个 assistant 版本（`parentId` + `currentVersionId`）
- 版本切换 = 修改 `currentVersionId` 指针
- 最多 5 个版本（`MAX_REGENERATE_VERSIONS = 5`）

### 8.2 JSONL 映射

**版本创建**：每次重新生成 → 追加新的 `message/create` 事件（assistant 角色）。

**版本切换**：追加 `version/switch` 事件。

### 8.3 智能合并

**问题**：用户可能来回切换多次，产生大量无意义事件。

**方案**：写入前合并——同一消息的连续 switch 只保留最终落点。

```typescript
class VersionSwitchMerger {
  private pendingSwitches = new Map<string, VersionSwitchEvent>();
  private hasOtherEvent = new Set<string>();

  push(event: BaseEvent): void {
    if (event.type === 'version/switch') {
      const messageId = event.data.messageId;
      if (this.hasOtherEvent.has(messageId)) {
        // 之前有其他事件，不能合并 → 先 flush 旧的
        this.flush(messageId);
        this.hasOtherEvent.delete(messageId);
      }
      this.pendingSwitches.set(messageId, event);  // 覆盖，不追加
    } else {
      // 真实事件：标记所有待写入的 switch 被隔断
      for (const messageId of this.pendingSwitches.keys()) {
        this.hasOtherEvent.add(messageId);
      }
    }
  }

  flush(messageId?: string): void {
    if (messageId) {
      const sw = this.pendingSwitches.get(messageId);
      if (sw) {
        this.buffer.push(sw);
        this.pendingSwitches.delete(messageId);
      }
    } else {
      for (const sw of this.pendingSwitches.values()) {
        this.buffer.push(sw);
      }
      this.pendingSwitches.clear();
      this.hasOtherEvent.clear();
    }
  }
}
```

### 8.4 回放处理

```typescript
case 'version/switch': {
  const data = event.data as VersionSwitchData;
  const version = state.versions.get(data.messageId);
  if (version) {
    version.currentVersionId = data.toVersion;
  }
  break;
}
```

---

## 9. API 兼容性设计

### 9.1 目标

保持现有 REST API 签名不变，前端无感知。

### 9.2 接口适配

#### GET /sessions/:sessionId/messages

```typescript
// 现有签名不变
@Get("sessions/:sessionId/messages")
async getMessages(
  @Param("sessionId") sessionId: string,
  @Query("limit") limit?: string,
  @Query("beforeMessageId") beforeMessageId?: string,
  @Query("afterMessageId") afterMessageId?: string,
) {
  // 内部路由
  if (await this.jsonlBackend.hasSession(sessionId)) {
    return this.jsonlBackend.getMessages(sessionId, { limit, beforeMessageId, afterMessageId });
  }
  // 兼容旧数据
  return this.sqliteBackend.getMessages(sessionId, { limit, beforeMessageId, afterMessageId });
}
```

#### 消息格式兼容

```typescript
// JSONL → 现有 Message 格式
function toLegacyMessage(node: SurfaceNode): Message {
  return {
    id: node.messageId,
    sessionId: node.metadata.sessionId,
    role: node.role,
    parentId: node.metadata.parentId,
    currentVersionId: node.metadata.currentVersionId,
    metadata: node.metadata,
    contents: [{
      id: node.metadata.contentId,
      messageId: node.messageId,
      turnsId: node.metadata.turnsId,
      role: node.role,
      content: node.content,
      reasoningContent: node.metadata.reasoningContent,
      metadata: node.metadata,
      files: node.metadata.files,
    }],
  };
}
```

### 9.3 双写过渡

```typescript
class DualWriteBackend {
  async appendEvent(sessionId: string, event: BaseEvent): Promise<void> {
    // 写入 JSONL（主）
    await this.jsonl.appendEvent(sessionId, event);
    
    // 异步写入 DB（兼容）
    if (this.dualWriteEnabled) {
      await this.sqlite.appendEvent(sessionId, event).catch(err => {
        this.logger.warn(`Dual write to SQLite failed: ${err}`);
      });
    }
  }
}
```

---

## 10. 前端适配设计

### 10.1 目标

前端组件无感知，只通过 API 消费数据。

### 10.2 适配点

| 现有逻辑 | 适配方案 |
|---------|---------|
| 消息列表从 API 获取 | 无变化（API 兼容）|
| 版本切换调用 API | 无变化（API 兼容）|
| 编辑消息（删除+重建）| 无变化（API 兼容）|
| 流式输出（SSE）| 无变化（SSE 事件格式不变）|
| 消息搜索 | 无变化（独立搜索索引）|

### 10.3 潜在优化

- **增量加载**：利用 seq 偏移量，只请求新事件
- **本地缓存**：前端缓存已加载的 surface，减少重复请求

---

## 11. 迁移策略

### 11.1 策略：彻底抛弃，一次性迁移

**不做双写**——双写增加复杂度且延长过渡期。改为：

```
Phase 0：准备
  ├── 实现 JsonlBackend + Replayer
  ├── 实现迁移脚本（SQLite → JSONL）
  └── 实现 API 兼容层

Phase 1：灰度迁移（后台）
  ├── 后台任务：逐个会话执行迁移
  ├── 迁移期间服务仍读 SQLite（旧逻辑）
  └── 迁移完成标记：manifest 中记录 migratedAt

Phase 2：切换读取路径
  ├── 读取切换到 JSONL
  ├── 写入直接写 JSONL（不再写 SQLite）
  └── 验证数据一致性

Phase 3：清理
  ├── 废弃 Message/MessageContent 表
  └── 数据库瘦身（VACUUM）
```

### 11.2 历史数据迁移

```typescript
async function migrateSession(sessionId: string): Promise<void> {
  // 1. 从 SQLite 读取所有消息
  const messages = await sqliteBackend.getAllMessages(sessionId);
  
  // 2. 转换为事件
  const events = messages.map(toEvent);
  
  // 3. 写入 JSONL
  await jsonlBackend.writeSegment(sessionId, 'seg-0000.jsonl', events);
  
  // 4. 创建 manifest
  await jsonlBackend.createManifest(sessionId, events);
  
  // 5. 校验
  const verified = await jsonlBackend.verify(sessionId, events.length);
  if (!verified) throw new Error('Migration verification failed');
}
```

### 11.3 回滚方案

- 双写期：随时可切回 SQLite 读取
- 保留 SQLite 数据直到 Phase 4 结束
- 版本标记：JSONL 文件头记录版本号，支持多版本回放

---

## 12. 风险与权衡

### 12.1 风险

| 风险 | 影响 | 缓解 |
|------|------|------|
| 回放性能 | 大会话冷启动慢 | 物化视图 + 增量回放 |
| 数据丢失 | 文件损坏 | 定期备份 + 校验和 |
| 并发写入 | 多端同时写 | 文件锁 + 事件队列 |
| 搜索退化 | JSONL 不支持全文搜索 | 独立 FTS5 索引 |
| 迁移失败 | 数据不一致 | 双写过渡 + 校验 |

### 12.2 权衡

| 优势 | 代价 |
|------|------|
| 消息存储从 DB 剥离 | 需要维护回放引擎 |
| 文件化易于同步 | 需要处理并发写 |
| 无需 DB migration | 需要双写过渡期 |
| 天然支持审计/回溯 | 文件体积增长（旧事件保留）|
| 简化部署（单文件拷贝）| 需要新的备份策略 |

### 12.3 不适用场景

- **强关系查询**：如"查找所有引用了某知识库的消息" → 需要独立索引
- **实时聚合**：如"统计每会话消息数" → 需要物化视图或独立统计
- **多表事务**：如"删除会话同时删除所有消息" → 需要跨文件事务

---

## 13. 核心代码结构（建议）

```
backend-ts/src/
├── common/
│   └── persistence/
│       ├── types.ts                  // 事件类型定义
│       ├── backend.interface.ts      // PersistenceBackend 接口
│       ├── jsonl-backend.ts          // JSONL 实现
│       ├── sqlite-backend.ts         // SQLite 兼容实现
│       ├── dual-write-backend.ts     // 双写实现
│       ├── replayer.ts               // 回放引擎
│       ├── fold.ts                   // fold 算法
│       └── manifest.ts               // 分卷元数据
├── modules/
│   └── chat/
│       ├── message.service.ts        // 改造：路由到 PersistenceBackend
│       ├── compression-engine.ts     // 改造：生成事件而非修改 DB
│       └── persistent-session-context.ts  // 改造：使用 Replayer
└── scripts/
    └── migrate-messages.ts           // 历史数据迁移脚本
```

---

## 14. 下一步

### 14.1 已确认决策

| # | 决策项 | 结论 |
|---|--------|------|
| 1 | 存储方案 | **事件溯源（日志）** |
| 2 | 分卷触发 | 每 **5 次压缩**分新卷 |
| 3 | 版本切换 | **保留**，智能合并（连续切换只保留最终落点）|
| 4 | 搜索 | 独立 SQLite 已存在，**初期暂不实现**，先跑通核心 |
| 5 | 迁移策略 | **不做双写**，彻底抛弃旧表，一次性迁移 |
| 6 | 历史消息 | Surface = fold 产物，分页 = 数组切片（见第 15 节）|
| 7 | Envelope | **不存日志**，每次从 DB 实时拼装 |
| 8 | 三阶段路线 | 短期纯日志 → 中期日志+快照 → 长期无 DB（见第 16 节）|

### 14.2 待办

1. **PoC 验证**：单会话 JSONL 读写 + fold 回放
2. **性能测试**：万级事件回放基准
3. **迁移脚本**：历史数据批量导入 JSONL
4. **API 适配**：MessagesController 路由到 JSONL
5. **压缩映射**：compression-engine 生成事件而非修改 DB

---

## 16. 三阶段路线图

### 16.1 短期（PoC 阶段）：纯日志

**目标**：验证核心可行性，跑通读写回放流程。

```
seg-0000.jsonl: [归档：压缩遮蔽的旧消息]
seg-0001.jsonl: [归档：压缩遮蔽的旧消息]
seg-0002.jsonl: [活跃：当前可见消息 + 新事件追加]
```

- 每 **5 次压缩**分新卷
- 活跃卷 append-only 写入
- 读取：fold 活跃卷 + 上一卷 → 当前 surface
- 搜索：独立 SQLite（适配同步接口，初期可暂不实现）

**关键指标**：
- 冷启动回放 < 50ms（万级事件）
- 写入 O(1) append
- 崩溃恢复：只丢尾部一行

### 16.2 中期（生产优化）：活跃日志 + 归档快照

**目标**：优化读取性能，参考 SQLite WAL checkpoint 机制。

```
seg-0000.jsonl: [归档日志：只读]
seg-0001.jsonl: [归档日志：只读]
checkpoint.json: [seg-0001 fold 后的状态快照]
active.jsonl:    [活跃日志：append-only，从 checkpoint 之后开始]
```

**核心机制**：

1. **定期 Checkpoint**（类似 SQLite WAL checkpoint）：
   - 每 N 次写入 或 定时（如 30 秒）
   - 将活跃日志 fold → 生成 checkpoint 快照
   - 原子替换 checkpoint.json（write temp + rename）
   - 清空活跃日志（或截断已 checkpoint 部分）

2. **读取路径**：
   - 冷启动：load checkpoint.json（O(1)）+ fold 活跃日志（O(k)，k = 上次 checkpoint 后的新事件）
   - 热更新：fold 活跃日志的新事件（O(1) 增量）

3. **写入路径**：
   - 新消息 → append 到活跃日志（O(1)）
   - 编辑/删除 → append 事件到活跃日志（O(1)）
   - 不修改历史归档日志

**崩溃恢复**：
- checkpoint.json 用原子替换 → 不会损坏
- 活跃日志 append-only → 只丢最后一行
- 恢复：load checkpoint + fold 活跃日志 → 完整状态

**性能**：
- 冷启动：O(1) 加载 checkpoint + O(k) 回放活跃日志（k 通常 < 100）
- 写入：O(1) append
- 磁盘占用：活跃日志定期清理，不会无限增长

### 16.3 长期（架构演进）：彻底摆脱数据库

**目标**：除必要功能（知识库向量检索）外，所有数据走文件。

```
sessions/<sessionId>/
  ├── checkpoint.json    // 当前状态快照
  ├── active.jsonl       // 活跃日志
  ├── seg-0000.jsonl     // 归档日志（只读）
  ├── seg-0001.jsonl     // 归档日志（只读）
  └── manifest.json      // 元数据

users.jsonl              // 用户数据（或独立文件）
characters.jsonl         // 角色定义
memory.jsonl             // 记忆数据
models.jsonl             // 模型配置
kb/                      // 知识库（向量检索仍需专用存储）
  └── <kbId>/
      ├── chunks.jsonl
      └── index.bin      // 向量索引（仍需专用格式）
```

**退出数据库的条件**：
- 所有域数据都有文件持久化方案
- 知识库向量检索可独立为专用索引服务
- 多端同步基于文件（如 git/CRDT）

### 16.4 三阶段对比

| | 短期（纯日志）| 中期（日志+快照）| 长期（无 DB）|
|---|---|---|---|
| 读取 | O(n) 回放 | O(1) + O(k) 回放 | O(1) + O(k) |
| 写入 | O(1) append | O(1) append | O(1) append |
| 崩溃恢复 | 只丢一行 | 只丢一行 | 只丢一行 |
| 实现复杂度 | 低 | 中 | 高 |
| 数据库依赖 | 元数据 + 搜索 | 搜索 | 无（向量除外）|
| 适用阶段 | PoC 验证 | 生产上线 | 架构终态 |

---

## 17. 下一步

### 17.1 已确认决策

| # | 决策项 | 结论 |
|---|--------|------|
| 1 | 存储方案 | **事件溯源（日志）** |
| 2 | 分卷触发 | 每 **5 次压缩**分新卷 |
| 3 | 版本切换 | 保留，智能合并（连续切换只保留最终落点）|
| 4 | 搜索 | **初期暂不实现**，先跑通核心 |
| 5 | 迁移策略 | **不做双写**，彻底抛弃旧表 |
| 6 | 历史消息 | Surface = fold 产物，分页 = 数组切片 |
| 7 | Envelope | **不存日志**，每次从 DB 实时拼装 |
| 8 | 三阶段 | 短期纯日志 → 中期日志+快照 → 长期无 DB |

### 17.2 待办

1. **PoC 验证**：单会话 JSONL 读写 + fold 回放
2. **性能测试**：万级事件回放基准
3. **迁移脚本**：历史数据批量导入 JSONL
4. **API 适配**：MessagesController 路由到 JSONL
5. **压缩映射**：compression-engine 生成事件而非修改 DB

### 15.1 问题

前端 `ChatPanel.vue` 通过 `GET /sessions/:sessionId/messages?limit=30&beforeMessageId=xxx` 获取消息列表。切换到 JSONL 后，这条接口的数据源不再是 DB 表，而是事件日志的回放产物。

**核心矛盾**：
- 现有 API 是**游标分页**（每次取 N 条，滚动加载更多）
- JSONL 是**全量日志**（必须 fold 才能知道"当前可见哪些消息"）
- 如何让前端用现有的"滚动加载更多"模式消费事件溯源数据？

### 15.2 方案：Surface = 物化视图，分页 = Surface 切片

```
JSONL 事件日志
    │
    │ fold（回放）
    ▼
Surface（内存中的当前可见消息列表）
    │
    │ 数组切片
    ▼
前端分页消费（limit + cursor = 数组的一段）
```

**核心思路**：
1. 会话加载时，回放活跃卷 + 上一卷 → 构建完整 surface
2. surface 是一个**有序数组**（按 seq 排序的可见消息列表）
3. 前端分页请求 = 对 surface 做**数组切片**
4. 滚动加载更多 = 按需加载更早的卷 → 扩展 surface

### 15.3 Surface 构建流程

```typescript
class SessionSurfaceCache {
  private surfaces = new Map<string, SurfaceCache>();

  async getSurface(sessionId: string): Promise<SurfaceCache> {
    let cache = this.surfaces.get(sessionId);
    if (cache) return cache;

    cache = await this.buildSurface(sessionId);
    this.surfaces.set(sessionId, cache);
    return cache;
  }

  private async buildSurface(sessionId: string): Promise<SurfaceCache> {
    const manifest = await this.storage.readManifest(sessionId);
    const state = createInitialState();

    // 1. 回放活跃卷（完整 fold）
    const activeSeg = manifest.segments.find(s => s.status === 'active');
    const activeEvents = await this.storage.readSegment(sessionId, activeSeg.file);
    foldEvents(activeEvents, state);

    // 2. 回放上一卷（获取最近摘要 + 历史上下文）
    const archivedSegs = manifest.segments.filter(s => s.status === 'archived');
    const prevSeg = archivedSegs[archivedSegs.length - 1];
    if (prevSeg) {
      const prevEvents = await this.storage.readSegment(sessionId, prevSeg.file);
      foldEvents(prevEvents, state);
    }

    return {
      sessionId,
      nodes: state.surface.filter(n => n.visible),  // 可见消息
      envelope: state.envelope,
      versions: state.versions,
      lastSeq: state.lastProcessedSeq,
      hasOlder: archivedSegs.length > 1,  // 是否有更早的卷
    };
  }

  // 增量更新（新消息到达时）
  async appendEvents(sessionId: string, events: BaseEvent[]): Promise<void> {
    const cache = this.surfaces.get(sessionId);
    if (!cache) return;
    foldEvents(events, cache.state);
  }

  // 加载更早的历史（用户滚动到顶部时）
  async loadOlder(sessionId: string): Promise<SurfaceNode[]> {
    const manifest = await this.storage.readManifest(sessionId);
    const archivedSegs = manifest.segments.filter(s => s.status === 'archived');
    
    // 加载倒数第二卷（更早的历史）
    if (archivedSegs.length >= 2) {
      const olderSeg = archivedSegs[archivedSegs.length - 2];
      const events = await this.storage.readSegment(sessionId, olderSeg.file);
      const cache = this.surfaces.get(sessionId);
      foldEvents(events, cache.state);
      return cache.state.surface.filter(n => n.visible);
    }
    return [];
  }
}
```

### 15.4 分页 API 适配

```typescript
@Get("sessions/:sessionId/messages")
async getMessages(
  @Param("sessionId") sessionId: string,
  @Query("limit") limit?: string,
  @Query("beforeMessageId") beforeMessageId?: string,
  @Query("afterMessageId") afterMessageId?: string,
) {
  const surface = await this.surfaceCache.getSurface(sessionId);
  const messages = surface.nodes.map(toLegacyMessage);

  // 基于游标的数组切片
  const pageSize = parseInt(limit) || 30;
  
  if (beforeMessageId) {
    // 加载更早的消息（向上滚动）
    const idx = messages.findIndex(m => m.id === beforeMessageId);
    if (idx === -1) return { items: [], hasMore: false };
    
    const start = Math.max(0, idx - pageSize);
    const slice = messages.slice(start, idx);
    const hasMore = start > 0 || surface.hasOlder;
    
    return { items: slice.reverse(), hasMore };
  }
  
  if (afterMessageId) {
    // 加载更新的消息（向下滚动，新消息）
    const idx = messages.findIndex(m => m.id === afterMessageId);
    if (idx === -1) return { items: [], hasMore: false };
    
    const end = Math.min(messages.length, idx + pageSize + 1);
    const slice = messages.slice(idx + 1, end);
    const hasMore = end < messages.length;
    
    return { items: slice, hasMore };
  }

  // 默认：返回最近 N 条
  const slice = messages.slice(-pageSize);
  const hasMore = messages.length > pageSize || surface.hasOlder;
  return { items: slice, hasMore };
}
```

### 15.5 前端交互映射

| 前端操作 | 现有实现 | JSONL 适配 |
|---------|---------|-----------|
| 首次加载 | `GET /messages?limit=30` | surface 数组最后 30 条 |
| 向上滚动加载更多 | `GET /messages?limit=15&beforeMessageId=xxx` | surface 数组向前切片 |
| 新消息到达 | SSE 推送 → 追加到列表 | SSE 推送 → 追加事件 → 更新 surface |
| 滚动到顶触发加载 | `beforeMessageId` 触发 | 如果 `hasOlder` → 异步加载更早卷 |

### 15.6 性能考量

| 场景 | 优化策略 |
|------|---------|
| 冷启动（首次加载）| 只回放活跃卷 + 上一卷，不加载全部历史 |
| 大会话（万级消息）| surface 常驻内存，增量更新 |
| 超大会话（10 万+）| 活跃卷保持较小（频繁压缩），surface 大小可控 |
| 多会话并发 | 每个会话独立 surface 缓存，LRU 淘汰 |

### 15.7 关键指标

```
假设：
- 活跃卷保留最近 200 条消息
- 每条消息平均 500 字节
- 上一卷包含 1 次压缩摘要 + 最近 1000 条消息

冷启动回放：
- 活跃卷 200 条 → < 5ms
- 上一卷 1000 条 → < 20ms
- 总计 < 25ms（远快于 DB 查询+序列化）

内存占用：
- 每条 SurfaceNode ≈ 1KB（content + metadata）
- 1000 条消息 ≈ 1MB 内存
- 100 个活跃会话 ≈ 100MB（可接受）
```

```typescript
// 事件类型
type EventType =
  | 'session/init'
  | 'envelope'
  | 'message/create'
  | 'message/prune'
  | 'message/compact'
  | 'version/switch'
  | 'usage/report';

// 基础事件
interface BaseEvent {
  type: EventType;
  seq: number;
  time: number;
  data: Record<string, unknown>;
}

// 持久化后端接口
interface PersistenceBackend {
  // 会话
  createSession(meta: SessionMeta): Promise<void>;
  getSession(id: string): Promise<SessionMeta | null>;
  listSessions(query: SessionQuery): Promise<SessionMeta[]>;

  // 事件
  appendEvent(sessionId: string, event: BaseEvent): Promise<void>;
  appendEvents(sessionId: string, events: BaseEvent[]): Promise<void>;
  readEvents(sessionId: string, fromSeq?: number): Promise<BaseEvent[]>;
  getAllEvents(sessionId: string): Promise<BaseEvent[]>;

  // 分卷
  splitSegment(sessionId: string): Promise<void>;
  readManifest(sessionId: string): Promise<Manifest>;
  writeManifest(sessionId: string, manifest: Manifest): Promise<void>;

  // 校验
  verify(sessionId: string, expectedEventCount: number): Promise<boolean>;
}

// 回放引擎接口
interface MessageReplayer {
  initialize(): Promise<void>;
  appendEvents(events: BaseEvent[]): Promise<void>;
  getVisibleMessages(): Message[];
  getVersionState(userMessageId: string): VersionState | undefined;
  getState(): ReplayState;
}
```

---

> 文档结束。待评审确认后进入 PoC 实现阶段。
