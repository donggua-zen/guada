import { Injectable, Logger } from "@nestjs/common";
import * as fs from "fs";
import * as path from "path";
import * as mammoth from "mammoth";
import { OcrService } from "./ocr.service";
import { PageEntry } from "./chunking.service";

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

  // 文件大小限制（字节）
  private readonly MAX_TEXT_SIZE = 1024 * 1024 * 1024; // 1GB
  private readonly MAX_PDF_SIZE = 1024 * 1024 * 1024; // 1GB
  private readonly MAX_WORD_SIZE = 1024 * 1024 * 1024; // 1GB
  private readonly MAX_EXCEL_SIZE = 1024 * 1024 * 1024; // 1GB

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
   */
  async parseFile(filePath: string): Promise<ParsedFileResult> {
    const ext = path.extname(filePath).replace(/^\./, "").toLowerCase();
    const fileType = await this.detectFileType(ext);

    const content = await fs.promises.readFile(filePath);
    const fileSize = content.length;

    // 验证文件大小
    this.validateFileSize(fileSize, fileType);

    try {
      if (fileType === "text" || fileType === "code") {
        const text = await this.parseTextFile(filePath);
        return { text, pages: text ? [{ pageNum: 1, text }] : [] };
      } else if (fileType === "pdf") {
        return await this.parsePdfFileWithPages(filePath);
      } else if (fileType === "word") {
        const text = await this.parseWordFile(filePath);
        return { text, pages: text ? [{ pageNum: 1, text }] : [] };
      } else if (fileType === "excel") {
        return await this.parseExcelFile(filePath);
      } else {
        // 未知类型，尝试当作文本解析
        this.logger.warn(`未知文件类型：${fileType}，尝试当作文本解析`);
        const text = await this.parseTextFile(filePath);
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
   * 如果解析结果为空（可能是扫描件），则尝试使用 OCR 识别
   * @param filePath 文件绝对路径
   */
  private async parsePdfFileWithPages(
    filePath: string,
  ): Promise<ParsedFileResult> {
    try {
      const content = await fs.promises.readFile(filePath);
      const pdfResult = await this.parsePdfByPages(content);

      // 判断是否为扫描件：字符数少于 50 的页面超过一半
      const isScan = this.isScanPdf(pdfResult.pages);

      if (isScan) {
        const lowCharCount = pdfResult.pages.filter(
          (p) => p.charCount < 50,
        ).length;
        this.logger.warn(
          `检测到扫描件 PDF（共 ${pdfResult.totalPages} 页，其中 ${lowCharCount} 页字符数少于 50），尝试 OCR 识别`,
        );
        const ocrResult = await this.ocrService.recognizePdf(filePath);
        if (ocrResult && ocrResult.text.trim()) {
          this.logger.log(
            `OCR 识别成功，提取文本长度: ${ocrResult.text.length} 字符`,
          );
          return {
            text: ocrResult.text,
            pages: [{ pageNum: 1, text: ocrResult.text }],
          };
        }
        throw new Error("OCR 识别失败或结果为空");
      }

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

      // 构建 PageEntry 列表
      const pageEntries: PageEntry[] = pdfResult.pages.map((p) => ({
        pageNum: p.pageNum,
        text: p.text,
      }));

      this.logger.debug(
        `PDF 解析成功，共 ${pdfResult.totalPages} 页，提取文本长度: ${cleanedText.length} 字符`,
      );
      return { text: cleanedText, pages: pageEntries };
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
      code: ["py", "js", "ts", "java", "cpp", "c", "go", "rs"],
    };
  }
}
