import { Injectable, Logger } from "@nestjs/common";
import * as fs from "fs";
import * as path from "path";

/**
 * 单页渲染结果
 */
export interface RenderedPage {
  pageNum: number; // 页码（从 1 开始）
  buffer: Buffer; // 图片二进制（PNG 或 JPEG）
  width: number; // 像素宽
  height: number; // 像素高
  mimeType: string; // "image/png" | "image/jpeg"
}

/**
 * 渲染选项
 */
export interface RenderPagesOptions {
  scale?: number; // 渲染缩放（1.0 = 72 DPI），默认 2.0 ≈ 144 DPI
  maxPages?: number; // 最大页数保护，默认 200
  pages?: number[]; // 指定页码集合（1-based）；缺省 = 全部页。越界页自动过滤，去重后升序渲染
}

/** 默认渲染缩放：2.0（≈144 DPI），OCR 识别率与图片体积的平衡点 */
const DEFAULT_SCALE = 2.0;
/** 最大页数保护（云 OCR 按页计费 + 内存/耗时护栏） */
const DEFAULT_MAX_PAGES = 200;
/** 云 OCR 图片最长边限制（以百度 general_basic 8192px 为基准） */
const MAX_IMAGE_SIDE = 8192;
/** 原始图片字节目标上限：base64(+约33%) 与 urlencode(约+8%) 后控制在主流云 OCR 4MB 限制内 */
const TARGET_RAW_BYTES = Math.floor(2.5 * 1024 * 1024);
/** JPEG 质量降级阶梯 */
const JPEG_QUALITY_LADDER = [85, 70, 55];
/** 超限时二次渲染的缩放系数 */
const RESCALE_FACTOR = 0.6;

/**
 * PDF → 图片渲染服务
 *
 * 基于 pdfjs-dist（Node legacy build）+ @napi-rs/canvas（pdfjs-dist 内置可选依赖，
 * Node 下 DefaultCanvasFactory 自动切换为 NodeCanvasFactory）将 PDF 逐页渲染为图片，
 * 供仅支持图片输入的云 OCR 厂商（百度等）使用。
 *
 * 设计要点：
 * - 流式逐页产出（AsyncGenerator）：渲染一页、消费一页、释放一页，大 PDF 不驻留内存
 * - 资源按需加载：cmaps/standard_fonts 由 pdfjs 按页需求数读取单文件，不全量载入
 * - 尺寸守卫：最长边 ≤ 8192px（渲染前按视口自动降 scale）
 * - 体积守卫：PNG 超目标 → JPEG 质量阶梯降级 → 仍超限则缩放重渲染一轮，最终兜底交付
 */
@Injectable()
export class PdfToImageService {
  private readonly logger = new Logger(PdfToImageService.name);

  /** 缓存已加载的 pdfjs 模块（ESM 动态导入开销较大，只做一次） */
  private pdfjsLib: any = null;
  /** 缓存资源目录（cmaps / standard_fonts） */
  private assets: { cmaps: string; standardFonts: string } | null = null;

  /**
   * 获取 PDF 页数
   * @param filePath PDF 文件路径
   */
  async getPageCount(filePath: string): Promise<number> {
    const lib = await this.loadPdfjs();
    const data = new Uint8Array(await fs.promises.readFile(filePath));
    const doc = await lib.getDocument(this.buildDocParams(data)).promise;
    try {
      return doc.numPages;
    } finally {
      await doc.destroy();
    }
  }

  /**
   * 逐页渲染 PDF 为图片（流式）
   *
   * @param filePath PDF 文件路径
   * @param opts 渲染选项
   * @yields RenderedPage 每页一张图，调用方消费后可立即释放 buffer
   */
  async *renderPages(
    filePath: string,
    opts: RenderPagesOptions = {},
  ): AsyncGenerator<RenderedPage> {
    const scale = opts.scale ?? DEFAULT_SCALE;
    const maxPages = opts.maxPages ?? DEFAULT_MAX_PAGES;

    const lib = await this.loadPdfjs();
    const { createCanvas } = await import("@napi-rs/canvas");

    const data = new Uint8Array(await fs.promises.readFile(filePath));
    const doc = await lib.getDocument(this.buildDocParams(data)).promise;

    try {
      const total: number = doc.numPages;

      // 页码集合：指定页（过滤越界 + 去重 + 升序）或全量
      let pageList: number[];
      if (opts.pages && opts.pages.length > 0) {
        const wanted = [
          ...new Set(
            opts.pages.filter(
              (n) => Number.isInteger(n) && n >= 1 && n <= total,
            ),
          ),
        ].sort((a, b) => a - b);
        if (wanted.length === 0) {
          return;
        }
        if (wanted.length > maxPages) {
          throw new Error(
            `指定渲染页数 ${wanted.length} 超过 OCR 渲染上限 ${maxPages} 页`,
          );
        }
        pageList = wanted;
      } else {
        if (total > maxPages) {
          throw new Error(
            `PDF 共 ${total} 页，超过 OCR 渲染上限 ${maxPages} 页，请拆分后重试`,
          );
        }
        pageList = Array.from({ length: total }, (_, i) => i + 1);
      }

      for (const pageNum of pageList) {
        const page = await doc.getPage(pageNum);
        try {
          // 尺寸守卫：按原始视口计算不超过最长边限制的有效缩放
          const baseViewport = page.getViewport({ scale: 1 });
          const baseMaxSide = Math.max(baseViewport.width, baseViewport.height);
          const effectiveScale = Math.min(
            scale,
            MAX_IMAGE_SIDE / Math.max(baseMaxSide, 1),
          );

          yield* this.renderAndEncodePage(
            createCanvas,
            page,
            pageNum,
            effectiveScale,
          );
        } finally {
          page.cleanup();
        }
      }
    } finally {
      await doc.destroy();
    }
  }

  /**
   * 渲染单页并按体积守卫编码
   * PNG（无损优先）→ 超限则 JPEG 质量阶梯 → 仍超限则缩放重渲染一轮 → 最终兜底交付
   */
  private async *renderAndEncodePage(
    createCanvas: any,
    page: any,
    pageNum: number,
    initialScale: number,
  ): AsyncGenerator<RenderedPage> {
    let attemptScale = initialScale;

    // 最多 1 次缩放重渲染（shrink=0 首次，shrink=1 缩放后重试，之后兜底交付）
    for (let shrink = 0; ; shrink++) {
      const viewport = page.getViewport({ scale: attemptScale });
      const width = Math.ceil(viewport.width);
      const height = Math.ceil(viewport.height);
      const canvas = createCanvas(width, height);
      const ctx = canvas.getContext("2d");

      // 白底填充：部分 PDF 页面背景透明，OCR 输入需要不透明图片
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, width, height);

      await page.render({ canvasContext: ctx, viewport }).promise;

      const png = canvas.toBuffer("image/png");
      if (png.length <= TARGET_RAW_BYTES) {
        yield {
          pageNum,
          buffer: png,
          width,
          height,
          mimeType: "image/png",
        };
        return;
      }

      // PNG 超限 → JPEG 质量阶梯
      for (const quality of JPEG_QUALITY_LADDER) {
        const jpeg = canvas.toBuffer("image/jpeg", quality);
        if (jpeg.length <= TARGET_RAW_BYTES) {
          this.logger.debug(
            `第 ${pageNum} 页 PNG ${(png.length / 1024 / 1024).toFixed(1)}MB 超限，降级 JPEG q${quality}`,
          );
          yield {
            pageNum,
            buffer: jpeg,
            width,
            height,
            mimeType: "image/jpeg",
          };
          return;
        }
      }

      // 仍超限 → 缩放重渲染一轮，或最终兜底交付（保证不中断管线）
      if (shrink >= 1 || attemptScale * RESCALE_FACTOR < 0.5) {
        const fallback = canvas.toBuffer(
          "image/jpeg",
          JPEG_QUALITY_LADDER[JPEG_QUALITY_LADDER.length - 1],
        );
        this.logger.warn(
          `第 ${pageNum} 页渲染图片持续超限（scale=${attemptScale.toFixed(2)}），兜底交付 ${(fallback.length / 1024 / 1024).toFixed(1)}MB JPEG`,
        );
        yield {
          pageNum,
          buffer: fallback,
          width,
          height,
          mimeType: "image/jpeg",
        };
        return;
      }

      this.logger.debug(
        `第 ${pageNum} 页 JPEG 全阶梯仍超限，缩放 ${attemptScale.toFixed(2)} → ${(attemptScale * RESCALE_FACTOR).toFixed(2)} 重渲染`,
      );
      attemptScale = attemptScale * RESCALE_FACTOR;
    }
  }

  /**
   * 加载 pdfjs legacy 构建（ESM），并补齐 Node 环境全局对象
   */
  private async loadPdfjs(): Promise<any> {
    if (this.pdfjsLib) {
      return this.pdfjsLib;
    }

    // 用变量承载 import 说明符：运行时为 require(esm)（Node 22.12+ 原生支持），
    // 与 file-parser 现有 `import("pdfjs-dist")` 同一模式，实测可运行
    const legacySpecifier = "pdfjs-dist/legacy/build/pdf.mjs";
    const mod: any = await import(legacySpecifier);
    const lib = mod.getDocument ? mod : mod.default;
    if (!lib?.getDocument) {
      throw new Error("pdfjs-dist legacy 构建加载失败：缺少 getDocument");
    }

    // @napi-rs/canvas 提供的类补齐 Node 全局（pdfjs 渲染路径可能用到）
    try {
      const napi: any = await import("@napi-rs/canvas");
      const g = globalThis as any;
      if (!g.DOMMatrix) g.DOMMatrix = napi.DOMMatrix;
      if (!g.Path2D) g.Path2D = napi.Path2D;
      if (!g.ImageData) g.ImageData = napi.ImageData;
    } catch {
      // 可选依赖缺失时交给 pdfjs 内部逻辑处理（其自带 NodeCanvasFactory 同样依赖该包）
    }

    this.pdfjsLib = lib;
    return lib;
  }

  /**
   * 构建 getDocument 参数（挂载本地 cmaps / standard_fonts 资源）
   */
  private buildDocParams(data: Uint8Array): Record<string, any> {
    const { cmaps, standardFonts } = this.resolveAssets();
    return {
      data,
      cMapUrl: cmaps,
      cMapPacked: true,
      standardFontDataUrl: standardFonts,
      isEvalSupported: false,
    };
  }

  /**
   * 解析 pdfjs-dist 包内资源目录（cmaps / standard_fonts）
   */
  private resolveAssets(): { cmaps: string; standardFonts: string } {
    if (this.assets) {
      return this.assets;
    }

    const pkgJsonPath = require.resolve("pdfjs-dist/package.json");
    const pkgRoot = path.dirname(pkgJsonPath);
    const cmaps = path.join(pkgRoot, "cmaps") + path.sep;
    const standardFonts = path.join(pkgRoot, "standard_fonts") + path.sep;

    if (!fs.existsSync(cmaps) || !fs.existsSync(standardFonts)) {
      this.logger.warn(
        `pdfjs-dist 资源目录缺失：cmaps=${fs.existsSync(cmaps)}, standard_fonts=${fs.existsSync(standardFonts)}，中文 PDF 或非嵌入字体可能渲染异常`,
      );
    }

    this.assets = { cmaps, standardFonts };
    return this.assets;
  }
}
