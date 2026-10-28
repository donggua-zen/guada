import { BadRequestException, NotFoundException } from '@nestjs/common';
import { BotAdminService } from './bot-admin.service';

/**
 * 只覆盖本次新增的会话工作台链路；Bot CRUD 已有独立行为和测试面，
 * 这里通过最小 mock 把依赖隔离掉。
 */
function createService(overrides: any = {}) {
  const instanceManager = {
    getStatus: jest.fn().mockReturnValue('connected'),
    getAdapter: jest.fn().mockReturnValue({
      getCapabilities: () => ({ supportsPushMessage: true }),
    }),
    ...overrides.instanceManager,
  };
  const modelStore = { findModel: jest.fn(), ...overrides.modelStore };
  const agentStore = { findManyByIds: jest.fn(), ...overrides.agentStore };
  const sessionStore = {
    initialize: jest.fn(),
    query: jest.fn().mockReturnValue([]),
    get: jest.fn(),
    ...overrides.sessionStore,
  };
  const botStore = {
    list: jest.fn().mockReturnValue([]),
    /** 服务读 listOrdered；委托到 list 让既有 stub 继续生效 */
    listOrdered: jest.fn(() => botStore.list()),
    findById: jest.fn(),
    reorder: jest.fn().mockResolvedValue([]),
    ...overrides.botStore,
  };
  const sessionMapper = {
    enrichSession: jest.fn(),
    ...overrides.sessionMapper,
  };
  const chatRunner = {
    startStream: jest.fn().mockResolvedValue(jest.fn()),
    ...overrides.chatRunner,
  };
  const eventBus = { emit: jest.fn(), ...overrides.eventBus };

  const service = new BotAdminService(
    instanceManager as any,
    modelStore as any,
    agentStore as any,
    sessionStore as any,
    botStore as any,
    sessionMapper as any,
    chatRunner as any,
    eventBus as any,
  );

  return {
    service,
    instanceManager,
    sessionStore,
    botStore,
    sessionMapper,
    chatRunner,
    eventBus,
  };
}

const botSession = {
  id: 'session-1',
  sessionType: 'bot',
  botId: 'bot-1',
  platform: 'qq',
  externalId: 'qq:private:user-a',
  title: 'QQ 私聊 user-a',
  lastActiveAt: new Date('2026-01-01T00:00:00.000Z'),
  data: { botUser: { name: '张三' } },
};

const botInstance = {
  id: 'bot-1',
  name: '机器人一',
  platform: 'qq',
  enabled: true,
  status: 'running',
  defaultAgentId: 'agent-1',
  defaultModelId: 'model-1',
  defaultThinkingEffort: null,
  additionalKwargs: null,
};

describe('BotAdminService bot chat workspace', () => {
  it('aggregates bot sessions and marks online bots', async () => {
    const { service, sessionStore, botStore, instanceManager } = createService();
    sessionStore.query.mockReturnValue([botSession]);
    botStore.list.mockReturnValue([botInstance]);

    const result = await service.getChatGroups(10);

    expect(sessionStore.initialize).toHaveBeenCalled();
    expect(instanceManager.getStatus).toHaveBeenCalledWith('bot-1');
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].online).toBe(true);
    expect(result.groups[0].conversations[0].displayName).toBe('张三');
  });

  it('broadcasts bot.changed after reorder', async () => {
    const { service, botStore, eventBus } = createService();
    botStore.reorder.mockResolvedValue([{ id: 'bot-1', sortOrder: 0 }]);

    await service.reorderInstances(['bot-1']);

    expect(eventBus.emit).toHaveBeenCalledWith(
      'bot.changed',
      expect.objectContaining({ action: 'reordered' }),
    );
  });

  it('returns a warning instead of throwing when the bot is gone', async () => {
    const { service, sessionStore, botStore } = createService();
    sessionStore.get.mockReturnValue(botSession);
    botStore.findById.mockReturnValue(undefined);

    const result = await service.getSessionDetail('session-1');

    expect(result.bot).toBeNull();
    expect(result.canReply).toBe(false);
    expect(result.warning).toContain('机器人不存在');
    expect(result.session.agent).toBeNull();
  });

  it('enriches agent/model and reports canReply=true', async () => {
    const { service, sessionStore, botStore, sessionMapper } = createService();
    sessionStore.get.mockReturnValue(botSession);
    botStore.findById.mockReturnValue(botInstance);
    sessionMapper.enrichSession.mockImplementation(async (session: any) => {
      session.agent = { id: 'agent-1' };
      session.model = { id: 'model-1' };
      session.modelId = 'model-1';
    });

    const result = await service.getSessionDetail('session-1');

    expect(result.canReply).toBe(true);
    expect(result.session.agent).toEqual({ id: 'agent-1' });
    expect(result.bot?.supportsPushMessage).toBe(true);
  });

  it('rejects non-bot sessions', async () => {
    const { service, sessionStore } = createService();
    sessionStore.get.mockReturnValue({ ...botSession, sessionType: 'web' });

    await expect(service.sendSessionMessage('session-1', { content: 'hi' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('starts a stream with the enriched bot session', async () => {
    const { service, sessionStore, botStore, sessionMapper, chatRunner } = createService();
    sessionStore.get.mockReturnValue(botSession);
    botStore.findById.mockReturnValue(botInstance);
    sessionMapper.enrichSession.mockImplementation(async (session: any) => {
      session.agent = { id: 'agent-1' };
      session.modelId = 'model-1';
    });

    const result = await service.sendSessionMessage('session-1', {
      content: '继续聊',
    });

    expect(result).toEqual({ ok: true, started: true });
    expect(chatRunner.startStream).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'session-1',
        source: { origin: 'bot-admin', botId: 'bot-1' },
        preloadedSession: expect.objectContaining({ id: 'session-1' }),
        userMessage: expect.objectContaining({ content: '继续聊' }),
      }),
    );
  });

  it('rejects forwarding to IM in the current version', async () => {
    const { service, sessionStore, botStore, sessionMapper } = createService();
    sessionStore.get.mockReturnValue(botSession);
    botStore.findById.mockReturnValue(botInstance);
    sessionMapper.enrichSession.mockImplementation(async (session: any) => {
      session.agent = { id: 'agent-1' };
      session.modelId = 'model-1';
    });

    await expect(
      service.sendSessionMessage('session-1', {
        content: '继续聊',
        forwardToPlatform: true,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('throws 404 when the session does not exist', async () => {
    const { service, sessionStore } = createService();
    sessionStore.get.mockReturnValue(undefined);

    await expect(service.getSessionDetail('missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
