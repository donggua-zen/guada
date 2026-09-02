import { Injectable, Logger, Optional } from "@nestjs/common";
import { HttpService } from "@nestjs/axios";
import { firstValueFrom } from "rxjs";
import * as fs from "fs";
import * as path from "path";
import { SettingsService } from "../settings/settings.service";
import { PdfToImageService } from "../../common/pdf-render/pdf-to-image.service";
import { retryWithBackoff } from "../llm-core/utils/retry.util";
import type { FileProgressCallback } from "../../common/types/file-progress.types";

/**
 * PDF OCR 模式
 * - native：OCR 服务原生支持 PDF 直传（如 Umi-OCR）
 * - render：OCR 服务仅收图片，需先将 PDF 逐页渲染为图片（如百度）
 * - none：OCR 未配置或不支持
 */
type PdfOcrMode = "native" | "render" | "none";

/**
 * OCR 服务配置接口
 */
interface OcrConfig {
  provider: "umi" | "baidu" | "none";
  umiHost?: string;
  umiPort?: number;
  baiduApiKey?: string;
  baiduSecretKey?: string;
  /** 扫描页 OCR 策略：auto=仅低字符页（默认）；force=全页强制 OCR */
  ocrMode?: "auto" | "force";
}

/**
 * OCR 提供商能力声明
 */
interface OcrCapabilities {
  supportsPdf: boolean;
  supportsImage: boolean;
  pdfMode: PdfOcrMode;
}

/**
 * OCR 识别结果
 */
interface OcrResult {
  text: string;
  pages?: Array<{
    page: number;
    text: string;
  }>;
}

/**
 * Umi-OCR 响应结构
 */
interface UmiOcrResponse {
  code: number;
  data: string | Array<{
    text: string;
    score: number;
    box: number[][];
  }>;
  time: number;
}

/**
 * Umi-OCR PDF 上传响应
 */
interface UmiPdfUploadResponse {
  code: number;
  data: string;
}

/**
 * Umi-OCR PDF 结果响应
 */
interface UmiPdfResultResponse {
  code: number;
  data: Array<{
    page: number;
    data: Array<{
      text: string;
      score: number;
      box: number[][];
    }>;
  }>;
  processed_count: number;
  pages_count: number;
  is_done: boolean;
  state: string;
  message?: string;
}

/**
 * 百度 OCR Token 响应
 */
interface BaiduTokenResponse {
  access_token: string;
  expires_in: number;
}

/**
 * 百度 OCR 响应
 */
interface BaiduOcrResponse {
  words_result: Array<{
    words: string;
  }>;
  words_result_num: number;
  error_code?: number;
  error_msg?: string;
}

/**
 * OCR 服务
 * 支持 UMI 本地 OCR 和百度 OCR 两种提供商
 * PDF 识别按能力分派：umi 走原生 PDF 任务，百度等仅支持图片的提供商走“渲染为图片后逐页识别”
 */
@Injectable()
export class OcrService {
  private readonly logger = new Logger(OcrService.name);

  constructor(
    private readonly httpService: HttpService,
    private readonly settingsService: SettingsService,
    // 测试/旧代码可能以两参构造；DI 场景下由模块注入
    @Optional() private readonly pdfToImage?: PdfToImageService,
  ) {}

  /**
   * 获取 OCR 配置
   * 从前端设置中心读取配置
   */
  private async getOcrConfig(): Promise<OcrConfig> {
    try {
      const settings = await this.settingsService.getGroupSettings("ocr");
      if (!settings || !settings.provider || settings.provider === "none") {
        return { provider: "none" };
      }

      return {
        provider: settings.provider,
        umiHost: settings.umiHost || "127.0.0.1",
        umiPort: settings.umiPort || 1224,
        baiduApiKey: settings.baiduApiKey,
        baiduSecretKey: settings.baiduSecretKey,
        ocrMode: settings.ocrMode === "force" ? "force" : "auto",
      };
    } catch (error) {
      this.logger.warn(`获取 OCR 配置失败: ${error instanceof Error ? error.message : String(error)}`);
      return { provider: "none" };
    }
  }

  /**
   * 获取当前 OCR 提供商的能力声明
   * supportsPdf 与 pdfMode 同步维护：native/render 均代表“可处理 PDF”
   */
  async getCapabilities(): Promise<OcrCapabilities> {
    const config = await this.getOcrConfig();
    if (config.provider === "umi") {
      return { supportsPdf: true, supportsImage: true, pdfMode: "native" };
    } else if (config.provider === "baidu") {
      // 百度仅接受图片：由 PdfToImageService 渲染后逐页识别
      return { supportsPdf: true, supportsImage: true, pdfMode: "render" };
    }
    return { supportsPdf: false, supportsImage: false, pdfMode: "none" };
  }

  /**
   * 对 PDF 文件执行 OCR 识别
   * 如果当前提供商不支持 PDF，返回 null 而非抛错
   * @param filePath PDF 文件路径
   * @param onProgress 进度回调
   * @returns OCR 识别结果
   */
  async recognizePdf(
    filePath: string,
    onProgress?: FileProgressCallback,
  ): Promise<OcrResult | null> {
    const config = await this.getOcrConfig();

    if (config.provider === "none") {
      this.logger.warn("OCR 未配置，跳过扫描件识别");
      return null;
    }

    const caps = await this.getCapabilities();
    if (!caps.supportsPdf) {
      this.logger.warn(`当前 OCR 提供商 ${config.provider} 不支持 PDF 识别，跳过`);
      return null;
    }

    try {
      if (caps.pdfMode === "native") {
        try {
          return await this.recognizePdfWithUmi(filePath, config, onProgress);
        } catch (nativeError: any) {
          // 降级：本地 PDF 管线自身失败（如任务处理异常）且服务可达时，
          // 渲染为图片后走 umi 图片接口逐页识别；
          // 连接级错误（服务未启动/网络不通）不降级——图片接口同样不可用，避免逐页重试拖慢失败
          if (!this.pdfToImage || isRetryableOcrError(nativeError)) {
            throw nativeError;
          }
          this.logger.warn(
            `UMI 原生 PDF 管线失败（${nativeError?.message}），降级为渲染逐页识别`,
          );
          return await this.recognizePdfViaImages(filePath, config, onProgress);
        }
      }
      if (caps.pdfMode === "render") {
        return await this.recognizePdfViaImages(filePath, config, onProgress);
      }
      return null;
    } catch (error) {
      this.logger.error(`OCR 识别失败: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  /**
   * 获取扫描页 OCR 策略
   * - auto（默认）：仅对无文本层/低字符页做 OCR（按页路由，文本页零成本保留）
   * - force：所有页强制 OCR（等价 ocrmypdf --force-ocr，适合本地免费 OCR 或扫描件为主的场景）
   */
  async getScanOcrStrategy(): Promise<"auto" | "force"> {
    const config = await this.getOcrConfig();
    return config.ocrMode ?? "auto";
  }

  /**
   * 对图片文件执行 OCR 识别
   * @param filePath 图片文件路径
   * @returns OCR 识别结果
   */
  async recognizeImage(filePath: string): Promise<OcrResult | null> {
    const config = await this.getOcrConfig();

    if (config.provider === "none") {
      this.logger.warn("OCR 未配置，跳过图片识别");
      return null;
    }

    try {
      const fileData = await fs.promises.readFile(filePath);
      const text = await this.recognizeImageBuffer(
        fileData,
        undefined,
        path.basename(filePath),
      );
      return {
        text,
        pages: [{ page: 1, text }],
      };
    } catch (error) {
      this.logger.error(`OCR 识别失败: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  /**
   * 对内存中的图片二进制执行 OCR 识别（PDF 渲染路径与图片文件路径共用）
   * @param buffer 图片二进制（PNG/JPEG）
   * @param mimeType 可选 MIME 提示
   * @param hintName 可选文件名提示（日志用）
   * @returns 识别出的文本
   */
  async recognizeImageBuffer(
    buffer: Buffer,
    mimeType?: string,
    hintName?: string,
  ): Promise<string> {
    const config = await this.getOcrConfig();

    if (config.provider === "none") {
      throw new Error("OCR 未配置，无法识别图片");
    }

    const label = hintName || mimeType || "image";
    if (config.provider === "umi") {
      return await this.recognizeImageWithUmi(buffer, config, label);
    } else if (config.provider === "baidu") {
      return await this.recognizeImageWithBaidu(buffer, config, label);
    }
    throw new Error(`不支持的 OCR 提供商: ${config.provider}`);
  }

  // ==================== PDF 渲染识别（百度等仅支持图片的提供商） ====================

  /**
   * 对 PDF 的指定页执行“渲染为图片 → 逐页 OCR”识别
   *
   * 页面级混合路由的核心入口：调用方（file-parser）先用文本层筛出低字符页，
   * 只对这些页做渲染+OCR，识别结果与文本层按页码合并。
   *
   * @param filePath PDF 文件路径
   * @param pageNumbers 需要识别的页码集合（1-based，越界页由渲染层过滤）
   * @param onProgress 进度回调（内部上报 15%~80%）
   * @returns 按页码升序的识别结果
   */
  async recognizePdfPages(
    filePath: string,
    pageNumbers: number[],
    onProgress?: FileProgressCallback,
  ): Promise<Array<{ page: number; text: string }>> {
    const config = await this.getOcrConfig();
    if (config.provider === "none") {
      throw new Error("OCR 未配置，无法识别");
    }
    if (!this.pdfToImage) {
      throw new Error("PDF 转图片服务未初始化，无法执行渲染识别");
    }
    if (!pageNumbers || pageNumbers.length === 0) {
      return [];
    }

    const total = pageNumbers.length;
    this.logger.log(
      `渲染逐页 OCR：${filePath}，指定 ${total} 页（provider=${config.provider}）`,
    );

    const pages: Array<{ page: number; text: string }> = [];
    let done = 0;

    for await (const rendered of this.pdfToImage.renderPages(filePath, {
      pages: pageNumbers,
    })) {
      try {
        const text = await retryWithBackoff(
          () =>
            this.recognizeImageBuffer(
              rendered.buffer,
              rendered.mimeType,
              `pdf-page-${rendered.pageNum}`,
            ),
          {
            logger: this.logger,
            context: `OCR page ${rendered.pageNum}/${total}`,
            maxRetries: 2,
            baseDelayMs: 500,
            maxDelayMs: 5000,
            shouldRetry: (error) => isRetryableOcrError(error),
          },
        );
        pages.push({ page: rendered.pageNum, text: text || "" });
      } finally {
        // 尽早释放页面图片内存
        rendered.buffer = null as any;
      }

      done++;
      if (onProgress) {
        const pct = Math.min(80, 15 + Math.round((done / total) * 65));
        await onProgress(pct, `OCR 识别中 (${done}/${total} 页)`);
      }
    }

    return pages.sort((a, b) => a.page - b.page);
  }

  /**
   * 将 PDF 全部页渲染为图片后逐页 OCR 识别（整文件场景）
   * 复用 recognizePdfPages；进度映射与 UMI PDF 路径保持一致：12%（渲染提示）→ 15%~80%
   */
  private async recognizePdfViaImages(
    filePath: string,
    config: OcrConfig,
    onProgress?: FileProgressCallback,
  ): Promise<OcrResult> {
    if (!this.pdfToImage) {
      throw new Error("PDF 转图片服务未初始化，无法执行渲染识别");
    }

    const totalPages = await this.pdfToImage.getPageCount(filePath);
    if (totalPages <= 0) {
      throw new Error("PDF 无有效页面");
    }

    this.logger.log(
      `使用 ${config.provider} OCR 逐页识别 PDF（渲染模式）: ${filePath}，共 ${totalPages} 页`,
    );

    await onProgress?.(12, "正在将 PDF 渲染为图片...");

    const pages = await this.recognizePdfPages(
      filePath,
      Array.from({ length: totalPages }, (_, i) => i + 1),
      onProgress,
    );

    // 拼接全文（与 UMI PDF 路径同构）
    const fullText = pages
      .map((p) => `[第 ${p.page} 页]\n${p.text}`)
      .join("\n\n");

    return {
      text: fullText,
      pages,
    };
  }

  // ==================== UMI OCR ====================

  /**
   * 使用 UMI OCR 识别 PDF（分页处理，每批最多5页）
   */
  private async recognizePdfWithUmi(
    filePath: string,
    config: OcrConfig,
    onProgress?: FileProgressCallback,
  ): Promise<OcrResult> {
    const host = config.umiHost || "127.0.0.1";
    const port = config.umiPort || 1224;
    const baseUrl = `http://${host}:${port}`;

    this.logger.log(`使用 UMI OCR 识别 PDF: ${filePath}`);

    // 1. 上传 PDF 文件
    await onProgress?.(12, "正在上传 PDF 到 OCR 服务...");
    const msnId = await this.uploadPdfToUmi(filePath, baseUrl);
    this.logger.log(`UMI PDF 任务已创建: ${msnId}`);

    // 2. 轮询结果（内部上报进度 15%~80%）
    await onProgress?.(15, "OCR 识别中...");
    const pages = await this.pollUmiPdfResult(msnId, baseUrl, onProgress);
    this.logger.log(`UMI PDF 识别完成，共 ${pages.length} 页`);

    // 3. 清理任务
    await onProgress?.(82, "OCR 处理完成，正在清理...");
    await this.clearUmiPdfTask(msnId, baseUrl);

    // 4. 拼接全文
    const fullText = pages
      .map((p) => `[第 ${p.page} 页]\n${p.text}`)
      .join("\n\n");

    return {
      text: fullText,
      pages,
    };
  }

  /**
   * 上传 PDF 到 UMI OCR
   */
  private async uploadPdfToUmi(filePath: string, baseUrl: string): Promise<string> {
    const { default: FormData } = await import("form-data");
    const filename = path.basename(filePath);
    const fileData = await fs.promises.readFile(filePath);

    const form = new FormData();
    form.append("file", fileData, {
      filename,
      contentType: "application/pdf",
    });
    form.append("json", JSON.stringify({
      "ocr.language": "models/config_chinese.txt",
      "doc.extractionMode": "mixed",
    }));

    const response = await firstValueFrom(
      this.httpService.post<UmiPdfUploadResponse>(
        `${baseUrl}/api/doc/upload`,
        form,
        {
          headers: form.getHeaders(),
          timeout: 30000,
        },
      ),
    );

    if (response.data.code !== 100) {
      throw new Error(`UMI PDF 上传失败: ${response.data.data}`);
    }

    return response.data.data;
  }

  /**
   * 轮询 UMI PDF 识别结果
   * 只要有进度（拿到新页面）就不会超时，只有 5 分钟没进度才超时
   */
  private async pollUmiPdfResult(
    msnId: string,
    baseUrl: string,
    onProgress?: FileProgressCallback,
  ): Promise<Array<{ page: number; text: string }>> {
    const allPages: Array<{ page: number; text: string }> = [];
    const NO_PROGRESS_TIMEOUT_MS = 5 * 60 * 1000; // 5 分钟无进度超时
    let lastProgressTime = Date.now();

    while (true) {
      const response = await firstValueFrom(
        this.httpService.post<UmiPdfResultResponse>(
          `${baseUrl}/api/doc/result`,
          {
            id: msnId,
            is_data: true,
            format: "dict",
            is_unread: true,
          },
          {
            headers: { "Content-Type": "application/json" },
            timeout: 30000,
          },
        ),
      );

      const result = response.data;
      const datas = result.data || [];

      // 提取新增内容
      for (const pageData of datas) {
        const pageNum = pageData.page || 0;
        const lines = Array.isArray(pageData.data) ? pageData.data.map((l) => l.text) : [];
        allPages.push({
          page: pageNum,
          text: lines.join("\n"),
        });
      }

      // 有进度，更新时间戳并上报
      if (datas.length > 0) {
        lastProgressTime = Date.now();
        const totalPages = result.pages_count || allPages.length;
        this.logger.log(
          `UMI OCR 进度: ${allPages.length}/${totalPages} 页`,
        );

        // 每页约 (80-15)/totalPages 的百分比增量
        await onProgress?.(
          Math.min(80, 15 + Math.round((allPages.length / Math.max(totalPages, 1)) * 65)),
          `OCR 识别中 (${allPages.length}/${totalPages} 页)`,
        );
      }

      // 检查是否全部完成
      if (result.is_done) {
        if (result.state === "success") {
          return allPages;
        }
        throw new Error(`UMI PDF OCR 失败: ${result.message || "未知错误"}`);
      }

      // 检查是否长时间无进度
      const elapsedSinceProgress = Date.now() - lastProgressTime;
      if (elapsedSinceProgress > NO_PROGRESS_TIMEOUT_MS) {
        throw new Error(
          `UMI PDF OCR 轮询超时: ${NO_PROGRESS_TIMEOUT_MS / 1000} 秒内无进度`,
        );
      }

      // 等待后继续轮询
      await this.sleep(500);
    }
  }

  /**
   * 清理 UMI PDF 任务
   */
  private async clearUmiPdfTask(msnId: string, baseUrl: string): Promise<void> {
    try {
      await firstValueFrom(
        this.httpService.get(`${baseUrl}/api/doc/clear/${msnId}`, {
          timeout: 5000,
        }),
      );
    } catch {
      // 忽略清理失败
    }
  }

  /**
   * 使用 UMI OCR 识别图片（接受内存 buffer）
   */
  private async recognizeImageWithUmi(
    fileData: Buffer,
    config: OcrConfig,
    label: string = "image",
  ): Promise<string> {
    const host = config.umiHost || "127.0.0.1";
    const port = config.umiPort || 1224;
    const baseUrl = `http://${host}:${port}`;

    this.logger.log(`使用 UMI OCR 识别图片: ${label}`);
    const base64 = fileData.toString("base64");

    const response = await firstValueFrom(
      this.httpService.post<UmiOcrResponse>(
        `${baseUrl}/api/ocr`,
        {
          base64,
          options: {
            "ocr.language": "models/config_chinese.txt",
            "data.format": "json",
            "tbpu.parser": "multi_para",
          },
        },
        {
          headers: { "Content-Type": "application/json" },
          timeout: 30000,
        },
      ),
    );

    if (response.data.code !== 100) {
      throw new Error(`UMI OCR 识别失败: ${JSON.stringify(response.data)}`);
    }

    const lines = Array.isArray(response.data.data) ? response.data.data : [];
    const text = lines.map((l) => l.text).join("\n");
    return text;
  }

  // ==================== 百度 OCR ====================

  // 百度 OCR 不支持 PDF，已通过 getCapabilities 声明，此处无需实现 PDF 识别方法

  /**
   * 使用百度 OCR 识别图片（接受内存 buffer）
   */
  private async recognizeImageWithBaidu(
    fileData: Buffer,
    config: OcrConfig,
    label: string = "image",
  ): Promise<string> {
    if (!config.baiduApiKey || !config.baiduSecretKey) {
      throw new Error("百度 OCR 配置不完整，请检查 API Key 和 Secret Key");
    }

    this.logger.log(`使用百度 OCR 识别图片: ${label}`);

    // 1. 获取 Access Token
    const token = await this.getBaiduAccessToken(config.baiduApiKey, config.baiduSecretKey);

    // 2. 图片转 base64
    const base64 = fileData.toString("base64");

    // 3. 调用百度通用文字识别 API
    const response = await firstValueFrom(
      this.httpService.post<BaiduOcrResponse>(
        `https://aip.baidubce.com/rest/2.0/ocr/v1/general_basic?access_token=${token}`,
        `image=${encodeURIComponent(base64)}`,
        {
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
          timeout: 30000,
        },
      ),
    );

    const data = response.data;

    if (data.error_code) {
      throw new Error(`百度 OCR 识别失败: ${data.error_msg}`);
    }

    return (data.words_result || []).map((r) => r.words).join("\n");
  }

  /**
   * 获取百度 Access Token
   */
  private async getBaiduAccessToken(apiKey: string, secretKey: string): Promise<string> {
    const response = await firstValueFrom(
      this.httpService.post<BaiduTokenResponse>(
        "https://aip.baidubce.com/oauth/2.0/token",
        null,
        {
          params: {
            grant_type: "client_credentials",
            client_id: apiKey,
            client_secret: secretKey,
          },
          timeout: 10000,
        },
      ),
    );

    return response.data.access_token;
  }

  /**
   * 延迟函数
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * 判断 OCR 请求错误是否可重试（临时性错误：限流/服务端错误/网络抖动）
 * 与 embedding.service 的判定口径保持一致
 */
export function isRetryableOcrError(error: any): boolean {
  if (!error) return false;

  const status = error.status ?? error.statusCode ?? error.response?.status ?? error.code;
  if (status === 429) return true;
  if (status && status >= 500 && status < 600) return true;

  const msg = String(error.message ?? "").toLowerCase();
  const retryableKeywords = [
    "econnreset", "econnrefused", "etimedout", "enotfound", "eai_again",
    "socket hang up", "fetch failed", "network error", "network timeout",
    "request aborted", "connection lost", "connection closed", "timeout",
  ];
  return retryableKeywords.some((kw) => msg.includes(kw));
}
