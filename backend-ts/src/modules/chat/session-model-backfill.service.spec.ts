import { SessionModelBackfillService } from "./session-model-backfill.service";

describe("SessionModelBackfillService", () => {
  let sessions: Array<{ id: string; agentId: string | null }>;
  let agentModels: Record<string, any>;
  let models: Array<{ id: string; modelType: string }>;
  let sessionStore: {
    initialize: jest.Mock;
    listWebSessionsWithMissingModel: jest.Mock;
    backfillModelId: jest.Mock;
  };
  let agentStore: { findById: jest.Mock };
  let modelStore: { listModels: jest.Mock; findModel: jest.Mock };
  let service: SessionModelBackfillService;

  beforeEach(() => {
    sessions = [];
    agentModels = {};
    models = [{ id: "p:first", modelType: "text" }];
    sessionStore = {
      initialize: jest.fn(async () => undefined),
      listWebSessionsWithMissingModel: jest.fn(() => sessions),
      backfillModelId: jest.fn(async () => undefined),
    };
    agentStore = {
      findById: jest.fn(async (id: string) => agentModels[id] ?? null),
    };
    modelStore = {
      listModels: jest.fn(() => models),
      findModel: jest.fn((id: string) => models.find((model) => model.id === id)),
    };
    service = new SessionModelBackfillService(
      sessionStore as any,
      agentStore as any,
      modelStore as any,
    );
  });

  it("智能体有可解析模型时优先使用智能体模型", async () => {
    models.push({ id: "p:agent", modelType: "text" });
    sessions = [{ id: "s1", agentId: "a1" }];
    agentModels.a1 = { id: "a1", modelId: "p:agent" };

    await service.onApplicationBootstrap();

    expect(sessionStore.backfillModelId).toHaveBeenCalledWith("s1", "p:agent");
  });

  it("智能体无模型时回填第一个可用文本模型", async () => {
    sessions = [{ id: "s1", agentId: "a1" }];
    agentModels.a1 = { id: "a1", modelId: null };

    await service.onApplicationBootstrap();

    expect(sessionStore.backfillModelId).toHaveBeenCalledWith("s1", "p:first");
  });

  it("智能体模型已失效时回退第一个可用文本模型", async () => {
    sessions = [{ id: "s1", agentId: "a1" }];
    agentModels.a1 = { id: "a1", modelId: "p:gone" };

    await service.onApplicationBootstrap();

    expect(sessionStore.backfillModelId).toHaveBeenCalledWith("s1", "p:first");
  });

  it("没有可用模型时保留空值、不写库", async () => {
    models.length = 0;
    sessions = [{ id: "s1", agentId: "a1" }];
    agentModels.a1 = { id: "a1", modelId: null };

    await service.onApplicationBootstrap();

    expect(sessionStore.backfillModelId).not.toHaveBeenCalled();
  });

  it("单条回填失败不影响其他会话", async () => {
    sessions = [
      { id: "s1", agentId: null },
      { id: "s2", agentId: null },
    ];
    sessionStore.backfillModelId
      .mockRejectedValueOnce(new Error("db busy"))
      .mockResolvedValueOnce(undefined);

    await service.onApplicationBootstrap();

    expect(sessionStore.backfillModelId).toHaveBeenCalledTimes(2);
  });

  it("没有待回填会话时不触发写入", async () => {
    await service.onApplicationBootstrap();

    expect(sessionStore.initialize).toHaveBeenCalled();
    expect(sessionStore.backfillModelId).not.toHaveBeenCalled();
  });
});
