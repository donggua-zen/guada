# dsh-purge 功能对照与实施进度

> 目标：以**独立三方插件** `donggua-zen/guada-purge` 复刻 dsh-purge 的用户可见能力。
> 宿主契约：`docs/plugin-market/third-party-plugin-api.md`
> 机制分析：`docs/plugin-market/dsh-purge-mechanism-analysis.md`

## 图例

- ✅ 已完成（宿主 + 插件）
- 🚧 宿主机制已完成，插件侧待接入
- ⬜ 未开始
- ⛔ 明确不做

## 对照表

| # | dsh-purge 能力 | GuaDa 实现 | 宿主机制 | 状态 |
|---|---|---|---|---|
| 1 | 提示词/人格注入 | `registerPromptSection('guada-purge.persona', order=-100)` | PromptAssembler | ✅ |
| 2 | 规则集（AGENTS.md 类） | `registerPromptSection('guada-purge.rules', order=100)` + cwd glob | PromptAssembler | ✅ |
| 3 | 技能库 | `registerSkill` × 6（防御/规范类） | 既有 | ✅ |
| 4 | `purge_status/apply/revert` 工具 | `registerTool` | 既有 | ✅ |
| 5 | 提示词编辑器 | 设置页「提示词」页签 + `prompt-inject.md` | `settings` slot + RPC + dataDir | ✅ |
| 6 | 规则集管理（列表/启用/新建/删除） | 设置页「规则集」页签 | `settings` slot + RPC + dataDir | ✅ |
| 7 | 状态分组（applied/skipped/...） | 插件 `core/status.js` + 设置页「状态」页签 | 无 | ✅ |
| 8 | Apply/Restore 快照 | `core/state.js`（apply 前快照 + revert） | dataDir | ✅ |
| 9 | 启动自检 | `onStart` 重读数据目录 | 既有 | ✅ |
| 10 | 会话标题旁入口按钮 | slot `conversation.header.actions` | 聊天区 slot（未实现） | ⬜ |
| 11 | 右侧 Clean/Drill dock | slot `conversation.side.panel` | 面板容器（未实现） | ⬜ |
| 12 | Drill 授权门 | slot `shell.overlay` | 全局 overlay slot（未实现） | ⬜ |
| 13 | `/purge`、`/rules` 命令 | `registerLocalCommand` | 动作命令注册表 | 🚧 |
| 14 | 启动/会话创建 hook | `registerHook('session.created')` | PluginHookRegistry | 🚧 |
| 15 | 每轮锚点 | `registerTurnReminderProvider` | 既有 | ⬜（可选） |
| 16 | 更新检查 | `POST /plugins/:id/update`（git） | 既有 | ⬜ |
| 17 | 子代理接管 / 绕过审批 / 改宿主源码 | — | — | ⛔ |

## 宿主已完成（v2）

| 机制 | 位置 | 测试 |
|---|---|---|
| `PLUGIN_API_VERSION = 2` + manifest 校验 | `types/plugin.types.ts`、`external-plugin-loader.ts` | `external-plugin-load.spec.ts` |
| `registerPromptSection` / `registerPromptTransform` | `api/plugin-api.ts`、`registry/plugin-registry.ts` | `plugin-api.contract.spec.ts` |
| `PromptAssembler`（内置段 + 命名段 + legacy + transform） | `prompt-assembler.service.ts` | `prompt-assembler.service.spec.ts` |
| `registerLocalCommand` + 解析谓词 + `/commands` 合并 | `local-slash-command*.ts`、`commands.controller.ts` | — |
| `registerHook`（白名单 + 结果校验 + fail-open） | `hooks/plugin-hook.registry.ts` | `plugin-hook.registry.spec.ts` |
| `getPluginDir` / `getDataDir` | `paths/plugin-paths.service.ts` | `plugin-paths.service.spec.ts` |
| `session.created` 常量与事件 | `hooks.contract.ts`、`sessions.controller.ts` | — |

## 端到端验收记录（2026-11-06）

临时数据目录启动后端（`SETTINGS_DIR/USERDATA_DIR=tmp/e2e-data`，端口 43999）：

1. `POST /plugins/install {"source":"local:D:/AI/work/guada-purge"}` → `success:true, id:guada-purge`
2. `POST /plugins/query` → `version=0.2.0`，3 个工具（purge_*）
3. `PUT /plugins/global {enabled:true}` → `GET /plugins/slots` 出现 `settings` slot（label=GuaDa Purge）
4. `POST /plugins/guada-purge/rpc/get_state` → 数据目录创建、3 个规则文件已 seed
5. `rpc/save_persona` → `state.revision=2`、`state.json` 落盘、`get_status` 变 `applied`
6. 禁用 → slot 消失；启用 → 恢复；`POST /plugins/reload/guada-purge` → `success:true`

## 下一步（Phase 2）

1. 宿主：`conversation.header.actions` / `conversation.side.panel` / `shell.overlay` 三个 slot 的消费方 + `usePluginPanels` + `plugin-host` props 桥。
2. 插件：HeaderButton / DockPanel / AuthGate。
3. 插件：`registerLocalCommand`（`/purge`、`/rules`）+ `registerHook('session.created')`。
4. 验收：按钮随启停出现/消失；dock 可开合；命令不落库不调模型；会话创建 hook 触发一次。
