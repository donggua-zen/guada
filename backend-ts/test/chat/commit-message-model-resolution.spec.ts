/**
 * 提交信息生成模型解析（SessionService.generateCommitMessageStream）
 *
 * 覆盖回退链：标题总结模型 → 当前对话模型（会话自选 modelId → 智能体 modelId）；
 * 都未配置 → no_model_configured；配置了但解析不到 → model_not_found（fail-loud）。
 *
 * 回归：用户只给会话选了模型、未设置标题模型时，对话正常可用，
 * 但生成提交信息曾报「未配置模型」——回退必须落到会话自选模型。
 */
import { SessionService } from "../../src/modules/chat/session.service";

/// <reference types="jest" />

const TITLE_MODEL = {
  id: "inst-title:m0",
  modelName: "m0",
  name: "M0",
  provider: { id: "inst-title", type: "custom", protocol: "openai" },
};

const SESSION_MODEL = {
  id: "inst-a:m1",
  modelName: "m1",
  name: "M1",
  provider: { id: "inst-a", type: "custom", protocol: "openai" },
};

const AGENT_MODEL = {
  id: "inst-agent:m2",
  modelName: "m2",
  name: "M2",
  provider: { id: "inst-agent", type: "custom", protocol: "openai" },
};

function buildService(opts: {
  titleModelId?: string | null;
  /** undefined = 会话不存在；null = 会话存在但未选模型 */
  sessionModelId?: string | null;
  /** 会话未绑定模型时的智能体兜底模型 */
  agentModelId?: string | null;
  findModel?: (id: string) => any;
}) {
  const sessionStore = {
    get: jest.fn(),
  };
  const modelStore = {
    findModel: jest.fn((id: string) =>
      opts.findModel ? opts.findModel(id) : undefined,
    ),
  };
  const settingsStorage = {
    getSettingValue: jest.fn(async (group: string, key: string) => {
      if (group !== "models") return null;
      if (key === "defaultTitleSummaryModelId") return opts.titleModelId ?? null;
      return null;
    }),
  };
  const llmService = {
    // 规范流式词表（StreamChunk）：正文增量为 text_delta（text 字段）
    completions: jest.fn(async () =>
      (async function* () {
        yield { type: "block_start", index: 0, blockType: "text" };
        yield { type: "text_delta", index: 0, text: "feat: 生成" };
        yield { type: "text_delta", index: 0, text: "提交信息" };
        yield {
          type: "block_end",
          index: 0,
          block: { type: "text", text: "feat: 生成提交信息" },
        };
        yield { type: "finish", finishReason: "stop" };
      })(),
    ),
  };

  const service = new SessionService(
    sessionStore as any, // 1 sessionStore
    {} as any, // 2 agentStore
    modelStore as any, // 3 modelStore
    settingsStorage as any, // 4 settingsStorage
    llmService as any, // 5 llmService
    {} as any, // 6 contextManager
    {} as any, // 7 urlService
    {} as any, // 8 workspaceService
    {} as any, // 9 sessionContextFactory
    {} as any, // 10 workspaceWatcherService
    {} as any, // 11 streamManager
    {} as any, // 12 compactionCoordinator
    {} as any, // 13 eventBus
    {} as any, // 14 sessionReplayService
    {} as any, // 15 contentSearch
    {} as any, // 16 sessionGroupService
  );
  const getSessionById = jest.spyOn(service, "getSessionById").mockImplementation(
    async (id: string) =>
      (opts.sessionModelId === undefined
        ? null
        : {
            id,
            modelId: opts.sessionModelId,
            agent: opts.agentModelId ? { modelId: opts.agentModelId } : null,
          }) as any,
  );

  return {
    service,
    sessionStore,
    getSessionById,
    modelStore,
    settingsStorage,
    llmService,
  };
}

async function collect(gen: AsyncIterable<any>): Promise<any[]> {
  const events: any[] = [];
  for await (const event of gen) events.push(event);
  return events;
}

describe("提交信息生成模型解析", () => {
  it("标题总结模型已配置 → 优先使用，不查会话模型", async () => {
    const { service, getSessionById, llmService } = buildService({
      titleModelId: TITLE_MODEL.id,
      sessionModelId: SESSION_MODEL.id,
      findModel: (id) => (id === TITLE_MODEL.id ? TITLE_MODEL : undefined),
    });

    const events = await collect(
      service.generateCommitMessageStream("s1", "diff"),
    );

    expect(events[events.length - 1]).toMatchObject({
      type: "done",
      modelId: TITLE_MODEL.id,
      modelSource: "title",
    });
    expect(getSessionById).not.toHaveBeenCalled();
    expect(llmService.completions).toHaveBeenCalledWith(
      expect.objectContaining({ model: TITLE_MODEL.modelName }),
    );
  });

  it("无标题模型 + 会话自选模型 → 回退会话当前模型", async () => {
    const { service, getSessionById, llmService } = buildService({
      sessionModelId: SESSION_MODEL.id,
      findModel: (id) => (id === SESSION_MODEL.id ? SESSION_MODEL : undefined),
    });

    const events = await collect(
      service.generateCommitMessageStream("s1", "diff"),
    );

    expect(events[events.length - 1]).toMatchObject({
      type: "done",
      modelId: SESSION_MODEL.id,
      modelSource: "chat",
    });
    expect(getSessionById).toHaveBeenCalledWith("s1");
    expect(llmService.completions).toHaveBeenCalledWith(
      expect.objectContaining({ model: SESSION_MODEL.modelName }),
    );
  });

  it("无标题模型 + 会话未选模型 → 回退智能体模型", async () => {
    const { service, llmService } = buildService({
      sessionModelId: null,
      agentModelId: AGENT_MODEL.id,
      findModel: (id) => (id === AGENT_MODEL.id ? AGENT_MODEL : undefined),
    });

    const events = await collect(
      service.generateCommitMessageStream("s1", "diff"),
    );

    expect(events[events.length - 1]).toMatchObject({
      type: "done",
      modelId: AGENT_MODEL.id,
      modelSource: "chat",
    });
    expect(llmService.completions).toHaveBeenCalledWith(
      expect.objectContaining({ model: AGENT_MODEL.modelName }),
    );
  });

  it("会话和智能体都未配置模型 → skipped no_model_configured", async () => {
    const { service, llmService } = buildService({
      sessionModelId: null,
      agentModelId: null,
    });

    const events = await collect(
      service.generateCommitMessageStream("s1", "diff"),
    );

    expect(events).toEqual([{ type: "skipped", reason: "no_model_configured" }]);
    expect(llmService.completions).not.toHaveBeenCalled();
  });

  it("流式词表回归：text_delta 增量逐条转发并累积为 done.message", async () => {
    // 回归：曾按旧词表读 `type: "text" / content`，与适配器实际输出的 text_delta 不匹配，
    // 导致正文被丢弃、误报「模型未返回有效内容」（generation_failed）
    const { service } = buildService({
      sessionModelId: SESSION_MODEL.id,
      findModel: (id) => (id === SESSION_MODEL.id ? SESSION_MODEL : undefined),
    });

    const events = await collect(
      service.generateCommitMessageStream("s1", "diff"),
    );

    // 前端 SSE 契约仍是 { type: "text", content }，但内容来自 text_delta 增量
    expect(
      events
        .filter((e) => e.type === "text")
        .map((e) => e.content)
        .join(""),
    ).toBe("feat: 生成提交信息");
    expect(events[events.length - 1]).toMatchObject({
      type: "done",
      message: "feat: 生成提交信息",
    });
  });

  it("模型只返回思考内容（无 text_delta）→ skipped generation_failed", async () => {
    const { service, llmService } = buildService({
      sessionModelId: SESSION_MODEL.id,
      findModel: (id) => (id === SESSION_MODEL.id ? SESSION_MODEL : undefined),
    });
    llmService.completions.mockResolvedValueOnce(
      (async function* () {
        yield { type: "reasoning_delta", index: 0, text: "思考中……" };
        yield { type: "finish", finishReason: "stop" };
      })(),
    );

    const events = await collect(
      service.generateCommitMessageStream("s1", "diff"),
    );

    expect(events).toEqual([{ type: "skipped", reason: "generation_failed" }]);
  });

  it("会话自选模型解析不到 → fail-loud model_not_found（不静默换模型）", async () => {
    const { service, llmService } = buildService({
      sessionModelId: "inst-deleted:gone",
      agentModelId: AGENT_MODEL.id,
      findModel: (id) => (id === AGENT_MODEL.id ? AGENT_MODEL : undefined),
    });

    const events = await collect(
      service.generateCommitMessageStream("s1", "diff"),
    );

    expect(events).toEqual([{ type: "skipped", reason: "model_not_found" }]);
    expect(llmService.completions).not.toHaveBeenCalled();
  });

  it("会话未绑定且智能体模型解析不到 → model_not_found", async () => {
    const { service, llmService } = buildService({
      sessionModelId: null,
      agentModelId: "inst-agent:gone",
      findModel: () => undefined,
    });

    const events = await collect(
      service.generateCommitMessageStream("s1", "diff"),
    );

    expect(events).toEqual([{ type: "skipped", reason: "model_not_found" }]);
    expect(llmService.completions).not.toHaveBeenCalled();
  });

  it("标题模型解析不到 → skipped model_not_found", async () => {
    const { service, llmService } = buildService({
      titleModelId: "inst-deleted:gone",
      sessionModelId: SESSION_MODEL.id,
      findModel: () => undefined,
    });

    const events = await collect(
      service.generateCommitMessageStream("s1", "diff"),
    );

    expect(events).toEqual([{ type: "skipped", reason: "model_not_found" }]);
    expect(llmService.completions).not.toHaveBeenCalled();
  });

  it("空 diff → skipped empty_diff，不解析模型", async () => {
    const { service, settingsStorage } = buildService({
      sessionModelId: SESSION_MODEL.id,
    });

    const events = await collect(
      service.generateCommitMessageStream("s1", "   "),
    );

    expect(events).toEqual([{ type: "skipped", reason: "empty_diff" }]);
    expect(settingsStorage.getSettingValue).not.toHaveBeenCalled();
  });
});
