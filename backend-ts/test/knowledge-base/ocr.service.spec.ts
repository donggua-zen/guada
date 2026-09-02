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

const mockPdfToImage = {
  getPageCount: jest.fn(),
  renderPages: jest.fn(),
};

function makeRenderedPage(pageNum: number, content: string) {
  return {
    pageNum,
    buffer: Buffer.from(content),
    width: 100,
    height: 100,
    mimeType: 'image/png',
  };
}

describe('OcrService', () => {
  let service: OcrService;

  beforeEach(() => {
    // 只清理我们手动创建的 mock，不清除 jest.mock('fs') 的全局 mock
    mockHttpService.post.mockClear();
    mockSettingsService.getGroupSettings.mockClear();
    mockPdfToImage.getPageCount.mockClear();
    mockPdfToImage.renderPages.mockClear();
    (fs.promises.readFile as jest.Mock).mockClear();

    // 默认启用 UMI OCR
    mockSettingsService.getGroupSettings.mockResolvedValue({
      provider: 'umi',
      umiHost: '127.0.0.1',
      umiPort: 1224,
    });

    service = new OcrService(
      mockHttpService as any,
      mockSettingsService as any,
      mockPdfToImage as any,
    );
  });

  describe('getCapabilities', () => {
    it('UMI 提供商应支持 PDF（native 模式）和图片', async () => {
      const caps = await service.getCapabilities();
      expect(caps.supportsPdf).toBe(true);
      expect(caps.supportsImage).toBe(true);
      expect(caps.pdfMode).toBe('native');
    });

    it('百度提供商应通过渲染模式支持 PDF', async () => {
      mockSettingsService.getGroupSettings.mockResolvedValue({
        provider: 'baidu',
        baiduApiKey: 'test-key',
        baiduSecretKey: 'test-secret',
      });
      const caps = await service.getCapabilities();
      expect(caps.supportsPdf).toBe(true);
      expect(caps.supportsImage).toBe(true);
      expect(caps.pdfMode).toBe('render');
    });

    it('未配置应返回无能力', async () => {
      mockSettingsService.getGroupSettings.mockResolvedValue({
        provider: 'none',
      });
      const caps = await service.getCapabilities();
      expect(caps.supportsPdf).toBe(false);
      expect(caps.supportsImage).toBe(false);
      expect(caps.pdfMode).toBe('none');
    });

    it('配置读取失败应返回无能力', async () => {
      mockSettingsService.getGroupSettings.mockRejectedValue(new Error('读取失败'));
      const caps = await service.getCapabilities();
      expect(caps.supportsPdf).toBe(false);
      expect(caps.supportsImage).toBe(false);
      expect(caps.pdfMode).toBe('none');
    });
  });

  describe('recognizePdf', () => {
    it('OCR 未配置应跳过识别', async () => {
      mockSettingsService.getGroupSettings.mockResolvedValue({ provider: 'none' });
      const result = await service.recognizePdf('/fake/path.pdf');
      expect(result).toBeNull();
    });

    it('百度提供商应走渲染识别路径（render 模式）', async () => {
      mockSettingsService.getGroupSettings.mockResolvedValue({
        provider: 'baidu',
        baiduApiKey: 'key',
        baiduSecretKey: 'secret',
      });
      mockPdfToImage.getPageCount.mockResolvedValue(2);
      mockPdfToImage.renderPages.mockImplementation(async function* () {
        yield makeRenderedPage(1, 'img-page-1');
        yield makeRenderedPage(2, 'img-page-2');
      });
      // 每页识别 = token + ocr 两次请求，共 2 页 → 4 次
      let ocrSeq = 0;
      mockHttpService.post.mockImplementation((url: string) => {
        if (url.includes('/oauth/2.0/token')) {
          return of({ data: { access_token: 'tok-123' } });
        }
        ocrSeq++;
        const pageText = ocrSeq === 1 ? '第一页文字' : '第二页文字';
        return of({
          data: { words_result: [{ words: pageText }], words_result_num: 1 },
        });
      });

      const result = await service.recognizePdf('/fake/path.pdf');

      expect(result).not.toBeNull();
      expect(result!.pages).toHaveLength(2);
      expect(result!.text).toContain('[第 1 页]');
      expect(result!.text).toContain('第一页文字');
      expect(result!.text).toContain('[第 2 页]');
      expect(result!.text).toContain('第二页文字');
      // 必须调用了渲染服务（整文件 = 全部页）
      expect(mockPdfToImage.getPageCount).toHaveBeenCalledWith('/fake/path.pdf');
      expect(mockPdfToImage.renderPages).toHaveBeenCalledWith('/fake/path.pdf', {
        pages: [1, 2],
      });
      // 百度图片接口必须被调用（general_basic）
      const baiduCalls = mockHttpService.post.mock.calls.filter((c: any[]) =>
        c[0].includes('general_basic'),
      );
      expect(baiduCalls).toHaveLength(2);
    });

    it('渲染识别页级失败应整体返回 null', async () => {
      mockSettingsService.getGroupSettings.mockResolvedValue({
        provider: 'baidu',
        baiduApiKey: 'key',
        baiduSecretKey: 'secret',
      });
      mockPdfToImage.getPageCount.mockResolvedValue(1);
      mockPdfToImage.renderPages.mockImplementation(async function* () {
        yield makeRenderedPage(1, 'img-page-1');
      });
      // token 成功，但图片识别返回不可重试的 4xx 错误
      mockHttpService.post.mockImplementation((url: string) => {
        if (url.includes('/oauth/2.0/token')) {
          return of({ data: { access_token: 'tok-123' } });
        }
        return throwError(() => ({
          status: 400,
          message: 'Request failed with status code 400',
        }));
      });

      const result = await service.recognizePdf('/fake/path.pdf');
      expect(result).toBeNull();
    });

    it('页级临时错误应重试后成功', async () => {
      mockSettingsService.getGroupSettings.mockResolvedValue({
        provider: 'baidu',
        baiduApiKey: 'key',
        baiduSecretKey: 'secret',
      });
      mockPdfToImage.getPageCount.mockResolvedValue(1);
      mockPdfToImage.renderPages.mockImplementation(async function* () {
        yield makeRenderedPage(1, 'img-page-1');
      });

      let ocrAttempts = 0;
      mockHttpService.post.mockImplementation((url: string) => {
        if (url.includes('/oauth/2.0/token')) {
          return of({ data: { access_token: 'tok-123' } });
        }
        ocrAttempts++;
        if (ocrAttempts === 1) {
          // 首次 5xx 可重试错误
          return throwError(() => ({ status: 500, message: 'server error' }));
        }
        return of({
          data: { words_result: [{ words: '重试后识别成功' }], words_result_num: 1 },
        });
      });

      const result = await service.recognizePdf('/fake/path.pdf');
      expect(result).not.toBeNull();
      expect(result!.text).toContain('重试后识别成功');
      expect(ocrAttempts).toBe(2);
    });

    it('渲染服务缺失时应返回 null 而非崩溃', async () => {
      mockSettingsService.getGroupSettings.mockResolvedValue({
        provider: 'baidu',
        baiduApiKey: 'key',
        baiduSecretKey: 'secret',
      });
      const bareService = new OcrService(
        mockHttpService as any,
        mockSettingsService as any,
      );
      const result = await bareService.recognizePdf('/fake/path.pdf');
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

    it('UMI 原生管线非连接类失败应降级渲染路径', async () => {
      mockSettingsService.getGroupSettings.mockResolvedValue({
        provider: 'umi',
        umiHost: '127.0.0.1',
        umiPort: 1224,
      });
      // 原生上传返回非 100 错误码（服务可达但任务失败）→ 触发降级
      mockHttpService.post.mockImplementation((url: string) => {
        if (url.includes('/api/doc/upload')) {
          return of({ data: { code: 200, data: '任务处理失败' } });
        }
        // 降级后的图片识别接口
        return of({
          data: {
            code: 100,
            data: [{ text: '降级逐页识别文本', score: 0.9, box: [] as number[][] }],
          },
        });
      });
      mockPdfToImage.renderPages.mockImplementation(async function* () {
        yield makeRenderedPage(1, 'img');
      });

      const result = await service.recognizePdf('/fake/path.pdf');

      expect(result).not.toBeNull();
      expect(result!.text).toContain('降级逐页识别文本');
      expect(mockPdfToImage.renderPages).toHaveBeenCalledWith('/fake/path.pdf', {
        pages: [1],
      });
    });

    it('UMI 服务连接失败不应降级（快速失败）', async () => {
      mockSettingsService.getGroupSettings.mockResolvedValue({
        provider: 'umi',
        umiHost: '127.0.0.1',
        umiPort: 1224,
      });
      // 连接拒绝 = 服务不可用，图片接口同样不可用，不应逐页重试
      mockHttpService.post.mockReturnValue(
        throwError(() => new Error('connect ECONNREFUSED 127.0.0.1:1224')),
      );

      const result = await service.recognizePdf('/fake/path.pdf');

      expect(result).toBeNull();
      expect(mockPdfToImage.renderPages).not.toHaveBeenCalled();
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

      // UMI 是 native 模式，不应调用渲染服务
      expect(mockPdfToImage.renderPages).not.toHaveBeenCalled();
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

  describe('getScanOcrStrategy', () => {
    it('默认应为 auto（仅低字符页 OCR）', async () => {
      mockSettingsService.getGroupSettings.mockResolvedValue({
        provider: 'baidu',
        baiduApiKey: 'k',
        baiduSecretKey: 's',
      });
      await expect(service.getScanOcrStrategy()).resolves.toBe('auto');
    });

    it('配置 ocrMode=force 时应返回 force（全页强制 OCR）', async () => {
      mockSettingsService.getGroupSettings.mockResolvedValue({
        provider: 'umi',
        umiHost: '127.0.0.1',
        umiPort: 1224,
        ocrMode: 'force',
      });
      await expect(service.getScanOcrStrategy()).resolves.toBe('force');
    });

    it('配置读取失败应回退 auto', async () => {
      mockSettingsService.getGroupSettings.mockRejectedValue(new Error('x'));
      await expect(service.getScanOcrStrategy()).resolves.toBe('auto');
    });
  });

  describe('recognizePdfPages', () => {
    it('应只渲染指定页并按页码升序返回', async () => {
      mockSettingsService.getGroupSettings.mockResolvedValue({
        provider: 'baidu',
        baiduApiKey: 'k',
        baiduSecretKey: 's',
      });
      mockPdfToImage.renderPages.mockImplementation(async function* () {
        // 渲染层按升序产出
        yield makeRenderedPage(3, '页三');
        yield makeRenderedPage(7, '页七');
      });
      mockHttpService.post.mockImplementation((url: string) => {
        if (url.includes('/oauth/2.0/token')) {
          return of({ data: { access_token: '***' } });
        }
        return of({ data: { words_result: [{ words: '识别文本' }] } });
      });

      const result = await service.recognizePdfPages('/fake/doc.pdf', [7, 3]);

      expect(mockPdfToImage.renderPages).toHaveBeenCalledWith('/fake/doc.pdf', {
        pages: [7, 3],
      });
      expect(result.map((p) => p.page)).toEqual([3, 7]);
      expect(result[0].text).toBe('识别文本');
    });

    it('空页码集合应直接返回空数组且不调用渲染', async () => {
      const result = await service.recognizePdfPages('/fake/doc.pdf', []);
      expect(result).toEqual([]);
      expect(mockPdfToImage.renderPages).not.toHaveBeenCalled();
    });

    it('渲染服务缺失应抛错', async () => {
      mockSettingsService.getGroupSettings.mockResolvedValue({
        provider: 'baidu',
        baiduApiKey: 'k',
        baiduSecretKey: 's',
      });
      const bareService = new OcrService(
        mockHttpService as any,
        mockSettingsService as any,
      );
      await expect(
        bareService.recognizePdfPages('/fake/doc.pdf', [1]),
      ).rejects.toThrow('PDF 转图片服务未初始化');
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
