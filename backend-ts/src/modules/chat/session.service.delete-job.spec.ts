import { SessionService } from "./session.service";

/// <reference types="jest" />

function buildService(options: {
  children?: Array<{ id: string }>;
  activeStreams?: Set<string>;
}) {
  const children = options.children ?? [];
  const activeStreams = options.activeStreams ?? new Set<string>();
  const sessionStore = {
    childrenOf: jest.fn(() => children),
    deleteChildrenOf: jest.fn(async () => undefined),
    deleteSession: jest.fn(async () => undefined),
  };
  const streamManager = {
    hasActiveStream: jest.fn((id: string) => activeStreams.has(id)),
  };
  const contextManager = {
    clearSessionTurns: jest.fn(async () => undefined),
  };
  const workspaceWatcher = {
    stopWatchingSession: jest.fn(),
  };
  const jobRegistry = {
    disposeSession: jest.fn(async () => 0),
  };
  const service = new SessionService(
    sessionStore as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    contextManager as any,
    {} as any,
    {} as any,
    {} as any,
    workspaceWatcher as any,
    streamManager as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    jobRegistry as any,
  );
  jest
    .spyOn(service as any, "hydrateSession")
    .mockResolvedValue({ id: "s1" });
  return { service, sessionStore, jobRegistry, contextManager, workspaceWatcher };
}

describe("SessionService.deleteSession × JobRegistry", () => {
  it("删除父会话时 dispose 父会话与 children 的 job", async () => {
    const { service, jobRegistry, sessionStore } = buildService({
      children: [{ id: "c1" }, { id: "c2" }],
    });

    await service.deleteSession("s1", false);

    expect(jobRegistry.disposeSession).toHaveBeenCalledWith("s1");
    expect(jobRegistry.disposeSession).toHaveBeenCalledWith("c1");
    expect(jobRegistry.disposeSession).toHaveBeenCalledWith("c2");
    expect(sessionStore.deleteChildrenOf).toHaveBeenCalledWith("s1");
    expect(sessionStore.deleteSession).toHaveBeenCalledWith("s1");
  });

  it("活跃流护栏先于 job 清理：拒绝删除且不 dispose", async () => {
    const { service, jobRegistry } = buildService({
      children: [{ id: "c1" }],
      activeStreams: new Set(["c1"]),
    });

    await expect(service.deleteSession("s1", false)).rejects.toMatchObject({
      response: { code: "SESSION_STREAMING" },
    });
    expect(jobRegistry.disposeSession).not.toHaveBeenCalled();
  });
});
