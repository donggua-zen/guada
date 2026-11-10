# 插件专属智能体（Plugin-owned Agents）

> PluginApi v4 引入。插件可以注册「开箱即用」的专属智能体：提示词与能力由插件代码定义，
> 不干扰其他智能体，用户不可改写。适用于特殊用途插件（如逆向分析、领域专用助手）——
> 用户安装插件即获得配套智能体，无需手动创建 agent、手动开启对应工具。

## 动机

v3 及之前，插件注册的提示词/工具/技能全局生效：逆向插件的能力会无差别注入每个智能体；
若要隔离，用户需手动创建智能体并逐一开启对应工具，且插件注册的提示词无法按智能体收口
（`scope` 只有 global/agent/session 三档存在性判断，不能按具体 agentId 过滤）。

v4 补齐两块能力：

1. **`api.registerAgent(def)`**：插件直接注册专属智能体（虚拟、不落盘、随插件生命周期）。
2. **`visibleTo` 作用域声明**：插件注册的工具/工具包/提示词段/技能可声明仅对特定智能体可见。

## 一、api.registerAgent

```js
api.registerAgent({
  id: "demo",                    // 插件内唯一，ASCII slug；实际 id 归一化为 plugin-<pluginId>-<id>
  name: "演示智能体",
  description: "…",              // 列表/新建会话面板展示
  avatar: "assets/logo.svg",     // 可选：相对插件根（经 /api/v1/plugins/:id/assets/ 服务）或 http(s) URL
  modelId: null,                 // 可选：形如 "{实例id}:{模型名}"；空 = 建会话回退默认模型
  systemPrompt: "你是…",         // 系统提示词正文（虚拟 AGENT.md body）
  settings: { assistantName: "…" }, // 可选：透传既有智能体设置键（memory/temperature 等）
  toolkits: ["my_kit"],          // 可选：开放给该智能体的工具包；缺省 = 本插件全部工具包
                                 //        跨插件引用写 "pluginId:kitId"
  skills: ["my_skill"],          // 可选：开放给该智能体的技能名；缺省 = 本插件注册的全部技能
});
```

### 语义与约束

| 方面 | 行为 |
|---|---|
| 存在形式 | **虚拟智能体**：不落盘，`AgentFileStore` 读取层合并；`GET /agents` 与 `findById` 单一收口 |
| id 规则 | 归一化为 `plugin-<pluginId>-<id>`；前缀 `plugin-` 对用户创建的智能体保留（创建即 400） |
| 生命周期 | 随插件：加载即出现；**全局禁用/卸载即从列表隐藏**；启用恢复 |
| 已绑定会话 | 插件移除后会话 hydrate 拿不到 agent → 降级为无 agent 配置，模型从 session.modelId 解析，不崩溃 |
| 能力收口 | 合成等效 settings（见下）；skill/mcp/sub_agent 三个自治理系统包**未显式列入 toolkits 时整包关闭** |
| 编辑粒度 | **部分可编辑**（v4.1，见下节）：提示词与插件绑定能力锁定，其余配置开放 |
| 会话锁定 | `buildEffectiveSettings` 检测 `agent.pluginId` → `plugins/skills/agents/systemPrompt` 四字段强制取智能体侧，会话级覆盖不生效 |
| 用户不可改 | 提示词/绑定能力由插件代码权威；插件更新即跟随更新 |

### 编辑粒度（v4.1：锁定 vs 可编辑）

插件智能体不再是整体只读。弹窗正常打开（AgentSettingPanel + `pluginLock` prop），
分界如下：

| 配置项 | 用户可改 | 持久化 | 权威 |
|---|---|---|---|
| systemPrompt | ❌ 禁用展示 | — | 插件代码 |
| 插件绑定的工具包（`def.toolkits`） | ❌ 锁定常开（UI 开关禁用 +「插件绑定」徽标） | — | 插件代码 |
| 插件绑定的技能（`def.skills`） | ❌ 锁定常开 | — | 插件代码 |
| 其他插件工具包 / MCP 服务器 / 技能 / 子代理 | ✅ 正常开关 | override | 用户 |
| name / description / modelId / memory 档位 / assistantName | ✅ 正常编辑 | override | 用户 |
| 头像 | ❌（上传仍 400） | — | 插件 |

- **Override 存储**：`SettingsStorage` group `agent-overrides`（key=agentId），结构
  `{ name?, description?, modelId?, settings? }`；写入经 `AgentService.updateAgent`
  分流（`PUT /agents/:id` 不变），settings 中的 `systemPrompt`/`__pluginAgent` 静默丢弃。
- **合并收口**：`AgentFileStore.virtualToView` → `mergePluginAgentOverrides`
  （plugin-agent-settings.ts）：合成声明 + override 浅合并 + **锁定重申**（owner 条目
  allow 必含锁定包、锁定技能 `settings.skills` 强制 true + `plugins.skill` 门控救回）。
- **常开保障**：`PluginManager.applyLockedKitLayer`——agentId 命中插件智能体时，绑定
  工具包从 `deniedToolkits` 移除，用户的 `deny_nonsystem`/白名单/黑名单一律压不过
  （语义镜像 essential 插件）；自治理包（mcp/skill/sub_agent）由 store 层 roleCfg 重申兜住。
- DELETE / 头像上传对插件智能体仍 400；卸载插件后重装，override 自动恢复。

### 能力收口细节（合成 settings）

- `settings.plugins`：`__default: true`（file/shell/time 等 **core 基础能力包保留**——它们不是
  essential，白名单模式会误伤）；显式写入：
  - `skill` / `mcp` / `sub_agent`：未列入 `toolkits` → `{ toolkits_filter: "deny_all" }`
  - owner 插件（及跨插件引用的其他插件）：`{ toolkits_filter: "allow", toolkits_allow: [...] }`
- `settings.skills`：`{ __default: false, <声明的技能>: true }`（白名单）
- `settings.agents`：`{ __default: false }`（插件智能体不可派生子代理）

## 二、visibleTo 作用域声明

四种注册内容统一支持 `visibleTo?: ("self" | string)[]`：

| 注册内容 | 强制点 | 其他智能体看到什么 |
|---|---|---|
| `ToolKitDef.visibleTo` | `PluginManager.applyVisibilityLayer`（智能体层末尾追加拒绝，**压过 allow 白名单**） | 工具包整体隐藏（工具 + 提示词） |
| 顶层 `registerTool` 的 `visibleTo` | `buildPluginResult` 过滤 `enabledTools` | 工具不在 tools 列表；执行侧 `findTool` 同源查询，自然 fail-closed |
| `registerPrompt(.Section)` 的 `visibleTo` | `PromptAssembler` 装配循环过滤 | 段不进系统提示词 |
| `registerSkill` 的 `visibleTo` | `# Skills` 清单过滤 + `skill_learn` 执行校验 | 清单不可见；强行 learn 报错 |

语义：

- **省略 = 全局可见**（现状语义不变，仍受智能体层 `settings.plugins` 治理）
- `"self"` = 仅本插件注册的智能体（按 id 前缀 `plugin-<pluginId>-` 匹配）
- 其余条目 = 智能体 id 精确匹配（可多个）
- 声明了但当前无智能体上下文 → **不可见**（fail-closed）

```js
// 例：仅专属智能体可用的提示词段
api.registerPrompt({ content: "…", visibleTo: ["self"] });
// 例：对指定智能体开放的顶层工具
api.registerTool({ name: "secret_scan", /* … */ visibleTo: ["self", "audit-agent"] });
```

限制：`governance: "self"`（内建专用自治理包，mcp/skill/sub_agent）不适用 `visibleTo`——
它们的可见性由自有 handler 按配置裁决；外部插件本就不能声明 governance。

## 三、典型组合：专属智能体 + 专属能力

```js
async onLoad(api) {
  // 1. 专属工具包（只给智能体用 → visibleTo 声明）
  api.registerToolKit({ id: "re_kit", visibleTo: ["self"], loadMode: "eager", /* … */ });
  // 2. 全局提示词段只进专属智能体
  api.registerPrompt({ content: "…逆向方法论…", visibleTo: ["self"] });
  // 3. 注册智能体（toolkits 缺省 = 本插件全部包，恰好只有 re_kit）
  api.registerAgent({ id: "main", name: "逆向助手", systemPrompt: "…", });
}
```

效果：安装插件 → 智能体列表出现「逆向助手」（带插件徽标）；用它开会话 → 拿到专属提示词
与工具；其他任何智能体完全无感；卸载插件 → 智能体消失。

## 四、实现锚点（后端）

| 关注点 | 位置 |
|---|---|
| 类型（`PluginAgentDef` / `VisibleToAgent`） | `backend-ts/src/modules/plugins/types/plugin.types.ts` |
| 可见性判定 | `backend-ts/src/modules/plugins/utils/agent-visibility.ts`（`isVisibleToAgent`） |
| 注册中心 | `backend-ts/src/modules/plugins/registry/plugin-agent.registry.ts`（静态单例，含启停 checker） |
| 能力合成 | `backend-ts/src/modules/plugins/registry/plugin-agent-settings.ts`（`composePluginAgentSettings`） |
| 注册 API | `backend-ts/src/modules/plugins/api/plugin-api.ts`（`registerAgent` / flush 提交） |
| 工具包裁决 | `backend-ts/src/modules/plugins/plugin.manager.ts`（`applyVisibilityLayer`） |
| 顶层工具过滤 | 同上（`buildPluginResult` 内 `enabledTools` 过滤） |
| 提示词过滤 | `backend-ts/src/modules/plugins/prompt-assembler.service.ts` |
| 虚拟合并 | `backend-ts/src/modules/agents/agent-file.store.ts`（`listAgents` / `findById` / `virtualToView`） |
| 只读守卫 | `backend-ts/src/modules/agents/agent.service.ts`（update/delete/avatar 400；create 保留前缀 400） |
| 会话锁定 | `backend-ts/src/modules/chat/jsonl-session-context.ts`（`buildEffectiveSettings`） |
| 技能过滤 | `backend-ts/src/modules/skills/plugins/skill.plugin.ts`（清单 + `skill_learn` 校验） |
| 活样例 | `plugins/hello-plugin`（`registerPluginAgent` + `visibleTo:["self"]` 提示词段） |

## 五、已知限制

- 插件智能体不参与智能体导入/导出（.md 往返）——定义属插件分发物。
- 插件全局禁用时其智能体从列表隐藏；已绑定会话降级为无 agent 配置（模型走 session.modelId）。
- 智能体层 `toolkits` 白名单（`allow` 模式）不能复活声明了 `visibleTo` 的工具包——
  生产侧声明优先于消费侧配置。
- `toolkits` 缺省值在 `flush()` 时定格为本插件当时注册的全部工具包；之后动态新增的
  工具包不会追溯进入已注册智能体的能力面（确定性优先）。
