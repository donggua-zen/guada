import { Injectable, Logger } from "@nestjs/common";
import * as fs from "fs";
import * as path from "path";
import * as mammoth from "mammoth";
import { OcrService } from "./ocr.service";
import { PageEntry } from "./chunking.service";
import type { FileProgressCallback } from "../../common/types/file-progress.types";

/**
 * PDF 逐页解析结果
 */
interface PdfPageInfo {
  pageNum: number;
  text: string;
  charCount: number;
}

/**
 * PDF 解析结果
 */
interface PdfParseResult {
  totalPages: number;
  pages: PdfPageInfo[];
  fullText: string;
}

/**
 * 文件解析结果（带页码信息）
 */
export interface ParsedFileResult {
  text: string;
  pages: PageEntry[];
}

@Injectable()
export class FileParserService {
  private readonly logger = new Logger(FileParserService.name);

  constructor(private readonly ocrService: OcrService) {}

  // 支持的文件类型
  private readonly TEXT_EXTENSIONS = new Set([
    "txt",
    "md",
    "markdown",
    "py",
    "js",
    "ts",
    "jsx",
    "tsx",
    "java",
    "cpp",
    "c",
    "h",
    "hpp",
    "go",
    "rs",
    "rb",
    "php",
    "json",
    "xml",
    "yaml",
    "yml",
    "toml",
    "html",
    "htm",
    "css",
    "scss",
    "less",
    "csv",
    "tsv",
    "sql",
    "sh",
    "bat",
    "ps1",
  ]);
  private readonly PDF_EXTENSIONS = new Set(["pdf"]);
  private readonly WORD_EXTENSIONS = new Set(["docx"]);
  private readonly EXCEL_EXTENSIONS = new Set(["xlsx"]);
  // 图片走 OCR（百度 general_basic 仅支持 jpg/jpeg/png/bmp，保持双提供商兼容）
  private readonly IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "bmp"]);
  /** 页面级扫描页判定阈值：低于该字符数的页视为疑似扫描页（与主流 ocrmypdf 同类口径） */
  private readonly SCAN_TEXT_THRESHOLD = 50;

  // 文件大小限制（字节）
  private readonly MAX_TEXT_SIZE = 1024 * 1024 * 1024; // 1GB
  private readonly MAX_PDF_SIZE = 1024 * 1024 * 1024; // 1GB
  private readonly MAX_WORD_SIZE = 1024 * 1024 * 1024; // 1GB
  private readonly MAX_EXCEL_SIZE = 1024 * 1024 * 1024; // 1GB
  private readonly MAX_IMAGE_SIZE = 1024 * 1024 * 1024; // 1GB

  /**
   * 检测文件类型
   */
  async detectFileType(fileExtension: string): Promise<string> {
    const ext = fileExtension.toLowerCase().replace(/^\./, "");

    if (this.TEXT_EXTENSIONS.has(ext)) {
      return "text";
    } else if (this.PDF_EXTENSIONS.has(ext)) {
      return "pdf";
    } else if (this.WORD_EXTENSIONS.has(ext)) {
      return "word";
    } else if (this.EXCEL_EXTENSIONS.has(ext)) {
      return "excel";
    } else if (this.IMAGE_EXTENSIONS.has(ext)) {
      return "image";
    } else if (
      ["py", "js", "ts", "java", "cpp", "c", "go", "rs"].includes(ext)
    ) {
      return "code";
    } else {
      return "unknown";
    }
  }

  /**
   * 解析文件内容（返回带页码信息的结果）
   * @param filePath 文件绝对路径
   * @param onProgress 进度回调
   */
  async parseFile(
    filePath: string,
    onProgress?: FileProgressCallback,
  ): Promise<ParsedFileResult> {
    const ext = path.extname(filePath).replace(/^\./, "").toLowerCase();
    const fileType = await this.detectFileType(ext);

    const content = await fs.promises.readFile(filePath);
    const fileSize = content.length;

    // 验证文件大小
    this.validateFileSize(fileSize, fileType);

    try {
      if (fileType === "text" || fileType === "code") {
        await onProgress?.(5, "正在读取文本文件...");
        const text = await this.parseTextFile(filePath);
        await onProgress?.(25, "文本文件读取完成");
        return { text, pages: text ? [{ pageNum: 1, text }] : [] };
      } else if (fileType === "pdf") {
        return await this.parsePdfFileWithPages(filePath, onProgress);
      } else if (fileType === "word") {
        await onProgress?.(5, "正在解析 Word 文档...");
        const text = await this.parseWordFile(filePath);
        await onProgress?.(25, "Word 文档解析完成");
        return { text, pages: text ? [{ pageNum: 1, text }] : [] };
      } else if (fileType === "excel") {
        await onProgress?.(5, "正在解析 Excel 文件...");
        const result = await this.parseExcelFile(filePath);
        await onProgress?.(25, "Excel 文件解析完成");
        return result;
      } else if (fileType === "image") {
        // 图片文件：OCR 是唯一文本来源，未配置或识别失败直接抛错（避免静默产生空文档）
        await onProgress?.(5, "正在 OCR 识别图片...");
        const ocrResult = await this.ocrService.recognizeImage(filePath);
        if (!ocrResult || !ocrResult.text.trim()) {
          throw new Error(
            "图片 OCR 识别失败或结果为空，请先在设置中心配置 OCR 提供商",
          );
        }
        await onProgress?.(25, "图片 OCR 识别完成");
        return {
          text: ocrResult.text,
          pages: [{ pageNum: 1, text: ocrResult.text }],
        };
      } else {
        // 未知类型，尝试当作文本解析
        this.logger.warn(`未知文件类型：${fileType}，尝试当作文本解析`);
        await onProgress?.(5, "正在尝试解析文件...");
        const text = await this.parseTextFile(filePath);
        await onProgress?.(25, "文件解析完成");
        return { text, pages: text ? [{ pageNum: 1, text }] : [] };
      }
    } catch (error: any) {
      this.logger.error(
        `文件解析失败：${filePath}, type=${fileType}, error=${error.message}`,
      );
      throw new Error(`文件解析失败：${error.message}`);
    }
  }

  /**
   * 验证文件大小
   */
  private validateFileSize(fileSize: number, fileType: string): void {
    const limits: Record<string, number> = {
      text: this.MAX_TEXT_SIZE,
      code: this.MAX_TEXT_SIZE,
      pdf: this.MAX_PDF_SIZE,
      word: this.MAX_WORD_SIZE,
      excel: this.MAX_EXCEL_SIZE,
      image: this.MAX_IMAGE_SIZE,
    };

    const limit = limits[fileType] || this.MAX_TEXT_SIZE;
    if (fileSize > limit) {
      throw new Error(
        `文件超出大小限制（最大 ${Math.floor(limit / 1024 / 1024)}MB）`,
      );
    }
  }

  /**
   * 解析文本文件
   * @param filePath 文件绝对路径
   */
  private async parseTextFile(filePath: string): Promise<string> {
    const content = await fs.promises.readFile(filePath);
    const ext = path.extname(filePath).replace(/^\./, "").toLowerCase();

    // 尝试不同的编码
    const encodings = ["utf-8", "gbk", "gb2312", "latin-1"];

    for (const encoding of encodings) {
      try {
        const text = content.toString(encoding as BufferEncoding);
        return text.trim();
      } catch (error) {
        continue;
      }
    }

    // 如果所有编码都失败，使用 latin-1（不会抛出异常）
    return content.toString("latin1" as BufferEncoding).trim();
  }

  /**
   * 使用 pdfjs-dist 逐页解析 PDF
   * 返回每页文本和字符数，用于扫描件检测
   */
  private async parsePdfByPages(content: Buffer): Promise<PdfParseResult> {
    const pdfjsLib = await import("pdfjs-dist");
    const pdfDocument = await pdfjsLib.getDocument({
      data: new Uint8Array(content),
    }).promise;
    const totalPages = pdfDocument.numPages;
    const pages: PdfPageInfo[] = [];
    let fullText = "";

    for (let i = 1; i <= totalPages; i++) {
      const page = await pdfDocument.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items.map((item: any) => item.str).join(" ");
      const charCount = pageText.length;
      pages.push({ pageNum: i, text: pageText, charCount });
      fullText += pageText + "\n";
      page.cleanup();
    }

    return { totalPages, pages, fullText };
  }

  /**
   * 判断是否为扫描件 PDF
   * 规则：字符数少于 50 的页面超过总页数的一半
   */
  private isScanPdf(pages: PdfPageInfo[]): boolean {
    if (pages.length === 0) return false;
    const lowCharPages = pages.filter((p) => p.charCount < 50).length;
    return lowCharPages > pages.length / 2;
  }

  /**
   * 解析 PDF 文件（返回带页码信息的结果）
   *
   * 页面级混合路由（主流 ocrmypdf 模型）：
   * - 文本层完整的页：零成本保留文本层
   * - 低字符页（疑似扫描页，charCount < SCAN_TEXT_THRESHOLD）：仅这些页渲染+OCR
   * - force 策略：所有页强制 OCR（等价 ocrmypdf --force-ocr）
   * - 整本扫描 + 原生 PDF 提供商（umi）：整文件走原生 PDF 管线（mixed 模式内部按页处理）
   * - 混合 PDF：文本层页与 OCR 页按页码升序合并，不再依赖文件级 isScanPdf 终局判定
   *
   * @param filePath 文件绝对路径
   * @param onProgress 进度回调
   */
  private async parsePdfFileWithPages(
    filePath: string,
    onProgress?: FileProgressCallback,
  ): Promise<ParsedFileResult> {
    try {
      const content = await fs.promises.readFile(filePath);

      await onProgress?.(5, "正在逐页提取 PDF 文本...");
      const pdfResult = await this.parsePdfByPages(content);

      const caps = await this.ocrService.getCapabilities();
      const strategy = await this.ocrService.getScanOcrStrategy();
      const isScan = this.isScanPdf(pdfResult.pages);

      // 页面级路由：低字符页 = 疑似扫描页；force 策略 = 全部页
      const lowTextPages = pdfResult.pages
        .filter((p) => p.charCount < this.SCAN_TEXT_THRESHOLD)
        .map((p) => p.pageNum);
      const ocrPageNums =
        strategy === "force"
          ? pdfResult.pages.map((p) => p.pageNum)
          : lowTextPages;

      const textPath = async (): Promise<ParsedFileResult> => {
        await onProgress?.(10, "PDF 文本提取完成");
        if (!pdfResult.fullText || pdfResult.fullText.trim().length === 0) {
          this.logger.warn(
            "PDF 解析结果为空，可能是不支持的文件格式、加密文件或扫描件",
          );
          return { text: "", pages: [] };
        }
        const cleanedText = pdfResult.fullText
          .replace(/\r\n/g, "\n")
          .replace(/\r/g, "\n")
          .replace(/\n{3,}/g, "\n\n")
          .trim();
        const pageEntries: PageEntry[] = pdfResult.pages.map((p) => ({
          pageNum: p.pageNum,
          text: p.text,
        }));
        return { text: cleanedText, pages: pageEntries };
      };

      // OCR 完全未配置：保持旧行为，仅用文本层
      if (!caps.supportsPdf && !caps.supportsImage) {
        this.logger.warn("OCR 未配置，疑似扫描页无法识别，仅使用 PDF 文本层");
        return await textPath();
      }

      // 无疑似扫描页（且非 force）：纯文本路径，零 OCR 成本
      if (ocrPageNums.length === 0) {
        return await textPath();
      }

      this.logger.log(
        `PDF 页面级 OCR 路由：共 ${pdfResult.totalPages} 页，需 OCR ${ocrPageNums.length} 页（strategy=${strategy}, pdfMode=${caps.pdfMode}, 整本扫描=${isScan}）`,
      );
      await onProgress?.(10, `检测到 ${ocrPageNums.length} 页需 OCR 识别...`);

      // OCR 进度映射：OCR 内部 0~100% → 全局 10%~80%（与旧扫描件分支一致）
      const ocrOnProgress: FileProgressCallback | undefined = onProgress
        ? async (ocrPct, ocrStep) => {
            const globalPct = 10 + Math.round((ocrPct / 100) * 70);
            await onProgress(globalPct, ocrStep);
          }
        : undefined;

      // 整本扫描（或 force）+ 原生 PDF 提供商（umi）→ 整文件走原生 PDF 管线
      if (caps.pdfMode === "native" && (isScan || strategy === "force")) {
        const ocrResult = await this.ocrService.recognizePdf(
          filePath,
          ocrOnProgress,
        );
        if (ocrResult && ocrResult.text.trim()) {
          this.logger.log(
            `OCR 识别成功，提取文本长度: ${ocrResult.text.length} 字符`,
          );
          return {
            text: ocrResult.text,
            pages: [{ pageNum: 1, text: ocrResult.text }],
          };
        }
        // OCR 已配置但识别失败 → 抛错
        throw new Error("OCR 识别失败或结果为空");
      }

      // 渲染逐页路径：render 型提供商（百度等）全场景；native 提供商（umi）混合 PDF 局部补页
      const ocrPages = await this.ocrService.recognizePdfPages(
        filePath,
        ocrPageNums,
        ocrOnProgress,
      );
      if (!ocrPages.length || ocrPages.every((p) => !p.text.trim())) {
        throw new Error("OCR 识别失败或结果为空");
      }

      // 合并：文本层页 + OCR 页，按页码升序
      const ocrSet = new Set(ocrPages.map((p) => p.page));
      const merged: PageEntry[] = [
        ...pdfResult.pages
          .filter((p) => !ocrSet.has(p.pageNum))
          .map((p) => ({ pageNum: p.pageNum, text: p.text })),
        ...ocrPages.map((p) => ({ pageNum: p.page, text: p.text })),
      ].sort((a, b) => a.pageNum - b.pageNum);

      const fullText = merged.map((p) => p.text).join("\n\n");
      const cleanedText = fullText
        .replace(/\r\n/g, "\n")
        .replace(/\r/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();

      this.logger.log(
        `PDF 解析完成（页面级混合）：文本层 ${merged.length - ocrPages.length} 页 + OCR ${ocrPages.length} 页`,
      );
      return { text: cleanedText, pages: merged };
    } catch (error: any) {
      this.logger.error(`PDF 解析失败: ${error.message}`);
      throw new Error(`PDF 文件解析失败: ${error.message}`);
    }
  }

  /**
   * 解析 Excel 文件
   * 使用 read-excel-file 解析 .xlsx，每个 Sheet 视为一页，表格内容转为 Markdown 格式
   * @param filePath 文件绝对路径
   */
  private async parseExcelFile(filePath: string): Promise<ParsedFileResult> {
    try {
      this.logger.debug("开始解析 Excel 文件");
      const readXlsxFile = await import("read-excel-file/node");

      // 解析为 Sheet[]，每个 Sheet 包含 sheet(name) 和 data(rows)
      const sheets = await readXlsxFile.default(filePath) as Array<{
        sheet: string;
        data: any[][];
      }>;

      const pages: PageEntry[] = [];

      for (let i = 0; i < sheets.length; i++) {
        const sheet = sheets[i];
        const data = sheet.data;

        if (!data || data.length === 0) {
          continue;
        }

        const text = this.convertSheetToMarkdown(sheet.sheet, data);
        if (text && text.trim()) {
          pages.push({ pageNum: i + 1, text });
        }
      }

      const fullText = pages.map((p) => p.text).join("\n\n");

      this.logger.debug(
        `Excel 文件解析成功，共 ${sheets.length} 个 Sheet，有效页数 ${pages.length}`,
      );
      return { text: fullText, pages };
    } catch (error: any) {
      this.logger.error(`Excel 文件解析失败: ${error.message}`);
      throw new Error(`Excel 文件解析失败: ${error.message}`);
    }
  }

  /**
   * 将 Sheet 数据转为 Markdown 表格
   * @param sheetName 工作表名称
   * @param data 二维数组数据
   */
  private convertSheetToMarkdown(sheetName: string, data: any[][]): string {
    if (!data || data.length === 0) {
      return "";
    }

    // 过滤掉完全为空的行
    const nonEmptyRows = data.filter((row) =>
      row.some(
        (cell) =>
          cell !== null && cell !== undefined && String(cell).trim() !== "",
      ),
    );

    if (nonEmptyRows.length === 0) {
      return "";
    }

    // 计算最大列数
    const maxCols = Math.max(...nonEmptyRows.map((row) => row.length));

    // 填充每行到相同列数
    const normalizedRows = nonEmptyRows.map((row) => {
      const filled = new Array(maxCols).fill("");
      for (let j = 0; j < row.length; j++) {
        filled[j] =
          row[j] !== null && row[j] !== undefined ? String(row[j]) : "";
      }
      return filled;
    });

    // 判断是否为单列表格（纯文本列表）
    if (maxCols === 1) {
      const lines = normalizedRows.map((row) => row[0]);
      return `## Sheet: ${sheetName}\n\n${lines.join("\n")}`;
    }

    // 构建 Markdown 表格
    const header = normalizedRows[0];
    const separator = new Array(maxCols).fill("---");
    const body = normalizedRows.slice(1);

    const lines: string[] = [];
    lines.push(`## Sheet: ${sheetName}`);
    lines.push("");
    lines.push(`| ${header.join(" | ")} |`);
    lines.push(`| ${separator.join(" | ")} |`);
    for (const row of body) {
      lines.push(`| ${row.join(" | ")} |`);
    }

    return lines.join("\n");
  }

  /**
   * 解析 Word 文档
   * @param filePath 文件绝对路径
   */
  private async parseWordFile(filePath: string): Promise<string> {
    try {
      this.logger.debug("开始解析 Word 文档");
      const content = await fs.promises.readFile(filePath);
      // 优先提取纯文本
      const result = await mammoth.extractRawText({ buffer: content });

      if (result.value && result.value.trim()) {
        this.logger.debug("Word 文档解析成功");
        // 清理文本：标准化换行符、合并多余空行、去除首尾空白
        return result.value
          .replace(/\r\n/g, "\n")
          .replace(/\r/g, "\n")
          .replace(/\n{3,}/g, "\n\n")
          .trim();
      }

      // 如果纯文本为空，记录警告并返回空字符串或尝试其他方案
      this.logger.warn("Word 文档提取的纯文本内容为空");
      return "";
    } catch (error: any) {
      this.logger.error(`Word 文档解析失败: ${error.message}`);
      throw new Error(`Word 文件解析失败: ${error.message}`);
    }
  }

  /**
   * 获取支持的文件扩展名列表
   */
  getSupportedExtensions(): Record<string, string[]> {
    return {
      text: Array.from(this.TEXT_EXTENSIONS).sort(),
      pdf: Array.from(this.PDF_EXTENSIONS).sort(),
      word: Array.from(this.WORD_EXTENSIONS).sort(),
      excel: Array.from(this.EXCEL_EXTENSIONS).sort(),
      image: Array.from(this.IMAGE_EXTENSIONS).sort(),
      code: ["py", "js", "ts", "java", "cpp", "c", "go", "rs"],
    };
  }
}
