import { RemoteBindingStateService } from "./remote-binding-state.service";
import { SettingsStorage } from "../../common/utils/settings-storage.util";

/**
 * RemoteBindingStateService — 绑定「冻结快照 + 变更渲染」测试：
 * - 冷启动初始化（以 live 建快照，无变更不注入）
 * - 变更 → origin='system' reminder 块；无变化 → null
 * - 快照冻结（live 变化不影响提示词清单）
 * - 压缩刷新（快照对齐 live）
 * - 旧记录兼容（含已废弃的 lastInjectedIds 字段）
 */
describe("RemoteBindingStateService", () => {
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

  it("冷启动：无记录 → 快照以 live 初始化，无变更不注入", async () => {
    const { service } = build(conns);
    expect(await service.getSnapshotIds("s1", ["c1"])).toEqual(["c1"]);
    expect(await service.buildChangeReminder("s1", ["c1"], ["c1"])).toBeNull();
    const list = await service.renderSnapshotList("s1", ["c1"]);
    expect(list).toContain('"server-a"');
  });

  it("绑定变更 → origin='system' reminder 块，快照冻结不动", async () => {
    const { service } = build(conns);
    await service.renderSnapshotList("s1", ["c1"]); // 冷启动建快照 systemPromptIds=[c1]

    const block: any = await service.buildChangeReminder("s1", ["c1"], ["c1", "c2"]);
    expect(block).not.toBeNull();
    expect(block.type).toBe("text");
    expect(block.origin).toBe("system");
    expect(block.text).toContain("<system_reminder>");
    expect(block.text).toContain("Remote Workspace Bindings Changed");
    expect(block.text).toContain('"server-b"');
    expect(block.text).toContain("Newly bound");

    // 冻结验证：live 已变，但提示词快照仍渲染旧清单（c1）
    const list = await service.renderSnapshotList("s1", ["c1", "c2"]);
    expect(list).toContain('"server-a"');
    expect(list).not.toContain('"server-b"');
  });

  it("无变化 → 不注入（null）", async () => {
    const { service } = build(conns);
    expect(await service.buildChangeReminder("s1", ["c1"], ["c1"])).toBeNull();
    // 顺序无关
    expect(await service.buildChangeReminder("s1", ["c2", "c1"], ["c1", "c2"])).toBeNull();
  });

  it("解除绑定 → 块声明 none，并列出 Unbound", async () => {
    const { service } = build(conns);
    const block: any = await service.buildChangeReminder("s1", ["c1"], []);
    expect(block).not.toBeNull();
    expect(block.text).toContain("no remote workspaces are bound now");
    expect(block.text).toContain("Unbound");
  });

  it("id→name 容错：连接已删除 → removed 占位", async () => {
    const { service } = build([]);
    const block: any = await service.buildChangeReminder("s1", [], ["gone"]);
    expect(block).not.toBeNull();
    expect(block.text).toContain('"gone" (removed)');
  });

  it("压缩刷新：快照对齐 live，提示词渲染跟随", async () => {
    const { service } = build(conns);
    await service.renderSnapshotList("s1", ["c1"]); // 冻结为 [c1]
    await service.refreshOnCompaction("s1", ["c1", "c2"]);
    const list = await service.renderSnapshotList("s1", ["c1", "c2"]);
    expect(list).toContain('"server-a"');
    expect(list).toContain('"server-b"');
  });

  it("旧记录兼容：带已废弃 lastInjectedIds 的状态仍按快照读取", async () => {
    const { service, store } = build(conns);
    store.set("chat-session-state:s1::ssh-bindings", {
      systemPromptIds: ["c1"],
      lastInjectedIds: ["c1", "c2"],
    });
    expect(await service.getSnapshotIds("s1", ["c1", "c2"])).toEqual(["c1"]);
  });
});
