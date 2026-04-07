import { Test, TestingModule } from '@nestjs/testing';
import { SessionService } from './session.service';
import { SessionRepository } from '../../common/database/session.repository';
import { CharacterRepository } from '../../common/database/character.repository';
import { MessageRepository } from '../../common/database/message.repository';
import { ModelRepository } from '../../common/database/model.repository';
import { GlobalSettingRepository } from '../../common/database/global-setting.repository';
import { LLMService } from './llm.service';
import { MemoryManagerService } from './memory.service';

describe('SessionService', () => {
  let service: SessionService;
  let sessionRepo: jest.Mocked<SessionRepository>;
  let characterRepo: jest.Mocked<CharacterRepository>;
  let messageRepo: jest.Mocked<MessageRepository>;
  let modelRepo: jest.Mocked<ModelRepository>;
  let globalSettingRepo: jest.Mocked<GlobalSettingRepository>;
  let llmService: jest.Mocked<LLMService>;
  let memoryManager: jest.Mocked<MemoryManagerService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SessionService,
        {
          provide: SessionRepository,
          useValue: {
            findById: jest.fn(),
            update: jest.fn(),
          },
        },
        {
          provide: CharacterRepository,
          useValue: {},
        },
        {
          provide: MessageRepository,
          useValue: {},
        },
        {
          provide: ModelRepository,
          useValue: {
            findById: jest.fn(),
          },
        },
        {
          provide: GlobalSettingRepository,
          useValue: {
            findByKey: jest.fn(),
          },
        },
        {
          provide: LLMService,
          useValue: {
            completionsNonStream: jest.fn(),
          },
        },
        {
          provide: MemoryManagerService,
          useValue: {
            getRecentMessagesForSummary: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<SessionService>(SessionService);
    sessionRepo = module.get(SessionRepository);
    characterRepo = module.get(CharacterRepository);
    messageRepo = module.get(MessageRepository);
    modelRepo = module.get(ModelRepository);
    globalSettingRepo = module.get(GlobalSettingRepository);
    llmService = module.get(LLMService);
    memoryManager = module.get(MemoryManagerService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('generateTitle', () => {
    it('should return skipped when no title model is configured', async () => {
      const sessionId = 'test-session-id';
      const userId = 'test-user-id';
      const mockSession = { id: sessionId, userId, title: 'Original Title' };

      sessionRepo.findById.mockResolvedValue(mockSession as any);
      globalSettingRepo.findByKey.mockResolvedValue(null);

      const result = await service.generateTitle(sessionId, userId);

      expect(result).toEqual({
        title: 'Original Title',
        skipped: true,
        reason: 'no_title_model_configured',
      });
    });

    it('should return skipped when insufficient messages', async () => {
      const sessionId = 'test-session-id';
      const userId = 'test-user-id';
      const mockSession = { id: sessionId, userId, title: 'Original Title' };

      sessionRepo.findById.mockResolvedValue(mockSession as any);
      globalSettingRepo.findByKey.mockResolvedValue({ value: 'model-id' } as any);
      memoryManager.getRecentMessagesForSummary.mockResolvedValue([]);

      const result = await service.generateTitle(sessionId, userId);

      expect(result).toEqual({
        title: 'Original Title',
        skipped: true,
        reason: 'insufficient_messages',
      });
    });

    it('should generate title successfully', async () => {
      const sessionId = 'test-session-id';
      const userId = 'test-user-id';
      const mockSession = { id: sessionId, userId, title: 'Original Title' };
      const mockModel = { id: 'model-id', name: 'gpt-3.5-turbo' };
      const mockMessages = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' },
      ];
      const mockLlmResponse = { content: 'Test Conversation' };

      sessionRepo.findById.mockResolvedValue(mockSession as any);
      globalSettingRepo.findByKey
        .mockResolvedValueOnce({ value: 'model-id' } as any) // for title model
        .mockResolvedValueOnce({ value: 'Default prompt' } as any); // for title prompt
      modelRepo.findById.mockResolvedValue(mockModel as any);
      memoryManager.getRecentMessagesForSummary.mockResolvedValue(mockMessages as any);
      llmService.completionsNonStream.mockResolvedValue(mockLlmResponse as any);
      sessionRepo.update.mockResolvedValue(mockSession as any);

      const result = await service.generateTitle(sessionId, userId);

      expect(result).toEqual({
        title: 'Test Conversation',
        skipped: false,
        old_title: 'Original Title',
      });
      expect(sessionRepo.update).toHaveBeenCalledWith(sessionId, { title: 'Test Conversation' });
    });
  });
});
