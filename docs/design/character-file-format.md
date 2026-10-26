# 智能体文件格式（agents/\<id\>/AGENT.md）

## 背景

角色/智能体定义的权威来源是**本地文件**，不再是数据库。原 `character` 表已冻结为
只读兜底（仅供回滚，上线前删除）。

这样做的收益：

- 人类可读可改：任何编辑器直接读写，提示词就是普通 Markdown 散文
- AI 可操作：AI 用普通文件读写就能增删改智能体，不需要 DB 客户端
- 便于同步/备份/分享：一个目录 = 一个自包含的智能体
- 无孤儿头像：头像在目录内，删除目录即删除头像

## 目录布局

```
<AGENTS_DATA_DIR>/
  <id>/
    AGENT.md        定义（YAML frontmatter + Markdown 正文）
    avatar.png      头像（可选，约定 avatar.<png|jpg|jpeg|webp|gif>）
    ...             其他资源（示例、配置等，随目录一起复制/删除）
  .trash/           UI 删除的回收站（<id>-<时间戳>/）
  .tombstones.json  UI 删除墓碑（阻止补种复活）
  .rekey.json       DB→文件一次性导出的旧 id → 目录名映射（迁移期文件）
```

**目录名即 id**。`findById(id)` 直接读 `agents/<id>/AGENT.md`，不需要索引；
缓存只服务于列表扫描。

内置默认助手模板在 `<BUNDLED_AGENTS_DIR>`（随包发布的 `bundled-agents/`），
启动时对「用户目录缺失且无墓碑」的默认 id 执行复制补种，**已存在绝不覆盖**。

## 文件格式

```markdown
---
name: 产品经理
description: 扮演具有技术和管理能力的产品经理角色，为用户提供实用的解答。
model: deepseek:deepseek-chat
settings:
  memory:
    summaryMode: memory_sync
  plugins:
    __strategy: deny_nonsystem
  agents:
    generic: true
---
你是一名经验丰富的产品经理……（systemPrompt 正文，原样存储，不做转义）
```

### 字段

| 字段 | 必填 | 说明 |
|---|---|---|
| `name` | 否 | 显示名称。缺省回退目录名。**修改它不会改变目录名（id）** |
| `description` | 否 | 简介，展示在列表与 `@` 候选中 |
| `model` | 否 | 模型引用 `{实例id}:{模型名}`；缺省 = 新建会话时选择模型，老会话运行期以此作为兜底 |
| `settings` | 否 | 内部设置，**原样透传**（见下） |
| 正文 | 否 | 即 `systemPrompt`。读取时回填到 `settings.systemPrompt` |

**刻意不设的字段**（用文件系统事实表达，避免元数据与事实不一致）：

| 概念 | 表达方式 |
|---|---|
| `id` | 目录名 |
| 创建/修改时间 | 文件系统 `birthtime` / `mtime` |
| 头像 | 目录内 `avatar.<ext>`（约定文件名） |
| 公开性 | 已移除（单机应用无此需求） |
| 分组 | 已移除（不再有分组概念） |

### settings 透传说明

`settings` 下的内容原样写入 YAML，原样读回。这是刻意的"减法"设计：
`plugins` / `agents` / `skills` / `memory` 的结构由消费方（`PluginManager`、
子代理与工作流插件、压缩策略）定义，格式层不做归一，避免改写语义。

## id 规则

id 由 `name` 派生（`slugifyAgentId`）：

- 保留 Unicode（含中文），以便 `ls agents/` 直接可读
- 仅剔除文件系统非法字符 `\ / : * ? " < > |` 与控制字符
- 空白折叠为 `-`，去首尾点/横线/空格
- 长度上限 100 字符
- 规避 Windows 保留名（`CON`/`PRN`/`AUX`/`NUL`/`COM1-9`/`LPT1-9`），冲突时前缀 `_`
- 创建时按**大小写不敏感**查重（Windows 文件系统语义），冲突追加 `-2`、`-3`

## ⚠️ 不要手动重命名目录

目录名就是 id，被这些地方引用：

- `session.character_id`（会话归属的角色）
- `bot_instance.default_character_id`（Bot 默认角色）
- `scheduler/tasks.json` 的 `characterId`（定时任务）
- 其他智能体 frontmatter 的 `settings.agents` 白名单键
- **历史 JSONL 消息中的 `subagent_spawn` 参数与 `@` 提及文本**（事件溯源日志不可改写）

手动重命名目录 = 换 id，引用会静默断开，且历史消息里的旧 id 无法修复。

**想改显示名，改 `name` 字段即可**，这不影响任何引用。

## 删除与恢复

| 操作 | 行为 |
|---|---|
| UI 删除助手 | 目录移入 `.trash/<id>-<时间戳>/`（含头像）+ 写墓碑；不复活，可手动还原 |
| 文件管理器/命令行删除 | 无墓碑 → 下次启动从内置模板补种（若该 id 是内置默认助手） |
| 删除非内置助手 | 无内置模板可补，目录不存在即视为已删除 |

补种恢复的是**内置默认版本**，用户对默认助手做过的修改会丢失；
有意删除请走 UI（写墓碑）以避免复活。

## 迁移期文件

| 文件 | 用途 |
|---|---|
| `.migrated-from-db` | 一次性导出标记，存在则不再从 DB 导出 |
| `.rekey.json` | 旧 cuid → 新目录名的映射，供模型引用等其它迁移反查 |
| `.tombstones.json` | UI 删除墓碑 |

还原旧快照导致引用回退时，删掉 `.migrated-from-db` 重启即可重跑导出（导出幂等）。

## 手写一个智能体

直接建目录写文件即可，无需任何工具：

```bash
mkdir -p ~/.guada/agents/代码审查员
cat > ~/.guada/agents/代码审查员/AGENT.md <<'EOF'
---
name: 代码审查员
description: 专注于代码质量与安全问题的审查专家
---
你是一名资深代码审查专家。审查时重点关注：
1. 正确性：边界条件、错误处理
2. 安全性：注入、越权、敏感信息泄漏
3. 可维护性：命名、重复、职责划分
EOF
```

已运行的服务通过文件监听（chokidar，300ms 防抖）自动热重载，无需重启。

## 环境变量

| 变量 | 说明 |
|---|---|
| `AGENTS_DATA_DIR` | 用户可写根目录；缺省回退 `USERDATA_DIR/agents` → `cwd()/data/agents` |
| `BUNDLED_AGENTS_DIR` | 内置模板目录；缺省 `cwd()/bundled-agents` |
| `AGENTS_URL_PREFIX` | 头像等资源的 URL 前缀；缺省 `/agents` |
