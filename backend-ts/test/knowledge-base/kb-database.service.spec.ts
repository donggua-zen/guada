import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  KbDatabaseService,
  assertUsableKbRoot,
  invalidateKbRootCache,
  resolveKbRoot,
  setConfiguredKbRoot,
} from '../../src/modules/knowledge-base/kb-database.service';
import {
  KB_SCHEMA_VERSION,
  migrateKbDatabase,
} from '../../src/modules/knowledge-base/kb-schema';
import {
  META_DOMAIN_KB,
  MetadataBootstrapGate,
} from '../../src/common/database/metadata-bootstrap.gate';
import Database from 'better-sqlite3';

/**
 * 每库连接注册表测试
 *
 * 这些性质一旦破了会很难查：句柄泄漏（删不掉库目录）、根解析被构造期快照
 * （用户改了存储根却不生效）、版本过高仍然写入（降级安装写坏数据）。
 */
describe('KbDatabaseService', () => {
  let root: string;
  let gate: MetadataBootstrapGate;
  let service: KbDatabaseService;

  function mkKb(kbId: string): void {
    fs.mkdirSync(path.join(root, kbId), { recursive: true });
    fs.writeFileSync(
      path.join(root, kbId, 'kb.json'),
      JSON.stringify({ id: kbId, name: kbId }),
    );
  }

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-db-'));
    process.env.KB_DATA_DIR = root;
    setConfiguredKbRoot(null);
    gate = new MetadataBootstrapGate();
    gate.complete(META_DOMAIN_KB);
    service = new KbDatabaseService(gate);
  });

  afterEach(async () => {
    await service.onModuleDestroy();
    delete process.env.KB_DATA_DIR;
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('根解析优先级：设置 > KB_DATA_DIR > USERDATA_DIR/data/kb', () => {
    // 当前 env 有 KB_DATA_DIR
    expect(resolveKbRoot()).toBe(path.resolve(root));

    // 设置覆盖 env
    const configured = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-root-set-'));
    try {
      setConfiguredKbRoot(configured);
      expect(resolveKbRoot()).toBe(path.resolve(configured));
    } finally {
      setConfiguredKbRoot(null);
      fs.rmSync(configured, { recursive: true, force: true });
    }

    // 去掉 env 后落 USERDATA_DIR
    delete process.env.KB_DATA_DIR;
    process.env.USERDATA_DIR = path.join(root, 'ud');
    try {
      expect(resolveKbRoot()).toBe(path.join(path.resolve(root, 'ud'), 'data', 'kb'));
    } finally {
      delete process.env.USERDATA_DIR;
      process.env.KB_DATA_DIR = root;
    }
  });

  it('拒绝 UNC（网络）路径，接受本地绝对路径', () => {
    const local = path.join(root, 'kb-root');
    expect(assertUsableKbRoot(local)).toBe(path.resolve(local));

    expect(() => assertUsableKbRoot('\\\\server\\share\\kb')).toThrow(
      /网络路径|UNC/,
    );
  });

  describe('设置文件读取 kbStorageRoot（不依赖 SettingsService 初始化时机）', () => {
    let settingsDir: string;
    let customRoot: string;

    beforeEach(() => {
      settingsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-settings-'));
      customRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-custom-'));
      process.env.SETTINGS_DIR = settingsDir;
      invalidateKbRootCache();
    });

    afterEach(() => {
      delete process.env.SETTINGS_DIR;
      invalidateKbRootCache();
      fs.rmSync(settingsDir, { recursive: true, force: true });
      fs.rmSync(customRoot, { recursive: true, force: true });
    });

    function writeSettings(value: unknown): void {
      fs.writeFileSync(
        path.join(settingsDir, 'system.json'),
        JSON.stringify({ kbStorageRoot: value }),
      );
      invalidateKbRootCache();
    }

    it('设置里的根优先于 KB_DATA_DIR（迁移也随之落在该根，回归：曾按默认根迁移）', () => {
      writeSettings(customRoot);
      expect(resolveKbRoot()).toBe(path.resolve(customRoot));

      // 迁移写盘也必须落到配置根
      expect(service.getRootDir()).toBe(path.resolve(customRoot));
    });

    it('设置为空/缺失时退回 KB_DATA_DIR', () => {
      writeSettings('');
      expect(resolveKbRoot()).toBe(path.resolve(root));

      fs.rmSync(path.join(settingsDir, 'system.json'));
      invalidateKbRootCache();
      expect(resolveKbRoot()).toBe(path.resolve(root));
    });

    it('设置值非法（相对路径）时退回 KB_DATA_DIR，不抛错', () => {
      writeSettings('relative/path/kb');
      expect(resolveKbRoot()).toBe(path.resolve(root));
    });

    it('设置值非法（UNC 网络路径）时退回 KB_DATA_DIR', () => {
      writeSettings('\\\\server\\share\\kb');
      expect(resolveKbRoot()).toBe(path.resolve(root));
    });

    it('设置文件是坏 JSON 时退回 KB_DATA_DIR', () => {
      fs.writeFileSync(path.join(settingsDir, 'system.json'), '{ not json');
      invalidateKbRootCache();
      expect(resolveKbRoot()).toBe(path.resolve(root));
    });

    it('显式 setConfiguredKbRoot 优先于设置文件（测试与脚本用）', () => {
      writeSettings(customRoot);
      const explicit = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-explicit-'));
      try {
        setConfiguredKbRoot(explicit);
        expect(resolveKbRoot()).toBe(path.resolve(explicit));
      } finally {
        setConfiguredKbRoot(null);
        fs.rmSync(explicit, { recursive: true, force: true });
      }
    });

    it('运行期不热切换：设置改了但进程内缓存不变（换根需重启）', () => {
      writeSettings(customRoot);
      expect(resolveKbRoot()).toBe(path.resolve(customRoot));

      const another = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-another-'));
      try {
        // 直接改文件、**不**清缓存：模拟"用户改了设置但没重启"
        fs.writeFileSync(
          path.join(settingsDir, 'system.json'),
          JSON.stringify({ kbStorageRoot: another }),
        );
        expect(resolveKbRoot()).toBe(path.resolve(customRoot));
      } finally {
        fs.rmSync(another, { recursive: true, force: true });
      }
    });
  });

  it('打开时自动建库并跑 schema 迁移（user_version = 当前版本）', async () => {
    mkKb('kb-a');
    const db = await service.getDb('kb-a');

    expect(fs.existsSync(path.join(root, 'kb-a', 'kb.db'))).toBe(true);
    expect(db.pragma('user_version', { simple: true })).toBe(KB_SCHEMA_VERSION);
    // 表齐全
    const tables = (
      db
        .prepare("SELECT name FROM sqlite_master WHERE type='table'")
        .all() as Array<{ name: string }>
    ).map((r) => r.name);
    expect(tables).toEqual(expect.arrayContaining(['item', 'chunk', 'chunk_fts']));
  });

  it('同一库重复取用复用同一连接（不重复打开）', async () => {
    mkKb('kb-a');
    const first = await service.getDb('kb-a');
    const second = await service.getDb('kb-a');
    expect(second).toBe(first);
    expect(service.openCount()).toBe(1);
  });

  it('LRU：句柄数不超过上限，最久未用的被关闭', async () => {
    for (let i = 0; i < 10; i++) mkKb(`kb-${i}`);
    for (let i = 0; i < 10; i++) {
      await service.getDb(`kb-${i}`);
      // 让 usedAt 有区分度
      await new Promise((r) => setTimeout(r, 2));
    }
    expect(service.openCount()).toBeLessThanOrEqual(8);
    // 最近使用的仍在
    expect(service.isOpen('kb-9')).toBe(true);
    // 最早的已被淘汰
    expect(service.isOpen('kb-0')).toBe(false);
  });

  it('close(kbId) 释放句柄后目录可以被删除（Windows 上不释放会失败）', async () => {
    mkKb('kb-a');
    await service.getDb('kb-a');
    expect(service.isOpen('kb-a')).toBe(true);

    await service.close('kb-a');
    expect(service.isOpen('kb-a')).toBe(false);

    // 关闭前 checkpoint(TRUNCATE) 会清掉 -wal，目录里只留单文件
    const dir = path.join(root, 'kb-a');
    await fs.promises.rm(dir, { recursive: true, force: true });
    expect(fs.existsSync(dir)).toBe(false);
  });

  it('关闭前 checkpoint：空闲后不残留 -wal（备份/拷贝友好）', async () => {
    mkKb('kb-a');
    const db = await service.getDb('kb-a');
    db.prepare(
      `INSERT INTO item (id, file_name, display_name, uploaded_at)
       VALUES ('i1', 'f', 'F', '2026-01-01T00:00:00.000Z')`,
    ).run();
    await service.close('kb-a');

    const walPath = path.join(root, 'kb-a', 'kb.db-wal');
    const size = fs.existsSync(walPath) ? fs.statSync(walPath).size : 0;
    expect(size).toBe(0);
  });

  it('库版本高于程序时拒绝打开（不降级写坏数据）', async () => {
    mkKb('kb-future');
    const dbPath = path.join(root, 'kb-future', 'kb.db');
    const raw = new Database(dbPath);
    raw.pragma(`user_version = ${KB_SCHEMA_VERSION + 1}`);
    raw.close();

    await expect(service.getDb('kb-future')).rejects.toThrow(/高于本程序支持/);
  });

  it('迁移幂等：重复调用不报错、版本不变', () => {
    const dbPath = path.join(root, 'idem.db');
    const db = new Database(dbPath);
    try {
      migrateKbDatabase(db, 'kb-x');
      migrateKbDatabase(db, 'kb-x');
      migrateKbDatabase(db, 'kb-x');
      expect(db.pragma('user_version', { simple: true })).toBe(KB_SCHEMA_VERSION);
    } finally {
      db.close();
    }
  });

  it('非法 kbId 被拒绝（路径穿越 / 保留字符 / 字面量 undefined）', async () => {
    for (const bad of ['../escape', 'a/b', 'a\\b', '.hidden', 'undefined', 'null', '']) {
      await expect(service.getDb(bad)).rejects.toThrow(/非法/);
    }
  });

  it('listKbIds 只认含 kb.json 的目录，且忽略 . 开头的备份目录', async () => {
    mkKb('kb-a');
    mkKb('kb-b');
    fs.mkdirSync(path.join(root, 'kb-c.new'), { recursive: true }); // 迁移残留
    fs.mkdirSync(path.join(root, '.pre-sqlite', 'kb-old'), { recursive: true });
    fs.writeFileSync(path.join(root, 'loose.txt'), 'x');

    const ids = await service.listKbIds();
    expect(ids.sort()).toEqual(['kb-a', 'kb-b']);
  });
});
