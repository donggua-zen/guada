import { WechatPersonalBotAdapter } from './wechat-personal-bot.adapter';
import { PlatformUtilsService } from '../services/platform-utils.service';
import { BotMediaRequest, BotConfig } from '../interfaces/bot-platform.interface';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// Mock IlinkBot — only the methods we need
jest.mock('./wechat-personal-sdk/ilink-bot', () => ({
  IlinkBot: jest.fn(),
}));

function createMockPlatformUtils(): PlatformUtilsService {
  return {
    ensureUniqueFileName: jest.fn().mockImplementation((dir, name) => path.join(dir, name)),
    downloadFile: jest.fn(),
  } as any;
}

function createMockClient() {
  return {
    sendTextToUser: jest.fn(),
    sendPhotoToUser: jest.fn().mockResolvedValue({ messageId: 'msg-1' }),
    sendVideoToUser: jest.fn().mockResolvedValue({ messageId: 'msg-2' }),
    sendDocumentToUser: jest.fn().mockResolvedValue({ messageId: 'msg-3' }),
    on: jest.fn(),
    clearSession: jest.fn(),
    downloadInboundMedia: jest.fn(),
    stopPolling: jest.fn(),
  };
}

/**
 * Create an adapter with client and status set directly,
 * bypassing the connect() login flow.
 */
function createConnectedAdapter(): WechatPersonalBotAdapter {
  const { IlinkBot } = jest.requireMock('./wechat-personal-sdk/ilink-bot');
  const mockClient = createMockClient();
  IlinkBot.mockImplementation(() => mockClient);

  const adapter = new WechatPersonalBotAdapter(createMockPlatformUtils());

  // Set internal state directly to bypass login flow
  const priv = adapter as any;
  priv.client = mockClient;
  priv.status = 'connected';

  return adapter;
}

describe('WechatPersonalBotAdapter - sendMedia', () => {
  let adapter: WechatPersonalBotAdapter;
  let mockClient: any;

  beforeEach(() => {
    adapter = createConnectedAdapter();
    mockClient = (adapter as any).client;
  });

  it('发送图片：调用 sendPhotoToUser', async () => {
    const request: BotMediaRequest = {
      conversationId: 'chat-123',
      mediaType: 'image',
      filePath: '/tmp/test.png',
    };

    await adapter.sendMedia!(request);

    expect(mockClient.sendPhotoToUser).toHaveBeenCalledWith(
      'chat-123',
      '/tmp/test.png',
      { filename: undefined, contentType: undefined, caption: undefined },
    );
  });

  it('发送视频：调用 sendVideoToUser', async () => {
    const request: BotMediaRequest = {
      conversationId: 'chat-123',
      mediaType: 'video',
      filePath: '/tmp/test.mp4',
    };

    await adapter.sendMedia!(request);

    expect(mockClient.sendVideoToUser).toHaveBeenCalledWith(
      'chat-123',
      '/tmp/test.mp4',
      { filename: undefined, contentType: undefined, caption: undefined },
    );
  });

  it('发送文件：调用 sendDocumentToUser', async () => {
    const request: BotMediaRequest = {
      conversationId: 'chat-123',
      mediaType: 'file',
      filePath: '/tmp/test.pdf',
    };

    await adapter.sendMedia!(request);

    expect(mockClient.sendDocumentToUser).toHaveBeenCalledWith(
      'chat-123',
      '/tmp/test.pdf',
      { filename: undefined, contentType: undefined, caption: undefined },
    );
  });

  it('发送图片带 caption 和 filename', async () => {
    const request: BotMediaRequest = {
      conversationId: 'chat-123',
      mediaType: 'image',
      filePath: '/tmp/test.png',
      filename: 'photo.png',
      contentType: 'image/png',
      caption: '看这张图',
    };

    await adapter.sendMedia!(request);

    expect(mockClient.sendPhotoToUser).toHaveBeenCalledWith(
      'chat-123',
      '/tmp/test.png',
      { filename: 'photo.png', contentType: 'image/png', caption: '看这张图' },
    );
  });

  it('未连接时抛出错误', async () => {
    (adapter as any).status = 'stopped';

    const request: BotMediaRequest = {
      conversationId: 'chat-123',
      mediaType: 'image',
      filePath: '/tmp/test.png',
    };

    await expect(adapter.sendMedia!(request)).rejects.toThrow('not connected');
  });

  it('无效类型抛出错误', async () => {
    const request: BotMediaRequest = {
      conversationId: 'chat-123',
      mediaType: 'audio' as any,
      filePath: '/tmp/test.mp3',
    };

    await expect(adapter.sendMedia!(request)).rejects.toThrow('Unsupported media type');
  });

  it('URL 文件直接传递给 SDK', async () => {
    const request: BotMediaRequest = {
      conversationId: 'chat-123',
      mediaType: 'image',
      filePath: 'https://example.com/image.png',
    };

    await adapter.sendMedia!(request);

    expect(mockClient.sendPhotoToUser).toHaveBeenCalledWith(
      'chat-123',
      'https://example.com/image.png',
      { filename: undefined, contentType: undefined, caption: undefined },
    );
  });
});
