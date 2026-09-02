/// <reference types="jest" />

/**
 * PdfToImageService 单元测试
 *
 * pdfjs-dist 为 ESM 动态导入（legacy/build/pdf.mjs），jest CJS 环境下必须 mock；
 * @napi-rs/canvas 原生模块同样 mock，通过可控的 toBuffer 返回值测试体积守卫逻辑。
 */

// ---- Mock pdfjs-dist legacy build ----
const mockGetDocument = jest.fn();

jest.mock(
  'pdfjs-dist/legacy/build/pdf.mjs',
  () => ({
    getDocument: (...args: any[]) => mockGetDocument(...args),
  }),
  { virtual: true },
);

// ---- Mock @napi-rs/canvas ----
const mockCanvas = {
  width: 0,
  height: 0,
  getContext: jest.fn(),
  toBuffer: jest.fn(),
};
const mockCreateCanvas: jest.Mock = jest.fn();

jest.mock('@napi-rs/canvas', () => ({
  createCanvas: (...args: any[]) => mockCreateCanvas(...args),
  DOMMatrix: class {},
  Path2D: class {},
  ImageData: class {},
}));

// ---- Mock fs：服务会读取 PDF 文件字节，mock 掉避免依赖真实文件 ----
jest.mock('fs', () => {
  const actual = jest.requireActual('fs');
  return {
    ...actual,
    promises: {
      ...actual.promises,
      readFile: jest.fn().mockResolvedValue(Buffer.from('%PDF-fake')),
    },
    existsSync: jest.fn().mockReturnValue(true),
  };
});

import { PdfToImageService } from '../../src/common/pdf-render/pdf-to-image.service';

function makeDocMock(numPages: number, pageFactory?: (pageNum: number) => any) {
  const pages = new Map<number, any>();
  return {
    numPages,
    destroy: jest.fn().mockResolvedValue(undefined),
    getPage: jest.fn(async (pageNum: number) => {
      if (!pages.has(pageNum)) {
        pages.set(
          pageNum,
          pageFactory
            ? pageFactory(pageNum)
            : {
                getViewport: jest.fn(({ scale }: { scale: number }) => ({
                  width: 612 * scale,
                  height: 792 * scale,
                })),
                render: jest.fn().mockReturnValue({ promise: Promise.resolve() }),
                cleanup: jest.fn(),
              },
        );
      }
      return pages.get(pageNum);
    }),
  };
}

describe('PdfToImageService', () => {
  let service: PdfToImageService;

  beforeEach(() => {
    mockGetDocument.mockClear();
    mockCreateCanvas.mockReset().mockImplementation((w: number, h: number) => {
      mockCanvas.width = w;
      mockCanvas.height = h;
      return mockCanvas;
    });
    mockCanvas.getContext.mockReset().mockReturnValue({
      fillStyle: '',
      fillRect: jest.fn(),
    });
    // 默认小图（1KB），走 PNG 正常路径
    mockCanvas.toBuffer.mockReset().mockImplementation((format: string) =>
      Buffer.alloc(1024),
    );

    service = new PdfToImageService();
  });

  describe('getPageCount', () => {
    it('应返回 PDF 页数并释放文档', async () => {
      const doc = makeDocMock(5);
      mockGetDocument.mockReturnValue({ promise: Promise.resolve(doc) });

      const count = await service.getPageCount('/fake/doc.pdf');

      expect(count).toBe(5);
      expect(doc.destroy).toHaveBeenCalled();
      // 必须挂载 cmaps 与 standard_fonts 资源
      const params = mockGetDocument.mock.calls[0][0];
      expect(params.cMapUrl).toContain('cmaps');
      expect(params.cMapPacked).toBe(true);
      expect(params.standardFontDataUrl).toContain('standard_fonts');
    });
  });

  describe('renderPages', () => {
    it('应逐页产出渲染结果（默认 scale 2.0）', async () => {
      const doc = makeDocMock(2);
      mockGetDocument.mockReturnValue({ promise: Promise.resolve(doc) });

      const results: any[] = [];
      for await (const page of service.renderPages('/fake/doc.pdf')) {
        results.push(page);
      }

      expect(results).toHaveLength(2);
      expect(results[0].pageNum).toBe(1);
      expect(results[1].pageNum).toBe(2);
      // 612x792 @ scale 2 → 1224x1584
      expect(mockCreateCanvas).toHaveBeenNthCalledWith(1, 1224, 1584);
      expect(results[0].mimeType).toBe('image/png');
      expect(Buffer.isBuffer(results[0].buffer)).toBe(true);
      expect(doc.destroy).toHaveBeenCalled();
      // 渲染后必须清理页面资源
      expect(doc.getPage).toHaveBeenCalledWith(1);
      expect(doc.getPage).toHaveBeenCalledWith(2);
    });

    it('指定 pages 时应只渲染所选页（过滤越界去重并升序）', async () => {
      const doc = makeDocMock(5);
      mockGetDocument.mockReturnValue({ promise: Promise.resolve(doc) });

      const results: any[] = [];
      for await (const page of service.renderPages('/fake/doc.pdf', {
        pages: [4, 2, 99, 2],
      })) {
        results.push(page);
      }

      expect(results.map((r) => r.pageNum)).toEqual([2, 4]);
      expect(doc.getPage).toHaveBeenCalledTimes(2);
      expect(doc.getPage).toHaveBeenNthCalledWith(1, 2);
      expect(doc.getPage).toHaveBeenNthCalledWith(2, 4);
      expect(doc.destroy).toHaveBeenCalled();
    });

    it('指定 pages 全部越界时应不产出任何页', async () => {
      const doc = makeDocMock(3);
      mockGetDocument.mockReturnValue({ promise: Promise.resolve(doc) });

      const results: any[] = [];
      for await (const page of service.renderPages('/fake/doc.pdf', {
        pages: [0, -1, 99],
      })) {
        results.push(page);
      }

      expect(results).toHaveLength(0);
      expect(doc.getPage).not.toHaveBeenCalled();
    });

    it('超过 maxPages 上限应抛错且不渲染', async () => {
      const doc = makeDocMock(3);
      mockGetDocument.mockReturnValue({ promise: Promise.resolve(doc) });

      const iterator = service.renderPages('/fake/doc.pdf', { maxPages: 2 });
      await expect((async () => {
        for await (const _ of iterator) {
          // consume
        }
      })()).rejects.toThrow(/超过 OCR 渲染上限/);

      expect(doc.getPage).not.toHaveBeenCalled();
      expect(doc.destroy).toHaveBeenCalled();
    });

    it('视口超过 8192px 时应自动降低渲染 scale', async () => {
      // 原始页面 10000x10000（scale=1），8192/10000 < 默认 2.0
      const doc = makeDocMock(1, () => ({
        getViewport: jest.fn(({ scale }: { scale: number }) => ({
          width: 10000 * scale,
          height: 10000 * scale,
        })),
        render: jest.fn().mockReturnValue({ promise: Promise.resolve() }),
        cleanup: jest.fn(),
      }));
      mockGetDocument.mockReturnValue({ promise: Promise.resolve(doc) });

      for await (const _ of service.renderPages('/fake/doc.pdf')) {
        // consume
      }

      // 有效 scale = 8192/10000 = 0.8192 → 画布 8192x8192
      expect(mockCreateCanvas).toHaveBeenCalledWith(8192, 8192);
    });

    it('PNG 超限时应降级 JPEG 质量阶梯', async () => {
      const doc = makeDocMock(1);
      mockGetDocument.mockReturnValue({ promise: Promise.resolve(doc) });

      mockCanvas.toBuffer.mockImplementation((format: string) => {
        if (format === 'image/png') return Buffer.alloc(3 * 1024 * 1024); // 3MB 超限
        return Buffer.alloc(1024 * 1024); // 1MB JPEG 合格
      });

      const results: any[] = [];
      for await (const page of service.renderPages('/fake/doc.pdf')) {
        results.push(page);
      }

      expect(results).toHaveLength(1);
      expect(results[0].mimeType).toBe('image/jpeg');
      // PNG 1 次 + JPEG 阶梯 1 次（首个 JPEG 即合格）
      const formats = mockCanvas.toBuffer.mock.calls.map((c: any[]) => c[0]);
      expect(formats.filter((f: string) => f === 'image/png')).toHaveLength(1);
      expect(formats.filter((f: string) => f === 'image/jpeg')).toHaveLength(1);
    });

    it('全阶梯超限时应缩放重渲染一轮后兜底交付', async () => {
      const doc = makeDocMock(1);
      mockGetDocument.mockReturnValue({ promise: Promise.resolve(doc) });

      // 所有编码尝试都返回 3MB（超限）
      mockCanvas.toBuffer.mockReturnValue(Buffer.alloc(3 * 1024 * 1024));

      const results: any[] = [];
      for await (const page of service.renderPages('/fake/doc.pdf')) {
        results.push(page);
      }

      // 不应死循环，最终交付一页
      expect(results).toHaveLength(1);
      expect(results[0].mimeType).toBe('image/jpeg');
      // 发生了两次渲染（首次 scale 2.0 + 缩放 1.2）
      expect(mockCreateCanvas).toHaveBeenCalledTimes(2);
    });
  });
});
