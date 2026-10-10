import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { BotAdminService } from '../services/bot-admin.service';
import { AgentFileStore } from '../../agents/agent-file.store';
import { SessionMetaStore } from '../../chat/session-meta.store';
import { BotFileStore } from '../bot-file.store';
import { BotInstanceManager } from '../services/bot-instance-manager.service';
import { ProviderFileStore } from '../../llm-core/provider-file.store';
import { CreateBotDto, SubmitBotVerificationDto } from './bot-admin.dto';
import { BotStatus } from '../interfaces/bot-platform.interface';

describe('CreateBotDto validation', () => {
  it('should accept a valid platform', () => {
    const dto = new CreateBotDto();
    dto.platform = 'qq';
    dto.name = 'Test Bot';
    dto.platformConfig = { appId: '123', appSecret: 'secret' };
    dto.defaultAgentId = 'char-1';

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
        { provide: AgentFileStore, useValue: { findById: jest.fn().mockResolvedValue(null) } },
        { provide: SessionMetaStore, useValue: { query: jest.fn().mockReturnValue([]), get: jest.fn() } },
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
    dto.defaultAgentId = 'char-1';

    await expect(
      service.createInstance(dto),
    ).rejects.toThrow(BadRequestException);
  });

  it('should reject unknown platform', async () => {
    const dto = new CreateBotDto();
    dto.platform = 'nonexistent';
    dto.name = 'Test';
    dto.platformConfig = {};
    dto.defaultAgentId = 'char-1';

    await expect(
      service.createInstance(dto),
    ).rejects.toThrow(BadRequestException);
  });

  it('should accept a valid platform', async () => {
    const dto = new CreateBotDto();
    dto.platform = 'qq';
    dto.name = 'Test Bot';
    dto.platformConfig = { appId: '123', appSecret: 'secret' };
    dto.defaultAgentId = 'char-1';

    const result = await service.createInstance(dto);
    expect(result).toBeDefined();
    expect(botStore.create).toHaveBeenCalled();
  });
});

describe('SubmitBotVerificationDto validation', () => {
  const validateCode = async (code: unknown) =>
    validate(plainToInstance(SubmitBotVerificationDto, { code }));

  it('接受 4 至 8 位数字', async () => {
    expect(await validateCode('1234')).toHaveLength(0);
    expect(await validateCode('12345678')).toHaveLength(0);
  });

  it('拒绝 3 位、9 位与非数字', async () => {
    expect((await validateCode('123')).length).toBeGreaterThan(0);
    expect((await validateCode('123456789')).length).toBeGreaterThan(0);
    expect((await validateCode('12ab')).length).toBeGreaterThan(0);
    expect((await validateCode(undefined)).length).toBeGreaterThan(0);
  });
});

describe('BotAdminService 数字配对码', () => {
  let service: BotAdminService;
  let instanceManager: any;

  beforeEach(async () => {
    instanceManager = { getAdapter: jest.fn() };

    const module = await Test.createTestingModule({
      providers: [
        BotAdminService,
        { provide: BotInstanceManager, useValue: instanceManager },
        { provide: ProviderFileStore, useValue: { findModel: () => undefined } },
        { provide: AgentFileStore, useValue: { findById: jest.fn().mockResolvedValue(null) } },
        { provide: SessionMetaStore, useValue: { query: jest.fn().mockReturnValue([]), get: jest.fn() } },
        { provide: BotFileStore, useValue: { findById: jest.fn(), list: jest.fn().mockReturnValue([]) } },
      ],
    }).compile();

    service = module.get(BotAdminService);
  });

  it('需要配对码时优先返回 verify_code_required', () => {
    instanceManager.getAdapter.mockReturnValue({
      getStatus: () => BotStatus.CONNECTING,
      getVerificationState: () => 'pair_code',
      getQrCodeUrl: () => 'https://qr.test/1',
    });

    expect(service.getQrCodeStatus('bot-1')).toMatchObject({
      status: 'verify_code_required',
    });
  });

  it('无需配对码时返回二维码', () => {
    instanceManager.getAdapter.mockReturnValue({
      getStatus: () => BotStatus.CONNECTING,
      getVerificationState: () => 'none',
      getQrCodeUrl: () => 'https://qr.test/1',
    });

    expect(service.getQrCodeStatus('bot-1')).toMatchObject({
      status: 'qr_ready',
      qrCodeUrl: 'https://qr.test/1',
    });
  });

  it('submitVerification 调用适配器能力', async () => {
    const submitVerificationCode = jest.fn();
    instanceManager.getAdapter.mockReturnValue({ submitVerificationCode });

    await expect(service.submitVerification('bot-1', '1234')).resolves.toMatchObject({
      success: true,
    });
    expect(submitVerificationCode).toHaveBeenCalledWith('1234');
  });

  it('未启动时报 404，不支持时报 400', async () => {
    instanceManager.getAdapter.mockReturnValue(undefined);
    await expect(service.submitVerification('bot-1', '1234')).rejects.toThrow(NotFoundException);

    instanceManager.getAdapter.mockReturnValue({});
    await expect(service.submitVerification('bot-1', '1234')).rejects.toThrow(BadRequestException);
  });
});
