/**
 * ProcessManagerService UI 侧边栏方法测试
 *
 * 覆盖 OverviewPanel 后台进程区块依赖的三个方法：
 * - listRunningForUser：只返回该会话该用户运行中的进程
 * - killIfOwned：归属校验 + 终止语义
 * - readLogTail：日志尾部读取与 404（null）语义
 */
import { ProcessManagerService } from '../../src/modules/shell/process-manager.service';

describe('ProcessManagerService UI methods', () => {
  let svc: ProcessManagerService;
  let enqueueMessage: jest.Mock;
  let emitted: any[];
  /** 测试期间创建的后台进程（sessionId/userId/processId），供 afterEach 清理 */
  const created: Array<{ sessionId: string; userId: string; processId: string }> = [];

  /** 轮询等待日志内容出现（固定 sleep 在并发负载下会 flake：子进程刷盘时机不定） */
  async function waitForLog(
    processId: string,
    sessionId: string,
    userId: string,
    expected: string,
    timeoutMs = 10_000,
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const log = await svc.readLogTail(processId, sessionId, userId);
      if (log?.content?.includes(expected)) return;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(`log content "${expected}" not found within ${timeoutMs}ms`);
  }

  beforeAll(async () => {
    enqueueMessage = jest.fn();
    emitted = [];
    const mockRunner: any = { enqueueMessage };
    const mockEmitter: any = { emit: (name: string, payload: any) => { emitted.push({ name, payload }); } };
    svc = new ProcessManagerService(mockRunner, mockEmitter);
  });

  afterEach(async () => {
    for (const { sessionId, userId, processId } of created) {
      svc.killIfOwned(processId, sessionId, userId);
    }
    created.length = 0;
  });

  /** execute 后台命令并登记清理 */
  async function runBackground(
    sessionId: string,
    userId: string,
    command: string,
  ): Promise<string> {
    const res = await svc.execute(command, process.cwd(), 'utf-8', sessionId, userId, {
      timeout: 1000,
      background: true,
    });
    expect(res.kind).toBe('backgrounded');
    const processId = (res as any).processId as string;
    created.push({ sessionId, userId, processId });
    return processId;
  }

  it('listRunningForUser 只返回归属用户的运行中进程', async () => {
    const processId = await runBackground(
      'sess-ui',
      'user-a',
      'node -e "console.log(\'ui-test\'); setTimeout(()=>{}, 30000)"',
    );

    const own = svc.listRunningForUser('sess-ui', 'user-a');
    expect(own.map((p) => p.id)).toContain(processId);
    expect(own[0].status).toBe('running');
    expect(own[0].startedAt).toBeInstanceOf(Date);

    // 其他用户 / 其他会话不可见
    expect(svc.listRunningForUser('sess-ui', 'user-b')).toHaveLength(0);
    expect(svc.listRunningForUser('sess-other', 'user-a')).toHaveLength(0);

    // 转后台时发射了 process.changed 事件（SSE 链路）
    expect(emitted.some((e) => e.name === 'process.changed' && e.payload.sessionId === 'sess-ui')).toBe(true);
  });

  it('readLogTail 读取日志尾部，越权返回 null', async () => {
    const processId = await runBackground(
      'sess-log',
      'user-a',
      'node -e "console.log(\'log-line-1\'); console.log(\'log-line-2\'); setTimeout(()=>{}, 30000)"',
    );

    // 等日志落盘（轮询，避免固定 sleep 在并发负载下 flake）
    await waitForLog(processId, 'sess-log', 'user-a', 'log-line-1');
    const log = await svc.readLogTail(processId, 'sess-log', 'user-a');
    expect(log).not.toBeNull();
    expect(log!.status).toBe('running');
    expect(log!.content).toContain('log-line-1');

    // 越权/不存在
    expect(await svc.readLogTail(processId, 'sess-log', 'user-b')).toBeNull();
    expect(await svc.readLogTail('p-not-exist', 'sess-log', 'user-a')).toBeNull();

    // 小 maxBytes 截断标记
    const tiny = await svc.readLogTail(processId, 'sess-log', 'user-a', 16);
    expect(tiny).not.toBeNull();
    expect(tiny!.truncated).toBe(true);
  });

  it('killIfOwned 校验归属后终止，进程从列表消失', async () => {
    const processId = await runBackground(
      'sess-kill',
      'user-a',
      'node -e "setTimeout(()=>{}, 30000)"',
    );

    expect(svc.killIfOwned(processId, 'sess-kill', 'user-b')).toBeNull();
    expect(svc.listRunningForUser('sess-kill', 'user-a')).toHaveLength(1);

    expect(svc.killIfOwned(processId, 'sess-kill', 'user-a')).toBe('killed');
    expect(svc.listRunningForUser('sess-kill', 'user-a')).toHaveLength(0);
    expect(svc.killIfOwned(processId, 'sess-kill', 'user-a')).toBeNull();

    // kill → cleanup 发射 process.changed（结束通知链路）
    expect(emitted.some((e) => e.name === 'process.changed' && e.payload.sessionId === 'sess-kill')).toBe(true);
  });
});
