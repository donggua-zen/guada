import { BotFileSenderPlugin } from './bot-file-sender.plugin';
import { BotInstanceManager } from '../services/bot-instance-manager.service';
import { PluginApiImpl } from '../../plugins/api/plugin-api';
import { BotStatus } from '../interfaces/bot-platform.interface';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// ── Helpers ──

function createMockSession(overrides: Record<string, any> = {}) {
  return {
    sessionId: 'session-1',
    userId: 'user-1',
    sessionType: 'bot',
    botId: 'bot-1',
    externalId: 'wechat-personal:private:chat123',
    getWorkspacePath: jest.fn().mockReturnValue(os.tmpdir()),
    ...overrides,
  };
}

function createMockAdapter(sendMediaImpl?: Function) {
  return {
    sendMedia: sendMediaImpl || jest.fn().mockResolvedValue(undefined),
    getPlatform: jest.fn().mockReturnValue('wechat-personal'),
    getCapabilities: jest.fn().mockReturnValue({ sendIntervalMs: 0 }),
  };
}

function createMockBotInstanceManager(
  adapter?: any,
  statusSequence: BotStatus[] = [BotStatus.CONNECTED],
) {
  let statusIndex = 0;
  return {
    getAdapter: jest.fn().mockReturnValue(adapter || createMockAdapter()),
    getStatus: jest.fn().mockImplementation(() => {
      const status = statusSequence[Math.min(statusIndex, statusSequence.length - 1)];
      statusIndex++;
      return status;
    }),
    throttleSend: jest.fn().mockResolvedValue(undefined),
  } as any;
}

/** Extract the tool handler from the plugin's onLoad registration */
function extractToolHandler(plugin: BotFileSenderPlugin): {
  execute: (args: any, ctx?: any) => Promise<string>;
} {
  const api = new PluginApiImpl('bot_file_sender', '文件发送');
  plugin.onLoad(api as any);

  const toolKits = (api as any)._toolKits as any[];
  for (const tk of toolKits) {
    const tools = tk.getTools();
    const sendFileTool = tools.find((t: any) => t.name === 'send_file');
    if (sendFileTool) {
      return { execute: sendFileTool.handler };
    }
  }

  throw new Error('send_file tool not registered');
}

// Use real timers with a mocked RETRY_INTERVAL_MS via jest.spyOn
// We can't easily mock the module constant, so we use real timers with short timeout

// ── Tests ──

describe('BotFileSenderPlugin', () => {
  it('正常发送文件：调用 adapter.sendMedia', async () => {
    const sendMediaMock = jest.fn().mockResolvedValue(undefined);
    const manager = createMockBotInstanceManager(createMockAdapter(sendMediaMock));
    const plugin = new BotFileSenderPlugin(manager);
    const { execute } = extractToolHandler(plugin);

    const tmpFile = path.join(os.tmpdir(), `test-${Date.now()}.txt`);
    fs.writeFileSync(tmpFile, 'test content');

    try {
      const result = await execute(
        { filePath: tmpFile, mediaType: 'file' },
        { session: createMockSession() },
      );

      expect(result).toContain('Sent file');
      expect(sendMediaMock).toHaveBeenCalledWith({
        conversationId: 'chat123',
        mediaType: 'file',
        filePath: tmpFile,
        caption: undefined,
        sourceType: 'private',
      });
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });

  it('非 bot 会话：抛出错误', async () => {
    const plugin = new BotFileSenderPlugin(createMockBotInstanceManager());
    const { execute } = extractToolHandler(plugin);

    await expect(
      execute(
        { filePath: '/tmp/test.txt', mediaType: 'file' },
        { session: createMockSession({ sessionType: 'web' }) },
      ),
    ).rejects.toThrow('only available in bot sessions');
  });

  it('文件不存在：抛出错误', async () => {
    const plugin = new BotFileSenderPlugin(createMockBotInstanceManager());
    const { execute } = extractToolHandler(plugin);

    await expect(
      execute(
        { filePath: '/nonexistent/path/file.txt', mediaType: 'file' },
        { session: createMockSession() },
      ),
    ).rejects.toThrow('File not found');
  });

  it('adapter 不支持 sendMedia：抛出错误', async () => {
    const adapterWithoutSendMedia = {
      getPlatform: jest.fn().mockReturnValue('qq'),
    };
    const manager = createMockBotInstanceManager(adapterWithoutSendMedia);
    const plugin = new BotFileSenderPlugin(manager);
    const { execute } = extractToolHandler(plugin);

    const tmpFile = path.join(os.tmpdir(), `test-${Date.now()}.txt`);
    fs.writeFileSync(tmpFile, 'test content');

    try {
      await expect(
        execute(
          { filePath: tmpFile, mediaType: 'file' },
          { session: createMockSession() },
        ),
      ).rejects.toThrow('does not support sending files');
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });

  it('URL 文件：不检查本地存在性', async () => {
    const sendMediaMock = jest.fn().mockResolvedValue(undefined);
    const manager = createMockBotInstanceManager(createMockAdapter(sendMediaMock));
    const plugin = new BotFileSenderPlugin(manager);
    const { execute } = extractToolHandler(plugin);

    const result = await execute(
      { filePath: 'https://example.com/image.png', mediaType: 'image' },
      { session: createMockSession() },
    );

    expect(result).toContain('Sent image');
    expect(sendMediaMock).toHaveBeenCalledWith({
      conversationId: 'chat123',
      mediaType: 'image',
      filePath: 'https://example.com/image.png',
      caption: undefined,
      sourceType: 'private',
    });
  });

  it('conversationId 从 externalId 正确解析', async () => {
    const sendMediaMock = jest.fn().mockResolvedValue(undefined);
    const manager = createMockBotInstanceManager(createMockAdapter(sendMediaMock));
    const plugin = new BotFileSenderPlugin(manager);
    const { execute } = extractToolHandler(plugin);

    const tmpFile = path.join(os.tmpdir(), `test-${Date.now()}.txt`);
    fs.writeFileSync(tmpFile, 'test');

    try {
      await execute(
        { filePath: tmpFile, mediaType: 'image' },
        {
          session: createMockSession({
            externalId: 'wechat-personal:group:group456',
          }),
        },
      );

      expect(sendMediaMock).toHaveBeenCalledWith(
        expect.objectContaining({ conversationId: 'group456' }),
      );
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });

  it('带 caption 参数', async () => {
    const sendMediaMock = jest.fn().mockResolvedValue(undefined);
    const manager = createMockBotInstanceManager(createMockAdapter(sendMediaMock));
    const plugin = new BotFileSenderPlugin(manager);
    const { execute } = extractToolHandler(plugin);

    const tmpFile = path.join(os.tmpdir(), `test-${Date.now()}.txt`);
    fs.writeFileSync(tmpFile, 'test');

    try {
      await execute(
        { filePath: tmpFile, mediaType: 'image', caption: 'caption text' },
        { session: createMockSession() },
      );

      expect(sendMediaMock).toHaveBeenCalledWith(
        expect.objectContaining({ caption: 'caption text' }),
      );
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });

  // ── Retry logic tests ──

  it('重连后重试成功：第一次 DISCONNECTED，第二次 CONNECTED', async () => {
    const sendMediaMock = jest.fn().mockResolvedValue(undefined);
    const manager = createMockBotInstanceManager(
      createMockAdapter(sendMediaMock),
      [BotStatus.DISCONNECTED, BotStatus.CONNECTED],
    );
    const plugin = new BotFileSenderPlugin(manager);
    const { execute } = extractToolHandler(plugin);

    const tmpFile = path.join(os.tmpdir(), `test-${Date.now()}.txt`);
    fs.writeFileSync(tmpFile, 'test');

    try {
      const result = await execute(
        { filePath: tmpFile, mediaType: 'file' },
        { session: createMockSession() },
      );

      expect(result).toContain('Sent file');
      expect(sendMediaMock).toHaveBeenCalledTimes(1);
      expect(manager.getStatus).toHaveBeenCalledTimes(2);
    } finally {
      fs.unlinkSync(tmpFile);
    }
  }, 15000);

  it('持续断开：重试 3 次后返回错误', async () => {
    const sendMediaMock = jest.fn().mockResolvedValue(undefined);
    const manager = createMockBotInstanceManager(
      createMockAdapter(sendMediaMock),
      [BotStatus.DISCONNECTED, BotStatus.DISCONNECTED, BotStatus.DISCONNECTED],
    );
    const plugin = new BotFileSenderPlugin(manager);
    const { execute } = extractToolHandler(plugin);

    const tmpFile = path.join(os.tmpdir(), `test-${Date.now()}.txt`);
    fs.writeFileSync(tmpFile, 'test');

    try {
      await expect(
        execute(
          { filePath: tmpFile, mediaType: 'file' },
          { session: createMockSession() },
        ),
      ).rejects.toThrow('not connected');
      expect(sendMediaMock).not.toHaveBeenCalled();
      expect(manager.getStatus).toHaveBeenCalledTimes(3);
    } finally {
      fs.unlinkSync(tmpFile);
    }
  }, 15000);

  it('sendMedia 抛错后重试成功', async () => {
    let callCount = 0;
    const sendMediaMock = jest.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) return Promise.reject(new Error('Network error'));
      return Promise.resolve();
    });
    const manager = createMockBotInstanceManager(createMockAdapter(sendMediaMock));
    const plugin = new BotFileSenderPlugin(manager);
    const { execute } = extractToolHandler(plugin);

    const tmpFile = path.join(os.tmpdir(), `test-${Date.now()}.txt`);
    fs.writeFileSync(tmpFile, 'test');

    try {
      const result = await execute(
        { filePath: tmpFile, mediaType: 'file' },
        { session: createMockSession() },
      );

      expect(result).toContain('Sent file');
      expect(sendMediaMock).toHaveBeenCalledTimes(2);
    } finally {
      fs.unlinkSync(tmpFile);
    }
  }, 15000);

  // ── Serialization tests ──

  it('并发调用串行化：两个 send_file 不重叠执行', async () => {
    const executionLog: string[] = [];
    const sendMediaMock = jest.fn().mockImplementation(async () => {
      executionLog.push('start');
      await new Promise((r) => setTimeout(r, 100));
      executionLog.push('end');
    });
    const manager = createMockBotInstanceManager(createMockAdapter(sendMediaMock));
    const plugin = new BotFileSenderPlugin(manager);
    const { execute } = extractToolHandler(plugin);

    const tmpFile = path.join(os.tmpdir(), `test-${Date.now()}.txt`);
    fs.writeFileSync(tmpFile, 'test');

    try {
      // Fire two calls concurrently
      const p1 = execute(
        { filePath: tmpFile, mediaType: 'file' },
        { session: createMockSession() },
      );
      const p2 = execute(
        { filePath: tmpFile, mediaType: 'image' },
        { session: createMockSession() },
      );

      await Promise.all([p1, p2]);

      // If serialized: start, end, start, end
      // If concurrent: start, start, end, end
      expect(executionLog).toEqual(['start', 'end', 'start', 'end']);
      expect(sendMediaMock).toHaveBeenCalledTimes(2);
    } finally {
      fs.unlinkSync(tmpFile);
    }
  }, 15000);
});
