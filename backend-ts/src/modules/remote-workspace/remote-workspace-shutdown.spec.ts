import { RemoteAgentManager } from "./remote-workspace-agent-manager";

/// <reference types="jest" />

describe("RemoteAgentManager shutdown reaping", () => {
  function buildManager() {
    const manager = new RemoteAgentManager({} as any);
    const call = jest.fn(async () => ({ killed: 1 }));
    const dispose = jest.fn();
    (manager as any).cache.set("s1::conn1", {
      rpc: { call },
      version: "0.7.0",
      isOpen: () => true,
      dispose,
      busy: false,
      lastActive: Date.now(),
    });
    return { manager, call, dispose };
  }

  afterEach(() => {
    delete process.env.GUADA_KEEP_REMOTE_JOBS_ON_EXIT;
  });

  it("onModuleDestroy 调 killAllProcesses 并释放连接", async () => {
    const { manager, call, dispose } = buildManager();
    await manager.onModuleDestroy();
    expect(call).toHaveBeenCalledWith(
      "killAllProcesses",
      {},
      undefined,
      1_000,
    );
    expect(dispose).toHaveBeenCalled();
  });

  it("GUADA_KEEP_REMOTE_JOBS_ON_EXIT=1 时只释放连接", async () => {
    process.env.GUADA_KEEP_REMOTE_JOBS_ON_EXIT = "1";
    const { manager, call, dispose } = buildManager();
    await manager.onModuleDestroy();
    expect(call).not.toHaveBeenCalled();
    expect(dispose).toHaveBeenCalled();
  });
});
