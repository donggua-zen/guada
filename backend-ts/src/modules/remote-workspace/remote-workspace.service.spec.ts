import { HttpException } from "@nestjs/common";
import { RemoteWorkspaceService } from "./remote-workspace.service";
import { SettingsStorage } from "../../common/utils/settings-storage.util";

/**
 * RemoteWorkspaceService 连接名称唯一性测试：
 * - 名称冲突是普通 HTTP 409，不应被全局过滤器误判为 500；
 * - 字符串形态 HttpException 保证前端 ApiService 能读取到具体文案；
 * - 编辑态排除自身，前后空格按归一化值判重。
 */
describe("RemoteWorkspaceService connection names", () => {
  const config = {
    kind: "docker" as const,
    container: "guada-dev",
    path: "/workspace",
  };

  const build = (connections: any[] = []) => {
    const store = new Map<string, Record<string, any>>();
    store.set("remote-workspace::connections", connections);
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
    const service = new RemoteWorkspaceService(settingsStorage);
    return { service, store, settingsStorage };
  };

  const expectConflict = (promise: Promise<unknown>): Promise<void> =>
    promise.then(
      () => {
        throw new Error("expected a conflict");
      },
      (error: HttpException) => {
        expect(error).toBeInstanceOf(HttpException);
        expect(error.getStatus()).toBe(409);
        expect(error.getResponse()).toBe("连接名称已存在，请换一个名称");
      },
    );

  it("新建同名连接 → 409 字符串异常，且不写盘", async () => {
    const { service, settingsStorage } = build([
      { id: "conn_a", name: "我的板子", config },
    ]);

    await expectConflict(service.createConnection("我的板子", config));
    expect(settingsStorage.updateSettings).not.toHaveBeenCalled();
  });

  it("前后空格同名 → 409", async () => {
    const { service } = build([
      { id: "conn_a", name: "我的板子", config },
    ]);

    await expectConflict(service.createConnection("  我的板子  ", config));
  });

  it("新名称保存时归一化为 trim 值", async () => {
    const { service, store } = build();

    const created = await service.createConnection("  server-c  ", config);

    expect(created.name).toBe("server-c");
    expect(store.get("remote-workspace::connections")?.[0].name).toBe("server-c");
  });

  it("编辑改成另一连接名 → 409", async () => {
    const { service, settingsStorage } = build([
      { id: "conn_a", name: "server-a", config },
      { id: "conn_b", name: "server-b", config },
    ]);

    await expectConflict(
      service.updateConnection("conn_a", { name: " server-b " }),
    );
    expect(settingsStorage.updateSettings).not.toHaveBeenCalled();
  });

  it("编辑保持自身原名 → 成功；空名称不覆盖已有名称", async () => {
    const { service, store } = build([
      { id: "conn_a", name: "server-a", config },
      { id: "conn_b", name: "server-b", config },
    ]);

    const updated = await service.updateConnection("conn_a", {
      name: " server-a ",
    });

    expect(updated?.name).toBe("server-a");
    expect(store.get("remote-workspace::connections")?.[0].name).toBe("server-a");

    const unchanged = await service.updateConnection("conn_a", { name: "   " });
    expect(unchanged?.name).toBe("server-a");
    expect(store.get("remote-workspace::connections")?.[0].name).toBe("server-a");
  });
});
