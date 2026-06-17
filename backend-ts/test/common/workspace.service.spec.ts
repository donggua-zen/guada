/// <reference types="jest" />

import { WorkspaceService } from '../../src/common/services/workspace.service';
import { ConfigService } from '@nestjs/config';
import { SettingsStorage } from '../../src/common/utils/settings-storage.util';
import * as path from 'path';

describe('WorkspaceService', () => {
  let service: WorkspaceService;
  let mockConfigService: jest.Mocked<ConfigService>;
  let mockSettingsStorage: jest.Mocked<SettingsStorage>;

  const FALLBACK_DIR = path.join(process.cwd(), 'workspace');

  beforeEach(() => {
    mockConfigService = {
      get: jest.fn().mockReturnValue(undefined),
    } as any;

    mockSettingsStorage = {
      getSettingValue: jest.fn(),
    } as any;

    service = new WorkspaceService(mockConfigService as any, mockSettingsStorage as any);
  });

  describe('getEffectiveBaseDir', () => {
    it('设置存储返回路径时应该使用该路径', async () => {
      mockSettingsStorage.getSettingValue.mockResolvedValue('D:\\my-workspace');

      const result = await service.getEffectiveBaseDir();

      expect(result).toBe('D:\\my-workspace');
    });

    it('设置存储返回 null 时应使用 fallback 路径', async () => {
      mockSettingsStorage.getSettingValue.mockResolvedValue(null);

      const result = await service.getEffectiveBaseDir();

      expect(result).toBe(FALLBACK_DIR);
    });

    it('设置存储返回空字符串时应使用 fallback', async () => {
      mockSettingsStorage.getSettingValue.mockResolvedValue('');

      const result = await service.getEffectiveBaseDir();

      expect(result).toBe(FALLBACK_DIR);
    });

    it('设置存储返回相对路径时应使用 fallback', async () => {
      mockSettingsStorage.getSettingValue.mockResolvedValue('relative/path');

      const result = await service.getEffectiveBaseDir();

      expect(result).toBe(FALLBACK_DIR);
    });

    it('环境变量 WORKSPACE_BASE_DIR 应作为 fallback', async () => {
      const envDir = 'D:\\env-workspace';
      mockConfigService.get.mockImplementation((key: string) => {
        if (key === 'WORKSPACE_BASE_DIR') return envDir;
        return undefined;
      });

      // 重新创建 service 使构造函数读取配置
      mockSettingsStorage.getSettingValue.mockResolvedValue(null);
      service = new WorkspaceService(mockConfigService as any, mockSettingsStorage as any);

      const result = await service.getEffectiveBaseDir();

      expect(result).toBe(envDir);
    });

    it('设置存储返回路径非绝对路径时应使用 fallback', async () => {
      // 返回一个对象（模拟未 await 的 Promise）
      mockSettingsStorage.getSettingValue.mockResolvedValue({} as any);

      const result = await service.getEffectiveBaseDir();

      // 如果是字符串但非绝对路径，走 fallback
      expect(result).toBe(FALLBACK_DIR);
    });

    it('设置存储路径目录不存在时应自动创建', async () => {
      const newDir = path.join(FALLBACK_DIR, '__test_temp__');
      mockSettingsStorage.getSettingValue.mockResolvedValue(newDir);

      const result = await service.getEffectiveBaseDir();

      expect(result).toBe(newDir);
      // 清理
      try { require('fs').rmdirSync(newDir); } catch {}
    });

    it('设置存储路径创建失败时应使用 fallback', async () => {
      // 模拟 mkdirSync 抛异常
      const mkdirSpy = jest.spyOn(require('fs'), 'mkdirSync').mockImplementationOnce(() => {
        throw new Error('Permission denied');
      });
      mockSettingsStorage.getSettingValue.mockResolvedValue('D:\\test-permission-denied');

      const result = await service.getEffectiveBaseDir();

      expect(result).toBe(FALLBACK_DIR);
      mkdirSpy.mockRestore();
    });
  });

  describe('getWorkspaceDir', () => {
    it('应返回 sessionId 对应的子目录', async () => {
      mockSettingsStorage.getSettingValue.mockResolvedValue(null);

      const result = await service.getWorkspaceDir('test-session-001');

      expect(result).toBe(path.join(FALLBACK_DIR, 'test-session-001'));
    });

    it('路径遍历攻击应抛异常', async () => {
      mockSettingsStorage.getSettingValue.mockResolvedValue(null);

      await expect(
        service.getWorkspaceDir('../../../etc/passwd'),
      ).rejects.toThrow('Path traversal detected');
    });
  });

  describe('getDefaultWorkspaceDir', () => {
    it('应返回基于 baseDir 和 sessionId 的路径', async () => {
      mockSettingsStorage.getSettingValue.mockResolvedValue(null);

      const result = await service.getDefaultWorkspaceDir('session-123');

      expect(result).toBe(path.join(FALLBACK_DIR, 'session-123'));
    });

    it('路径遍历攻击应抛异常', async () => {
      mockSettingsStorage.getSettingValue.mockResolvedValue(null);

      await expect(
        service.getDefaultWorkspaceDir('../malicious'),
      ).rejects.toThrow('Path traversal detected');
    });
  });

  describe('generateWorkspaceDir', () => {
    it('应生成不重复的目录并创建', async () => {
      mockSettingsStorage.getSettingValue.mockResolvedValue(null);

      const result = await service.generateWorkspaceDir('TEST');

      expect(result).toContain('TEST');
      expect(result).toContain(FALLBACK_DIR);
      // 验证目录已被创建
      expect(require('fs').existsSync(result)).toBe(true);
      // 清理
      try { require('fs').rmdirSync(result); } catch {}
    });

    it('生成目录应在 baseDir 范围内', async () => {
      mockSettingsStorage.getSettingValue.mockResolvedValue(null);

      const result = await service.generateWorkspaceDir('TEST');

      expect(result.startsWith(FALLBACK_DIR)).toBe(true);
      try { require('fs').rmdirSync(result); } catch {}
    });
  });

  describe('resolveSessionWorkspaceDir', () => {
    it('有自定义路径时优先使用', async () => {
      const session = { id: 's-001', workspacePath: 'D:\\custom\\path' };

      const result = await service.resolveSessionWorkspaceDir(session);

      expect(result).toBe('D:\\custom\\path');
    });

    it('无自定义路径时使用默认工作目录', async () => {
      mockSettingsStorage.getSettingValue.mockResolvedValue(null);
      const session = { id: 's-002' };

      const result = await service.resolveSessionWorkspaceDir(session);

      expect(result).toBe(path.join(FALLBACK_DIR, 's-002'));
    });
  });
});
