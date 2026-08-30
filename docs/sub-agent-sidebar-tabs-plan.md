# 子Agent 侧边栏标签化 + 生命周期重构 完整实施方案

> 项目：GuaDa AI（frontend + backend-ts）
> 日期：2026-08-29
> 状态：待实施

---

## 0. 目标与设计原则

1. **主对话永不被替换**：点击子Agent，在侧边栏工作目录以标签形式打开其对话记录（只读）。
2. **移除"关闭=删除"概念**（参考 deepseek-harness 模式）：子Agent 生命周期只有 start / finished 两个状态边缘，会话记录永久留存；删除只发生在主会话删除时级联执行。
3. **关闭标签 ≠ 关闭子Agent**：用户关标签只是"不看了"。
4. **数据零 API 校验**：标签恢复校验全部使用本地 `sessionStore.sessionsMap`。
5. **agent 标签不做 LRU 淘汰**、无数量上限压力。

---

## 1. 现状事实（已核实，含文件行号）

### 前端

| 事实 | 位置 |
|---|---|
| 主会话与子Agent 共用一个 ChatPanel，`panelSession` 按 `activeTabId` 切换 = 替换当前页面 | `frontend/src/components/chat/ChatPage.vue:67-73, 230-239` |
| 子Agent 由 SSE 事件 `sub_agent_create` / `sub_agent_closed` 动态增删 | `ChatPage.vue:245-296, 732-733` |
| 侧边栏已有成熟统一标签体系（file/browser/git/terminal，拖拽/持久化/会话切换清理） | `frontend/src/stores/tab.ts`、`frontend/src/components/chat/workspace/WorkspaceSidebar.vue` |
| `UnifiedTab` 类型定义，无 agent 类型 | `frontend/src/composables/usePreviewTabCache.ts:6-28` |
| ChatPanel watch session.id 自动 `loadMessages`；消息在 sessionStore 按 sessionId 存取；SSE 按 sessionId 写入 → 侧边栏只读视图天然支持实时流 | `frontend/src/components/chat/ChatPanel.vue:631, 663` |
| `evictFileTab()` 只遍历 `type === 'file'`，agent 标签天然不参与 LRU | `frontend/src/stores/tab.ts:99-117` |
| `sessionsMap` 是唯一数据源且包含 sub_agent 会话（`sessionsList` 过滤视图反证） | `frontend/src/stores/session.ts:24, 150` |
| 死代码：`SessionAgentList.vue` 已 import 未使用；`AgentTabBar.vue` 全项目无引用 | `WorkspaceSidebar.vue:169` |
| 全屏浮动容器：Teleport + FloatingChatPanel，仅 MainLayout 一处引用 | `ChatPage.vue:69, 358-364`、`FloatingChatPanel.vue`、`MainLayout.vue:3` |

### 后端

| 事实 | 位置 |
|---|---|
| 关闭子Agent = **硬删会话** 后再广播事件 | `backend-ts/src/modules/sub-agent/sub-agent.manager.ts:570`（`sessionRepo.deleteById`） |
| 事件链：内部 `subagent.closed` → SSE `sub_agent_closed` | `sub-agent.manager.ts:573` → `modules/chat/session-events.service.ts:273-279` |
| 另有一处监听 `subagent.closed`（浏览器插件）需同步改名 | `modules/plugins/builtins/browser.plugin.ts:42` |
| Prisma `parentId` 关系**无 onDelete: Cascade**（schema 注释明确要求业务层手动处理） | `backend-ts/prisma/schema.prisma:56, 62-65` |
| 主会话 `deleteSession` 只删自身+消息级联，**不会删子会话** → 改为留存后必须补业务层级联 | `modules/chat/session.service.ts:434-445` |
| `sessionRepo.findByParentId(parentId)` 已存在，可直接用于级联 | `sub-agent.manager.ts:590` 附近使用 |
| Session 模型有 `archived` 字段、`@@index([parentId])` 已有 | `schema.prisma:57, 75` |

---

## 2. 后端改造：移除"关闭删除"概念

### 2.1 事件语义变更

```
旧：closeSubAgent → 删除会话 → emit "subagent.closed" → SSE "sub_agent_closed"
新：finishSubAgent →（不删数据）→ emit "subagent.finished" → SSE "sub_agent_finished"
    payload 增加 reason?: 'completed' | 'aborted' | 'error'
```

### 2.2 改动点

**A. `sub-agent.manager.ts`（核心，~20 行）**
1. `closeSubAgent()` 内（约 570 行）**删除** `await this.sessionRepo.deleteById(subSessionId)`。
2. 事件名 `subagent.closed` → `subagent.finished`，payload 增加 `reason`（从现有 finalize/notifyComplete 链路取终止原因，缺省 `'completed'`）。
3. 内存清理逻辑（`states` / `running` / `completers`，540-568 行）**原样保留** —— 运行态归内存，数据归数据库，二者彻底解耦。
4. 方法更名 `closeSubAgent` → `finishSubAgent`（内部调用点同步改）。

**B. `session-events.service.ts`（~6 行）**
- `@OnEvent("subagent.closed")` → `@OnEvent("subagent.finished")`，SSE 事件名 `sub_agent_closed` → `sub_agent_finished`。

**C. `browser.plugin.ts:42`（~1 行）**
- `@OnEvent("subagent.closed")` → `@OnEvent("subagent.finished")`。

**D. `session.service.ts deleteSession()` 补业务层级联（~10 行）**

```ts
// 删除主会话前，级联删除其全部子Agent会话
const children = await this.sessionRepo.findByParentId(sessionId);
for (const child of children) {
  if (child.sessionType === 'sub_agent') {
    await this.sessionRepo.deleteById(child.id);
  }
}
await this.sessionRepo.deleteById(sessionId);
```

- 走业务层而非 Prisma `onDelete: Cascade`，符合 schema 注释的既定约定（允许悬空引用、业务层手动处理），**零数据库迁移**。

**E. 存量孤儿数据清理（一次性，可选脚本）**
- 上线后执行一次：查出 `parentId` 指向不存在主会话的 `sub_agent` 会话并删除。当前架构下关闭即删所以存量应为 0，此步是防御性的。

### 2.3 不做的事

- ❌ 不加 Prisma schema 迁移（无字段变更、无关系变更）。
- ❌ 不做软删除字段（`deletedAt`）——记录要么在（可看），要么随主会话删掉，无中间态。
- ❌ 不实现 harness 的 continuable/冷恢复唤醒 —— 当前子Agent 是一次性任务型，但"会话永久留存"的架构已为将来续聊留了路。

---

## 3. 前端改造

### 3.1 砍掉全屏浮动容器（净删 ~450 行）

| 文件 | 操作 |
|---|---|
| `ChatPage.vue:69-83` | 去掉 `<Teleport to="#floating-chat">` 包裹，ChatPanel 直接渲染 |
| `ChatPage.vue:358-364` | 删除 `teleportDisabled` ref 及其 watch |
| `ChatPage.vue:739` | 保留 `workspaceFullscreen = false` 复位逻辑 |
| `FloatingChatPanel.vue` | **整文件删除**（400+ 行） |
| `MainLayout.vue:3, 35` | 移除引用 |
| `layoutStore.workspaceFullscreen` | **语义简化**：全屏 = pane1 收起（现有 `split-size: 0` 逻辑已天然支持），工作目录占满窗口；`toggleWorkspaceFullscreen` 按钮保留。与标签化方案互补——全屏工作区里同样能开 agent 标签看对话 |

### 3.2 tab store 扩展 agent 类型（~20 行）

**`usePreviewTabCache.ts` — UnifiedTab 增加：**
```ts
type: 'file' | 'browser' | 'git' | 'terminal' | 'agent' | 'newtab';
// agent
agentSessionId?: string;   // 子会话 ID
agentName?: string;        // 显示名
agentStatus?: 'running' | 'completed' | 'error';
agentAvatarUrl?: string;
```

**`tab.ts` 增加：**
```ts
function openAgentTab(agent: { sessionId: string; name: string; status: ...; avatarUrl?: string }): void {
  const key = `agent:${agent.sessionId}`;
  if (!tabs.value.some(t => t.key === key)) {
    tabs.value.push({ type: 'agent', key, agentSessionId: agent.sessionId, ... });
  }
  selectTab(key);
}
```

- LRU：**零代码** —— `evictFileTab` 只遍历 file 类型，天然不碰 agent 标签（约束 4 已满足）。
- 持久化：agent 标签随 `usePreviewTabCache` 按会话正常持久化，恢复时校验（见 3.6）。

### 3.3 新组件 AgentChatPanel（只读对话视图，无输入框）

一期直接复用 ChatPanel：

```vue
<ChatPanel :session="subSession" :readonly="true" :hide-header="true"
           :session-id="agentSessionId" :hide-input="true" />
```

- **无输入框**（新增 `hideInput` prop，~5 行）：ChatPanel 现有 `readonly` 只会把 ChatInput 变成只读占位条（`ChatInput.vue:45-48`），侧边栏场景应完全不渲染输入区。ChatPanel 内部 `<ChatInput v-if="!hideInput">` 即可，send/attachment 逻辑不受影响。
- **不传 `#aside` slot**（约束 2）——侧边栏视图无 OverviewPanel。
- 消息历史：ChatPanel watch session.id 自动 load；实时流：SSE 按 sessionId 写 sessionStore，自动续流。
- 注意：不传 `agent-tabs` props（不嵌套子Agent面板）。
- **与 DSH 对照**（调研结论）：DSH 侧边栏只放导航树（名称/类型/运行状态/token，无对话无输入框），子代理对话在主区域整页切换且**带输入框**（因其子代理 continuable、支持人续聊）。GuaDa 侧边栏标签只读方案与之兼容：未来若要支持子Agent 续聊，把 `hideInput` 关掉即可平滑升级，架构已预留（会话永久留存 + 流式写入）。
- 二期优化（可选）：抽出轻量只读消息视图（复用 `message-item` / `TurnItem` 渲染层），避免 1316 行重组件进侧边栏。**不阻塞一期上线**。

### 3.4 WorkspaceSidebar 渲染分支（~50 行）

1. **标签栏**：`tab.type === 'agent'` 分支 —— 显示头像（有则用）或运行状态点（running 转圈 / completed 绿点 / error 红点，沿用 AgentTabBar 的视觉语言）+ 名称 + 关闭按钮。
2. **内容区**：
```vue
<template v-for="tab in agentTabs" :key="tab.key">
  <AgentChatPanel v-show="activeTabKey === tab.key"
    :agent-session-id="tab.agentSessionId" :tab="tab"
    @close="closeTab(tab)" />
</template>
```
   参照 file 标签的 v-show 保活模式（保留 DOM/滚动位置）。
3. **closeTab**：仅 `tabStore.removeTab(key)`，**不调用任何子Agent 关闭接口**（约束 3）。后端已无关闭删除概念，全链路一致。
4. 右侧目录树显隐条件不变（仅 file 标签显示），agent 标签激活时全宽显示对话。

### 3.5 ChatPage 改道 + 事件处理（~60 行改动 + ~80 行删除）

1. **点击改道**：AgentPanel 的 `@switch-agent` 处理从 `switchTab()` 改为 `tabStore.openAgentTab(...)`；`switchTab` / `closeSubAgentTab` / `panelSession` 的子会话分支 / `readonly` / `hide-header` 动态 props 一并删除——主对话恒定渲染 `mainSession`。
2. **`handleSubAgentCreate`**：保留 agentTabs/subSessions 维护（供列表与校验），追加调用 `openAgentTab`（是否自动打开标签可配置，默认**不自动**打开，避免打扰——用户点列表时才开）。
3. **`handleSubAgentClosed` → `handleSubAgentFinished`**：监听 `sub_agent_finished`，**不移除 tab**，仅更新 `agentStatus = reason === 'error' ? 'error' : 'completed'`；标签若打开则自动转为历史只读态（本就只读，无需操作）。
4. `ChatOutline` 显隐条件 `activeTabId === 'main'` 删除（恒显示）。

### 3.6 持久化恢复的本地校验（~15 行，零 API）

`usePreviewTabCache` 恢复标签列表时：

```ts
tabs = savedTabs.filter(t => {
  if (t.type !== 'agent') return true;
  const s = sessionStore.sessionsMap.get(t.agentSessionId!);
  return !!s && s.sessionType === 'sub_agent';   // 主会话已被级联删除 → Map 里查不到 → 丢弃
});
```

- 依据：`sessionsMap` 包含 sub_agent 会话；主会话删除时后端已级联删除子会话，下次拉取会话列表后 Map 中不存在 → 标签静默失效。
- 边界：应用刚启动、会话列表尚未拉完时，先不过滤、延迟到列表就绪后再校验（恢复流程本身在列表加载后执行，现有时序已满足）。

---

## 4. 实施顺序（3 个独立可回滚的阶段）

### 阶段 1：后端生命周期重构（~0.5 天）
1. `subagent.closed` → `subagent.finished`（manager + session-events + browser.plugin 三处）+ 取消删除。
2. `deleteSession` 业务层级联。
3. 回归：子Agent 正常结束 / 中断 / 出错三种路径；主会话删除后确认子会话与消息清空。

### 阶段 2：前端标签化核心（~1~1.5 天）
1. 砍浮动容器（独立提交，先回滚包）。
2. tab store 扩展 + AgentChatPanel + WorkspaceSidebar 渲染 + ChatPage 改道。
3. 回归：点击子Agent 开标签、实时流、多标签并存、关标签后可重开（列表入口）、切会话标签清空、刷新后标签恢复与失效校验。

### 阶段 3：体验完善（~0.5~1 天，可选）
1. 激活死代码 `SessionAgentList`：工作目录侧边栏内嵌子Agent列表（运行状态指示），点击开标签。
2. 删除 `AgentTabBar.vue` 死代码。
3. 二期轻量只读视图（如 ChatPanel 复用无性能问题则无限期推迟）。

---

## 5. 风险与对策

| 风险 | 对策 |
|---|---|
| ChatPanel 双实例（主面板 + 侧边栏）输入框/aside 槽位冲突 | 侧边栏实例 readonly + 无 aside + 无 agent-tabs；一期验证，有问题立即走二期轻量视图 |
| 旧版前端连新后端：收到未知事件 `sub_agent_finished` | 旧前端仅是不处理（子Agent tab 不再自动移除），无崩溃风险；前后端同仓同发版，影响窗口极短 |
| 标签恢复时子会话尚在但主会话已删 | 不可能：级联保证子会话先于/随主会话删除；Map 校验兜底 |
| 全屏按钮语义变化引起用户困惑 | 全屏 = 工作目录占满 + agent 标签可看对话，功能不减反增；changelog 说明 |
| states 内存清理与"不删数据"不一致 | 刻意为之：运行态归内存、数据归库，`getSubAgents` 已支持"从 DB 读已完成列表"（重启后恢复），语义自洽 |

---

## 6. 工作量汇总

| 模块 | 改动 | 量级 |
|---|---|---|
| 后端生命周期 | 4 文件，净减 1 行删除 + ~35 行 | 0.5 天 |
| 砍浮动容器 | 3 文件，净删 ~450 行 | 0.5 小时 |
| tab store 扩展 | 2 文件，~20 行 | 0.5 小时 |
| AgentChatPanel | 新文件（一期复用）| ~80 行 |
| WorkspaceSidebar | ~50 行 | 0.5 天（含视觉细节） |
| ChatPage 改道 | ~60 行改 + ~80 行删 | 0.5 天 |
| 持久化校验 | ~15 行 | 0.5 小时 |
| **合计** | **后端 4 文件 + 前端 8 文件，前后端合计净代码量约持平（删 450+，增 250~400）** | **~2.5~3.5 天** |

无数据库迁移，无新 API，无性能敏感改动。
