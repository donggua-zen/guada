# 定时任务模块 API 文档

## 接口概览

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/v1/scheduler/tasks | 获取任务列表 |
| GET | /api/v1/scheduler/cron-presets | 获取 Cron 预设 |
| POST | /api/v1/scheduler/tasks | 创建任务 |
| GET | /api/v1/scheduler/tasks/:id | 获取任务详情 |
| PUT | /api/v1/scheduler/tasks/:id | 更新任务 |
| DELETE | /api/v1/scheduler/tasks/:id | 删除任务 |
| POST | /api/v1/scheduler/tasks/:id/toggle | 切换启用状态 |
| POST | /api/v1/scheduler/tasks/:id/run | 手动触发执行 |
| POST | /api/v1/scheduler/tasks/:id/test | 测试触发执行（无副作用） |
| GET | /api/v1/scheduler/tasks/:id/logs | 获取执行日志 |

所有接口需要携带认证 Token（AuthGuard）。

---

## 数据类型

### ScheduledTask

```typescript
interface ScheduledTask {
  id: string;
  userId: string;
  name: string;
  prompt: string;
  scheduleType: "cron" | "once";     // 调度类型
  cronExpression: string;             // cron 表达式（cron 类型时使用）
  executeAt?: string | null;          // 定点执行时间 ISO 字符串（once 类型时使用）
  targetMode: "new_session" | "existing_session";
  targetSessionId?: string | null;
  characterId?: string | null;
  modelId?: string | null;
  settings?: Record<string, any> | null;
  enabled: boolean;
  maxExecutions?: number | null;  // 最大执行次数，null 表示无限
  executionCount?: number;        // 已执行次数
  maxRetries?: number;            // 最大重试次数，默认 0
  retryInterval?: number;         // 重试间隔（秒），默认 60
  lastRunAt?: string | null;
  nextRunAt?: string | null;
  createdAt: string;
  updatedAt: string;
}
```

### ScheduledTaskLog

```typescript
interface ScheduledTaskLog {
  id: string;
  taskId: string;
  sessionId?: string | null;
  status: "pending" | "running" | "completed" | "failed";
  error?: string | null;
  startedAt: string;
  finishedAt?: string | null;
}
```

---

## 接口详情

### GET /api/v1/scheduler/tasks

获取当前用户的所有定时任务。

**响应**

```json
{
  "items": [ScheduledTask],
  "total": number
}
```

---

### GET /api/v1/scheduler/cron-presets

获取预设的 cron 表达式列表，供前端选择。

**响应**

```json
[
  { "label": "每分钟", "value": "* * * * *" },
  { "label": "每5分钟", "value": "*/5 * * * *" },
  { "label": "每15分钟", "value": "*/15 * * * *" },
  { "label": "每小时", "value": "0 * * * *" },
  { "label": "每天", "value": "0 0 * * *" },
  { "label": "每周", "value": "0 0 * * 0" },
  { "label": "每月", "value": "0 0 1 * *" }
]
```

---

### POST /api/v1/scheduler/tasks

创建定时任务。

**请求体**

```typescript
{
  name: string;
  prompt: string;
  scheduleType: "cron" | "once";
  cronExpression?: string;  // scheduleType 为 cron 时必填
  executeAt?: string;       // scheduleType 为 once 时必填，ISO 8601 格式
  targetMode: "new_session" | "existing_session";
  targetSessionId?: string;
  characterId?: string;
  modelId?: string;
  settings?: Record<string, any>;
  enabled?: boolean;
  maxExecutions?: number;
  maxRetries?: number;
  retryInterval?: number;
}
```

**响应**

```json
ScheduledTask
```

---

### GET /api/v1/scheduler/tasks/:id

获取单个任务详情。

**响应**

```json
ScheduledTask
```

---

### PUT /api/v1/scheduler/tasks/:id

更新定时任务。所有字段可选，只更新传入的字段。

**请求体**

```typescript
{
  name?: string;
  prompt?: string;
  scheduleType?: "cron" | "once";
  cronExpression?: string;
  executeAt?: string | null;
  targetMode?: "new_session" | "existing_session";
  targetSessionId?: string | null;
  characterId?: string | null;
  modelId?: string | null;
  settings?: Record<string, any> | null;
  enabled?: boolean;
  maxExecutions?: number;
  maxRetries?: number;
  retryInterval?: number;
}
```

**响应**

```json
ScheduledTask
```

---

### DELETE /api/v1/scheduler/tasks/:id

删除定时任务。

**响应**

HTTP 204 No Content

---

### POST /api/v1/scheduler/tasks/:id/toggle

切换任务的启用/禁用状态。

**响应**

```json
ScheduledTask
```

---

### POST /api/v1/scheduler/tasks/:id/run

手动立即触发任务执行。

**响应**

```json
{
  "success": true,
  "message": "任务已触发"
}
```

---

### POST /api/v1/scheduler/tasks/:id/test

测试触发任务执行。与 `run` 接口的区别是：**无任何副作用**。

**特性：**
- 失败不重试
- 不增加 `executionCount`
- 不自动禁用任务（不受 `maxExecutions` 影响）
- 不更新 `lastRunAt`
- 不创建执行日志
- 仅执行任务本身的对话逻辑

**适用场景：**
- 验证任务配置是否正确
- 测试提示词效果
- 调试任务执行流程

**响应**

```json
{
  "success": true,
  "message": "测试执行完成"
}
```

---

### GET /api/v1/scheduler/tasks/:id/logs

获取任务的执行日志。

**响应**

```json
{
  "items": [ScheduledTaskLog],
  "total": number
}
```

---

## 前端开发指南

### 页面结构建议

```
/scheduler                    # 定时任务管理页
  ├── 任务列表表格
  ├── 新建/编辑任务弹窗
  ├── Cron 表达式选择器
  └── 执行日志抽屉
```

### 核心交互流程

1. **创建任务**
   - 用户填写名称、提示词、cron 表达式
   - 选择执行模式：新建会话 / 注入已有会话
   - 提交后任务进入调度队列

2. **任务执行**
   - 到达 cron 设定时间自动触发
   - 也可手动点击「立即执行」
   - 执行过程通过 SSE 广播，前端可实时查看

3. **查看日志**
   - 点击任务行的「日志」按钮
   - 展开抽屉显示该任务的历史执行记录

### 调度类型

支持两种调度方式：

**1. cron — 周期性执行**

使用 cron 表达式定义执行周期，任务按周期重复执行。

```json
{
  "scheduleType": "cron",
  "cronExpression": "0 9 * * *",
  "executeAt": null
}
```

**2. once — 一次性定点执行**

指定具体的执行时间，到达时间后执行一次，然后自动禁用。

```json
{
  "scheduleType": "once",
  "cronExpression": "",
  "executeAt": "2026-05-25T14:30:00.000Z"
}
```

- `executeAt` 必须是未来的有效时间
- 执行完成后任务自动设置为 `enabled: false`
- 适合预约某个具体时间的任务

### 最大执行次数

设置 `maxExecutions` 可以限制任务的总执行次数：

- `maxExecutions: null` 或未设置 — 任务无限次执行（按 cron 周期持续运行）
- `maxExecutions: 1` — 任务只执行一次，执行完成后自动禁用
- `maxExecutions: 5` — 任务最多执行 5 次，达到后自动禁用

每次执行成功（包括流启动成功）后，`executionCount` 自动 +1。达到 `maxExecutions` 时任务自动设置为 `enabled: false`，不再继续调度。

### 重试机制

任务执行失败时，如果是以下可重试的错误，会自动按配置重试：

- `SESSION_BUSY` — 会话正在处理其他请求
- `STREAM_START_FAILED` — 启动流失败
- `SUBSCRIBE_FAILED` — 订阅流失败

重试配置：
- `maxRetries`: 最大重试次数（默认 0，表示不重试）
- `retryInterval`: 每次重试间隔秒数（默认 60 秒）

不可重试的错误（如会话不存在、缺少消息内容等）会直接标记为失败。

---

### 注意事项

- `targetMode` 为 `existing_session` 时，`targetSessionId` 必填
- `cronExpression` 使用标准 cron 格式（5 位：分 时 日 月 周）
- 任务执行时会自动创建用户消息并启动 AI 流式回复
- 执行日志保留最近 200 条，超出自动清理
- 建议为一次性任务设置 `maxExecutions: 1`，避免手动清理
- 达到 `maxExecutions` 后任务自动禁用，不会删除，可手动重新启用
