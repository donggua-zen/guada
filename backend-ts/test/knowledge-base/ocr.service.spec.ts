/// <reference types="jest" />

import { OcrService } from '../../src/modules/knowledge-base/ocr.service';
import { HttpService } from '@nestjs/axios';
import { of, throwError } from 'rxjs';

// ---- Mock fs ----
jest.mock('fs', () => {
  const actual = jest.requireActual('fs');
  return {
    ...actual,
    promises: {
      ...actual.promises,
      readFile: jest.fn().mockResolvedValue(Buffer.from('fake pdf content')),
    },
  };
});

import * as fs from 'fs';

// ---- Mocks ----
const mockHttpService = {
  post: jest.fn(),
};

const mockSettingsService = {
  getGroupSettings: jest.fn(),
};

describe('OcrService', () => {
  let service: OcrService;

  beforeEach(() => {
    // 只清理我们手动创建的 mock，不清除 jest.mock('fs') 的全局 mock
    mockHttpService.post.mockClear();
    mockSettingsService.getGroupSettings.mockClear();
    (fs.promises.readFile as jest.Mock).mockClear();

    // 默认启用 UMI OCR
    mockSettingsService.getGroupSettings.mockResolvedValue({
      provider: 'umi',
      umiHost: '127.0.0.1',
      umiPort: 1224,
    });

    service = new OcrService(mockHttpService as any, mockSettingsService as any);
  });

  describe('getCapabilities', () => {
    it('UMI 提供商应支持 PDF 和图片', async () => {
      const caps = await service.getCapabilities();
      expect(caps.supportsPdf).toBe(true);
      expect(caps.supportsImage).toBe(true);
    });

    it('百度提供商应仅支持图片', async () => {
      mockSettingsService.getGroupSettings.mockResolvedValue({
        provider: 'baidu',
        baiduApiKey: 'test-key',
        baiduSecretKey: 'test-secret',
      });
      const caps = await service.getCapabilities();
      expect(caps.supportsPdf).toBe(false);
      expect(caps.supportsImage).toBe(true);
    });

    it('未配置应返回无能力', async () => {
      mockSettingsService.getGroupSettings.mockResolvedValue({
        provider: 'none',
      });
      const caps = await service.getCapabilities();
      expect(caps.supportsPdf).toBe(false);
      expect(caps.supportsImage).toBe(false);
    });

    it('配置读取失败应返回无能力', async () => {
      mockSettingsService.getGroupSettings.mockRejectedValue(new Error('读取失败'));
      const caps = await service.getCapabilities();
      expect(caps.supportsPdf).toBe(false);
      expect(caps.supportsImage).toBe(false);
    });
  });

  describe('recognizePdf', () => {
    it('OCR 未配置应跳过识别', async () => {
      mockSettingsService.getGroupSettings.mockResolvedValue({ provider: 'none' });
      const result = await service.recognizePdf('/fake/path.pdf');
      expect(result).toBeNull();
    });

    it('提供商不支持 PDF 应跳过', async () => {
      mockSettingsService.getGroupSettings.mockResolvedValue({
        provider: 'baidu',
        baiduApiKey: 'key',
        baiduSecretKey: 'secret',
      });
      const result = await service.recognizePdf('/fake/path.pdf');
      expect(result).toBeNull();
    });

    it('HTTP 请求失败应返回 null', async () => {
      // HTTP 请求失败（网络错误），需返回 Observable
      mockHttpService.post.mockReturnValue(
        throwError(() => new Error('Request failed with status code 500')),
      );

      const result = await service.recognizePdf('/fake/path.pdf');
      expect(result).toBeNull();
    });

    it('UMI PDF 上传应使用 multipart/form-data', async () => {
      // 模拟 UMI 上传成功 + 轮询完成
      mockHttpService.post
        .mockReturnValueOnce(of({ data: { code: 100, data: 'test-msn-id' } }))
        .mockReturnValueOnce(of({
          data: {
            code: 100,
            data: [
              { page: 1, data: [{ text: 'OCR识别文本', score: 0.95, box: [[0, 0, 100, 100]] }] },
            ],
            pages_count: 1,
            processed_count: 1,
            is_done: true,
            state: 'success',
          },
        }));

      const result = await service.recognizePdf('/fake/path.pdf');

      expect(result).not.toBeNull();
      expect(result!.text).toContain('OCR识别文本');

      // 验证上传请求使用了 form-data
      const uploadCall = mockHttpService.post.mock.calls[0];
      expect(uploadCall[0]).toContain('/api/doc/upload');

      // 验证请求头包含 multipart/form-data
      const headers = uploadCall[2]?.headers;
      expect(headers).toBeDefined();
      const contentType = headers['Content-Type'] || headers['content-type'];
      expect(contentType).toBeDefined();
      expect(contentType as string).toContain('multipart/form-data');
    });

    it('UMI PDF 完整流程应返回拼接文本', async () => {
      mockHttpService.post
        .mockReturnValueOnce(of({ data: { code: 100, data: 'msn-001' } }))
        .mockReturnValueOnce(of({
          data: {
            code: 100,
            data: [
              { page: 1, data: [{ text: '第一页内容。', score: 0.98, box: [] as number[][] }] },
              { page: 2, data: [{ text: '第二页内容。', score: 0.97, box: [] as number[][] }] },
            ],
            pages_count: 2,
            processed_count: 2,
            is_done: true,
            state: 'success',
          },
        }));

      const result = await service.recognizePdf('/fake/path.pdf');

      expect(result).not.toBeNull();
      expect(result!.text).toContain('[第 1 页]');
      expect(result!.text).toContain('第一页内容');
      expect(result!.text).toContain('[第 2 页]');
      expect(result!.text).toContain('第二页内容');
      expect(result!.pages).toHaveLength(2);
    });

    it('UMI 轮询应支持 onProgress 回调', async () => {
      mockHttpService.post
        .mockReturnValueOnce(of({ data: { code: 100, data: 'msn-002' } }))
        .mockReturnValueOnce(of({
          data: {
            code: 100,
            data: [{ page: 1, data: [{ text: '第1页', score: 0.9, box: [] as number[][] }] }],
            pages_count: 3,
            processed_count: 1,
            is_done: false,
            state: 'running',
          },
        }))
        .mockReturnValueOnce(of({
          data: {
            code: 100,
            data: [
              { page: 2, data: [{ text: '第2页', score: 0.9, box: [] as number[][] }] },
              { page: 3, data: [{ text: '第3页', score: 0.9, box: [] as number[][] }] },
            ],
            pages_count: 3,
            processed_count: 3,
            is_done: true,
            state: 'success',
          },
        }));

      const onProgress = jest.fn();
      await service.recognizePdf('/fake/path.pdf', onProgress);

      // 应该在每个阶段调用进度回调
      expect(onProgress).toHaveBeenCalled();
      const ocrSteps = onProgress.mock.calls.filter(
        ([, step]: [number, string]) => (step as string).includes('OCR'),
      );
      expect(ocrSteps.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('recognizeImage', () => {
    it('OCR 未配置应返回 null', async () => {
      mockSettingsService.getGroupSettings.mockResolvedValue({ provider: 'none' });
      const result = await service.recognizeImage('/fake/img.png');
      expect(result).toBeNull();
    });

    it('UMI 图片识别应调用正确 API', async () => {
      mockHttpService.post.mockReturnValue(of({
        data: {
          code: 100,
          data: [{ text: '图片中的文字', score: 0.95, box: [] as number[][] }],
          time: 100,
        },
      }));

      const result = await service.recognizeImage('/fake/img.png');

      expect(result).not.toBeNull();
      expect(result!.text).toBe('图片中的文字');

      const postCall = mockHttpService.post.mock.calls[0];
      expect(postCall[0]).toContain('/api/ocr');
    });
  });
});
