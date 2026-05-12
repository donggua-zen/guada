import { Injectable, Logger } from '@nestjs/common';
import { TempFileManager } from './temp-file-manager.service';

/**
 * 图片后处理回调函数类型
 * @param buffer 下载的原始buffer
 * @returns 处理后的buffer
 */
type ImagePostProcessor = (buffer: Buffer) => Promise<Buffer> | Buffer;

/**
 * 平台工具服务
 * 
 * 提供通用的文件下载和处理功能
 * 平台特定逻辑通过后处理回调由适配器层提供
 */
@Injectable()
export class PlatformUtilsService {
  private readonly logger = new Logger(PlatformUtilsService.name);

  constructor(
    private tempFileManager: TempFileManager
  ) { }

  /**
   * 下载并处理图片（下载 + 可选后处理 + 保存到临时文件）
   * 
   * @param url 图片URL
   * @param options 处理选项
   * @param options.postProcessor 可选的后处理回调函数，用于平台特定的处理（如解密）
   * @param options.timeout 下载超时时间（毫秒）
   * @param options.ttl 临时文件存活时间（毫秒）
   * @param options.filename 文件名（可选）
   * @returns 临时文件路径和文件大小
   * 
   * @example
   * // 基本用法 - 直接下载保存
   * const result = await platformUtils.downloadAndProcessImage(url);
   * 
   * @example
   * // 带后处理 - 企业微信图片解密
   * const result = await platformUtils.downloadAndProcessImage(url, {
   *   postProcessor: async (buffer) => {
   *     return await this.decryptWeComImage(buffer, aesKey);
   *   }
   * });
   */
  async downloadAndProcessImage(
    url: string,
    options?: {
      postProcessor?: ImagePostProcessor;
      timeout?: number;
      ttl?: number;
      filename?: string;
    }
  ): Promise<{ tempPath: string; fileSize: number }> {
    const timeout = options?.timeout || 30000;
    const ttl = options?.ttl;

    this.logger.debug(`Downloading image from: ${url}`);

    // 下载文件
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    let buffer: Buffer;

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'AiChat-Bot/1.0',
        },
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Failed to download: ${response.status} ${response.statusText}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      buffer = Buffer.from(arrayBuffer);
    } catch (error: any) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        throw new Error(`Download timeout after ${timeout}ms`);
      }
      throw error;
    }

    this.logger.debug(`Downloaded image size: ${buffer.length} bytes`);

    // 执行后处理（如果提供）
    if (options?.postProcessor) {
      this.logger.debug('Executing post-processor...');
      try {
        buffer = await options.postProcessor(buffer);
        this.logger.debug(`Post-processed image size: ${buffer.length} bytes`);
      } catch (error: any) {
        this.logger.error(`Post-processor failed: ${error.message}`);
        throw error;
      }
    }

    // 保存到临时文件
    const extension = options?.filename ?
      '.' + options.filename.split('.').pop() :
      '.jpg'; // 默认扩展名

    const tempPath = await this.tempFileManager.saveToTemp(
      buffer,
      'image',
      extension,
      ttl
    );

    return {
      tempPath,
      fileSize: buffer.length,
    };
  }
}
