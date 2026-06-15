# 子 Agent 系统

子 Agent 系统实现了 **分层 Agent 体系**：主 Agent 可将复杂任务拆解并委派给子 Agent 独立执行，子 Agent 拥有专属的会话上下文、工具权限和模型配置，执行结果自动归集回主 Agent。

## 架构

```
SubAgentManager
├── spawn()               → 创建子 Agent + 启动执行
│   ├── foreground 模式   → 阻塞等待，直接返回结果
│   └── background 模式   → 后台执行，通过事件广播通知
├── sendMessage()         → 向已存在的子 Agent 发送消息
├── waitForComplete()     → 等待子 Agent 完成（可超时/中断）
├── closeSubAgent()       → 关闭子 Agent 会话
├── getSubAgents()        → 查询父会话下的所有子 Agent
└── 事件监听
    ├── stream.finished   → 自动完成归集
    └── eventBus 广播     → subagent.created / subagent.finished
```

## 工作流程

### 创建子 Agent `spawn()`

```
spawn({ parentSessionId, userId, name, task, characterId? }, mode)
    │
    ├─ 1. 获取父会话信息（继承配置）
    ├─ 2. 限制检查（最多 10 个子 Agent）
    ├─ 3. 继承工具配置（角色工具 > 父会话工具）
    ├─ 4. 角色驱动配置
    │   ├─ characterId 存在 → 继承角色设定（systemPrompt、tools、modelId）
    │   └─ characterId 不存在 → 使用 SUB_AGENT_DEFAULT_PROMPT
    ├─ 5. 创建子会话记录 (sessionType = "sub_agent")
    ├─ 6. 广播 subagent.created 事件
    └─ 7. 执行子 Agent 流 → 返回 SubAgentResult
```

### 子 Agent 执行 `executeSubAgentStream()`

1. 通过 `ChatRunnerService.startStream()` 启动独立的 Agent 流
2. 监听流事件，实时广播 `sub_agent_event` 给前端
3. 流结束后自动调用 `notifyComplete()` 归集结果
4. 后台模式：通过 `eventBus.emit("subagent.finished")` 广播
5. 前台模式：通过 `completer.resolve()` 返回给等待方

### 等待完成 `waitForComplete()`

```
waitForComplete(parentSessionId, { timeout?, abortSignal? })
    │
    ├─ 检查是否已有完成的子 Agent → 立即返回
    ├─ 注册 completer（带超时定时器）
    ├─ 等待 resolve / reject
    └─ 超时 → reject("等待子Agent完成超时")
```

## 默认子 Agent 提示词

当子 Agent 没有绑定角色时，使用内置默认提示词，核心要点：
- **核心职责**：专注于分配的任务，使用工具收集信息、处理数据
- **行为准则**：主动使用工具，分解复杂问题，完成后给出简洁总结
- **注意事项**：工具权限由主 Agent 分配，工作目录与主 Agent 共享

## 继承与覆盖策略

| 配置 | 继承来源 | 可覆盖 |
|------|----------|--------|
| systemPrompt | 角色设定 > 默认提示词 | ✅ characterId |
| tools | 角色工具 > 父会话工具 | ✅ 创建时指定 |
| mcpServers | 角色 MCP > 父会话 MCP | ✅ 创建时指定 |
| modelId | 角色模型 > 父会话模型 | ✅ characterId |
| workspacePath | 父会话 | ❌ 固定继承 |

## 状态管理

`ParentSessionState` 维护以下状态：

```typescript
interface ParentSessionState {
  completed: { subSessionId: string; name: string; result: SubAgentResult }[];
  completers: SubAgentCompleter[];
}
```

运行状态不通过内存 Map 维护，改为实时查询 `SessionStreamManager` 的活跃流状态。这样即使子 Agent 由用户直接交互启动（非 spawn 创建），也能准确感知其运行状态。

## 关键特性

| 特性 | 说明 |
|------|------|
| **独立会话** | 每个子 Agent 专属上下文，与主 Agent 完全隔离 |
| **错误隔离** | 子 Agent 失败不影响主 Agent 流程，错误信息可被感知 |
| **结果归集** | 自动 Markdown 格式化摘要并注入主 Agent |
| **树形追踪** | 通过 `parentId` 建立会话树，支持多层嵌套 |
| **数量限制** | 每个父会话最多 10 个子 Agent |
| **历史导出** | 流结束后自动导出子 Agent 对话历史为 Markdown 文件 |
