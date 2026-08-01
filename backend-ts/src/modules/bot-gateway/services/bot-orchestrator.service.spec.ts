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
      userId: 'user-1',
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
    defaultCharacterId: 'char-1',
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

  it('非流式·多轮：每个 finish 事件发送独立消息', async () => {
    const cb = await setupAndProcess(orchestrator, deps, adapter, config, message);

    cb.onEvent({ type: 'text', content: '让我查一下' });
    await flushPromises();
    cb.onEvent({ type: 'finish', finishReason: 'tool_calls' });
    await flushPromises();
    cb.onEvent({ type: 'tool_calls_response', toolCallsResponse: [] });
    await flushPromises();
    cb.onEvent({ type: 'text', content: '根据结果...' });
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

    cb.onEvent({ type: 'text', content: 'Hello' });
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

    cb.onEvent({ type: 'text', content: 'A' });
    await flushPromises();
    cb.onEvent({ type: 'finish', finishReason: 'tool_calls' });
    await flushPromises();
    cb.onEvent({ type: 'finish', finishReason: 'tool_calls' });
    await flushPromises();
    cb.onEvent({ type: 'text', content: 'B' });
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

    cb.onEvent({ type: 'text', content: 'partial reply' });
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

  it('流式·多轮：finish 事件不影响流式行为，onComplete 发送最终完整内容', async () => {
    const cb = await setupAndProcess(orchestrator, deps, adapter, config, message);

    cb.onEvent({ type: 'text', content: 'A' });
    await flushPromises();
    cb.onEvent({ type: 'finish', finishReason: 'tool_calls' });
    await flushPromises();
    cb.onEvent({ type: 'text', content: 'B' });
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

    cb.onEvent({ type: 'text', content: 'Hello' });
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
});
