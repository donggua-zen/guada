import { Injectable, Logger } from '@nestjs/common';
import { TempFileManager } from './temp-file-manager.service';

/**
 * 平台工具服务
 * 
 * 集中管理各平台特定的工具函数，如图片解密、文件处理等
 * 避免在 SessionMapperService 中耦合平台特定逻辑
 */
@Injectable()
export class PlatformUtilsService {
  private readonly logger = new Logger(PlatformUtilsService.name);

  constructor(
    private tempFileManager: TempFileManager
  ) {}

  /**
   * 解密企业微信加密的图片
   * @param encryptedBuffer 加密的buffer
   * @param aesKey AES密钥（Base64编码的32字节密钥）
   * @returns 解密后的buffer
   */
  async decryptWeComImage(encryptedBuffer: Buffer, aesKey: string): Promise<Buffer> {
    const crypto = await import('crypto');

    // AES密钥是Base64编码的，需要先解码
    let paddedAesKey = aesKey;
    const paddingNeeded = (-aesKey.length % 4);
    if (paddingNeeded > 0) {
      paddedAesKey += '='.repeat(paddingNeeded);
    }
    
    const keyBuffer = Buffer.from(paddedAesKey, 'base64');

    if (keyBuffer.length !== 32) {
      throw new Error(`Invalid AES key length after Base64 decode: expected 32 bytes, got ${keyBuffer.length} bytes`);
    }

    // IV取AESKey前16字节
    const iv = keyBuffer.slice(0, 16);
    const key = keyBuffer;

    // 使用手动 PKCS#7 填充处理（参考 AstrBot）
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    decipher.setAutoPadding(false);

    let decrypted = decipher.update(encryptedBuffer);
    decrypted = Buffer.concat([decrypted, decipher.final()]);

    // 手动去除 PKCS#7 填充
    const padLen = decrypted[decrypted.length - 1];
    if (padLen < 1 || padLen > 32) {
      throw new Error(`Invalid PKCS#7 padding length: ${padLen}`);
    }
    
    // 验证填充是否正确
    for (let i = 0; i < padLen; i++) {
      if (decrypted[decrypted.length - 1 - i] !== padLen) {
        throw new Error(`Invalid PKCS#7 padding at position ${i}`);
      }
    }
    
    decrypted = decrypted.slice(0, decrypted.length - padLen);

    return decrypted;
  }

  /**
   * 下载并处理图片（下载 + 解密 + 保存到临时文件）
   * @param url 图片URL
   * @param options 处理选项
   */
  async downloadAndProcessImage(
    url: string,
    options?: {
      platform?: 'wecom' | 'dingtalk' | 'feishu';
      aesKey?: string;
      timeout?: number;
      ttl?: number; // 临时文件存活时间
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

    // 根据平台进行解密处理
    if (options?.platform === 'wecom' && options?.aesKey) {
      this.logger.debug('Decrypting WeCom image...');
      buffer = await this.decryptWeComImage(buffer, options.aesKey);
      this.logger.debug(`Decrypted image size: ${buffer.length} bytes`);
    }

    // 保存到临时文件
    const tempPath = await this.tempFileManager.saveToTemp(
      buffer,
      'image',
      '.jpg', // 企业微信图片通常是JPEG
      ttl
    );

    return {
      tempPath,
      fileSize: buffer.length,
    };
  }
}
