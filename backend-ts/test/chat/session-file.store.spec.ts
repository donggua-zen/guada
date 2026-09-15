import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  META_FILE,
  SESSION_ID_PREFIX,
  SessionFileStore,
} from '../../src/modules/chat/session-file.store';
import {
  META_DOMAIN_SESSIONS,
  MetadataBootstrapGate,
} from '../../src/common/database/metadata-bootstrap.gate';

/**
 * SessionFileStore 创建语义测试
 *
 * 回归点：`create` 原先只做 `String(data.id)`，缺 id 时得到字面量 "undefined" ——
 * 所有新建会话（web/bot/子代理/workflow）都落进同一个 `sessions/undefined/` 目录互相
 * 覆盖，HTTP 也返回 `id: "undefined"`。DB 时代由 Prisma `@default(cuid())` 生成 id，
 * 迁到文件存储后这一职责必须由 store 自己承担。
 */
describe('SessionFileStore', () => {
  let root: string;
  let store: SessionFileStore;
  let gate: MetadataBootstrapGate;

  const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

  function mkStore(): SessionFileStore {
    // 门控是纯内存类，直接放行，避免测试挂在 30s 超时上
    gate = new MetadataBootstrapGate();
    gate.complete(META_DOMAIN_SESSIONS);
    return new SessionFileStore(gate);
  }

  function metaPath(id: string): string {
    return path.join(root, 'sessions', id, META_FILE);
  }

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'session-store-'));
    process.env.SESSION_DATA_DIR = root;
    store = mkStore();
  });

  afterEach(() => {
    store.onModuleDestroy();
    fs.rmSync(root, { recursive: true, force: true });
    delete process.env.SESSION_DATA_DIR;
  });

  it('不传 id 时铸造 `session-<uuid v4>`，并落盘 meta.json（不再落 sessions/undefined）', async () => {
    const row = await store.create({ title: '新会话' });

    expect(typeof row.id).toBe('string');
    expect(row.id.startsWith(SESSION_ID_PREFIX)).toBe(true);
    expect(row.id.slice(SESSION_ID_PREFIX.length)).toMatch(UUID_V4);
    expect(row.id).not.toBe('undefined');

    // 目录 + meta.json 落地，且文件里的 id 与返回值一致
    expect(fs.existsSync(metaPath(row.id))).toBe(true);
    const onDisk = JSON.parse(fs.readFileSync(metaPath(row.id), 'utf8'));
    expect(onDisk.id).toBe(row.id);
    expect(onDisk.title).toBe('新会话');
    expect(onDisk.sessionType).toBe('web');

    // 索引命中，可被查回
    expect(store.get(row.id)?.id).toBe(row.id);
    expect(store.has(row.id)).toBe(true);

    // 关键回归：绝不产生 sessions/undefined
    expect(fs.existsSync(path.join(root, 'sessions', 'undefined'))).toBe(false);
  });

  it('连续两次创建：id 互不相同且两个目录并存（原先共用 undefined 目录互相覆盖）', async () => {
    const a = await store.create({ title: 'A' });
    const b = await store.create({ title: 'B' });

    expect(a.id).not.toBe(b.id);
    expect(fs.existsSync(metaPath(a.id))).toBe(true);
    expect(fs.existsSync(metaPath(b.id))).toBe(true);
    expect(store.count()).toBe(2);
    expect(
      store.query(() => true).map((s) => s.id).sort(),
    ).toEqual([a.id, b.id].sort());
  });

  it('显式传入 id 时保留原值（迁移/外部指定场景）', async () => {
    const row = await store.create({ id: 'cmophqvcd0000vckz8xo3hfk1', title: '存量形状' });
    expect(row.id).toBe('cmophqvcd0000vckz8xo3hfk1');
    expect(fs.existsSync(metaPath(row.id))).toBe(true);
  });

  it('空 id 视为未提供（走生成分支），不抛错', async () => {
    const row = await store.create({ id: '', title: '空 id' });
    expect(row.id.startsWith(SESSION_ID_PREFIX)).toBe(true);
  });

  it.each(['undefined', 'null', '../escape', 'a/b', 'a\\b', '.hidden', 'bad:id'])(
    '非法 id "%s" 被拒绝，且不落盘',
    async (bad) => {
      await expect(store.create({ id: bad })).rejects.toThrow(/Invalid session id/);
      expect(fs.existsSync(path.join(root, 'sessions', bad))).toBe(false);
    },
  );

  it('deleteSession 对非法 id 抛错，不会删到 baseDir 之外', async () => {
    // baseDir 之外的哨兵文件：若校验缺失，`../sentinel` 会把它整目录删掉
    const sentinelDir = path.join(root, 'sentinel');
    fs.mkdirSync(sentinelDir, { recursive: true });
    fs.writeFileSync(path.join(sentinelDir, 'keep.txt'), 'keep', 'utf8');

    await expect(store.deleteSession('../sentinel')).rejects.toThrow(/Invalid session id/);
    expect(fs.existsSync(path.join(sentinelDir, 'keep.txt'))).toBe(true);
  });

  it('deleteSession 正常 id：删除整目录并返回 true，二次删除返回 false', async () => {
    const row = await store.create({ title: '待删' });
    expect(await store.deleteSession(row.id)).toBe(true);
    expect(fs.existsSync(path.join(root, 'sessions', row.id))).toBe(false);
    expect(await store.deleteSession(row.id)).toBe(false);
  });

  it('新实例重扫后仍能列出既有会话（盘为权威）', async () => {
    const row = await store.create({ title: '重启后仍在' });
    store.onModuleDestroy();

    const reopened = mkStore();
    await reopened.initialize();
    expect(reopened.get(row.id)?.title).toBe('重启后仍在');
    reopened.onModuleDestroy();
  });
});
