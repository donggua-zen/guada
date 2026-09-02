/// <reference types="jest" />

/**
 * FileParserService PDF 页面级路由 + 图片分支测试
 *
 * 页面级路由（P1）：低字符页才 OCR，文本页保留文本层，按页码合并。
 * pdfjs-dist 为 ESM 动态导入，jest CJS 环境必须 mock。
 */

// ---- Mock pdfjs-dist ----
const mockGetDocument = jest.fn();

jest.mock('pdfjs-dist', () => ({
  getDocument: (...args: any[]) => mockGetDocument(...args),
}));

// ---- Mock fs：parseFile 会读文件字节 ----
jest.mock('fs', () => {
  const actual = jest.requireActual('fs');
  return {
    ...actual,
    promises: {
      ...actual.promises,
      readFile: jest.fn().mockResolvedValue(Buffer.from('%PDF-fake-bytes')),
    },
  };
});

import { FileParserService } from '../../src/modules/knowledge-base/file-parser.service';

const mockOcrService = {
  recognizePdf: jest.fn(),
  recognizeImage: jest.fn(),
  recognizePdfPages: jest.fn(),
  getCapabilities: jest.fn(),
  getScanOcrStrategy: jest.fn(),
};

/** 构造 pdfjs 文档 mock：每页返回 items（字符数由文本长度决定） */
function makePdfDoc(pageTexts: string[]) {
  return {
    numPages: pageTexts.length,
    destroy: jest.fn().mockResolvedValue(undefined),
    getPage: jest.fn(async (i: number) => ({
      getTextContent: jest.fn(async () => ({
        items: pageTexts[i - 1].split(' ').map((s) => ({ str: s })),
      })),
      cleanup: jest.fn(),
    })),
  };
}

/** 长文本（>50 字符，视为有文本层） */
const LONG = 'This is a long text page with plenty of characters for extraction.';
/** 短文本（<50 字符，疑似扫描页） */
const SHORT = 'watermark';

describe('FileParserService PDF 页面级路由', () => {
  let service: FileParserService;

  beforeEach(() => {
    jest.clearAllMocks();
    (require('fs').promises.readFile as jest.Mock).mockClear();
    service = new FileParserService(mockOcrService as any);
    // 默认：百度 + auto 策略
    mockOcrService.getCapabilities.mockResolvedValue({
      supportsPdf: true,
      supportsImage: true,
      pdfMode: 'render',
    });
    mockOcrService.getScanOcrStrategy.mockResolvedValue('auto');
  });

  it('纯文本 PDF：所有页有文本层 → 不触发任何 OCR', async () => {
    mockGetDocument.mockReturnValue({
      promise: Promise.resolve(makePdfDoc([LONG, LONG, LONG])),
    });

    const result = await service.parseFile('/fake/doc.pdf');

    expect(mockOcrService.recognizePdf).not.toHaveBeenCalled();
    expect(mockOcrService.recognizePdfPages).not.toHaveBeenCalled();
    expect(result.pages).toHaveLength(3);
    expect(result.pages[0].pageNum).toBe(1);
  });

  it('混合 PDF（render 模式）：仅低字符页 OCR，与文本层按页码合并', async () => {
    mockGetDocument.mockReturnValue({
      promise: Promise.resolve(makePdfDoc([LONG, SHORT, LONG])),
    });
    mockOcrService.recognizePdfPages.mockResolvedValue([
      { page: 2, text: '扫描页OCR结果' },
    ]);

    const result = await service.parseFile('/fake/doc.pdf', jest.fn());

    // 只把第 2 页交给渲染 OCR
    expect(mockOcrService.recognizePdfPages).toHaveBeenCalledWith(
      '/fake/doc.pdf',
      [2],
      expect.any(Function),
    );
    expect(mockOcrService.recognizePdf).not.toHaveBeenCalled();
    // 合并后 3 页、升序、第 2 页为 OCR 文本
    expect(result.pages).toHaveLength(3);
    expect(result.pages.map((p) => p.pageNum)).toEqual([1, 2, 3]);
    expect(result.pages[1].text).toBe('扫描页OCR结果');
    expect(result.pages[0].text).toContain('long text page');
    expect(result.text).toContain('扫描页OCR结果');
  });

  it('混合 PDF（native umi）：非整本扫描 → 走渲染逐页补页（umi 图片接口）', async () => {
    mockOcrService.getCapabilities.mockResolvedValue({
      supportsPdf: true,
      supportsImage: true,
      pdfMode: 'native',
    });
    mockGetDocument.mockReturnValue({
      promise: Promise.resolve(makePdfDoc([LONG, SHORT, LONG])),
    });
    mockOcrService.recognizePdfPages.mockResolvedValue([
      { page: 2, text: '局部补页结果' },
    ]);

    const result = await service.parseFile('/fake/doc.pdf', jest.fn());

    expect(mockOcrService.recognizePdf).not.toHaveBeenCalled();
    expect(mockOcrService.recognizePdfPages).toHaveBeenCalledWith(
      '/fake/doc.pdf',
      [2],
      expect.any(Function),
    );
    expect(result.pages[1].text).toBe('局部补页结果');
  });

  it('整本扫描（native umi）→ 整文件原生 PDF 管线', async () => {
    mockOcrService.getCapabilities.mockResolvedValue({
      supportsPdf: true,
      supportsImage: true,
      pdfMode: 'native',
    });
    mockGetDocument.mockReturnValue({
      promise: Promise.resolve(makePdfDoc([SHORT, SHORT])),
    });
    mockOcrService.recognizePdf.mockResolvedValue({
      text: '[第 1 页]\n整本OCR\n[第 2 页]\n全文',
      pages: [],
    });

    const result = await service.parseFile('/fake/doc.pdf', jest.fn());

    expect(mockOcrService.recognizePdf).toHaveBeenCalledWith(
      '/fake/doc.pdf',
      expect.any(Function),
    );
    expect(mockOcrService.recognizePdfPages).not.toHaveBeenCalled();
    // 旧行为保持：整文件结果包成单页
    expect(result.pages).toHaveLength(1);
    expect(result.pages[0].pageNum).toBe(1);
    expect(result.text).toContain('整本OCR');
  });

  it('force 策略（render 模式）：所有页强制 OCR', async () => {
    mockOcrService.getScanOcrStrategy.mockResolvedValue('force');
    mockGetDocument.mockReturnValue({
      promise: Promise.resolve(makePdfDoc([LONG, LONG])),
    });
    mockOcrService.recognizePdfPages.mockResolvedValue([
      { page: 1, text: '页一OCR' },
      { page: 2, text: '页二OCR' },
    ]);

    const result = await service.parseFile('/fake/doc.pdf', jest.fn());

    expect(mockOcrService.recognizePdfPages).toHaveBeenCalledWith(
      '/fake/doc.pdf',
      [1, 2],
      expect.any(Function),
    );
    expect(result.pages.map((p) => p.pageNum)).toEqual([1, 2]);
  });

  it('force 策略（native umi）→ 即使有文本层也走整文件原生管线', async () => {
    mockOcrService.getCapabilities.mockResolvedValue({
      supportsPdf: true,
      supportsImage: true,
      pdfMode: 'native',
    });
    mockOcrService.getScanOcrStrategy.mockResolvedValue('force');
    mockGetDocument.mockReturnValue({
      promise: Promise.resolve(makePdfDoc([LONG, LONG])),
    });
    mockOcrService.recognizePdf.mockResolvedValue({
      text: '全文OCR',
      pages: [],
    });

    await service.parseFile('/fake/doc.pdf');

    expect(mockOcrService.recognizePdf).toHaveBeenCalled();
    expect(mockOcrService.recognizePdfPages).not.toHaveBeenCalled();
  });

  it('OCR 未配置：仅文本层，不调用 OCR', async () => {
    mockOcrService.getCapabilities.mockResolvedValue({
      supportsPdf: false,
      supportsImage: false,
      pdfMode: 'none',
    });
    mockGetDocument.mockReturnValue({
      promise: Promise.resolve(makePdfDoc([LONG, SHORT])),
    });

    const result = await service.parseFile('/fake/doc.pdf');

    expect(mockOcrService.recognizePdfPages).not.toHaveBeenCalled();
    expect(mockOcrService.recognizePdf).not.toHaveBeenCalled();
    // 文本层页保留
    expect(result.pages).toHaveLength(2);
  });

  it('渲染 OCR 全部页失败 → 抛错（不静默产生空文档）', async () => {
    mockGetDocument.mockReturnValue({
      promise: Promise.resolve(makePdfDoc([SHORT])),
    });
    mockOcrService.recognizePdfPages.mockResolvedValue([
      { page: 1, text: '' },
    ]);

    await expect(service.parseFile('/fake/doc.pdf')).rejects.toThrow(
      /OCR 识别失败或结果为空/,
    );
  });
});

describe('FileParserService 图片分支', () => {
  let service: FileParserService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new FileParserService(mockOcrService as any);
  });

  it('detectFileType 应识别 png/jpg/jpeg/bmp 为 image', async () => {
    for (const ext of ['png', 'jpg', 'jpeg', 'bmp', '.PNG']) {
      await expect(service.detectFileType(ext)).resolves.toBe('image');
    }
  });

  it('图片文件应走 OCR 并返回单页结果', async () => {
    mockOcrService.recognizeImage.mockResolvedValue({
      text: '图片中的文字',
      pages: [{ page: 1, text: '图片中的文字' }],
    });

    const result = await service.parseFile('/fake/photo.png');

    expect(mockOcrService.recognizeImage).toHaveBeenCalledWith('/fake/photo.png');
    expect(result.text).toBe('图片中的文字');
    expect(result.pages).toHaveLength(1);
    expect(result.pages[0].pageNum).toBe(1);
  });

  it('OCR 未配置时图片解析应抛出可操作提示', async () => {
    mockOcrService.recognizeImage.mockResolvedValue(null);

    await expect(service.parseFile('/fake/photo.png')).rejects.toThrow(
      /请先在设置中心配置 OCR/,
    );
  });

  it('getSupportedExtensions 应包含 image 组', () => {
    const exts = service.getSupportedExtensions();
    expect(exts.image).toEqual(['bmp', 'jpeg', 'jpg', 'png']);
  });
});
