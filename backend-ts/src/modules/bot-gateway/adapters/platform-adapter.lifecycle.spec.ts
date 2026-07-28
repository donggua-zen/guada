import { BotConfig } from '../interfaces/bot-platform.interface';
import { LarkBotAdapter } from './lark-bot.adapter';
import { WechatPersonalBotAdapter } from './wechat-personal-bot.adapter';

const config: BotConfig = {
  id: 'platform-bot',
  platform: 'wechat-personal',
  name: 'Platform Bot',
  platformConfig: {},
  enabled: true,
  defaultCharacterId: 'character-1',
};

describe('Platform adapter lifecycle contracts', () => {
  it('wechat-personal shuts down the old polling client before reconnecting', async () => {
    const adapter = new WechatPersonalBotAdapter({} as any);
    (adapter as any).config = config;
    const lifecycle: string[] = [];
    const shutdown = jest
      .spyOn(adapter, 'shutdown')
      .mockImplementation(async () => {
        lifecycle.push('shutdown');
      });
    const connect = jest
      .spyOn(adapter, 'connect')
      .mockImplementation(async () => {
        lifecycle.push('connect');
      });

    await adapter.reconnect();

    expect(shutdown).toHaveBeenCalledTimes(1);
    expect(connect).toHaveBeenCalledTimes(1);
    expect(lifecycle).toEqual(['shutdown', 'connect']);
  });

  it('lark declares SDK-managed reconnect to avoid a second manager reconnect loop', () => {
    const adapter = new LarkBotAdapter({} as any);

    expect(adapter.getCapabilities().handlesReconnectInternally).toBe(true);
  });

  it('lark shutdown closes the SDK WebSocket client exactly once', async () => {
    const adapter = new LarkBotAdapter({} as any);
    const close = jest.fn();
    (adapter as any).wsClient = { close };

    await adapter.shutdown();

    expect(close).toHaveBeenCalledTimes(1);
    expect((adapter as any).wsClient).toBeNull();
  });
});
