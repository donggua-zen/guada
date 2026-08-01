import { BaseBotAdapter } from '../adapters/base-bot.adapter';
import {
  BotConfig,
  BotMessage,
  BotResponse,
  BotStatus,
  BotRuntimeStatus,
  PlatformCapabilities,
} from '../interfaces/bot-platform.interface';
import { BotInstanceManager } from './bot-instance-manager.service';

interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
}

function createDeferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

class ControlledBotAdapter extends BaseBotAdapter {
  connectCalls = 0;
  shutdownCalls = 0;
  reconnectCalls = 0;
  emitDisconnectOnShutdown = false;
  handlesReconnectInternally = false;
  connectError?: Error;
  reconnectErrors: Error[] = [];
  private nextConnectGate?: Promise<void>;

  getPlatform(): string {
    return 'mock';
  }

  getCapabilities(): PlatformCapabilities {
    return {
      supportsStreaming: false,
      supportsPushMessage: true,
      supportsTemplateCard: false,
      supportsMultimedia: false,
      handlesReconnectInternally: this.handlesReconnectInternally,
    };
  }

  holdNextConnect(): Deferred {
    const deferred = createDeferred();
    this.nextConnectGate = deferred.promise;
    return deferred;
  }

  async connect(config: BotConfig): Promise<void> {
    this.config = config;
    this.connectCalls++;
    this.status = BotStatus.CONNECTING;

    if (this.connectError) throw this.connectError;

    const gate = this.nextConnectGate;
    this.nextConnectGate = undefined;
    if (gate) await gate;

    this.status = BotStatus.CONNECTED;
    this.emitConnected();
  }

  async shutdown(): Promise<void> {
    this.shutdownCalls++;
    this.status = BotStatus.STOPPED;
    if (this.emitDisconnectOnShutdown) {
      this.emitDisconnected({
        code: 1000,
        reason: 'shutdown',
        timestamp: new Date(),
      });
    }
  }

  async reconnect(): Promise<void> {
    this.reconnectCalls++;
    const error = this.reconnectErrors.shift();
    if (error) throw error;
    await super.reconnect();
  }

  async sendMessage(_response: BotResponse): Promise<void> {}

  emitExternalDisconnect(code = 1006): void {
    this.status = BotStatus.DISCONNECTED;
    this.emitDisconnected({
      code,
      reason: 'external disconnect',
      timestamp: new Date(),
    });
  }

  emitIncomingMessage(id: string): void {
    const message: BotMessage = {
      messageId: id,
      senderId: 'sender',
      conversationId: 'conversation',
      content: id,
      messageType: 'text',
      sourceType: 'private',
      timestamp: new Date(),
    };
    this.emitMessage(message);
  }

  observerCounts(): { message: number; connect: number; disconnect: number } {
    return {
      message: this.messageSubject.observers.length,
      connect: this.connectSubject.observers.length,
      disconnect: this.disconnectSubject.observers.length,
    };
  }
}

const BOT_ID = 'bot-1';

function createConfig(
  overrides: Partial<BotConfig['reconnectConfig']> = {},
): BotConfig {
  return {
    id: BOT_ID,
    platform: 'mock',
    name: 'Lifecycle Bot',
    platformConfig: {},
    enabled: true,
    defaultCharacterId: 'character-1',
    reconnectConfig: {
      enabled: true,
      maxRetries: 3,
      retryInterval: 100,
      ...overrides,
    },
  };
}

async function settleMicrotasks(): Promise<void> {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}

describe('BotInstanceManager lifecycle', () => {
  let manager: BotInstanceManager;
  let prisma: any;
  let adapterFactory: any;
  let orchestrator: any;
  let adapters: ControlledBotAdapter[];

  beforeEach(() => {
    jest.useFakeTimers();
    adapters = [];
    prisma = {
      botInstance: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    adapterFactory = {
      createAdapter: jest.fn(() => {
        const adapter = new ControlledBotAdapter();
        adapters.push(adapter);
        return adapter;
      }),
    };
    orchestrator = {
      enqueueMessage: jest.fn().mockResolvedValue(undefined),
      cleanupBot: jest.fn(),
      cleanup: jest.fn(),
    };
    manager = new BotInstanceManager(prisma, adapterFactory, orchestrator);
    (manager as any).logger = {
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    };
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  function currentInstance(): any {
    return (manager as any).botInstances.get(BOT_ID);
  }

  it('registers exactly one subscription for each adapter event stream', async () => {
    await manager.startBot(createConfig());

    expect(adapters[0].observerCounts()).toEqual({
      message: 1,
      connect: 1,
      disconnect: 1,
    });
  });

  it('repeated start replaces the adapter and unsubscribes the old streams', async () => {
    const config = createConfig();
    await manager.startBot(config);
    const first = adapters[0];

    await manager.startBot(config);
    const second = adapters[1];

    expect(first.shutdownCalls).toBe(1);
    expect(first.observerCounts()).toEqual({ message: 0, connect: 0, disconnect: 0 });
    expect(second.observerCounts()).toEqual({ message: 1, connect: 1, disconnect: 1 });

    first.emitIncomingMessage('stale');
    second.emitIncomingMessage('active');
    await settleMicrotasks();

    expect(orchestrator.enqueueMessage).toHaveBeenCalledTimes(1);
    expect(orchestrator.enqueueMessage.mock.calls[0][1].messageId).toBe('active');
  });

  it('rejects restart for an unknown bot without creating an adapter', async () => {
    await expect(manager.restartBot('missing-bot')).rejects.toThrow(
      'Bot not found: missing-bot',
    );
    expect(adapterFactory.createAdapter).not.toHaveBeenCalled();
  });

  it('serializes repeated restarts without accumulating subscriptions', async () => {
    await manager.startBot(createConfig());

    await manager.restartBot(BOT_ID);
    await manager.restartBot(BOT_ID);

    expect(adapters).toHaveLength(3);
    expect(adapters[0].observerCounts()).toEqual({ message: 0, connect: 0, disconnect: 0 });
    expect(adapters[1].observerCounts()).toEqual({ message: 0, connect: 0, disconnect: 0 });
    expect(adapters[2].observerCounts()).toEqual({ message: 1, connect: 1, disconnect: 1 });
    expect(currentInstance().adapter).toBe(adapters[2]);
  });

  it('coalesces concurrent restart requests into one restart cycle', async () => {
    await manager.startBot(createConfig());

    await Promise.all([
      manager.restartBot(BOT_ID),
      manager.restartBot(BOT_ID),
      manager.restartBot(BOT_ID),
    ]);

    expect(adapterFactory.createAdapter).toHaveBeenCalledTimes(2);
    expect(adapters[0].shutdownCalls).toBe(1);
    expect(adapters[1].connectCalls).toBe(1);
    expect(adapters[1].observerCounts()).toEqual({ message: 1, connect: 1, disconnect: 1 });
  });

  it('does not start reconnect while the initial connect call is still pending', async () => {
    const adapter = new ControlledBotAdapter();
    const connectGate = adapter.holdNextConnect();
    adapterFactory.createAdapter.mockReturnValueOnce(adapter);

    const start = manager.startBot(createConfig());
    await settleMicrotasks();
    adapter.emitExternalDisconnect();
    await settleMicrotasks();
    await jest.advanceTimersByTimeAsync(1_000);

    expect(adapter.reconnectCalls).toBe(0);
    expect(currentInstance().reconnectAttempts).toBe(0);

    connectGate.resolve();
    await start;
    expect(adapter.getStatus()).toBe(BotStatus.CONNECTED);
  });

  it('cleans up subscriptions and the instance when initial connect fails', async () => {
    const failing = new ControlledBotAdapter();
    failing.connectError = new Error('invalid credentials');
    adapterFactory.createAdapter.mockReturnValueOnce(failing);

    await expect(manager.startBot(createConfig())).rejects.toThrow('invalid credentials');

    expect(failing.shutdownCalls).toBe(1);
    expect(failing.observerCounts()).toEqual({ message: 0, connect: 0, disconnect: 0 });
    expect(currentInstance()).toBeUndefined();
  });

  it('queues stop behind an in-flight initial connection without leaking the adapter', async () => {
    const adapter = new ControlledBotAdapter();
    const connectGate = adapter.holdNextConnect();
    adapterFactory.createAdapter.mockReturnValueOnce(adapter);

    const start = manager.startBot(createConfig());
    await settleMicrotasks();
    const stop = manager.stopBot(BOT_ID);

    expect(adapter.shutdownCalls).toBe(0);
    connectGate.resolve();
    await Promise.all([start, stop]);

    expect(adapter.shutdownCalls).toBe(1);
    expect(adapter.observerCounts()).toEqual({ message: 0, connect: 0, disconnect: 0 });
    expect(currentInstance()).toBeUndefined();
  });

  it('coalesces repeated stop effects so the adapter is shut down once', async () => {
    await manager.startBot(createConfig());
    const adapter = adapters[0];

    await Promise.all([
      manager.stopBot(BOT_ID),
      manager.stopBot(BOT_ID),
      manager.stopBot(BOT_ID),
    ]);

    expect(adapter.shutdownCalls).toBe(1);
    expect(orchestrator.cleanupBot).toHaveBeenCalledTimes(1);
    expect(currentInstance()).toBeUndefined();
  });

  it('does not reconnect when manual stop makes shutdown emit disconnect', async () => {
    await manager.startBot(createConfig());
    const adapter = adapters[0];
    adapter.emitDisconnectOnShutdown = true;

    await manager.stopBot(BOT_ID);
    await jest.advanceTimersByTimeAsync(1_000);

    expect(adapter.shutdownCalls).toBe(1);
    expect(adapter.reconnectCalls).toBe(0);
    expect(currentInstance()).toBeUndefined();
  });

  it('cleans up immediately when reconnect is disabled', async () => {
    await manager.startBot(createConfig({ enabled: false }));
    const adapter = adapters[0];

    adapter.emitExternalDisconnect();
    await settleMicrotasks();

    expect(adapter.reconnectCalls).toBe(0);
    expect(adapter.shutdownCalls).toBe(1);
    expect(currentInstance()).toBeUndefined();
  });

  it('deduplicates repeated external disconnect events while a timer is pending', async () => {
    await manager.startBot(createConfig());
    const adapter = adapters[0];

    adapter.emitExternalDisconnect();
    adapter.emitExternalDisconnect();
    adapter.emitExternalDisconnect();
    await settleMicrotasks();

    expect(currentInstance().reconnectAttempts).toBe(1);
    await jest.advanceTimersByTimeAsync(100);

    expect(adapter.reconnectCalls).toBe(1);
  });

  it('ignores disconnect emitted by shutdown during an in-flight reconnect', async () => {
    await manager.startBot(createConfig());
    const adapter = adapters[0];
    adapter.emitDisconnectOnShutdown = true;
    const reconnectConnect = adapter.holdNextConnect();

    adapter.emitExternalDisconnect();
    await settleMicrotasks();
    await jest.advanceTimersByTimeAsync(100);
    await settleMicrotasks();

    expect(adapter.reconnectCalls).toBe(1);
    expect(currentInstance().status).toBe(BotRuntimeStatus.RECONNECTING);

    await jest.advanceTimersByTimeAsync(500);
    expect(adapter.reconnectCalls).toBe(1);

    reconnectConnect.resolve();
    await settleMicrotasks();

    expect(currentInstance().status).toBe(BotRuntimeStatus.CONNECTED);
    expect(currentInstance().reconnectAttempts).toBe(0);
  });

  it('shuts down a stale reconnect that completes after the bot was stopped', async () => {
    await manager.startBot(createConfig());
    const adapter = adapters[0];
    const reconnectConnect = adapter.holdNextConnect();

    adapter.emitExternalDisconnect();
    await settleMicrotasks();
    await jest.advanceTimersByTimeAsync(100);
    await settleMicrotasks();
    expect(adapter.reconnectCalls).toBe(1);

    await manager.stopBot(BOT_ID);
    expect(currentInstance()).toBeUndefined();

    reconnectConnect.resolve();
    await settleMicrotasks();

    expect(adapter.getStatus()).toBe(BotStatus.STOPPED);
    expect(adapter.shutdownCalls).toBe(3);
    expect(adapter.observerCounts()).toEqual({ message: 0, connect: 0, disconnect: 0 });
  });

  it('clears a pending reconnect timer when the bot is stopped', async () => {
    await manager.startBot(createConfig());
    const adapter = adapters[0];

    adapter.emitExternalDisconnect();
    await settleMicrotasks();
    await manager.stopBot(BOT_ID);
    await jest.advanceTimersByTimeAsync(1_000);

    expect(adapter.reconnectCalls).toBe(0);
    expect(currentInstance()).toBeUndefined();
  });

  it('does not schedule external reconnect for adapters that handle it internally', async () => {
    await manager.startBot(createConfig());
    const adapter = adapters[0];
    adapter.handlesReconnectInternally = true;

    adapter.emitExternalDisconnect();
    await settleMicrotasks();
    await jest.advanceTimersByTimeAsync(1_000);

    expect(adapter.reconnectCalls).toBe(0);
    expect(currentInstance().reconnectAttempts).toBe(0);
  });

  it('times out one reconnect attempt and schedules only one retry', async () => {
    await manager.startBot(createConfig({ maxRetries: 3 }));
    const adapter = adapters[0];
    const reconnectConnect = adapter.holdNextConnect();
    (manager as any).RECONNECT_TIMEOUT_MS = 500;

    adapter.emitExternalDisconnect();
    await settleMicrotasks();
    await jest.advanceTimersByTimeAsync(100);
    await settleMicrotasks();
    expect(adapter.reconnectCalls).toBe(1);

    await jest.advanceTimersByTimeAsync(500);
    await settleMicrotasks();

    expect(currentInstance().reconnectAttempts).toBe(1);
    expect(currentInstance().status).toBe(BotRuntimeStatus.RECONNECTING);
    expect(currentInstance().reconnectTimer).toBeUndefined();

    await jest.advanceTimersByTimeAsync(1_000);
    expect(adapter.reconnectCalls).toBe(1);

    reconnectConnect.resolve();
    await settleMicrotasks();

    expect(currentInstance().reconnectAttempts).toBe(2);
    // 第二次重连已调度（delay > 0），status 已提前标记为 RECONNECTING
    expect(currentInstance().status).toBe(BotRuntimeStatus.RECONNECTING);
    expect(currentInstance().reconnectTimer).toBeDefined();
    expect(adapter.getStatus()).toBe(BotStatus.STOPPED);

    await manager.stopBot(BOT_ID);
    expect(adapter.reconnectCalls).toBe(1);
  });

  it('retries failed reconnects up to the limit, then cleans up and disables the bot', async () => {
    await manager.startBot(createConfig({ maxRetries: 2 }));
    const adapter = adapters[0];
    adapter.reconnectErrors.push(new Error('retry-1'), new Error('retry-2'));

    adapter.emitExternalDisconnect();
    await settleMicrotasks();
    await jest.advanceTimersByTimeAsync(100);
    await settleMicrotasks();
    await jest.advanceTimersByTimeAsync(100);
    await settleMicrotasks();

    expect(adapter.reconnectCalls).toBe(2);
    expect(adapter.shutdownCalls).toBe(1);
    expect(currentInstance()).toBeUndefined();
    expect(prisma.botInstance.update).toHaveBeenCalledWith({
      where: { id: BOT_ID },
      data: {
        enabled: false,
        status: 'error',
        lastError: 'retry-2',
      },
    });
    expect(adapter.shutdownCalls).toBe(1);
    expect(adapter.observerCounts()).toEqual({ message: 0, connect: 0, disconnect: 0 });
  });

  it('waits for an in-flight start and prevents bot resurrection during shutdown', async () => {
    const adapter = new ControlledBotAdapter();
    const connectGate = adapter.holdNextConnect();
    adapterFactory.createAdapter.mockReturnValueOnce(adapter);

    const start = manager.startBot(createConfig());
    await settleMicrotasks();
    const shutdown = manager.onApplicationShutdown();
    await settleMicrotasks();

    expect(adapter.shutdownCalls).toBe(0);
    connectGate.resolve();
    await Promise.all([start, shutdown]);

    expect(adapter.shutdownCalls).toBe(1);
    expect(currentInstance()).toBeUndefined();
    await expect(manager.startBot(createConfig())).rejects.toThrow(
      'Bot manager is shutting down',
    );
    await expect(manager.restartBot(BOT_ID)).rejects.toThrow(
      'Bot manager is shutting down',
    );
  });

  it('cleans up every adapter once during application shutdown', async () => {
    await manager.startBot(createConfig());
    const secondConfig = { ...createConfig(), id: 'bot-2' };
    await manager.startBot(secondConfig);

    await manager.onApplicationShutdown();

    expect(adapters[0].shutdownCalls).toBe(1);
    expect(adapters[1].shutdownCalls).toBe(1);
    expect((manager as any).botInstances.size).toBe(0);
    expect(orchestrator.cleanup).toHaveBeenCalledTimes(1);
  });
});
