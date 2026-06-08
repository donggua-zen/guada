# 断点续传机制 - 集成测试指南

## 概述

本文档说明如何测试断点续传机制（Resume Mode）的完整功能，包括工具审批、表单交互等场景。

## 核心概念

### 1. 断点模式（Resume Mode）

新增的 `regenerationMode: 'resume'` 用于从断点处继续执行，支持以下场景：
- **工具审批**：用户批准/拒绝工具调用后继续执行
- **表单交互**：用户填写表单后继续处理
- **错误重试**：网络错误后点击继续
- **工具限流**：超出限制后用户确认继续

### 2. ResumeContext 数据结构

存储在 `MessageContent.metadata.resumeContext` 中：

```typescript
interface ResumeContext {
  type: 'approval' | 'form' | 'error_retry' | 'tool_limit';
  status: 'pending' | 'completed';
  token?: string;  // 验证令牌（可选）
  data?: any;      // 断点相关数据
  createdAt?: string;
  completedAt?: string;
}
```

## API 接口

### 1. 流式对话接口

**端点**: `POST /api/chat/completions` 或 `POST /api/chat/stream`

**请求体**:
```json
{
  "sessionId": "session_123",
  "messageId": "msg_user_001",
  "regenerationMode": "resume",  // 断点模式
  "resumeData": {
    "token": "resume_1234567890_abc",
    "decisions": [
      {
        "toolCallId": "call_001",
        "decision": "approve",
        "reason": "允许读取文件"
      },
      {
        "toolCallId": "call_002",
        "decision": "reject",
        "reason": "不允许执行命令"
      }
    ]
  }
}
```

**响应事件**:
- 首次迭代：`update` 事件（更新现有助手消息）
- 后续迭代：`create` 事件（创建新内容）
- 工具审批请求：`tool_approval_request` 事件

## 测试场景

### 场景 1: 工具审批 - 单个工具

#### 步骤 1: 触发工具调用

```bash
curl -X POST http://localhost:3000/api/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "sessionId": "test_session_001",
    "messageId": "msg_user_001",
    "regenerationMode": "overwrite"
  }'
```

**预期响应**:
```json
{
  "type": "tool_approval_request",
  "toolCalls": [
    {
      "id": "call_001",
      "name": "file__read",
      "arguments": { "path": "/test.txt" },
      "displayMessage": "正在读取文件 /test.txt..."
    }
  ],
  "resumeToken": "resume_1234567890_abc",
  "finishReason": "resume_required"
}
```

#### 步骤 2: 用户批准后继续

```bash
curl -X POST http://localhost:3000/api/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "sessionId": "test_session_001",
    "messageId": "msg_user_001",
    "regenerationMode": "resume",
    "resumeData": {
      "token": "resume_1234567890_abc",
      "decisions": [
        {
          "toolCallId": "call_001",
          "decision": "approve"
        }
      ]
    }
  }'
```

**预期行为**:
1. 跳过 LLM 调用
2. 从历史消息恢复 `assistantResponse`
3. 执行批准的工具（`file__read`）
4. 更新 `resumeContext.status` 为 `completed`
5. 继续正常的 Agent 循环

### 场景 2: 工具审批 - 多个工具混合决策

#### 步骤 1: 触发多个工具调用

假设 LLM 返回两个工具调用：
- `file__read`（需要审批）
- `web__search`（不需要审批）

**预期响应**:
```json
{
  "type": "tool_approval_request",
  "toolCalls": [
    {
      "id": "call_001",
      "name": "file__read",
      "arguments": { "path": "/secret.txt" }
    },
    {
      "id": "call_002",
      "name": "exec__run",
      "arguments": { "command": "ls -la" }
    }
  ],
  "resumeToken": "resume_1234567890_xyz",
  "finishReason": "resume_required"
}
```

#### 步骤 2: 部分批准，部分拒绝

```bash
curl -X POST http://localhost:3000/api/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "sessionId": "test_session_001",
    "messageId": "msg_user_001",
    "regenerationMode": "resume",
    "resumeData": {
      "token": "resume_1234567890_xyz",
      "decisions": [
        {
          "toolCallId": "call_001",
          "decision": "approve",
          "reason": "允许读取"
        },
        {
          "toolCallId": "call_002",
          "decision": "reject",
          "reason": "不允许执行命令"
        }
      ]
    }
  }'
```

**预期行为**:
1. 只执行 `call_001`（file__read）
2. `call_002`（exec__run）被跳过，返回错误信息
3. 工具响应中包含拒绝的原因

### 场景 3: Token 验证失败

#### 测试无效 Token

```bash
curl -X POST http://localhost:3000/api/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "sessionId": "test_session_001",
    "messageId": "msg_user_001",
    "regenerationMode": "resume",
    "resumeData": {
      "token": "resume_invalid_token",
      "decisions": []
    }
  }'
```

**预期响应**: HTTP 400 错误
```json
{
  "statusCode": 400,
  "message": "Invalid resume token"
}
```

### 场景 4: 缺少 ResumeContext

#### 测试无断点上下文的情况

```bash
curl -X POST http://localhost:3000/api/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "sessionId": "test_session_001",
    "messageId": "msg_user_001",
    "regenerationMode": "resume",
    "resumeData": {
      "decisions": []
    }
  }'
```

**预期响应**: HTTP 400 错误
```json
{
  "statusCode": 400,
  "message": "No pending resume context found"
}
```

## 数据库验证

### 检查 Metadata 存储

```sql
-- 查看包含 resumeContext 的消息
SELECT 
  id,
  role,
  content,
  metadata
FROM messages
WHERE metadata->>'resumeContext' IS NOT NULL
ORDER BY created_at DESC
LIMIT 10;
```

### 验证审批状态更新

```sql
-- 查看已完成的审批
SELECT 
  id,
  metadata->'resumeContext'->>'type' as type,
  metadata->'resumeContext'->>'status' as status,
  metadata->'resumeContext'->'data'->'approvalDecisions' as decisions,
  metadata->'resumeContext'->>'completedAt' as completed_at
FROM messages
WHERE metadata->'resumeContext'->>'status' = 'completed'
ORDER BY created_at DESC;
```

## 日志验证

### 关键日志点

1. **断点恢复开始**:
   ```
   Resuming from breakpoint for session
   ```

2. **断点类型**:
   ```
   Resumed from breakpoint, type: approval
   ```

3. **工具执行**:
   ```
   Executing approved tools: [tool names]
   ```

4. **审批完成**:
   ```
   Approval completed, status updated to completed
   ```

## 前端集成要点

### 1. 处理 tool_approval_request 事件

```typescript
if (event.type === 'tool_approval_request') {
  // 显示审批 UI
  showApprovalDialog(event.toolCalls, event.resumeToken);
  
  // 等待用户决策
  const decisions = await waitForUserDecision();
  
  // 携带决策重新发起请求
  streamResponse({
    sessionId,
    messageId,
    regenerationMode: 'resume',
    resumeData: {
      token: event.resumeToken,
      decisions,
    },
  });
}
```

### 2. 区分 create 和 update 事件

```typescript
if (event.type === 'create') {
  // 创建新的助手消息
  addAssistantMessage(event);
} else if (event.type === 'update') {
  // 更新现有助手消息（断点模式）
  updateAssistantMessage(event);
}
```

## 性能测试

### 并发场景

测试多个会话同时进行审批操作：

```bash
# 会话 1
curl -X POST http://localhost:3000/api/chat/completions \
  -d '{"sessionId": "session_001", ..., "regenerationMode": "resume", ...}'

# 会话 2（同时）
curl -X POST http://localhost:3000/api/chat/completions \
  -d '{"sessionId": "session_002", ..., "regenerationMode": "resume", ...}'
```

**验证点**:
- 每个会话的 resumeContext 独立存储
- Token 不会冲突
- 审批决策不会混淆

## 边界情况测试

### 1. 超时处理

如果用户在审批请求后长时间不响应：
- ResumeContext 应保持 `pending` 状态
- 下次请求时仍可使用相同的 token

### 2. 重复审批

如果用户多次提交相同的审批决策：
- 第二次请求应检测到 `status === 'completed'`
- 返回错误或忽略重复请求

### 3. 会话中断

如果在审批过程中会话被关闭：
- ResumeContext 应保留在数据库中
- 用户重新打开会话后可继续审批

## 扩展场景

### 表单交互示例

```typescript
// LLM 返回需要用户填写表单
{
  type: 'form_request',
  formFields: [
    { name: 'email', type: 'email', required: true },
    { name: 'phone', type: 'tel', required: false },
  ],
  resumeToken: 'resume_form_123',
  finishReason: 'resume_required'
}

// 用户填写后继续
{
  regenerationMode: 'resume',
  resumeData: {
    token: 'resume_form_123',
    formData: {
      email: 'user@example.com',
      phone: '1234567890',
    }
  }
}
```

### 错误重试示例

```typescript
// 网络错误后提示用户重试
{
  type: 'error_retry_request',
  error: 'Connection timeout',
  resumeToken: 'resume_retry_456',
  finishReason: 'resume_required'
}

// 用户点击继续
{
  regenerationMode: 'resume',
  resumeData: {
    token: 'resume_retry_456',
    action: 'retry'
  }
}
```

## 总结

断点续传机制提供了一个通用的中断-恢复框架，可以适配多种交互场景。通过统一的 `ResumeContext` 数据结构和 `regenerationMode: 'resume'` 模式，实现了：

1. **最小侵入**：只在必要位置添加判断逻辑
2. **最大复用**：完全利用现有的 Agent 循环架构
3. **通用性强**：支持审批、表单、重试等多种场景
4. **扩展性好**：新增场景只需添加新的 `type`
