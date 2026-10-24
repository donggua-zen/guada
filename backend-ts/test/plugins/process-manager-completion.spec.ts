/**
 * ProcessManagerService 完成通知与回合结束收割（drainCompleted）回归测试
 *
 * 覆盖回归：后台进程在回合进行中结束、AI 未 poll 时，
 * 回合结束拦截器（turn.stopping → drainCompleted）仍能读到完整输出；
 * 模型侧读取（job_read → registry.read）消费结果后 drain 不重复投递。
 *
 * 通知权归 JobRegistry（job.settled → JobNotifier）；enqueueSystemMessageFromEntry
 * 旧信箱路径只服务 Registry 未注入的测试/嵌入场景，本套件走真实 Registry。
 */
import { JobRegistryService } from '../../src/modules/jobs/job-registry.service';
import { ProcessManagerService } from '../../src/modules/shell/process-manager.service';
import type { JobId, JobSettledEvent } from '../../src/modules/jobs/job.types';

describe('ProcessManagerService completion & drain', () => {
  let svc: ProcessManagerService;
  let enqueueMessage: jest.Mock;
  let registry: JobRegistryService;
  let settledEvents: JobSettledEvent[];
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
    settledEvents = [];
    const mockRunner: any = { enqueueMessage };
    const registryEmitter: any = {
      emit: (name: string, payload: any) => {
        if (name === 'job.settled') settledEvents.push(payload);
      },
    };
    registry = new JobRegistryService(registryEmitter);
    svc = new ProcessManagerService(
      mockRunner,
      { emit: () => true } as any,
      registry,
    );
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
  ): Promise<{ processId: string; jobId: JobId }> {
    const res = await svc.execute(command, process.cwd(), 'utf-8', sessionId, {
      timeout: 1000,
      background: true,
    });
    expect(res.kind).toBe('backgrounded');
    const processId = (res as any).processId as string;
    const jobId = (res as any).jobId as JobId;
    created.push({ sessionId, processId });
    return { processId, jobId };
  }

  /** 等待 job 结算（job.settled 事件已发出、终态可读） */
  async function waitForSettled(
    jobId: JobId,
    sessionId: string,
  ): Promise<void> {
    await waitFor(
      () => registry.get(jobId, sessionId)?.finishedAt !== undefined,
      `job ${jobId} settled`,
    );
  }

  it('回合内结束：drainCompleted 仍能读到输出，模型读取后不重复投递', async () => {
    const { jobId } = await runBackground(
      'sess-drain',
      'node -e "console.log(\'drain-marker-1\'); process.exit(0)"',
    );

    // 进程结束 → job.settled 精确一次（通知权归 Registry，不再直接 enqueue）
    await waitForSettled(jobId, 'sess-drain');
    const drainEvents = settledEvents.filter((e) => e.job.id === jobId);
    expect(drainEvents).toHaveLength(1);
    expect(drainEvents[0].notify).toBe(true);
    expect(enqueueMessage).not.toHaveBeenCalled();

    // 回合结束 → 拦截器 drain：应读到完整输出（修复前此处输出为空）
    const drained = await svc.drainCompleted('sess-drain');
    expect(drained).toHaveLength(1);
    expect(drained[0].status).toBe('completed');
    expect(drained[0].output).toContain('drain-marker-1');

    // drain 消费了终态 → job 置 reported，后续完成通知失效
    expect(registry.get(jobId, 'sess-drain')?.reported).toBe(true);
    expect(svc.listBySession('sess-drain')).toHaveLength(0);
  });

  it('进程结束后、模型读取前 poll 仍能拿到输出', async () => {
    const { processId, jobId } = await runBackground(
      'sess-poll',
      'node -e "console.log(\'poll-marker-2\'); process.exit(0)"',
    );

    await waitForSettled(jobId, 'sess-poll');
    expect(settledEvents.filter((e) => e.job.id === jobId)).toHaveLength(1);

    const result = await svc.poll(processId, 0, 'sess-poll');
    expect(result).not.toBeNull();
    expect(result!.status).toBe('completed');
    expect(result!.output).toContain('poll-marker-2');

    // poll 消费并清理 entry → job 已 reported
    expect(registry.get(jobId, 'sess-poll')?.reported).toBe(true);
  });

  it('未读取的完成 job 保持可读（无队列消息依赖）', async () => {
    const { jobId } = await runBackground(
      'sess-fallback',
      'node -e "console.log(\'fallback-marker-3\'); process.exit(0)"',
    );

    await waitForSettled(jobId, 'sess-fallback');
    expect(settledEvents.filter((e) => e.job.id === jobId)).toHaveLength(1);

    // 未被读取：job 未 reported（通知仍待投递）、entry 与日志可读
    expect(registry.get(jobId, 'sess-fallback')?.reported).toBe(false);
    expect(svc.listBySession('sess-fallback')).toHaveLength(1);

    // job_read 读取 → markReported，通知被消费
    const read = await registry.read(jobId, 'sess-fallback');
    expect(read.output.text).toContain('fallback-marker-3');
    expect(registry.get(jobId, 'sess-fallback')?.reported).toBe(true);
  });
});
