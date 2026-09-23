/**
 * ProcessManagerService 完成通知与回合结束收割（drainCompleted）回归测试
 *
 * 覆盖回归：后台进程在回合进行中结束、AI 未 poll 时，
 * 回合结束拦截器（turn.stopping → drainCompleted）仍能读到完整输出；
 * 排队中的 process_monitor 通知与拦截注入去重（entry 清理后 isValid() 为 false）。
 *
 * 修复前 enqueueSystemMessageFromEntry 会预消费 readOffset，drain/poll 读到空输出，
 * 同时 buildPollResult 清理 entry 使排队通知也被 isValid() 判失效丢弃 → 输出彻底丢失。
 */
import { ProcessManagerService } from '../../src/modules/shell/process-manager.service';

describe('ProcessManagerService completion & drain', () => {
  let svc: ProcessManagerService;
  let enqueueMessage: jest.Mock;
  let emitted: any[];
  /** 测试期间创建的后台进程（sessionId/processId），供 afterEach 清理 */
  const created: Array<{ sessionId: string; processId: string }> = [];

  /** 轮询等待条件成立（子进程结束/落盘时机不定，固定 sleep 会 flake） */
  async function waitFor(
    predicate: () => boolean,
    what: string,
    timeoutMs = 10_000,
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (predicate()) return;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error(`timeout waiting for: ${what}`);
  }

  beforeAll(async () => {
    enqueueMessage = jest.fn();
    emitted = [];
    const mockRunner: any = { enqueueMessage };
    const mockEmitter: any = {
      emit: (name: string, payload: any) => {
        emitted.push({ name, payload });
      },
    };
    svc = new ProcessManagerService(mockRunner, mockEmitter);
  });

  afterEach(async () => {
    for (const { sessionId, processId } of created) {
      svc.killIfOwned(processId, sessionId);
    }
    created.length = 0;
    enqueueMessage.mockClear();
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

  /**
   * 等待该会话出现"进程完成通知"入队（enqueue 路径已完成窥视读取）。
   * 返回 enqueueMessage 收到的队列项参数。
   */
  async function waitForCompletionNotification(
    sessionId: string,
  ): Promise<any> {
    await waitFor(
      () =>
        enqueueMessage.mock.calls.some(
          (c: any[]) => c[0]?.sessionId === sessionId,
        ),
      `completion notification enqueued for ${sessionId}`,
    );
    const call = enqueueMessage.mock.calls.find(
      (c: any[]) => c[0]?.sessionId === sessionId,
    )!;
    return call[0];
  }

  it('回合内结束：drainCompleted 仍能读到输出，排队通知随后失效不重复投递', async () => {
    const processId = await runBackground(
      'sess-drain',
      'node -e "console.log(\'drain-marker-1\'); process.exit(0)"',
    );
    expect(processId).toBeTruthy();

    // 进程结束 → enqueue 路径打包通知入队（模拟流活跃时的排队）
    const queued = await waitForCompletionNotification('sess-drain');
    expect(queued.source.kind).toBe('process_monitor');
    expect(queued.blocks?.[0]?.text).toContain('drain-marker-1');

    // 回合结束 → 拦截器 drain：应读到完整输出（修复前此处输出为空）
    const drained = await svc.drainCompleted('sess-drain');
    expect(drained).toHaveLength(1);
    expect(drained[0].status).toBe('completed');
    expect(drained[0].output).toContain('drain-marker-1');

    // drain 已消费事件并清理 entry → 排队通知 isValid() 为 false（processQueue 丢弃，去重）
    expect(queued.isValid()).toBe(false);
    expect(svc.listBySession('sess-drain')).toHaveLength(0);
  });

  it('进程结束后、通知投递前 poll 仍能拿到输出', async () => {
    const processId = await runBackground(
      'sess-poll',
      'node -e "console.log(\'poll-marker-2\'); process.exit(0)"',
    );
    expect(processId).toBeTruthy();

    const queued = await waitForCompletionNotification('sess-poll');
    expect(queued.source.kind).toBe('process_monitor');

    const result = await svc.poll(processId, 0, 'sess-poll');
    expect(result).not.toBeNull();
    expect(result!.status).toBe('completed');
    expect(result!.output).toContain('poll-marker-2');

    // poll 消费并清理 entry → 排队通知失效，不会重复投递
    expect(queued.isValid()).toBe(false);
  });

  it('拦截次数用尽（未 drain/poll）：排队通知保持有效，回合结束后兜底投递不丢消息', async () => {
    const processId = await runBackground(
      'sess-fallback',
      'node -e "console.log(\'fallback-marker-3\'); process.exit(0)"',
    );
    expect(processId).toBeTruthy();

    const queued = await waitForCompletionNotification('sess-fallback');
    expect(queued.source.kind).toBe('process_monitor');
    // 通知消息自身携带输出（窥视打包）——兜底投递不丢内容
    expect(queued.blocks?.[0]?.text).toContain('fallback-marker-3');

    // 模拟拦截次数用尽：本轮引擎短路 runTurnStoppingHook，drain 不执行，
    // 进程 entry 与排队通知原样保留（isValid 依赖 entry 存在）
    expect(queued.isValid()).toBe(true);
    expect(svc.listBySession('sess-fallback')).toHaveLength(1);

    // 回合正常结束后 processQueue 投递该通知 → onConsumed 清理 entry
    queued.onConsumed();
    expect(svc.listBySession('sess-fallback')).toHaveLength(0);
  });
});
