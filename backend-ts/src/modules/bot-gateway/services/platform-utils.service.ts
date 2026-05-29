import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

/**
 * 文件后处理回调函数类型
 * @param buffer 下载的原始buffer
 * @returns 处理后的buffer
 */
type FilePostProcessor = (buffer: Buffer) => Promise<Buffer> | Buffer;

/**
 * 平台工具服务
 *
 * 提供通用的文件下载和处理功能
 * 平台特定逻辑通过后处理回调由适配器层提供
 */
@Injectable()
export class PlatformUtilsService {
  private readonly logger = new Logger(PlatformUtilsService.name);

  /**
   * 确保文件名在目标目录中唯一
   * 如果文件名已存在，自动追加 `_1`、`_2` 等后缀
   * @param dir 目标目录
   * @param fileName 原始文件名
   * @returns 唯一的文件路径（绝对路径）
   */
  async ensureUniqueFileName(dir: string, fileName: string): Promise<string> {
    const ext = path.extname(fileName);
    const base = path.basename(fileName, ext);
    let finalPath = path.join(dir, fileName);
    let counter = 1;

    while (await fs.access(finalPath).then(() => true).catch(() => false)) {
      finalPath = path.join(dir, `${base}_${counter}${ext}`);
      counter++;
    }

    return finalPath;
  }

  /**
   * 下载文件到指定路径（下载 + 可选后处理 + 直接保存到目标路径）
   *
   * @param url 文件URL
   * @param savePath 保存路径的绝对路径
   * @param options 处理选项
   * @param options.postProcessor 可选的后处理回调函数，用于平台特定的处理（如解密）
   * @param options.timeout 下载超时时间（毫秒）
   * @returns 文件大小
   *
   * @example
   * // 基本用法 - 直接下载保存到指定路径
   * const fileSize = await platformUtils.downloadFile(url, '/path/to/save.jpg');
   *
   * @example
   * // 带后处理 - 企业微信图片解密
   * const fileSize = await platformUtils.downloadFile(url, '/path/to/save.jpg', {
   *   postProcessor: async (buffer) => {
   *     return await this.decryptWeComImage(buffer, aesKey);
   *   }
   * });
   */
  async downloadFile(
    url: string,
    savePath: string,
    options?: {
      postProcessor?: FilePostProcessor;
      timeout?: number;
    },
  ): Promise<{ fileSize: number }> {
    const timeout = options?.timeout || 30000;

    this.logger.debug(`Downloading file from: ${url}`);

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

    this.logger.debug(`Downloaded file size: ${buffer.length} bytes`);

    // 执行后处理（如果提供）
    if (options?.postProcessor) {
      this.logger.debug('Executing post-processor...');
      try {
        buffer = await options.postProcessor(buffer);
        this.logger.debug(`Post-processed file size: ${buffer.length} bytes`);
      } catch (error: any) {
        this.logger.error(`Post-processor failed: ${error.message}`);
        throw error;
      }
    }

    // 直接保存到目标路径
    await fs.writeFile(savePath, buffer);

    return {
      fileSize: buffer.length,
    };
  }
}
