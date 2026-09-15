/**
 * SchedulerPlugin 工具回归测试
 *
 * 回归点：`scheduler_create_task` 原先要求 `ctx.session.userId`，而单账户模型下
 * 该字段恒为 undefined，导致 AI 建定时任务**恒失败**（抛「无法获取用户ID」）。
 * userId 维度移除后，只要 sessionId 存在即应创建成功。
 */
import { SchedulerPlugin } from './scheduler.plugin';

/** 捕获 registerToolKit 注册的工具，返回 name → tool 映射 */
function captureTools(plugin: SchedulerPlugin): Promise<Record<string, any>> {
  const tools: Record<string, any> = {};
  const api: any = {
    registerNls: jest.fn(),
    registerToolKit: () => ({
      registerTool: (tool: any) => {
        tools[tool.name] = tool;
      },
      registerPrompt: jest.fn(),
    }),
  };
  return plugin.onLoad(api).then(() => tools);
}

describe('SchedulerPlugin 定时任务工具', () => {
  it('scheduler_create_task 在只有 sessionId 的上下文下创建成功（不因 userId 缺失抛错）', async () => {
    const createTask = jest.fn().mockResolvedValue({
      id: 'task-1',
      name: '每日早报',
      nextRunAt: '2026-09-15T00:00:00.000Z',
    });
    const plugin = new SchedulerPlugin({ createTask } as any);
    const tools = await captureTools(plugin);

    const ctx: any = { session: { sessionId: 'sess-1' } };
    const raw = await tools['scheduler_create_task'].execute(
      {
        name: '每日早报',
        prompt: '写一份今天的早报',
        schedule_type: 'cron',
        cron_expression: '0 8 * * *',
      },
      ctx,
    );

    const result = JSON.parse(raw);
    expect(result.success).toBe(true);
    expect(result.task.id).toBe('task-1');
    expect(createTask).toHaveBeenCalledTimes(1);
    // 任务归属当前会话（不再有 userId 维度）
    expect(createTask.mock.calls[0][0]).toMatchObject({
      name: '每日早报',
      scheduleType: 'cron',
      targetMode: 'existing_session',
      targetSessionId: 'sess-1',
      enabled: true,
    });
  });

  it('缺少 sessionId 时仍拒绝创建（会话归属是唯一必需维度）', async () => {
    const createTask = jest.fn();
    const plugin = new SchedulerPlugin({ createTask } as any);
    const tools = await captureTools(plugin);

    await expect(
      tools['scheduler_create_task'].execute(
        {
          name: '无会话任务',
          prompt: 'x',
          schedule_type: 'cron',
          cron_expression: '0 8 * * *',
        },
        { session: {} } as any,
      ),
    ).rejects.toThrow(/无法获取会话ID/);
    expect(createTask).not.toHaveBeenCalled();
  });
});
