import { SessionMapperService } from './session-mapper.service';

function createService(overrides: any = {}) {
  const providerStore = {
    findModel: jest.fn((id: string) => ({ id, modelName: id })),
    ...overrides.providerStore,
  };
  const sessionStore = {
    findByBotAndExternalId: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    ...overrides.sessionStore,
  };
  const agentStore = {
    findById: jest.fn(async (id: string) => ({ id, modelId: 'm-agent' })),
    ...overrides.agentStore,
  };
  const workspaceService = {
    generateWorkspaceDir: jest.fn(async () => '/tmp/bot-session'),
    ...overrides.workspaceService,
  };
  const botStore = {
    findById: jest.fn(() => ({ id: 'bot-1' })),
    ...overrides.botStore,
  };

  const service = new SessionMapperService(
    providerStore as any,
    sessionStore as any,
    agentStore as any,
    workspaceService as any,
    botStore as any,
  );

  return { service, providerStore, sessionStore, agentStore };
}

describe('SessionMapperService bot session enrich', () => {
  it('会话已有 modelId：用户选择优先，并标记 modelSource=session', async () => {
    const { service, providerStore } = createService();
    const session: any = { id: 's1', modelId: 'm-user', settings: {} };

    await service.enrichSession(session, {
      defaultAgentId: 'agent-1',
      defaultModelId: 'm-bot',
      defaultThinkingEffort: 'low',
    });

    expect(providerStore.findModel).toHaveBeenCalledWith('m-user');
    expect(session.modelId).toBe('m-user');
    expect(session.modelSource).toBe('session');
    expect(session.model).toEqual(expect.objectContaining({ id: 'm-user' }));
  });

  it('会话未选择时用 Bot 默认模型，来源 bot', async () => {
    const { service } = createService();
    const session: any = { id: 's1', modelId: null, settings: {} };

    await service.enrichSession(session, {
      defaultAgentId: 'agent-1',
      defaultModelId: 'm-bot',
    });

    expect(session.modelId).toBe('m-bot');
    expect(session.modelSource).toBe('bot');
  });

  it('Bot 也未配置时回退智能体模型，来源 agent', async () => {
    const { service } = createService();
    const session: any = { id: 's1', modelId: null, settings: {} };

    await service.enrichSession(session, {
      defaultAgentId: 'agent-1',
      defaultModelId: null,
    });

    expect(session.modelId).toBe('m-agent');
    expect(session.modelSource).toBe('agent');
  });

  it('思考档位：用户已设置时不被 Bot 默认覆盖', async () => {
    const { service } = createService();
    const session: any = {
      id: 's1',
      modelId: 'm-user',
      settings: { thinkingEffort: 'high' },
    };

    await service.enrichSession(session, {
      defaultAgentId: 'agent-1',
      defaultModelId: 'm-bot',
      defaultThinkingEffort: 'low',
    });

    expect(session.settings.thinkingEffort).toBe('high');
  });

  it('思考档位：用户未设置时用 Bot 默认兜底', async () => {
    const { service } = createService();
    const session: any = { id: 's1', modelId: 'm-user', settings: {} };

    await service.enrichSession(session, {
      defaultAgentId: 'agent-1',
      defaultModelId: 'm-bot',
      defaultThinkingEffort: 'low',
    });

    expect(session.settings.thinkingEffort).toBe('low');
  });

  it('模型不存在时抛错', async () => {
    const { service } = createService({
      providerStore: { findModel: jest.fn(() => null) },
    });
    const session: any = { id: 's1', modelId: 'm-missing', settings: {} };

    await expect(
      service.enrichSession(session, { defaultAgentId: 'agent-1' }),
    ).rejects.toThrow('模型不存在');
  });
});
