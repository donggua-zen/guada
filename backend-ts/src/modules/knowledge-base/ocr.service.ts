import { Injectable, Logger } from "@nestjs/common";
import { HttpService } from "@nestjs/axios";
import { firstValueFrom } from "rxjs";
import * as fs from "fs";
import * as path from "path";
import { SettingsService } from "../settings/settings.service";

/**
 * OCR 服务配置接口
 */
interface OcrConfig {
  provider: "umi" | "baidu" | "none";
  umiHost?: string;
  umiPort?: number;
  baiduApiKey?: string;
  baiduSecretKey?: string;
}

/**
 * OCR 提供商能力声明
 */
interface OcrCapabilities {
  supportsPdf: boolean;
  supportsImage: boolean;
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
 */
@Injectable()
export class OcrService {
  private readonly logger = new Logger(OcrService.name);

  constructor(
    private readonly httpService: HttpService,
    private readonly settingsService: SettingsService,
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
      };
    } catch (error) {
      this.logger.warn(`获取 OCR 配置失败: ${error instanceof Error ? error.message : String(error)}`);
      return { provider: "none" };
    }
  }

  /**
   * 获取当前 OCR 提供商的能力声明
   */
  async getCapabilities(): Promise<OcrCapabilities> {
    const config = await this.getOcrConfig();
    if (config.provider === "umi") {
      return { supportsPdf: true, supportsImage: true };
    } else if (config.provider === "baidu") {
      return { supportsPdf: false, supportsImage: true };
    }
    return { supportsPdf: false, supportsImage: false };
  }

  /**
   * 对 PDF 文件执行 OCR 识别
   * 如果当前提供商不支持 PDF，返回 null 而非抛错
   * @param filePath PDF 文件路径
   * @returns OCR 识别结果
   */
  async recognizePdf(filePath: string): Promise<OcrResult | null> {
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
      if (config.provider === "umi") {
        return await this.recognizePdfWithUmi(filePath, config);
      }
      return null;
    } catch (error) {
      this.logger.error(`OCR 识别失败: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
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
      if (config.provider === "umi") {
        return await this.recognizeImageWithUmi(filePath, config);
      } else if (config.provider === "baidu") {
        return await this.recognizeImageWithBaidu(filePath, config);
      }
      return null;
    } catch (error) {
      this.logger.error(`OCR 识别失败: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  // ==================== UMI OCR ====================

  /**
   * 使用 UMI OCR 识别 PDF（分页处理，每批最多5页）
   */
  private async recognizePdfWithUmi(
    filePath: string,
    config: OcrConfig,
  ): Promise<OcrResult> {
    const host = config.umiHost || "127.0.0.1";
    const port = config.umiPort || 1224;
    const baseUrl = `http://${host}:${port}`;

    this.logger.log(`使用 UMI OCR 识别 PDF: ${filePath}`);

    // 1. 上传 PDF 文件
    const msnId = await this.uploadPdfToUmi(filePath, baseUrl);
    this.logger.log(`UMI PDF 任务已创建: ${msnId}`);

    // 2. 轮询结果
    const pages = await this.pollUmiPdfResult(msnId, baseUrl);
    this.logger.log(`UMI PDF 识别完成，共 ${pages.length} 页`);

    // 3. 清理任务
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
    const boundary = `----NodeFormBoundary${Date.now()}`;
    const filename = path.basename(filePath);
    const fileData = await fs.promises.readFile(filePath);

    const options = JSON.stringify({
      "ocr.language": "简体中文",
      "doc.extractionMode": "mixed",
    });

    // 构造 multipart/form-data
    const parts = [
      `--${boundary}`,
      `Content-Disposition: form-data; name="file"; filename="${filename}"`,
      "Content-Type: application/pdf",
      "",
      "",
      `--${boundary}`,
      'Content-Disposition: form-data; name="json"',
      "",
      options,
      `--${boundary}--`,
    ];

    const bodyParts: Buffer[] = [];
    for (let i = 0; i < parts.length; i++) {
      bodyParts.push(Buffer.from(parts[i] + "\r\n"));
      if (parts[i].includes("Content-Type: application/pdf")) {
        bodyParts.push(fileData);
        bodyParts.push(Buffer.from("\r\n"));
      }
    }
    const body = Buffer.concat(bodyParts);

    const response = await firstValueFrom(
      this.httpService.post<UmiPdfUploadResponse>(
        `${baseUrl}/api/doc/upload`,
        body,
        {
          headers: {
            "Content-Type": `multipart/form-data; boundary=${boundary}`,
          },
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
        const lines = (pageData.data || []).map((l) => l.text);
        allPages.push({
          page: pageNum,
          text: lines.join("\n"),
        });
      }

      // 有进度，更新时间戳
      if (datas.length > 0) {
        lastProgressTime = Date.now();
        this.logger.log(
          `UMI OCR 进度: ${allPages.length}/${result.pages_count || "?"} 页`,
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
   * 使用 UMI OCR 识别图片
   */
  private async recognizeImageWithUmi(
    filePath: string,
    config: OcrConfig,
  ): Promise<OcrResult> {
    const host = config.umiHost || "127.0.0.1";
    const port = config.umiPort || 1224;
    const baseUrl = `http://${host}:${port}`;

    this.logger.log(`使用 UMI OCR 识别图片: ${filePath}`);

    const fileData = await fs.promises.readFile(filePath);
    const base64 = fileData.toString("base64");

    const response = await firstValueFrom(
      this.httpService.post<UmiOcrResponse>(
        `${baseUrl}/api/ocr`,
        {
          base64,
          options: {
            "ocr.language": "简体中文",
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

    return {
      text,
      pages: [{ page: 1, text }],
    };
  }

  // ==================== 百度 OCR ====================

  // 百度 OCR 不支持 PDF，已通过 getCapabilities 声明，此处无需实现 PDF 识别方法

  /**
   * 使用百度 OCR 识别图片
   */
  private async recognizeImageWithBaidu(
    filePath: string,
    config: OcrConfig,
  ): Promise<OcrResult> {
    if (!config.baiduApiKey || !config.baiduSecretKey) {
      throw new Error("百度 OCR 配置不完整，请检查 API Key 和 Secret Key");
    }

    this.logger.log(`使用百度 OCR 识别图片: ${filePath}`);

    // 1. 获取 Access Token
    const token = await this.getBaiduAccessToken(config.baiduApiKey, config.baiduSecretKey);

    // 2. 读取图片并转 base64
    const fileData = await fs.promises.readFile(filePath);
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

    const text = (data.words_result || []).map((r) => r.words).join("\n");

    return {
      text,
      pages: [{ page: 1, text }],
    };
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
