# 定时任务管理

Agent 按配置周期自动执行对话任务，支持 Cron 表达式与固定间隔两种调度方式。

## 架构

```
scheduler.module.ts
├── scheduler.controller.ts   → REST API（CRUD + 手动触发）
├── scheduler.service.ts      → 业务逻辑层
├── task-storage.service.ts   → 任务持久化（数据库）
├── task-scheduler.service.ts → Cron 调度引擎
├── task-executor.service.ts  → 任务执行器
├── scheduler-tool.provider.ts→ Agent 工具接口
└── types/
    └── scheduler.types.ts    → 类型定义
```

### 执行流程

```
API 请求创建任务
    ↓
scheduler.service.createTask()
    ├─ 生成任务 ID + 校验配置
    └─ task-storage.service 持久化
            ↓
task-scheduler.service 注册到调度引擎
    ├─ Cron 表达式 → node-schedule
    └─ 固定间隔 → setInterval
            ↓
到达触发时间
    ↓
task-executor.service.executeTask()
    ├─ 1. 查找/创建会话（绑定角色、继承配置）
    ├─ 2. 构建用户消息（角色描述 + 任务提示词）
    ├─ 3. 调用 ChatRunnerService.startStream() 启动 Agent
    └─ 4. 记录执行日志
```

## 核心能力

| 能力 | 说明 |
|------|------|
| **Cron 调度** | 标准 5 位 Cron 语法，如 `0 9 * * 1`（每周一 9:00） |
| **固定间隔** | 按分钟/小时/天为单位的循环执行 |
| **角色绑定** | 可绑定特定角色，复用角色提示词、工具权限和模型参数 |
| **会话隔离** | 每个定时任务拥有独立会话上下文，避免与人工对话冲突 |
| **执行记录** | 完整记录每次执行结果与日志，可追溯历史 |
| **手动测试** | 支持立即执行一次测试（`testTask`），验证任务配置 |
| **启用/停用** | 动态控制任务执行，无需删除 |
| **Cron 预设** | 内置常用 Cron 表达式预设，快速选择 |

## 任务配置

```typescript
interface CreateTaskDto {
  name: string;               // 任务名称
  prompt: string;             // 任务提示词（发给 Agent 的指令）
  scheduleType: 'cron' | 'interval';
  cronExpression?: string;    // Cron 表达式
  intervalMinutes?: number;   // 间隔分钟数
  characterId?: string;       // 绑定角色 ID（可选）
  enabled: boolean;           // 是否启用
}
```

## 场景示例

| 场景 | 配置 |
|------|------|
| **每日资讯摘要** | Cron `0 8 * * *`，绑定运营角色，抓取并总结最新资讯 |
| **竞品监控** | 间隔每 2 小时，绑定浏览器工具 Agent，截图分析竞品页面 |
| **每周报表** | Cron `0 10 * * 1`，绑定数据分析角色，自动生成周报 |
| **定时清理** | Cron `0 0 * * 0`，执行维护脚本，清理临时文件 |

## 执行记录

每次执行后自动记录：
- 执行时间、状态（成功/失败）
- 输出内容摘要
- 错误信息（如有）
- 消耗 Token 数

可通过 API 查询历史执行记录，用于审计与排查。
