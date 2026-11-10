import { SessionService } from "./session.service";

/**
 * 创建会话的模型解析契约（全局默认对话模型移除后）：
 * - modelId → agent.modelId
 * - 两者都没有 → 400 MODEL_REQUIRED
 * - 指定/继承的模型必须可解析
 *
 * 另覆盖创建响应回带目录分组：侧栏目录模式的桶归属只看前端缓存的 projectGroups，
 * 新目录分组若不随响应下发，首个使用该目录的会话会先落进「通用」桶。
 */
describe("SessionService 创建会话模型解析", () => {
  const buildService = (overrides: {
    agent?: any;
    modelExists?: boolean;
    created?: any;
    /** ensureProjectGroup 返回的分组行；缺省为一行可用的 workspace 分组 */
    projectGroupRow?: any;
    /** ensureProjectGroup 抛错（验证「注册失败不阻断建会话」） */
    ensureGroupThrows?: boolean;
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
      ensureProjectGroup: jest.fn(async () => {
        if (overrides.ensureGroupThrows) throw new Error("db boom");
        return (
          overrides.projectGroupRow ?? {
            id: "pg-1",
            path: "/proj/alpha",
            pathKey: "/proj/alpha",
            name: "alpha",
            nameOverridden: true,
            icon: "rocket",
            position: 3,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          }
        );
      }),
    };
    const agentStore = { findById: jest.fn(async () => agent) };
    const modelStore = {
      findModel: jest.fn(() =>
        overrides.modelExists === false ? undefined : { id: "p:m" },
      ),
    };
    const workspaceService = {
      // 真实实现生成的是 `WORK-YYYY-MM-DD-XXXX` 自动目录（不注册为项目分组）
      generateWorkspaceDir: jest.fn(async () => "/base/WORK-2026-07-28-XvZL"),
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

  describe("创建响应回带目录分组", () => {
    const agent = { id: "a1", name: "Agent", modelId: "p:m", settings: {} };

    it("显式真实目录：注册分组并回带投影后的分组视图", async () => {
      const { service, sessionStore } = buildService({ agent });

      const session = await service.createSession({
        agentId: "a1",
        workspacePath: "/proj/alpha",
      });

      expect(sessionStore.ensureProjectGroup).toHaveBeenCalledTimes(1);
      expect(sessionStore.ensureProjectGroup).toHaveBeenCalledWith(
        expect.objectContaining({ path: "/proj/alpha", prepend: true }),
      );
      // 投影口径：position → sortOrder、nameOverridden → isOverridden
      expect(session.projectGroup).toEqual({
        id: "pg-1",
        name: "alpha",
        path: "/proj/alpha",
        pathKey: "/proj/alpha",
        icon: "rocket",
        sortOrder: 3,
        isOverridden: true,
        kind: "workspace",
      });
    });

    it("公共目录不注册，projectGroup 为 null", async () => {
      const { service, sessionStore } = buildService({ agent });

      const session = await service.createSession({
        agentId: "a1",
        workspacePath: "/base/public",
      });

      expect(sessionStore.ensureProjectGroup).not.toHaveBeenCalled();
      expect(session.projectGroup).toBeNull();
    });

    it("自动生成目录不注册，projectGroup 为 null", async () => {
      const { service, sessionStore } = buildService({ agent });

      const session = await service.createSession({
        agentId: "a1",
        workspacePath: "/base/WORK-2026-07-28-XvZL",
      });

      expect(sessionStore.ensureProjectGroup).not.toHaveBeenCalled();
      expect(session.projectGroup).toBeNull();
    });

    it("未传工作目录（自动生成）时 projectGroup 为 null", async () => {
      const { service, sessionStore } = buildService({ agent });

      const session = await service.createSession({ agentId: "a1" });

      expect(sessionStore.ensureProjectGroup).not.toHaveBeenCalled();
      expect(session.projectGroup).toBeNull();
    });

    it("注册失败不阻断建会话，projectGroup 为 null", async () => {
      const { service } = buildService({ agent, ensureGroupThrows: true });

      const session = await service.createSession({
        agentId: "a1",
        workspacePath: "/proj/alpha",
      });

      expect(session.id).toBe("s1");
      expect(session.projectGroup).toBeNull();
    });
  });
});
