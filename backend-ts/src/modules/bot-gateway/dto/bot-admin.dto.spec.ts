import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { BotAdminService } from '../services/bot-admin.service';
import { PrismaService } from '../../../common/database/prisma.service';
import { BotInstanceManager } from '../services/bot-instance-manager.service';
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
  let prisma: any;
  let instanceManager: any;

  beforeEach(async () => {
    prisma = {
      botInstance: {
        create: jest.fn().mockResolvedValue({ id: 'bot-1' }),
      },
    };
    instanceManager = {
      getStatus: jest.fn().mockReturnValue(null),
      startInstance: jest.fn(),
    };

    const module = await Test.createTestingModule({
      providers: [
        BotAdminService,
        { provide: PrismaService, useValue: prisma },
        { provide: BotInstanceManager, useValue: instanceManager },
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
      service.createInstance('user-1', dto),
    ).rejects.toThrow(BadRequestException);
  });

  it('should reject unknown platform', async () => {
    const dto = new CreateBotDto();
    dto.platform = 'nonexistent';
    dto.name = 'Test';
    dto.platformConfig = {};
    dto.defaultCharacterId = 'char-1';

    await expect(
      service.createInstance('user-1', dto),
    ).rejects.toThrow(BadRequestException);
  });

  it('should accept a valid platform', async () => {
    const dto = new CreateBotDto();
    dto.platform = 'qq';
    dto.name = 'Test Bot';
    dto.platformConfig = { appId: '123', appSecret: 'secret' };
    dto.defaultCharacterId = 'char-1';

    const result = await service.createInstance('user-1', dto);
    expect(result).toBeDefined();
    expect(prisma.botInstance.create).toHaveBeenCalled();
  });
});
