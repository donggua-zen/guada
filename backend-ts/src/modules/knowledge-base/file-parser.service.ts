import { Injectable, Logger } from "@nestjs/common";
import * as fs from "fs";
import * as path from "path";
import { PDFParse } from "pdf-parse";
import * as mammoth from "mammoth";

@Injectable()
export class FileParserService {
  private readonly logger = new Logger(FileParserService.name);

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

  // 文件大小限制（字节）
  private readonly MAX_TEXT_SIZE = 10 * 1024 * 1024; // 10MB
  private readonly MAX_PDF_SIZE = 50 * 1024 * 1024; // 50MB
  private readonly MAX_WORD_SIZE = 20 * 1024 * 1024; // 20MB

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
    } else if (
      ["py", "js", "ts", "java", "cpp", "c", "go", "rs"].includes(ext)
    ) {
      return "code";
    } else {
      return "unknown";
    }
  }

  /**
   * 解析文件内容
   */
  async parseFile(
    fileContent: Buffer,
    fileType: string,
    fileExtension: string,
    fileSize?: number,
  ): Promise<string> {
    const ext = fileExtension.toLowerCase().replace(/^\./, "");

    // 验证文件大小
    if (fileSize) {
      this.validateFileSize(fileSize, fileType);
    }

    try {
      if (fileType === "text" || fileType === "code") {
        return await this.parseTextFile(fileContent, ext);
      } else if (fileType === "pdf") {
        return await this.parsePdfFile(fileContent);
      } else if (fileType === "word") {
        return await this.parseWordFile(fileContent);
      } else {
        // 未知类型，尝试当作文本解析
        this.logger.warn(`未知文件类型：${fileType}，尝试当作文本解析`);
        return await this.parseTextFile(fileContent, ext);
      }
    } catch (error: any) {
      this.logger.error(
        `文件解析失败：${fileExtension}, size=${fileSize}, error=${error.message}`,
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
   */
  private async parseTextFile(content: Buffer, ext: string): Promise<string> {
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
   * 解析 PDF 文件
   */
  private async parsePdfFile(content: Buffer): Promise<string> {
    try {
      const parser = new PDFParse({ data: content });
      const result = await parser.getText();
      // 清理文本：去除多余空白、标准化换行符
      return result.text
        .replace(/\r\n/g, "\n")
        .replace(/\r/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
    } catch (error: any) {
      this.logger.error(`PDF 解析失败: ${error.message}`);
      throw new Error(`PDF 文件解析失败: ${error.message}`);
    }
  }

  /**
   * 解析 Word 文档
   */
  private async parseWordFile(content: Buffer): Promise<string> {
    try {
      this.logger.debug("开始解析 Word 文档");
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
   * 从文件路径解析内容
   */
  async parseFileFromPath(filePath: string): Promise<string> {
    const ext = path.extname(filePath).replace(/^\./, "").toLowerCase();
    const fileType = await this.detectFileType(ext);

    const content = await fs.promises.readFile(filePath);

    return await this.parseFile(content, fileType, ext, content.length);
  }

  /**
   * 获取支持的文件扩展名列表
   */
  getSupportedExtensions(): Record<string, string[]> {
    return {
      text: Array.from(this.TEXT_EXTENSIONS).sort(),
      pdf: Array.from(this.PDF_EXTENSIONS).sort(),
      word: Array.from(this.WORD_EXTENSIONS).sort(),
      code: ["py", "js", "ts", "java", "cpp", "c", "go", "rs"],
    };
  }
}
