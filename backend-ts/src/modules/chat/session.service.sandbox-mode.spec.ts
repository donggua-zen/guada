/**
 * 会话读/写入口的 sandboxMode 归一化：
 * - Windows 上历史 read-only 在响应与执行侧都收敛为 workspace-write；
 * - 读取只改响应副本，不原地改写 store 缓存；
 * - 部分 settings 更新不能把旧档位丢掉；
 * - 非 Windows 保持 read-only。
 */
import { SessionService } from "./session.service";

const ORIGINAL_PLATFORM = process.platform;

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, "platform", {
    value: platform,
    configurable: true,
  });
}

function createService(initialSettings: Record<string, any>) {
  const current: any = {
    id: "s1",
    title: "t",
    sessionType: "web",
    agentId: null,
    settings: { ...initialSettings },
  };
  const store = {
    get: jest.fn(() => current),
    childrenOf: jest.fn(() => []),
    update: jest.fn(async (_id: string, data: any) => {
      if (data.settings !== undefined) current.settings = data.settings;
      return { ...current };
    }),
  };
  const service = new SessionService(
    store as any,
    { findById: async () => null } as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    { toResourceAbsoluteUrl: (u: string) => u } as any,
    {} as any,
    {} as any,
    {} as any,
    { hasActiveStream: () => false } as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );
  return { service, store, current };
}

describe("SessionService sandboxMode 归一化（Windows）", () => {
  beforeAll(() => setPlatform("win32"));
  afterAll(() => setPlatform(ORIGINAL_PLATFORM));

  it("读取：历史 read-only 返回 workspace-write，且不改写 store 缓存", async () => {
    const { service, current } = createService({ sandboxMode: "read-only" });

    const session = await service.getSessionById("s1");

    expect(session.settings.sandboxMode).toBe("workspace-write");
    // 响应是副本，store 里的历史值保持不变（等下一次写入再落库）
    expect(current.settings.sandboxMode).toBe("read-only");
  });

  it("更新：旧客户端传 read-only 落库为 workspace-write", async () => {
    const { service, store } = createService({ sandboxMode: "workspace-write" });

    const updated = await service.updateSession("s1", {
      settings: { sandboxMode: "read-only" },
    });

    expect(updated.settings.sandboxMode).toBe("workspace-write");
    expect(store.update).toHaveBeenCalledWith(
      "s1",
      expect.objectContaining({
        settings: expect.objectContaining({ sandboxMode: "workspace-write" }),
      }),
    );
  });

  it("部分更新：未传 sandboxMode 时沿用现值并归一化", async () => {
    const { service, store } = createService({ sandboxMode: "read-only" });

    await service.updateSession("s1", {
      settings: { thinkingEffort: "high" },
    });

    const patch = (store.update as jest.Mock).mock.calls[0][1];
    expect(patch.settings.sandboxMode).toBe("workspace-write");
    expect(patch.settings.thinkingEffort).toBe("high");
  });

  it("非法历史值读取时回退 workspace-write", async () => {
    const { service } = createService({ sandboxMode: "yolo" });
    const session = await service.getSessionById("s1");
    expect(session.settings.sandboxMode).toBe("workspace-write");
  });
});

describe("SessionService sandboxMode 归一化（macOS / Linux）", () => {
  beforeAll(() => setPlatform("linux"));
  afterAll(() => setPlatform(ORIGINAL_PLATFORM));

  it("读取：read-only 保持原值", async () => {
    const { service } = createService({ sandboxMode: "read-only" });
    const session = await service.getSessionById("s1");
    expect(session.settings.sandboxMode).toBe("read-only");
  });

  it("更新：read-only 保持原值", async () => {
    const { service, store } = createService({ sandboxMode: "workspace-write" });

    const updated = await service.updateSession("s1", {
      settings: { sandboxMode: "read-only" },
    });

    expect(updated.settings.sandboxMode).toBe("read-only");
    expect(
      (store.update as jest.Mock).mock.calls[0][1].settings.sandboxMode,
    ).toBe("read-only");
  });
});
