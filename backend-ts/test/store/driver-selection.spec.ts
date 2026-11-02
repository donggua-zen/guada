/**
 * 驱动选择机制回归测试
 *
 * 锁住一个容易静默失效的契约：**注册过的驱动必须真的被装配路径解析到**。
 *
 * 背景：`MESSAGE_EVENT_LOG` 曾在 `PersistenceModule` 里硬绑 `useExisting: JsonlBackend`，
 * 端口和注册表都写好了，但接线漏了一处——设了 `GUADA_STORE_DRIVER_MESSAGES=postgres`
 * 仍然走 JSONL，而且启动日志还会照环境变量报出 postgres（误导排查）。
 * 本文件用假驱动把「选择 → 解析 → 实例」这一段钉死。
 */
import type { MessageEventLog } from '../../src/common/persistence/event-log.port';
import type { SessionMetaPort } from '../../src/common/store/ports/session-meta.port';
import {
  __resetStoreDriversForTest,
  createStoreDriver,
  getStoreDriverFactory,
  registerStoreDriver,
  resolveStoreDriverName,
} from '../../src/common/store/driver-registry';

const ENV_KEYS = [
  'GUADA_STORE_DRIVER',
  'GUADA_STORE_DRIVER_SESSIONS',
  'GUADA_STORE_DRIVER_ASSETS',
  'GUADA_STORE_DRIVER_MESSAGES',
  'GUADA_STORE_DRIVER_USAGE',
] as const;

describe('存储驱动选择机制', () => {
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = {};
    for (const key of ENV_KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
    __resetStoreDriversForTest();
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    __resetStoreDriversForTest();
  });

  it('缺省驱动名反映真实介质：messages=jsonl、assets=fs、sessions/usage=sqlite', () => {
    expect(resolveStoreDriverName('messages')).toBe('jsonl');
    // assets 是纯文件系统容器，与 SQLite 无关——默认值不能写成 sqlite
    expect(resolveStoreDriverName('assets')).toBe('fs');
    expect(resolveStoreDriverName('sessions')).toBe('sqlite');
    expect(resolveStoreDriverName('usage')).toBe('sqlite');
  });

  it('域环境变量优先于全局', () => {
    process.env.GUADA_STORE_DRIVER = 'postgres';
    process.env.GUADA_STORE_DRIVER_MESSAGES = 'http';
    expect(resolveStoreDriverName('messages')).toBe('http');
    expect(resolveStoreDriverName('sessions')).toBe('postgres');
  });

  it('未注册驱动 → createStoreDriver 抛错并提示注册方式', () => {
    process.env.GUADA_STORE_DRIVER_MESSAGES = 'postgres';
    expect(() => createStoreDriver('messages')).toThrow(
      /存储驱动未注册：messages=postgres/,
    );
  });

  it('注册后 createStoreDriver 返回注册实现的实例（messages 域）', () => {
    const fake = { kind: 'fake-event-log' } as unknown as MessageEventLog;
    registerStoreDriver('messages', 'postgres', () => fake);
    process.env.GUADA_STORE_DRIVER_MESSAGES = 'postgres';

    expect(getStoreDriverFactory('messages', 'postgres')).toBeDefined();
    expect(createStoreDriver<MessageEventLog>('messages')).toBe(fake);
  });

  it('注册后 createStoreDriver 返回注册实现的实例（sessions 域）', () => {
    const fake = { kind: 'fake-meta' } as unknown as SessionMetaPort;
    registerStoreDriver('sessions', 'postgres', () => fake);
    process.env.GUADA_STORE_DRIVER_SESSIONS = 'postgres';

    expect(createStoreDriver<SessionMetaPort>('sessions')).toBe(fake);
  });

  it('fallback 只在未注册时生效，已注册时不被 fallback 抢走', () => {
    const fallback = { kind: 'sqlite' } as unknown as SessionMetaPort;
    const registered = { kind: 'postgres' } as unknown as SessionMetaPort;
    registerStoreDriver('sessions', 'postgres', () => registered);
    process.env.GUADA_STORE_DRIVER_SESSIONS = 'postgres';

    // 已注册：返回注册实现
    expect(createStoreDriver('sessions', () => fallback)).toBe(registered);

    // 换成未注册的名字：退回 fallback
    process.env.GUADA_STORE_DRIVER_SESSIONS = 'http';
    expect(createStoreDriver('sessions', () => fallback)).toBe(fallback);
  });

  it('同域同驱动只构造一次：三个端口 provider 共享一个实例', () => {
    // 对应 StoreModule 里 sessions 域被 meta/group/project-group 三个端口各解析一次。
    // 若每次调工厂，企业驱动会构造多份（多套连接池、内存状态互不可见）。
    let built = 0;
    const instance = { kind: 'pg-store' };
    registerStoreDriver('sessions', 'postgres', () => {
      built += 1;
      return instance;
    });
    process.env.GUADA_STORE_DRIVER_SESSIONS = 'postgres';

    const a = createStoreDriver('sessions');
    const b = createStoreDriver('sessions');
    const c = createStoreDriver('sessions');
    expect(a).toBe(instance);
    expect(b).toBe(instance);
    expect(c).toBe(instance);
    expect(built).toBe(1);
  });

  it('不同域各自独立构造（sessions 与 assets 不共用实例）', () => {
    const sessions = { kind: 'pg-meta' };
    const assets = { kind: 's3' };
    registerStoreDriver('sessions', 'postgres', () => sessions);
    registerStoreDriver('assets', 's3', () => assets);
    process.env.GUADA_STORE_DRIVER_SESSIONS = 'postgres';
    process.env.GUADA_STORE_DRIVER_ASSETS = 's3';

    expect(createStoreDriver('sessions')).toBe(sessions);
    expect(createStoreDriver('assets')).toBe(assets);
  });

  it('注销驱动后丢弃已缓存实例（避免注销仍复用）', () => {
    let built = 0;
    const dispose = registerStoreDriver('usage', 'postgres', () => {
      built += 1;
      return { n: built };
    });
    process.env.GUADA_STORE_DRIVER_USAGE = 'postgres';

    const first = createStoreDriver('usage');
    expect(createStoreDriver('usage')).toBe(first);
    expect(built).toBe(1);

    dispose();
    // 注销后回到「未注册」：无 fallback 即抛错
    expect(() => createStoreDriver('usage')).toThrow(/存储驱动未注册/);
  });

  it('同名重复注册抛错（防止两个企业包互相覆盖）', () => {
    registerStoreDriver('usage', 'postgres', () => ({}));
    expect(() => registerStoreDriver('usage', 'postgres', () => ({}))).toThrow(
      /存储驱动重复注册：usage\/postgres/,
    );
  });
});
