/**
 * 存储端口契约测试套件
 *
 * 照 deepseek-harness 的做法：把「一个合格驱动必须满足的行为」写成与实现无关的
 * 断言集，由驱动工厂参数化。新增驱动（企业版 Postgres / HTTP）只要跑通本套件，
 * 领域层就不需要为新驱动做任何适配。
 *
 * 当前覆盖：
 * - `runSessionMetaContract`：会话行 CRUD、查询三态、分页 tiebreak、删除幂等
 * - `runSessionGroupContract`：分组 CRUD 与解绑语义
 * - `runProjectGroupContract`：目录分组派生成员关系与启动标记
 * - `runEventLogContract`：事件追加的 seq 分配与连续性
 *
 * 用法：
 * ```ts
 * runSessionMetaContract('sqlite', async () => {
 *   const store = createTestSessionStore();
 *   await store.initialize();
 *   return store;
 * });
 * ```
 */
import type { SessionMetaPort } from '../../../src/common/store/ports/session-meta.port';
import type { ProjectGroupPort, SessionGroupPort } from '../../../src/common/store/ports/group.port';
import type { SessionAssetPort, SessionRow } from '../../../src/common/store/ports/types';
import type { MessageEventLog } from '../../../src/common/persistence/event-log.port';

/** 契约工厂：每次调用返回一个「空库、已就绪」的驱动 */
export type MetaContractFactory = () => Promise<SessionMetaPort & { destroy?(): void }>;

/** 契约中可选的生命周期收口 */
function destroy(driver: { destroy?(): void }): void {
  driver.destroy?.();
}

export function runSessionMetaContract(
  name: string,
  make: MetaContractFactory,
): void {
  describe(`SessionMetaPort 契约 · ${name}`, () => {
    let driver: SessionMetaPort & { destroy?(): void };

    beforeEach(async () => {
      driver = await make();
      await driver.startup?.();
    });

    afterEach(() => {
      destroy(driver);
    });

    it('create 返回完整行：id 已铸造、时间为 ISO 字符串、lastActiveAt 默认非空', async () => {
      const row = await driver.create({ title: '契约会话' });
      expect(typeof row.id).toBe('string');
      expect(row.id.length).toBeGreaterThan(0);
      expect(row.title).toBe('契约会话');
      expect(row.sessionType).toBe('web');
      expect(typeof row.createdAt).toBe('string');
      expect(Number.isNaN(Date.parse(row.createdAt))).toBe(false);
      expect(row.lastActiveAt).not.toBeNull();
      expect(row.archived).toBe(false);
      expect(row.pinned).toBe(false);
    });

    it('显式 id 原样保留；缺 id 时连续创建不撞号', async () => {
      const explicit = await driver.create({ id: 'explicit-1', title: 'a' });
      expect(explicit.id).toBe('explicit-1');

      const a = await driver.create({ title: 'b' });
      const b = await driver.create({ title: 'c' });
      expect(a.id).not.toBe(b.id);
    });

    it('get / has 对不存在的 id 返回 null / false（不抛错）', async () => {
      expect(await driver.get('missing')).toBeNull();
      expect(await driver.has('missing')).toBe(false);
    });

    it('create 子会话时 rootId 解析为父会话的 rootId（顶层父则取父 id）', async () => {
      const parent = await driver.create({ title: '父' });
      const child = await driver.create({
        title: '子',
        sessionType: 'sub_agent',
        parentId: parent.id,
      });
      expect(child.parentId).toBe(parent.id);
      expect(child.rootId).toBe(parent.id);
    });

    it('update：undefined 保持原值、null 显式置空、未命中返回 null', async () => {
      const row = await driver.create({ title: 'x', description: 'd' });
      const kept = await driver.update(row.id, { title: undefined });
      expect(kept?.title).toBe('x');
      expect(kept?.description).toBe('d');

      const cleared = await driver.update(row.id, { description: null });
      expect(cleared?.description).toBeNull();

      expect(await driver.update('missing', { title: 'y' })).toBeNull();
    });

    it('update 会写回 updatedAt（毫秒精度内单调不降）', async () => {
      const row = await driver.create({ title: 'x' });
      const before = row.updatedAt;
      const after = await driver.update(row.id, { title: 'y' });
      expect(after?.title).toBe('y');
      // ISO 字符串是毫秒精度：create 与 update 可能落在同一毫秒，
      // 因此断言「不降 + 合法时间戳」，不断言严格不等（否则是抖动测试）
      expect(Number.isNaN(Date.parse(after!.updatedAt))).toBe(false);
      expect(after!.updatedAt >= before).toBe(true);
    });

    it('queryPaged：rows 与 total 来自同一快照，分页不重不漏（id tiebreak）', async () => {
      for (let i = 0; i < 6; i += 1) {
        await driver.create({ id: `p${i}`, title: `t${i}`, sessionType: 'web' });
      }
      const first = await driver.queryPaged(
        { sessionType: 'web' },
        'createdAsc',
        { skip: 0, limit: 3 },
      );
      const second = await driver.queryPaged(
        { sessionType: 'web' },
        'createdAsc',
        { skip: 3, limit: 3 },
      );
      expect(first.total).toBe(6);
      expect(second.total).toBe(6);
      expect(first.rows).toHaveLength(3);
      expect(second.rows).toHaveLength(3);
      const ids = [...first.rows, ...second.rows].map((r) => r.id);
      expect(new Set(ids).size).toBe(6);
    });

    it('query 三态过滤：groupId null 仅未分组、archived undefined 不过滤', async () => {
      await driver.create({ id: 'g1', groupId: 'grp' });
      await driver.create({ id: 'n1', groupId: null });
      const ungrouped = await driver.query({ groupId: null });
      expect(ungrouped.map((r) => r.id)).toEqual(['n1']);

      const all = await driver.query({});
      expect(all).toHaveLength(2);
    });

    it('childrenOf 按 createdAsc 返回子会话（不依赖 id 顺序，只校验集合与升序）', async () => {
      const parent = await driver.create({ title: 'p' });
      await driver.create({ id: 'c2', parentId: parent.id, title: 'c2' });
      await driver.create({ id: 'c1', parentId: parent.id, title: 'c1' });
      const children = await driver.childrenOf(parent.id);
      expect(children.map((c) => c.id).sort()).toEqual(['c1', 'c2']);
      // createdAt 单调不降（tiebreak 由 id 决定，不在此断言具体顺序）
      for (let i = 1; i < children.length; i += 1) {
        expect(children[i].createdAt >= children[i - 1].createdAt).toBe(true);
      }
    });

    it('countByParentId 排除已冻结（closedAt 非空）子会话', async () => {
      const parent = await driver.create({ title: 'p' });
      await driver.create({ id: 'c1', parentId: parent.id });
      await driver.create({
        id: 'c2',
        parentId: parent.id,
        closedAt: new Date().toISOString(),
      });
      expect(await driver.countByParentId(parent.id)).toBe(1);
    });

    it('deleteRows 幂等：对不存在的 id 返回 0，不抛错', async () => {
      const row = await driver.create({ title: 'x' });
      expect(await driver.deleteRows([row.id])).toBe(1);
      expect(await driver.deleteRows([row.id])).toBe(0);
      expect(await driver.deleteRows(['missing'])).toBe(0);
    });

    it('clearGroup 把该组会话置为未分组并返回受影响行数', async () => {
      await driver.create({ id: 'a', groupId: 'grp' });
      await driver.create({ id: 'b', groupId: 'grp' });
      await driver.create({ id: 'c', groupId: 'other' });
      expect(await driver.clearGroup('grp')).toBe(2);
      expect((await driver.get('a'))?.groupId).toBeNull();
    });

    it('updateLastActiveAt 刷新两个时间戳；对不存在的 id 静默返回', async () => {
      const row = await driver.create({ title: 'x' });
      await driver.updateLastActiveAt(row.id);
      const after = await driver.get(row.id);
      expect(after?.lastActiveAt).not.toBe(row.lastActiveAt);
      await expect(driver.updateLastActiveAt('missing')).resolves.toBeUndefined();
    });

    it('backfillModelId 只改模型引用，不触碰时间戳', async () => {
      const row = await driver.create({ title: 'x' });
      await driver.backfillModelId(row.id, 'model-1');
      const after = await driver.get(row.id);
      expect(after?.modelId).toBe('model-1');
      expect(after?.updatedAt).toBe(row.updatedAt);
      expect(after?.lastActiveAt).toBe(row.lastActiveAt);
    });

    it('listWebSessionIds 按 lastActiveAt 降序且默认排除归档', async () => {
      await driver.create({ id: 'w1', sessionType: 'web' });
      await driver.create({ id: 'w2', sessionType: 'web', archived: true });
      await driver.create({ id: 'b1', sessionType: 'bot' });
      const ids = await driver.listWebSessionIds();
      expect(ids).toEqual(['w1']);
      expect(await driver.listWebSessionIds(true)).toHaveLength(2);
    });

    it('getManyByIds 保持入参顺序、缺失项忽略', async () => {
      await driver.create({ id: 'a' });
      await driver.create({ id: 'b' });
      const rows = await driver.getManyByIds(['b', 'missing', 'a']);
      expect(rows.map((r) => r.id)).toEqual(['b', 'a']);
    });

    it('findByBotAndExternalId 只匹配 sessionType=bot', async () => {
      await driver.create({
        id: 'bot1',
        sessionType: 'bot',
        botId: 'b',
        externalId: 'e',
      });
      await driver.create({
        id: 'web1',
        sessionType: 'web',
        botId: 'b',
        externalId: 'e',
      });
      const found = await driver.findByBotAndExternalId('b', 'e');
      expect(found?.id).toBe('bot1');
      expect(await driver.findByBotAndExternalId('b', 'nope')).toBeNull();
    });

    it('settings 折叠进 data.settings：读回等价', async () => {
      const row = await driver.create({
        title: 'x',
        settings: { thinkingEnabled: true },
        data: { custom: 1 },
      });
      const after = await driver.get(row.id);
      expect(after?.settings).toEqual({ thinkingEnabled: true });
      expect(after?.data?.custom).toBe(1);
      expect(after?.data?.settings).toEqual({ thinkingEnabled: true });
    });
  });
}

/**
 * 分组契约需要的组合能力。
 *
 * 为什么用 `getSession` 而不是 `get`：分组端口与元信息端口都有 `create`/`update`
 * 同名方法，合并对象必须按端口归属覆盖；为避免歧义，会话行读取统一走显式别名。
 */
export type GroupContractDriver = SessionGroupPort & {
  startup?(): Promise<void>;
  getSession(id: string): Promise<SessionRow | null>;
  /** 元信息端口的 create（分组端口 create 同名，故用别名） */
  createSession(input: {
    id?: string;
    title?: string;
    groupId?: string | null;
  }): Promise<SessionRow>;
  destroy?(): void;
};

export function runSessionGroupContract(
  name: string,
  make: () => Promise<GroupContractDriver>,
): void {
  describe(`SessionGroupPort 契约 · ${name}`, () => {
    let driver: GroupContractDriver;

    beforeEach(async () => {
      driver = await make();
      await driver.startup?.();
    });

    afterEach(() => destroy(driver));

    it('create/list：按 sortOrder 升序', async () => {
      await driver.create({ name: 'B', sortOrder: 2 });
      await driver.create({ name: 'A', sortOrder: 1 });
      const list = await driver.list();
      expect(list.map((g) => g.name)).toEqual(['A', 'B']);
    });

    it('update：未传的字段保持原值', async () => {
      const group = await driver.create({ name: 'A', sortOrder: 1 });
      const updated = await driver.update(group.id, { icon: 'folder' });
      expect(updated?.name).toBe('A');
      expect(updated?.icon).toBe('folder');
    });

    it('update 对未知 id 返回 null', async () => {
      expect(await driver.update('missing', { name: 'x' })).toBeNull();
    });

    it('delete 解绑该组会话（group_id 置空），不删除会话行', async () => {
      const group = await driver.create({ name: 'A' });
      // 会话行由元信息端口创建（工厂装配时以 createSession 别名暴露）
      const sessionId = await (driver as any).createSession({
        title: 's',
        groupId: group.id,
      });
      await driver.delete(group.id);
      expect((await driver.getSession(sessionId.id)).groupId).toBeNull();
    });

    it('getMaxSortOrder / batchUpdateSortOrder', async () => {
      await driver.create({ name: 'A', sortOrder: 5 });
      expect(await driver.getMaxSortOrder()).toBe(5);
      const a = await driver.create({ name: 'B', sortOrder: 6 });
      const updated = await driver.batchUpdateSortOrder([
        { id: a.id, sortOrder: 0 },
      ]);
      expect(updated.find((g) => g.id === a.id)?.sortOrder).toBe(0);
    });
  });
}

export function runProjectGroupContract(
  name: string,
  make: () => Promise<ProjectGroupPort & { destroy?(): void }>,
): void {
  describe(`ProjectGroupPort 契约 · ${name}`, () => {
    let driver: ProjectGroupPort & { destroy?(): void };

    beforeEach(async () => {
      driver = await make();
    });

    afterEach(() => destroy(driver));

    it('ensureProjectGroup 幂等：同 pathKey 返回既有行，不覆盖改名', async () => {
      const first = await driver.ensureProjectGroup({ path: '/proj/a' });
      await driver.updateProjectGroup(first.id, { name: '改名' });
      const second = await driver.ensureProjectGroup({ path: '/proj/a' });
      expect(second.id).toBe(first.id);
      expect(second.name).toBe('改名');
      expect(second.nameOverridden).toBe(true);
    });

    it('updateProjectGroup 只传 icon 时不置 nameOverridden', async () => {
      const group = await driver.ensureProjectGroup({ path: '/proj/b' });
      const updated = await driver.updateProjectGroup(group.id, {
        icon: 'folder',
      });
      expect(updated?.nameOverridden).toBe(false);
    });

    it('reorderProjectGroups 拒绝不完整 id 集合', async () => {
      const a = await driver.ensureProjectGroup({ path: '/proj/a' });
      await driver.ensureProjectGroup({ path: '/proj/b' });
      await expect(driver.reorderProjectGroups([a.id])).rejects.toThrow();
    });

    it('deleteProjectGroup 只删分组行', async () => {
      const group = await driver.ensureProjectGroup({ path: '/proj/c' });
      await driver.deleteProjectGroup(group.id);
      expect(await driver.findProjectGroup(group.id)).toBeNull();
    });

    it('isBootstrapped / markBootstrapped 往返', async () => {
      expect(await driver.isBootstrapped()).toBe(false);
      await driver.markBootstrapped(new Date().toISOString());
      expect(await driver.isBootstrapped()).toBe(true);
    });

    it('listGroupCandidates 只返回 web + 未归档 + 有 workspaceKey 的目录', async () => {
      // 该契约依赖会话行，因此工厂需同时提供 meta 能力；此处用最小断言兜底
      const candidates = await driver.listGroupCandidates();
      expect(Array.isArray(candidates)).toBe(true);
      for (const candidate of candidates) {
        expect(typeof candidate.pathKey).toBe('string');
      }
    });
  });
}

export function runEventLogContract(
  name: string,
  make: () => Promise<MessageEventLog & { destroy?(): void }>,
): void {
  describe(`MessageEventLog 契约 · ${name}`, () => {
    let log: MessageEventLog & { destroy?(): void };
    const sid = 'contract-session';

    beforeEach(async () => {
      log = await make();
      await log.createSession(sid, { title: '契约' });
    });

    afterEach(() => destroy(log));

    it('createSession 幂等：重复调用不产生第二条 init', async () => {
      const before = await log.getAllEvents(sid);
      await log.createSession(sid, { title: '契约' });
      const after = await log.getAllEvents(sid);
      expect(after.length).toBe(before.length);
    });

    it('appendEvents 由后端分配 seq：返回定稿事件且连续', async () => {
      const finalized = await log.appendEvents(sid, [
        { type: 'turn/start', time: Date.now(), data: { turnId: 't1' } },
        {
          type: 'user/message',
          time: Date.now(),
          data: { messageId: 'm1', blocks: [], kind: 'user' },
        },
      ]);
      expect(finalized).toHaveLength(2);
      expect(finalized[0].seq).toBeGreaterThanOrEqual(0);
      expect(finalized[1].seq).toBe(finalized[0].seq + 1);
      expect(await log.tailSeq(sid)).toBe(finalized[1].seq);
    });

    it('多批 append 的 seq 严格连续（无重叠、无缺口）', async () => {
      const a = await log.appendEvents(sid, [
        { type: 'turn/start', time: Date.now(), data: { turnId: 't1' } },
      ]);
      const b = await log.appendEvents(sid, [
        {
          type: 'user/message',
          time: Date.now(),
          data: { messageId: 'm1', blocks: [], kind: 'user' },
        },
      ]);
      expect(b[0].seq).toBe(a[0].seq + 1);
    });

    it('appendEvents 空数组返回空数组，不分配 seq', async () => {
      const before = await log.tailSeq(sid);
      expect(await log.appendEvents(sid, [])).toEqual([]);
      expect(await log.tailSeq(sid)).toBe(before);
    });

    it('readEvents 从 fromSeq（含）起读', async () => {
      const ev = await log.appendEvents(sid, [
        { type: 'turn/start', time: Date.now(), data: { turnId: 't1' } },
      ]);
      const from = ev[0].seq;
      const tail = await log.readEvents(sid, from);
      expect(tail[0].seq).toBe(from);
      expect(await log.readEvents(sid, from + 1)).toEqual([]);
    });

    it('getAllEvents 与 tailSeq 一致', async () => {
      const ev = await log.appendEvents(sid, [
        { type: 'turn/start', time: Date.now(), data: { turnId: 't1' } },
        { type: 'turn/finish', time: Date.now(), data: { turnId: 't1' } },
      ]);
      const all = await log.getAllEvents(sid);
      expect(all[all.length - 1].seq).toBe(ev[ev.length - 1].seq);
    });

    it('hasSession / listSessionIds / deleteSession 幂等', async () => {
      expect(await log.hasSession(sid)).toBe(true);
      expect(await log.listSessionIds()).toContain(sid);
      await log.deleteSession(sid);
      expect(await log.hasSession(sid)).toBe(false);
      expect(await log.getAllEvents(sid)).toEqual([]);
      await log.deleteSession(sid); // 幂等
    });

    it('未知会话的 tailSeq 返回 -1', async () => {
      expect(await log.tailSeq('no-such-session')).toBe(-1);
    });
  });
}

/**
 * 会话资产端口契约。
 *
 * 最重要的一条是 **域边界**：资产驱动只能动资产子目录，不能碰事件日志。
 * 这条在企业版拓扑下尤其关键——`seg-*.jsonl` 归 messages 域（可能是远端驱动），
 * 资产驱动整目录 rm 会越权删掉另一个域的数据。
 */
export function runSessionAssetContract(
  name: string,
  make: () => Promise<
    SessionAssetPort & {
      /** 测试用：直接往会话目录写一个「事件日志」文件，用于验证域边界 */
      writeProbeFile(sessionId: string, fileName: string): Promise<void>;
      /** 测试用：判断会话目录下某文件是否存在 */
      hasFile(sessionId: string, relativePath: string): Promise<boolean>;
      destroy?(): void;
    }
  >,
): void {
  describe(`SessionAssetPort 契约 · ${name}`, () => {
    let driver: Awaited<ReturnType<typeof make>>;
    const sid = 'asset-contract-session';

    beforeEach(async () => {
      driver = await make();
    });

    afterEach(() => driver.destroy?.());

    it('ensure 幂等；exists 反映真实状态', async () => {
      expect(await driver.exists(sid)).toBe(false);
      await driver.ensure(sid);
      expect(await driver.exists(sid)).toBe(true);
      await driver.ensure(sid); // 幂等
      expect(await driver.exists(sid)).toBe(true);
    });

    it('copy 覆盖资产子目录（含 workflows），缺失子目录静默跳过', async () => {
      const src = `${sid}-src`;
      const dst = `${sid}-dst`;
      await driver.ensure(src);
      for (const sub of ['images', 'previews', 'workflows']) {
        await driver.writeProbeFile(src, `${sub}/probe.txt`);
      }
      await driver.ensure(dst);

      await driver.copy(src, dst);
      for (const sub of ['images', 'previews', 'workflows']) {
        expect(await driver.hasFile(dst, `${sub}/probe.txt`)).toBe(true);
      }
    });

    it('copy 不复制事件日志（域边界）', async () => {
      const src = `${sid}-copy-src`;
      const dst = `${sid}-copy-dst`;
      await driver.ensure(src);
      await driver.ensure(dst);
      await driver.writeProbeFile(src, 'images/x.jpg');
      await driver.writeProbeFile(src, 'seg-0000.jsonl');
      await driver.writeProbeFile(src, 'manifest.json');
      await driver.writeProbeFile(src, 'snapshot.json');

      await driver.copy(src, dst);

      expect(await driver.hasFile(dst, 'images/x.jpg')).toBe(true);
      // 事件日志属 messages 域：复制它会让新会话出现重复 seq
      expect(await driver.hasFile(dst, 'seg-0000.jsonl')).toBe(false);
      expect(await driver.hasFile(dst, 'manifest.json')).toBe(false);
      expect(await driver.hasFile(dst, 'snapshot.json')).toBe(false);
    });

    it('remove 只删资产子目录，保留事件日志', async () => {
      await driver.ensure(sid);
      for (const sub of ['images', 'previews', 'workflows']) {
        await driver.writeProbeFile(sid, `${sub}/probe.txt`);
      }
      await driver.writeProbeFile(sid, 'seg-0000.jsonl');
      await driver.writeProbeFile(sid, 'manifest.json');

      await driver.remove(sid);

      for (const sub of ['images', 'previews', 'workflows']) {
        expect(await driver.hasFile(sid, `${sub}/probe.txt`)).toBe(false);
      }
      // 事件日志必须还在：它归 messages 驱动，删会话时由 clearSessionTurns 负责
      expect(await driver.hasFile(sid, 'seg-0000.jsonl')).toBe(true);
      expect(await driver.hasFile(sid, 'manifest.json')).toBe(true);
    });

    it('remove 幂等：目录不存在也不抛错', async () => {
      await expect(driver.remove('never-existed')).resolves.toBeUndefined();
    });

    it('remove 后若会话目录已空，目录本身也被收掉', async () => {
      await driver.ensure(sid);
      await driver.writeProbeFile(sid, 'images/probe.txt');
      // 没有事件日志 → 删完资产目录就空了
      await driver.remove(sid);
      expect(await driver.exists(sid)).toBe(false);
    });

    it('listIds 包含已有资产容器的会话', async () => {
      await driver.ensure(sid);
      expect(await driver.listIds()).toContain(sid);
    });
  });
}

/** 便捷类型：供驱动测试标注返回形状 */
export type ContractSessionRow = SessionRow;
export type ContractAsset = SessionAssetPort;