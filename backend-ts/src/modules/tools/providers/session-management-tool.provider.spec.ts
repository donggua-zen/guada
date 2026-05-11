import { Test, TestingModule } from '@nestjs/testing';
import { ToolOrchestrator } from '../tool-orchestrator.service';
import { SessionManagementToolProvider } from './session-management-tool.provider';
import { PrismaService } from '../../../common/database/prisma.service';
import { KnowledgeBaseToolProvider } from './knowledge-base-tool.provider';
import { MemoryToolProvider } from './memory-tool.provider';
import { MCPToolProvider } from './mcp-tool.provider';
import { TimeToolProvider } from './time-tool.provider';
import { ImageRecognitionToolProvider } from './image-recognition-tool.provider';
import { ShellToolProvider } from './shell-tool.provider';
import { FileToolProvider } from './file-tool.provider';
import { BrowserToolProvider } from './browser-tool.provider';
import { SkillToolBridgeService } from '../../skills/integration/skill-tool-bridge.service';
import { ToolContextFactory } from '../tool-context';

describe('SessionManagementToolProvider Integration', () => {
  let provider: SessionManagementToolProvider;
  let orchestrator: ToolOrchestrator;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SessionManagementToolProvider,
        {
          provide: PrismaService,
          useValue: {
            session: {
              findUnique: jest.fn(),
              update: jest.fn(),
            },
          },
        },
      ],
    }).compile();

    provider = module.get<SessionManagementToolProvider>(SessionManagementToolProvider);
  });

  it('should be defined', () => {
    expect(provider).toBeDefined();
  });

  it('should have correct namespace', () => {
    expect(provider.namespace).toBe('session_management');
  });

  describe('getTools', () => {
    it('should return empty array for non-bot sessions', async () => {
      const tools = await provider.getTools(true, { sessionType: 'web' });
      expect(tools).toEqual([]);
    });

    it('should return tools for bot sessions', async () => {
      const tools = await provider.getTools(true, { sessionType: 'bot' });
      expect(tools).toHaveLength(1);
      expect(tools[0].name).toBe('clear_session');
    });

    it('should return empty array when disabled', async () => {
      const tools = await provider.getTools(false, { sessionType: 'bot' });
      expect(tools).toEqual([]);
    });
  });

  describe('execute', () => {
    it('should throw error if sessionId is missing', async () => {
      await expect(
        provider.execute(
          { id: 'test', name: 'clear_session', arguments: { confirm: true } },
          {}
        )
      ).rejects.toThrow('无法获取会话 ID');
    });

    it('should throw error if sessionType is not bot', async () => {
      await expect(
        provider.execute(
          { id: 'test', name: 'clear_session', arguments: { confirm: true } },
          { sessionId: 'test-session', sessionType: 'web' }
        )
      ).rejects.toThrow('此工具仅在机器人会话中可用');
    });

    it('should throw error if confirm is not true', async () => {
      await expect(
        provider.execute(
          { id: 'test', name: 'clear_session', arguments: { confirm: false } },
          { sessionId: 'test-session', sessionType: 'bot' }
        )
      ).rejects.toThrow('需要设置 confirm: true 来确认清空操作');
    });
  });

  describe('getPrompt', () => {
    it('should return empty string for non-bot sessions', async () => {
      const prompt = await provider.getPrompt({ sessionType: 'web' });
      expect(prompt).toBe('');
    });

    it('should return prompt for bot sessions', async () => {
      const prompt = await provider.getPrompt({ sessionType: 'bot' });
      expect(prompt).toContain('会话管理工具');
      expect(prompt).toContain('clear_session');
    });
  });

  describe('getMetadata', () => {
    it('should return loadMode lazy for bot sessions', () => {
      const metadata = provider.getMetadata({ sessionType: 'bot' });
      expect(metadata.namespace).toBe('session_management');
      expect(metadata.displayName).toBe('会话管理');
      expect(metadata.isMcp).toBe(false);
      expect(metadata.loadMode).toBe('lazy');
    });

    it('should return loadMode none for non-bot sessions', () => {
      const metadata = provider.getMetadata({ sessionType: 'web' });
      expect(metadata.loadMode).toBe('none');
    });

    it('should return loadMode none when sessionType is undefined', () => {
      const metadata = provider.getMetadata({});
      expect(metadata.loadMode).toBe('none');
    });
  });
});
