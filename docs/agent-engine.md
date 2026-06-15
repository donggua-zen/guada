# Agent 引擎

Agent 引擎是 GuaDa 的核心，实现 **ReAct (Reasoning + Acting) 模式** 的多轮自治循环，统一处理来自 Web、桌面端和 IM 平台的所有对话请求。

## 整体架构

```
用户消息
    ↓
ChatRunnerService (对话运行器)
    ├── 会话队列管理 (enqueueMessage / processQueue)
    ├── 流状态管理 (SessionStreamManager)
    └── 事件广播 (StreamStarted / StreamFinished)
            ↓
AgentEngine.run() (主入口，会话锁保护)
            ↓
executeAgentLoop() (ReAct 循环)
    ├── executeLLMStream() → LLM 推理
    ├── buildYieldEvent()  → 构建 SSE 事件
    ├── 工具执行 (approvedTools)
    ├── 审批流程 (pendingTools → approval_required)
    └── 持久化 (appendParts → persist)
```

## 执行流程

### 主入口 `run()`

1. **会话锁检查**：通过 `SessionStreamManager` 确保同一会话同一时间只有一个流在运行
2. **请求上下文注入**：将 `abortSignal`、`sessionId`、`requestId` 注入 `RequestContext`
3. **委托执行**：调用 `executeAgentLoop()` 进入 ReAct 循环

### ReAct 循环 `executeAgentLoop()`

```
do {
    1. 加载历史消息 (getMessages)
    2. 创建/更新助手消息容器
    3. LLM 流式推理 (executeLLMStream)
       ├── 实时产出 text / think / tool_call 事件
       └── 累加完整响应 (accumulatedChunk)
    4. 检查工具调用
       ├── 无工具调用 → finish，退出循环
       ├── 有工具调用 → 执行工具
       │   ├── classifyToolsByApproval → 审批分类
       │   ├── 待审批工具 → yield approval_required，暂停
       │   └── 通过/无需审批工具 → executeBatch 执行
       └── 工具结果注入消息列表 → 继续下一轮
    5. 持久化 (appendParts)
} while (needToContinue)
```

## 关键机制

### 会话锁 (Session Lock)

基于内存 `Map<string, boolean>` 的排他锁，同一会话 ID 同时仅处理一个请求。锁在 `executeAgentLoop` 开始时获取，结束后释放，防止并发冲突。

### 流式传输 (SSE)

通过 `AsyncGenerator<EventChunk>` 逐块产出事件，前端实时渲染：

| 事件类型 | 触发时机 | 包含数据 |
|----------|----------|----------|
| `create` | 新对话轮次开始 | messageId, contentId, turnsId |
| `update` | 断点恢复模式 | messageId, contentId |
| `text` | LLM 产出文本内容 | content（流式累加） |
| `think` | LLM 产出推理内容 | reasoningContent |
| `tool_call` | LLM 调用工具 | toolCalls（含参数和展示文案） |
| `tool_calls_response` | 工具执行完毕 | toolCallsResponse |
| `finish` | 本轮结束 | finishReason, usage |

### 中断处理

`AbortSignal` 向下传递至 LLM 请求层和工具执行层：
- 客户端断开连接时自动中止 LLM 流式请求，避免浪费 Token
- 工具执行过程中断时抛出 `AbortError`，走异常处理流程
- 支持 `user_abort`、`timeout`、`error` 三种 finishReason 区分

### 再生模式

| 模式 | 行为 | 适用场景 |
|------|------|----------|
| `overwrite` | 用新回复覆盖旧回复（默认） | 常规重新生成 |
| `multi_version` | 保留旧版本，创建新版本 | 对比不同回复 |
| `resume` | 从中断点继续执行 | 审批续传、断点恢复 |

### 工具审批流程

敏感工具可配置审批，执行前触发审批请求：

```
LLM 返回工具调用
    ↓
classifyToolsByApproval()
    ├── 已审批工具 → 直接执行
    ├── 被拒工具   → 生成错误响应（含拒绝原因）
    └── 待审批工具 → yield finish(approval_required) → 等待前端审批
                                                ↓
                                          resume 续传
                                                ↓
                                    继续执行被批准的工具
```

审批上下文存储在 `metadata.approvalContext` 中，包含 `status`、`pendingToolCallIds`、`decisions` 等字段，持久化到数据库，刷新页面后仍可继续审批。

### 思考追踪

记录推理开始/结束时间戳，计算思维链耗时 `thinkingDurationMs`，存储于消息元数据中。用于前端实时展示推理时长。

## 配置继承

| 配置项 | 优先级 |
|--------|--------|
| systemPrompt | 会话设置 > 角色设置 > 空字符串 |
| tools / mcpServers | 会话设置 > 角色设置 |
| modelId | 角色模型 > 父会话模型 |
| temperature/topP 等 | 仅从角色设置读取 |
| thinkingEffort | 仅从会话设置读取 |
