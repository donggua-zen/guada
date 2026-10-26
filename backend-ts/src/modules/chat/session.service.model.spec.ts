import { SessionService } from "./session.service";

/**
 * 创建会话的模型解析契约（全局默认对话模型移除后）：
 * - modelId → agent.modelId
 * - 两者都没有 → 400 MODEL_REQUIRED
 * - 指定/继承的模型必须可解析
 */
describe("SessionService 创建会话模型解析", () => {
  const buildService = (overrides: {
    agent?: any;
    modelExists?: boolean;
    created?: any;
  } = {}) => {
    const agent = overrides.agent ?? {
      id: "a1",
      name: "Agent",
      modelId: null,
      settings: {},
    };
    const sessionStore = {
      create: jest.fn(async (data: any) => ({
        id: "s1",
        ...data,
        ...(overrides.created ?? {}),
      })),
      ensureProjectGroup: jest.fn(async () => undefined),
    };
    const agentStore = { findById: jest.fn(async () => agent) };
    const modelStore = {
      findModel: jest.fn(() =>
        overrides.modelExists === false ? undefined : { id: "p:m" },
      ),
    };
    const workspaceService = {
      generateWorkspaceDir: jest.fn(async () => "/tmp/ws"),
      validateCustomWorkspacePath: jest.fn(async () => undefined),
      ensureDirectoryExists: jest.fn(async () => undefined),
      getEffectiveBaseDir: jest.fn(async () => "/base"),
    };
    const contextManager = { ensureSession: jest.fn(async () => undefined) };

    const service = new SessionService(
      sessionStore as any,
      agentStore as any,
      modelStore as any,
      {} as any, // settingsStorage
      {} as any, // llmService
      contextManager as any,
      { toResourceAbsoluteUrl: (u: string) => u } as any,
      workspaceService as any,
      {} as any, // sessionContextFactory
      {} as any, // workspaceWatcherService
      {} as any, // streamManager
      {} as any, // compactionCoordinator
      {} as any, // eventBus
      {} as any, // sessionReplayService
      {} as any, // contentSearch
      { getGroups: async () => [] } as any,
    );

    return { service, sessionStore, modelStore };
  };

  it("请求和智能体都没有模型时返回 MODEL_REQUIRED", async () => {
    const { service, sessionStore } = buildService();

    await expect(service.createSession({ agentId: "a1" })).rejects.toMatchObject({
      response: { code: "MODEL_REQUIRED" },
    });
    expect(sessionStore.create).not.toHaveBeenCalled();
  });

  it("未传 modelId 时继承智能体模型", async () => {
    const { service, sessionStore } = buildService({
      agent: { id: "a1", name: "Agent", modelId: "p:m", settings: {} },
    });

    const session = await service.createSession({ agentId: "a1" });

    expect(sessionStore.create).toHaveBeenCalledWith(
      expect.objectContaining({ modelId: "p:m" }),
    );
    expect(session.modelId).toBe("p:m");
  });

  it("显式 modelId 优先于智能体模型", async () => {
    const { service, sessionStore } = buildService({
      agent: { id: "a1", name: "Agent", modelId: "p:agent", settings: {} },
    });

    await service.createSession({ agentId: "a1", modelId: "p:request" });

    expect(sessionStore.create).toHaveBeenCalledWith(
      expect.objectContaining({ modelId: "p:request" }),
    );
  });

  it("模型无法解析时拒绝创建", async () => {
    const { service, sessionStore } = buildService({
      agent: { id: "a1", name: "Agent", modelId: "p:m", settings: {} },
      modelExists: false,
    });

    await expect(service.createSession({ agentId: "a1" })).rejects.toThrow(
      /模型不存在/,
    );
    expect(sessionStore.create).not.toHaveBeenCalled();
  });
});
