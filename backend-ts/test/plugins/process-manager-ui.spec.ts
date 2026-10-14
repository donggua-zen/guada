/**
 * ProcessManagerService UI 侧边栏方法测试
 *
 * 覆盖 OverviewPanel 后台进程区块依赖的三个方法：
 * - listRunningBySession：只返回该会话运行中的进程
 * - killIfOwned：会话归属校验 + 终止语义。注意 entry 由子进程 close 事件清理
 *   （kill 路径不再立即 remove，留给看门狗补杀进程组，见 9c1c6657）：
 *   kill 后列表按状态立即为空，但"entry 已不存在"与通知事件都要等 close 清理后才成立
 * - readLogTail：日志尾部读取；entry 被清理后改从磁盘读（status="ended"），
 *   日志文件也不存在才是 null（404）
 *
 * 单账户模型下归属维度只有会话（userId 维度已移除）。
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  buildLogFileName,
  ProcessManagerService,
} from '../../src/modules/shell/process-manager.service';

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

  /** 轮询等待进程结束（entry 离开 running；进程结束后 entry 仍在，直到被消费清理） */
  async function waitForProcessEnd(processId: string, timeoutMs = 10_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const entry = svc.get(processId);
      if (!entry || entry.status !== 'running') return;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(`process ${processId} still running after ${timeoutMs}ms`);
  }

  /**
   * 轮询等待 entry 被清理（从内存移除）。
   *
   * kill 路径的 entry 由子进程 close 事件清理（不在 kill() 里立即 remove，
   * 留给看门狗补杀进程组成员），因此"已不存在"与 process.changed 通知都要等这一刻。
   */
  async function waitForCleanup(processId: string, timeoutMs = 10_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (!svc.get(processId)) return;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(`entry ${processId} not cleaned within ${timeoutMs}ms`);
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
    // 列表按 status 过滤，状态已置 killed → 立即为空
    expect(svc.listRunningBySession('sess-kill')).toHaveLength(0);
    // entry 由 close 事件清理（kill 路径不再立即 remove）：清理前再 kill 返回当前状态
    // 'killed'（幂等语义），而不是 null
    expect(svc.killIfOwned(processId, 'sess-kill')).toBe('killed');

    // kill → close 清理发射 process.changed（结束通知链路）。
    // 先清空累积：runBackground 转后台时已为同一 sessionId 发过一次事件，
    // 不清空则这条断言无法区分是不是清理路径发的。
    emitted.length = 0;
    await waitForCleanup(processId);
    expect(svc.killIfOwned(processId, 'sess-kill')).toBeNull();
    expect(emitted.some((e) => e.name === 'process.changed' && e.payload.sessionId === 'sess-kill')).toBe(true);
  });

  it('readLogTail：entry 被清理后改从磁盘读（按文件名定位），status=ended', async () => {
    // 唯一会话：隔离既有临时目录里的残留文件（PID 会被系统回收复用）
    const sessionId = `sess-ended-${Date.now()}`;
    const processId = await runBackground(
      sessionId,
      'node -e "console.log(\'tail-line\'); setTimeout(()=>{},150)"',
    );

    await waitForProcessEnd(processId);
    // 模拟真实链路：完成通知被消费后 entry 被清理（约在结束 1s 内）
    await svc.drainCompleted(sessionId);
    expect(svc.get(processId)).toBeNull();

    const log = await svc.readLogTail(processId, sessionId);
    expect(log).not.toBeNull();
    expect(log!.status).toBe('ended');
    expect(log!.content).toContain('tail-line');
    expect(log!.exitCode).toBeNull();
    // 起止时间随 entry 一起消失：不臆造（UI 也因此不显示时长）
    expect(log!.startedAt).toBeUndefined();
    expect(log!.finishedAt).toBeUndefined();

    // 会话边界由文件名结构保证（磁盘路径不放松归属校验）
    expect(await svc.readLogTail(processId, 'sess-other')).toBeNull();
    expect(await svc.readLogTail(processId, `${sessionId}-x`)).toBeNull();
  });

  it('readLogTail：日志文件也被清掉 → null（前端提示"可能已被清理"）', async () => {
    const sessionId = `sess-purged-${Date.now()}`;
    const processId = await runBackground(
      sessionId,
      'node -e "console.log(\'gone-line\'); setTimeout(()=>{},150)"',
    );

    await waitForProcessEnd(processId);
    await svc.drainCompleted(sessionId);

    // 精确路径 = 文件名派生（顺带验证实现与该纯函数一致）
    const logPath = path.join(
      os.tmpdir(),
      'guada-logs',
      buildLogFileName(processId, sessionId),
    );
    expect(fs.existsSync(logPath)).toBe(true);

    fs.unlinkSync(logPath);
    expect(await svc.readLogTail(processId, sessionId)).toBeNull();
  });

  it('readLogTail：pid/sessionId 含路径穿越字符 → 不拼路径，直接 null', async () => {
    expect(await svc.readLogTail('..%2F..%2Fsecret', 'sess-ui')).toBeNull();
    expect(await svc.readLogTail('a/b', 'sess-ui')).toBeNull();
    expect(await svc.readLogTail('7160', '../etc')).toBeNull();
  });
});

describe('后台进程日志文件名', () => {
  it('只含会话与进程 ID（可被 URL 参数唯一推出，不含时间戳）', () => {
    expect(buildLogFileName('7160', 'cmph0tcot001nb4kzy8gogkfm')).toBe(
      'guada-cmph0tcot001nb4kzy8gogkfm-7160.log',
    );
    // 兜底 id 形如 proc-<uuid>（自带减号）原样进名字，不做反解
    expect(buildLogFileName('proc-3f2a9c1e-8b7d-4e6f-9a01-2b3c4d5e6f70', 's1')).toBe(
      'guada-s1-proc-3f2a9c1e-8b7d-4e6f-9a01-2b3c4d5e6f70.log',
    );
  });
});
