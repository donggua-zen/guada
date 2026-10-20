import { BotOrchestrator } from './bot-orchestrator.service';
import {
  BotMessage,
  BotConfig,
  BotResponse,
  BotStatus,
  BotRuntimeStatus,
  PlatformCapabilities,
  StreamReplyOptions,
} from '../interfaces/bot-platform.interface';
import { BaseBotAdapter } from '../adapters/base-bot.adapter';
import { buildExternalId } from '../utils/external-id';

// ── Mock dependencies ──

interface CapturedCallbacks {
  onEvent: (data: any) => void;
  onComplete: (reason: string) => void;
  onError: (err: any) => void;
}

function createMockDeps() {
  const captured: { callbacks: CapturedCallbacks | null } = { callbacks: null };

  const chatRunner = {
    startStream: jest.fn().mockImplementation((_params: any, callbacks: CapturedCallbacks) => {
      captured.callbacks = callbacks;
      return Promise.resolve(() => {});
    }),
  };

  const sessionMapper = {
    getOrCreateBotSession: jest.fn().mockResolvedValue({
      id: 'session-1',
    }),
  };

  const workspaceService = {
    getWorkspacePath: jest.fn().mockReturnValue('/tmp/test-workspace'),
    getDefaultWorkspaceDir: jest.fn().mockResolvedValue('/tmp/test-workspace'),
  };

  return { chatRunner, sessionMapper, workspaceService, captured };
}

// ── Mock adapters ──

class MockNonStreamingAdapter extends BaseBotAdapter {
  sentMessages: BotResponse[] = [];

  getPlatform(): string {
    return 'mock';
  }

  getCapabilities(): PlatformCapabilities {
    return {
      supportsStreaming: false,
      supportsPushMessage: true,
      supportsTemplateCard: false,
      supportsMultimedia: false,
    };
  }

  async connect(_config: BotConfig): Promise<void> {
    this.status = BotStatus.CONNECTED;
  }

  async sendMessage(response: BotResponse): Promise<void> {
    this.sentMessages.push(response);
  }

  async shutdown(): Promise<void> {
    this.status = BotStatus.STOPPED;
  }
}

class MockStreamingAdapter extends BaseBotAdapter {
  streamReplies: { content: string; options?: StreamReplyOptions }[] = [];
  sentMessages: BotResponse[] = [];

  getPlatform(): string {
    return 'mock-streaming';
  }

  getCapabilities(): PlatformCapabilities {
    return {
      supportsStreaming: true,
      supportsPushMessage: true,
      supportsTemplateCard: false,
      supportsMultimedia: false,
    };
  }

  async connect(_config: BotConfig): Promise<void> {
    this.status = BotStatus.CONNECTED;
  }

  async sendMessage(response: BotResponse): Promise<void> {
    this.sentMessages.push(response);
  }

  async sendStreamReply(
    response: BotResponse,
    options?: StreamReplyOptions,
  ): Promise<boolean> {
    this.streamReplies.push({ content: response.content, options });
    return true;
  }

  async shutdown(): Promise<void> {
    this.status = BotStatus.STOPPED;
  }
}

// ── Helpers ──

function createBotMessage(overrides: Partial<BotMessage> = {}): BotMessage {
  return {
    messageId: 'msg-1',
    senderId: 'user-123',
    senderName: 'TestUser',
    conversationId: 'chat-456',
    content: 'Hello',
    messageType: 'text',
    sourceType: 'private',
    timestamp: new Date(),
    ...overrides,
  };
}

function createBotConfig(): BotConfig {
  return {
    id: 'bot-1',
    platform: 'mock',
    name: 'Test Bot',
    platformConfig: {},
    enabled: true,
    defaultAgentId: 'char-1',
  };
}

function flushPromises(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/**
 * Setup: enqueue message (creates session + queue), then directly call
 * the private handleIncomingMessage to skip the 3s debounce timer.
 *
 * Returns captured callbacks AND a completion promise that resolves when
 * the stream finishes (onComplete/onError), so tests can await after
 * triggering the callbacks.
 */
async function setupAndProcess(
  orchestrator: BotOrchestrator,
  deps: ReturnType<typeof createMockDeps>,
  adapter: MockNonStreamingAdapter | MockStreamingAdapter,
  config: BotConfig,
  message: BotMessage,
): Promise<CapturedCallbacks & { completion: Promise<void> }> {
  const instance = { adapter, config, status: BotRuntimeStatus.CONNECTED };
  await orchestrator.enqueueMessage('bot-1', message, instance);

  const externalId = buildExternalId(config.platform, 'private', message.senderId);
  const queueKey = `bot-1:${externalId}`;
  const priv = orchestrator as any;

  // handleIncomingMessage now awaits stream completion (onComplete/onError).
  // We capture its promise so tests can await it after triggering callbacks.
  const completion = priv.handleIncomingMessage(
    queueKey,
    'bot-1',
    [message],
    instance,
  ) as Promise<void>;

  await flushPromises();
  return { ...deps.captured.callbacks!, completion };
}

// ── Tests ──

describe('BotOrchestrator - 分轮次消息发送', () => {
  let orchestrator: BotOrchestrator;
  let deps: ReturnType<typeof createMockDeps>;
  let adapter: MockNonStreamingAdapter;
  let config: BotConfig;
  let message: BotMessage;

  beforeEach(async () => {
    deps = createMockDeps();
    config = createBotConfig();
    adapter = new MockNonStreamingAdapter();
    await adapter.connect(config);
    message = createBotMessage();
    orchestrator = new BotOrchestrator(
      deps.chatRunner as any,
      deps.sessionMapper as any,
      deps.workspaceService as any,
    );
  });

  afterEach(() => {
    orchestrator.cleanup();
  });

  it('非流式·多轮：每个 finish 事件发送独立消息', async () => {
    const cb = await setupAndProcess(orchestrator, deps, adapter, config, message);

    cb.onEvent({ type: 'text_delta', text: '让我查一下' });
    await flushPromises();
    cb.onEvent({ type: 'finish', finishReason: 'tool_calls' });
    await flushPromises();
    cb.onEvent({ type: 'tool_calls_response', toolCallsResponse: [] });
    await flushPromises();
    cb.onEvent({ type: 'text_delta', text: '根据结果...' });
    await flushPromises();
    cb.onEvent({ type: 'finish', finishReason: 'stop' });
    await flushPromises();
    cb.onComplete('completed');
    await cb.completion;
    await flushPromises();

    expect(adapter.sentMessages).toHaveLength(2);
    expect(adapter.sentMessages[0].content).toBe('让我查一下');
    expect(adapter.sentMessages[1].content).toBe('根据结果...');
  });

  it('非流式·单轮：finish 事件发送消息，onComplete 不重复发送', async () => {
    const cb = await setupAndProcess(orchestrator, deps, adapter, config, message);

    cb.onEvent({ type: 'text_delta', text: 'Hello' });
    await flushPromises();
    cb.onEvent({ type: 'finish', finishReason: 'stop' });
    await flushPromises();
    cb.onComplete('completed');
    await cb.completion;
    await flushPromises();

    expect(adapter.sentMessages).toHaveLength(1);
    expect(adapter.sentMessages[0].content).toBe('Hello');
  });

  it('非流式·空内容：无 text 事件时发送兜底回复', async () => {
    const cb = await setupAndProcess(orchestrator, deps, adapter, config, message);

    cb.onEvent({ type: 'finish', finishReason: 'stop' });
    await flushPromises();
    cb.onComplete('completed');
    await cb.completion;
    await flushPromises();

    expect(adapter.sentMessages).toHaveLength(1);
    expect(adapter.sentMessages[0].content).toBe('抱歉,我暂时无法回复。');
  });

  it('非流式·轮间空 finish：跳过空内容不发送', async () => {
    const cb = await setupAndProcess(orchestrator, deps, adapter, config, message);

    cb.onEvent({ type: 'text_delta', text: 'A' });
    await flushPromises();
    cb.onEvent({ type: 'finish', finishReason: 'tool_calls' });
    await flushPromises();
    cb.onEvent({ type: 'finish', finishReason: 'tool_calls' });
    await flushPromises();
    cb.onEvent({ type: 'text_delta', text: 'B' });
    await flushPromises();
    cb.onEvent({ type: 'finish', finishReason: 'stop' });
    await flushPromises();
    cb.onComplete('completed');
    await cb.completion;
    await flushPromises();

    expect(adapter.sentMessages).toHaveLength(2);
    expect(adapter.sentMessages[0].content).toBe('A');
    expect(adapter.sentMessages[1].content).toBe('B');
  });

  it('非流式·错误处理：onError 发送错误消息', async () => {
    const cb = await setupAndProcess(orchestrator, deps, adapter, config, message);

    cb.onEvent({ type: 'text_delta', text: 'partial reply' });
    await flushPromises();
    cb.onEvent({ type: 'finish', finishReason: 'stop' });
    await flushPromises();
    cb.onError(new Error('Stream failed'));
    await cb.completion;
    await flushPromises();

    expect(adapter.sentMessages).toHaveLength(2);
    expect(adapter.sentMessages[0].content).toBe('partial reply');
    expect(adapter.sentMessages[1].content).toBe('Stream failed');
  });
});

describe('BotOrchestrator - 流式平台不受影响', () => {
  let orchestrator: BotOrchestrator;
  let deps: ReturnType<typeof createMockDeps>;
  let adapter: MockStreamingAdapter;
  let config: BotConfig;
  let message: BotMessage;

  beforeEach(async () => {
    deps = createMockDeps();
    config = { ...createBotConfig(), platform: 'wecom' };
    adapter = new MockStreamingAdapter();
    await adapter.connect(config);
    message = createBotMessage();
    orchestrator = new BotOrchestrator(
      deps.chatRunner as any,
      deps.sessionMapper as any,
      deps.workspaceService as any,
    );
  });

  afterEach(() => {
    orchestrator.cleanup();
  });

  it('流式·多轮：finish 事件不影响流式行为，onComplete 发送最终完整内容', async () => {
    const cb = await setupAndProcess(orchestrator, deps, adapter, config, message);

    cb.onEvent({ type: 'text_delta', text: 'A' });
    await flushPromises();
    cb.onEvent({ type: 'finish', finishReason: 'tool_calls' });
    await flushPromises();
    cb.onEvent({ type: 'text_delta', text: 'B' });
    await flushPromises();
    cb.onEvent({ type: 'finish', finishReason: 'stop' });
    await flushPromises();
    cb.onComplete('completed');
    await cb.completion;
    await flushPromises();

    // 流式平台：finish 事件不触发分条发送
    // text 事件触发 sendStreamReply(finish: false)
    // onComplete 触发 sendStreamReply(finish: true) 发送完整累积内容 "AB"
    const finalReplies = adapter.streamReplies.filter(
      (r) => r.options?.finish === true,
    );
    expect(finalReplies).toHaveLength(1);
    expect(finalReplies[0].content).toBe('AB');
  });

  it('流式·单轮：保持原有流式行为', async () => {
    const cb = await setupAndProcess(orchestrator, deps, adapter, config, message);

    cb.onEvent({ type: 'text_delta', text: 'Hello' });
    await flushPromises();
    cb.onEvent({ type: 'finish', finishReason: 'stop' });
    await flushPromises();
    cb.onComplete('completed');
    await cb.completion;
    await flushPromises();

    const streamUpdates = adapter.streamReplies.filter(
      (r) => r.options?.finish === false,
    );
    const finalReplies = adapter.streamReplies.filter(
      (r) => r.options?.finish === true,
    );
    expect(streamUpdates.length).toBeGreaterThanOrEqual(1);
    expect(finalReplies).toHaveLength(1);
    expect(finalReplies[0].content).toBe('Hello');
  });

  it('流式·快速连续增量：中间帧合并，最终帧包含完整内容', async () => {
    const cb = await setupAndProcess(orchestrator, deps, adapter, config, message);

    cb.onEvent({ type: 'text_delta', text: 'A' });
    cb.onEvent({ type: 'text_delta', text: 'B' });
    cb.onEvent({ type: 'text_delta', text: 'C' });
    cb.onComplete('completed');
    await cb.completion;
    await flushPromises();

    const updates = adapter.streamReplies.filter(
      (r) => r.options?.finish === false,
    );
    const finals = adapter.streamReplies.filter(
      (r) => r.options?.finish === true,
    );

    // 首帧立即发送，间隔内的后续增量被合并
    expect(updates).toHaveLength(1);
    expect(updates[0].content).toBe('A');

    // 最终帧不被合并影响，仍包含完整内容
    expect(finals).toHaveLength(1);
    expect(finals[0].content).toBe('ABC');
  });
});

describe('BotOrchestrator - 错误反馈', () => {
  let orchestrator: BotOrchestrator;
  let deps: ReturnType<typeof createMockDeps>;
  let config: BotConfig;
  let message: BotMessage;

  beforeEach(() => {
    deps = createMockDeps();
    config = createBotConfig();
    message = createBotMessage();
    orchestrator = new BotOrchestrator(
      deps.chatRunner as any,
      deps.sessionMapper as any,
      deps.workspaceService as any,
    );
  });

  afterEach(() => {
    orchestrator.cleanup();
  });

  function queueKeyFor(platform: string, msg: BotMessage): string {
    return `bot-1:${buildExternalId(platform, 'private', msg.senderId)}`;
  }

  it('会话准备失败：向用户发送错误原因', async () => {
    const adapter = new MockNonStreamingAdapter();
    await adapter.connect(config);
    const instance = {
      adapter,
      config,
      status: BotRuntimeStatus.CONNECTED,
    };
    deps.sessionMapper.getOrCreateBotSession.mockRejectedValueOnce(
      new Error('智能体不存在：char-404，请检查 Bot 实例的智能体配置'),
    );

    await orchestrator.enqueueMessage('bot-1', message, instance);

    const queueKey = queueKeyFor(config.platform, message);
    expect(
      (orchestrator as any).messageQueues.get(queueKey)?.sessionError,
    ).toBe('智能体不存在：char-404，请检查 Bot 实例的智能体配置');

    await (orchestrator as any).handleIncomingMessage(
      queueKey,
      'bot-1',
      [message],
      instance,
    );

    expect(adapter.sentMessages).toHaveLength(1);
    expect(adapter.sentMessages[0].content).toBe(
      '智能体不存在：char-404，请检查 Bot 实例的智能体配置',
    );
  });

  it('会话准备失败：流式平台通过 sendStreamReply 发送错误', async () => {
    const adapter = new MockStreamingAdapter();
    const wecomConfig = { ...config, platform: 'wecom' as const };
    await adapter.connect(wecomConfig);
    const instance = {
      adapter,
      config: wecomConfig,
      status: BotRuntimeStatus.CONNECTED,
    };
    deps.sessionMapper.getOrCreateBotSession.mockRejectedValueOnce(
      new Error('Bot 实例未配置默认智能体'),
    );

    await orchestrator.enqueueMessage('bot-1', message, instance);

    const queueKey = queueKeyFor('wecom', message);
    await (orchestrator as any).handleIncomingMessage(
      queueKey,
      'bot-1',
      [message],
      instance,
    );

    const finalReplies = adapter.streamReplies.filter(
      (r) => r.options?.finish === true,
    );
    expect(finalReplies).toHaveLength(1);
    expect(finalReplies[0].content).toBe('Bot 实例未配置默认智能体');
  });

  it('startStream 启动失败：向用户发送错误原因', async () => {
    const adapter = new MockNonStreamingAdapter();
    await adapter.connect(config);
    const instance = {
      adapter,
      config,
      status: BotRuntimeStatus.CONNECTED,
    };
    deps.chatRunner.startStream.mockRejectedValueOnce(
      new Error('当前已有任务正在进行，请等待结束'),
    );

    await orchestrator.enqueueMessage('bot-1', message, instance);

    const queueKey = queueKeyFor(config.platform, message);
    await (orchestrator as any).handleIncomingMessage(
      queueKey,
      'bot-1',
      [message],
      instance,
    );

    expect(adapter.sentMessages).toHaveLength(1);
    expect(adapter.sentMessages[0].content).toBe(
      '当前已有任务正在进行，请等待结束',
    );
  });
});
