import {
  BotConfig,
  BotResponse,
  BotStatus,
  PlatformCapabilities,
} from '../interfaces/bot-platform.interface';
import { BaseBotAdapter } from './base-bot.adapter';

class TestBotAdapter extends BaseBotAdapter {
  connectCalls = 0;
  shutdownCalls = 0;
  emitDisconnectOnShutdown = false;
  lifecycle: string[] = [];

  getPlatform(): string {
    return 'mock';
  }

  getCapabilities(): PlatformCapabilities {
    return {
      supportsStreaming: false,
      supportsPushMessage: true,
      supportsTemplateCard: false,
      supportsMultimedia: false,
      handlesReconnectInternally: false,
    };
  }

  async connect(config: BotConfig): Promise<void> {
    this.config = config;
    this.connectCalls++;
    this.lifecycle.push('connect');
    this.status = BotStatus.CONNECTED;
    this.emitConnected();
  }

  async sendMessage(_response: BotResponse): Promise<void> {}

  async shutdown(): Promise<void> {
    this.shutdownCalls++;
    this.lifecycle.push('shutdown');
    this.status = BotStatus.STOPPED;
    if (this.emitDisconnectOnShutdown) {
      this.emitDisconnected({
        code: 1000,
        reason: 'shutdown',
        timestamp: new Date(),
      });
    }
  }
}

const config: BotConfig = {
  id: 'test-bot',
  platform: 'mock',
  name: 'Test Bot',
  platformConfig: {},
  enabled: true,
  defaultCharacterId: 'test-character',
};

describe('BaseBotAdapter reconnect lifecycle', () => {
  it('keeps event subscriptions active after reconnect', async () => {
    const adapter = new TestBotAdapter();
    const connectedEvents: number[] = [];
    const subscription = adapter.onConnect().subscribe(() => {
      connectedEvents.push(connectedEvents.length + 1);
    });

    await adapter.connect(config);
    await adapter.reconnect();

    expect(adapter.connectCalls).toBe(2);
    expect(adapter.shutdownCalls).toBe(1);
    expect(connectedEvents).toHaveLength(2);
    expect(adapter.getStatus()).toBe(BotStatus.CONNECTED);

    subscription.unsubscribe();
  });

  it('always shuts down the old connection before reconnecting', async () => {
    const adapter = new TestBotAdapter();

    await adapter.connect(config);
    adapter.lifecycle = [];
    await adapter.reconnect();

    expect(adapter.lifecycle).toEqual(['shutdown', 'connect']);
  });

  it('emits one shutdown disconnect without completing existing subscriptions', async () => {
    const adapter = new TestBotAdapter();
    adapter.emitDisconnectOnShutdown = true;
    const disconnectEvents = jest.fn();
    const connectEvents = jest.fn();
    const disconnectSubscription = adapter.onDisconnect().subscribe(disconnectEvents);
    const connectSubscription = adapter.onConnect().subscribe(connectEvents);

    await adapter.connect(config);
    await adapter.reconnect();

    expect(disconnectEvents).toHaveBeenCalledTimes(1);
    expect(connectEvents).toHaveBeenCalledTimes(2);

    disconnectSubscription.unsubscribe();
    connectSubscription.unsubscribe();
  });

  it('rejects reconnect before any configuration has been loaded', async () => {
    const adapter = new TestBotAdapter();

    await expect(adapter.reconnect()).rejects.toThrow(
      'Bot configuration is not available for reconnect',
    );
    expect(adapter.shutdownCalls).toBe(0);
  });
});
