import { RemoteBindingStateService } from "./remote-binding-state.service";
import { SettingsStorage } from "../../common/utils/settings-storage.util";

/**
 * RemoteBindingStateService — 绑定"冻结快照 + 增量注入"状态机测试：
 * - 冷启动初始化（无注入）
 * - 变更 → origin='system' 注入块（systemPromptIds 冻结不动）
 * - 无变化跳过
 * - 压缩刷新（两态对齐 live）
 * - 快照渲染按冻结清单（live 变化不影响）
 */
describe("RemoteBindingStateService", () => {
  type State = { systemPromptIds: string[]; lastInjectedIds: string[] };

  const build = (connections: any[] = []) => {
    const store = new Map<string, Record<string, any>>();
    const settingsStorage = {
      getSettingValue: jest.fn(async (group: string, key: string, def: any) =>
        store.has(`${group}::${key}`) ? store.get(`${group}::${key}`) : def,
      ),
      updateSettings: jest.fn(async (group: string, patch: Record<string, any>) => {
        for (const [k, v] of Object.entries(patch)) {
          store.set(`${group}::${k}`, v);
        }
      }),
    } as unknown as SettingsStorage;
    const workspaceService = {
      getConnections: jest.fn(async () => connections),
    } as any;
    const service = new RemoteBindingStateService(settingsStorage, workspaceService);
    return { service, store, settingsStorage, workspaceService };
  };

  const conns = [
    { id: "c1", name: "server-a", config: { username: "root", host: "1.1.1.1", port: 22, path: "/a" } },
    { id: "c2", name: "server-b", config: { username: "root", host: "2.2.2.2", port: 22, path: "/b" } },
  ];

  it("冷启动：无记录 → 初始化两态为 live，不注入", async () => {
    const { service } = build(conns);
    const blocks = await service.detectAndBuildInjection("s1", ["c1"]);
    expect(blocks).toEqual([]);
    const list = await service.renderSnapshotList("s1", ["c1"]);
    expect(list).toContain('"server-a"');
  });

  it("绑定变更 → origin='system' 注入块，systemPromptIds 冻结不动", async () => {
    const { service } = build(conns);
    await service.detectAndBuildInjection("s1", ["c1"]); // 冷启动
    await service.renderSnapshotList("s1", ["c1"]); // 快照渲染（systemPromptIds=[c1]）

    const blocks = await service.detectAndBuildInjection("s1", ["c1", "c2"]);
    expect(blocks).toHaveLength(1);
    const block: any = blocks[0];
    expect(block.type).toBe("text");
    expect(block.origin).toBe("system");
    expect(block.text).toContain("<system_reminder>");
    expect(block.text).toContain("Remote Workspace Bindings Changed");
    expect(block.text).toContain('"server-b"');

    // 冻结验证：live 已变，但快照仍渲染旧清单（c1）
    const list = await service.renderSnapshotList("s1", ["c1", "c2"]);
    expect(list).toContain('"server-a"');
    expect(list).not.toContain('"server-b"');
  });

  it("无变化 → 不注入", async () => {
    const { service } = build(conns);
    await service.detectAndBuildInjection("s1", ["c1"]);
    const blocks = await service.detectAndBuildInjection("s1", ["c1"]);
    expect(blocks).toEqual([]);
  });

  it("解除绑定 → 注入块声明 none；快照冻结仍含旧清单", async () => {
    const { service } = build(conns);
    await service.detectAndBuildInjection("s1", ["c1"]);
    const blocks = await service.detectAndBuildInjection("s1", []);
    expect(blocks).toHaveLength(1);
    expect((blocks[0] as any).text).toContain("no remote workspaces are bound now");
    const list = await service.renderSnapshotList("s1", []);
    expect(list).toContain('"server-a"');
  });

  it("id→name 容错：连接已删除 → removed 占位", async () => {
    const { service } = build([]);
    await service.detectAndBuildInjection("s1", ["c1"]);
    await service.detectAndBuildInjection("s1", ["c1", "gone"]);
    const blocks = await service.detectAndBuildInjection("s1", ["c1", "gone"]);
    expect(blocks).toEqual([]);
    // 变更发生在上一次调用已注入 — 重新制造变更验证 removed 文案
    const blocks2 = await service.detectAndBuildInjection("s1", ["gone"]);
    expect((blocks2[0] as any).text).toContain('"gone" (removed)');
  });

  it("压缩刷新：两态对齐 live，快照渲染跟随", async () => {
    const { service } = build(conns);
    await service.detectAndBuildInjection("s1", ["c1"]);
    await service.renderSnapshotList("s1", ["c1"]);
    await service.detectAndBuildInjection("s1", ["c1", "c2"]); // 注入变更

    await service.refreshOnCompaction("s1", ["c1", "c2"]);
    const list = await service.renderSnapshotList("s1", ["c1", "c2"]);
    expect(list).toContain('"server-a"');
    expect(list).toContain('"server-b"');
    // 刷新后 lastInjected == live → 无注入
    const blocks = await service.detectAndBuildInjection("s1", ["c1", "c2"]);
    expect(blocks).toEqual([]);
  });
});
