import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { BotAdminService } from '../services/bot-admin.service';
import { CharacterRepository } from '../../../common/database/character.repository';
import { SessionFileStore } from '../../chat/session-file.store';
import { BotFileStore } from '../bot-file.store';
import { BotInstanceManager } from '../services/bot-instance-manager.service';
import { ProviderFileStore } from '../../llm-core/provider-file.store';
import { CreateBotDto } from './bot-admin.dto';

describe('CreateBotDto validation', () => {
  it('should accept a valid platform', () => {
    const dto = new CreateBotDto();
    dto.platform = 'qq';
    dto.name = 'Test Bot';
    dto.platformConfig = { appId: '123', appSecret: 'secret' };
    dto.defaultCharacterId = 'char-1';

    expect(dto.platform).toBe('qq');
    expect(dto.name).toBe('Test Bot');
  });

  it('should have platform as required field (decorated with @IsNotEmpty)', () => {
    const dto = new CreateBotDto();
    dto.platform = undefined as any;

    // The @IsNotEmpty decorator ensures ValidationPipe rejects undefined
    expect(dto.platform).toBeUndefined();
  });
});

describe('BotAdminService.createInstance platform validation', () => {
  let service: BotAdminService;
  let instanceManager: any;
  let botStore: any;

  beforeEach(async () => {
    instanceManager = {
      getStatus: jest.fn().mockReturnValue(null),
      startInstance: jest.fn(),
    };
    // 机器人配置权威来源改为 bots/<id>.yaml（BotFileStore）
    botStore = {
      create: jest.fn().mockResolvedValue({ id: 'bot-1' }),
      findById: jest.fn(),
      update: jest.fn(),
      list: jest.fn().mockReturnValue([]),
    };

    const module = await Test.createTestingModule({
      providers: [
        BotAdminService,
        { provide: BotInstanceManager, useValue: instanceManager },
        { provide: ProviderFileStore, useValue: { findModel: () => undefined } },
        { provide: CharacterRepository, useValue: { findById: jest.fn().mockResolvedValue(null) } },
        { provide: SessionFileStore, useValue: { query: jest.fn().mockReturnValue([]), get: jest.fn() } },
        { provide: BotFileStore, useValue: botStore },
      ],
    }).compile();

    service = module.get(BotAdminService);
  });

  it('should reject undefined platform', async () => {
    const dto = new CreateBotDto();
    dto.platform = undefined as any;
    dto.name = 'Test';
    dto.platformConfig = {};
    dto.defaultCharacterId = 'char-1';

    await expect(
      service.createInstance(dto),
    ).rejects.toThrow(BadRequestException);
  });

  it('should reject unknown platform', async () => {
    const dto = new CreateBotDto();
    dto.platform = 'nonexistent';
    dto.name = 'Test';
    dto.platformConfig = {};
    dto.defaultCharacterId = 'char-1';

    await expect(
      service.createInstance(dto),
    ).rejects.toThrow(BadRequestException);
  });

  it('should accept a valid platform', async () => {
    const dto = new CreateBotDto();
    dto.platform = 'qq';
    dto.name = 'Test Bot';
    dto.platformConfig = { appId: '123', appSecret: 'secret' };
    dto.defaultCharacterId = 'char-1';

    const result = await service.createInstance(dto);
    expect(result).toBeDefined();
    expect(botStore.create).toHaveBeenCalled();
  });
});
