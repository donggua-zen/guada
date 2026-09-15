/**
 * ProcessManagerService UI 侧边栏方法测试
 *
 * 覆盖 OverviewPanel 后台进程区块依赖的三个方法：
 * - listRunningBySession：只返回该会话运行中的进程
 * - killIfOwned：会话归属校验 + 终止语义
 * - readLogTail：日志尾部读取与 404（null）语义
 *
 * 单账户模型下归属维度只有会话（userId 维度已移除）。
 */
import { ProcessManagerService } from '../../src/modules/shell/process-manager.service';

describe('ProcessManagerService UI methods', () => {
  let svc: ProcessManagerService;
  let enqueueMessage: jest.Mock;
  let emitted: any[];
  /** 测试期间创建的后台进程（sessionId/processId），供 afterEach 清理 */
  const created: Array<{ sessionId: string; processId: string }> = [];

  /** 轮询等待日志内容出现（固定 sleep 在并发负载下会 flake：子进程刷盘时机不定） */
  async function waitForLog(
    processId: string,
    sessionId: string,
    expected: string,
    timeoutMs = 10_000,
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const log = await svc.readLogTail(processId, sessionId);
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
    for (const { sessionId, processId } of created) {
      svc.killIfOwned(processId, sessionId);
    }
    created.length = 0;
  });

  /** execute 后台命令并登记清理 */
  async function runBackground(
    sessionId: string,
    command: string,
  ): Promise<string> {
    const res = await svc.execute(command, process.cwd(), 'utf-8', sessionId, {
      timeout: 1000,
      background: true,
    });
    expect(res.kind).toBe('backgrounded');
    const processId = (res as any).processId as string;
    created.push({ sessionId, processId });
    return processId;
  }

  it('listRunningBySession 只返回该会话的运行中进程', async () => {
    const processId = await runBackground(
      'sess-ui',
      'node -e "console.log(\'ui-test\'); setTimeout(()=>{}, 30000)"',
    );

    const own = svc.listRunningBySession('sess-ui');
    expect(own.map((p) => p.id)).toContain(processId);
    expect(own[0].status).toBe('running');
    expect(own[0].startedAt).toBeInstanceOf(Date);

    // 其他会话不可见
    expect(svc.listRunningBySession('sess-other')).toHaveLength(0);

    // 转后台时发射了 process.changed 事件（SSE 链路）
    expect(emitted.some((e) => e.name === 'process.changed' && e.payload.sessionId === 'sess-ui')).toBe(true);
  });

  it('readLogTail 读取日志尾部，跨会话返回 null', async () => {
    const processId = await runBackground(
      'sess-log',
      'node -e "console.log(\'log-line-1\'); console.log(\'log-line-2\'); setTimeout(()=>{}, 30000)"',
    );

    // 等日志落盘（轮询，避免固定 sleep 在并发负载下 flake）
    await waitForLog(processId, 'sess-log', 'log-line-1');
    const log = await svc.readLogTail(processId, 'sess-log');
    expect(log).not.toBeNull();
    expect(log!.status).toBe('running');
    expect(log!.content).toContain('log-line-1');

    // 跨会话 / 不存在
    expect(await svc.readLogTail(processId, 'sess-other')).toBeNull();
    expect(await svc.readLogTail('p-not-exist', 'sess-log')).toBeNull();

    // 小 maxBytes 截断标记
    const tiny = await svc.readLogTail(processId, 'sess-log', 16);
    expect(tiny).not.toBeNull();
    expect(tiny!.truncated).toBe(true);
  });

  it('killIfOwned 校验会话归属后终止，进程从列表消失', async () => {
    const processId = await runBackground(
      'sess-kill',
      'node -e "setTimeout(()=>{}, 30000)"',
    );

    expect(svc.killIfOwned(processId, 'sess-other')).toBeNull();
    expect(svc.listRunningBySession('sess-kill')).toHaveLength(1);

    expect(svc.killIfOwned(processId, 'sess-kill')).toBe('killed');
    expect(svc.listRunningBySession('sess-kill')).toHaveLength(0);
    expect(svc.killIfOwned(processId, 'sess-kill')).toBeNull();

    // kill → cleanup 发射 process.changed（结束通知链路）
    expect(emitted.some((e) => e.name === 'process.changed' && e.payload.sessionId === 'sess-kill')).toBe(true);
  });
});
