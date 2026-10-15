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

## 错过窗口（电脑休眠 / 应用未运行）

计划时刻到了任务却没跑，只可能是三种情况：进程没活着、事件循环被长时间阻塞、电脑睡了。三种都会留下可查的记录，且**一律不补跑**。

**策略**

- **宽限 5 分钟**：计划时刻迟到不超过 5 分钟照常补跑（短暂休眠唤醒、GC 卡顿都属此类）；超过即判为错过。判定交给 node-cron 的 `missedExecutionTolerance`，且补跑上限还会被槽位间隔进一步压住——「每分钟」任务最多晚 1 分钟补跑，不会漏几拍后连跑多次。
- **不补跑**：醒来后立刻执行一个几小时前该跑的任务通常已无意义，只留痕，是否补由用户手动「立即执行」决定。

**留痕的三条路径**（[`task-scheduler.service.ts`](../backend-ts/src/modules/scheduler/task-scheduler.service.ts)）

| 场景 | 触发点 | 记录 |
|------|--------|------|
| 运行期错过（休眠/挂起/阻塞） | node-cron `execution:missed` | 同一突发（2s 窗口）内的多个槽位合并为一条 `missed` 日志，含次数与首末时刻 |
| 应用没开（关机/退出/强退） | 启动时按 `nextRunAt` 对账 | 用 cron-parser 数出错过次数，记一条 `missed` |
| 一次性任务时刻已过 | 启动时 `delay <= 0` | 记一条 `missed` 并把任务停用（错过即终态） |

**不误报的前提**：`nextRunAt` 在**每次派发尝试后**都会推进（成功、失败、被重叠守卫挡下都算）。它表示「下一个待派发的槽位」，不是「上次成功时间」——否则执行失败过的任务会在下次启动时被当成错过。

**界面**：定时任务 → 执行历史中状态显示为「已错过」（琥珀色圆点），原因写在记录里，例如「错过 12 次计划执行（2026-10-15 08:00 ~ 09:00）：电脑休眠、应用被挂起或进程长时间阻塞」。任务本身保持启用，只是这些窗口没跑。

## 防休眠

桌面端可在 设置 → 通用 → 桌面行为 → 「保持电脑运行」里选择 `keepAwakeMode`：

- `off`：不干预；
- `busy`（默认）：仅在有对话或定时任务执行时阻止系统空闲休眠；
- `always`：应用运行期间一直阻止。

由 Electron 主进程持有 `powerSaveBlocker("prevent-app-suspension")` 实现（后端经 bridge 每 5s 上报忙碌状态）。只挡「空闲自动休眠」，**合盖与手动睡眠仍会中断任务**；Web 部署无此能力。设置值存在 system 分组（`<数据目录>/system.json`），主进程启动时直接读该文件，因此不依赖前端是否打开过设置页。
