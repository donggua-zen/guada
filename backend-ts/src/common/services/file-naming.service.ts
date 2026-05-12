import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { Injectable, Logger } from "@nestjs/common";

/**
 * 文件命名策略配置
 */
export interface FileNameStrategy {
  /** 基础名最大长度（不含时间戳和哈希） */
  maxBaseLength?: number;
  /** UUID哈希长度 */
  shortHashLength?: number;
  /** 特殊字符阈值（0-1之间，低于此比例触发降级） */
  specialCharThreshold?: number;
  /** 字母数字最小占比（0-1之间，低于此比例触发降级） */
  alphanumericMinRatio?: number;
}

/**
 * 文件路径生成结果
 */
export interface FilePathResult {
  /** 完整的物理文件路径 */
  filePath: string;
  /** 相对于基础目录的路径（用于数据库存储） */
  relativePath: string;
  /** 文件名 */
  fileName: string;
}

@Injectable()
export class FileNamingService {
  private readonly logger = new Logger(FileNamingService.name);
  
  // 默认配置
  private readonly defaultStrategy: FileNameStrategy = {
    maxBaseLength: 75,
    shortHashLength: 6,
    specialCharThreshold: 0.3,
    alphanumericMinRatio: 0.2,
  };

  /**
   * 生成安全的文件名（去除特殊字符，保留中文、字母、数字、下划线、连字符、空格）
   * @param fileName 原始文件名（不含扩展名）
   * @returns 清理后的安全文件名
   */
  sanitizeFileName(fileName: string): string {
    // 替换所有非法字符为下划线
    const sanitized = fileName
      .replace(/[<>:"\/\\|?*]/g, '_')  // Windows 非法字符
      .replace(/[\x00-\x1f\x7f]/g, '')  // 控制字符
      .trim();
    
    return sanitized || 'unnamed';
  }

  /**
   * 判断文件名是否包含过多特殊字符或异常字符（需要降级为UUID命名）
   * @param fileName 原始文件名（不含扩展名）
   * @param strategy 命名策略配置
   * @returns true 表示需要降级
   */
  needsUuidFallback(fileName: string, strategy?: FileNameStrategy): boolean {
    const config = { ...this.defaultStrategy, ...strategy };
    
    // 如果清理后长度不足原长度的阈值，说明特殊字符太多
    const sanitized = this.sanitizeFileName(fileName);
    if (sanitized.length < fileName.length * config.specialCharThreshold!) {
      return true;
    }
    
    // 如果清理后为空或只有下划线
    if (!sanitized || /^_+$/.test(sanitized)) {
      return true;
    }
    
    // 如果包含过多连续特殊字符（3个以上）
    if (/_{3,}/.test(sanitized)) {
      return true;
    }
    
    // 如果原始文件名几乎全是特殊字符（字母数字占比低于阈值）
    // 注意：空格、中文标点等也视为有效字符
    const alphanumericCount = (fileName.match(/[a-zA-Z0-9\u4e00-\u9fa5\s\u3000-\u303f\uff00-\uffef]/g) || []).length;
    if (alphanumericCount / fileName.length < config.alphanumericMinRatio!) {
      return true;
    }
    
    return false;
  }

  /**
   * 生成带日期目录的文件路径
   * 目录结构：{baseDir}/YYYYMMDD/
   * 文件命名策略：
   *   - 正常情况：原始文件名_HHmm_短哈希.ext（如：项目文档_1430_a3f8d2.pdf）
   *   - 文件名过长：截断至指定长度 + HHmm_短哈希.ext
   *   - 特殊字符过多：降级为 YYYYMMDD_HHmmss_UUID.ext
   * 
   * @param baseDir 基础目录的物理路径
   * @param originalName 原始文件名（含扩展名）
   * @param strategy 命名策略配置（可选）
   * @returns 文件路径生成结果
   */
  async generateFilePathWithDate(
    baseDir: string,
    originalName: string,
    strategy?: FileNameStrategy,
  ): Promise<FilePathResult> {
    const config = { ...this.defaultStrategy, ...strategy };
    const now = new Date();
    const dateStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
    
    // 创建日期目录（自动递归创建）
    const dateDir = path.join(baseDir, dateStr);
    await fs.promises.mkdir(dateDir, { recursive: true });
    
    const fileExtension = path.extname(originalName).toLowerCase();
    const baseName = path.basename(originalName, fileExtension);
    
    // 生成时间标识（时分，4位数字）
    const timeStr = `${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
    
    let uniqueFilename: string;
    
    // 判断是否需要降级为UUID命名
    if (this.needsUuidFallback(baseName, config)) {
      // 降级方案：完整时间戳 + UUID
      const fullTimeStr = `${timeStr}${String(now.getSeconds()).padStart(2, '0')}`;
      uniqueFilename = `${dateStr}_${fullTimeStr}_${crypto.randomUUID()}${fileExtension}`;
      this.logger.debug(`文件名包含过多特殊字符，降级为UUID命名：${originalName}`);
    } else {
      // 生成短哈希
      const shortHash = crypto.randomUUID().substring(0, config.shortHashLength);
      
      // 清理文件名中的特殊字符
      const sanitizedName = this.sanitizeFileName(baseName);
      
      // 截断过长的文件名
      const truncatedName = sanitizedName.length > config.maxBaseLength!
        ? sanitizedName.substring(0, config.maxBaseLength!)
        : sanitizedName;
      
      // 组合最终文件名：原始名_时分_哈希.扩展名
      uniqueFilename = `${truncatedName}_${timeStr}_${shortHash}${fileExtension}`;
    }
    
    const filePath = path.join(dateDir, uniqueFilename);
    const relativePath = path.relative(baseDir, filePath).replace(/\\/g, '/');
    
    return {
      filePath,
      relativePath,
      fileName: uniqueFilename,
    };
  }

  /**
   * 清理空目录（递归向上最多指定层数）
   * @param dirPath 目录路径
   * @param baseDir 基础目录（防止删除超出范围）
   * @param maxDepth 最大递归深度
   */
  async cleanupEmptyDirectories(
    dirPath: string,
    baseDir: string,
    maxDepth: number = 2,
  ): Promise<void> {
    if (maxDepth <= 0) return;
    
    try {
      // 检查目录是否为空
      const files = await fs.promises.readdir(dirPath);
      if (files.length > 0) return;
      
      // 确保不会删除基础目录或超出范围
      if (dirPath === baseDir || !dirPath.startsWith(baseDir)) {
        return;
      }
      
      // 检查是否是日期格式目录（YYYYMMDD），只清理这种格式的目录
      const dirName = path.basename(dirPath);
      if (!/^\d{8}$/.test(dirName)) {
        this.logger.debug(`跳过非日期目录: ${dirPath}`);
        return;
      }
      
      // 删除空日期目录
      await fs.promises.rmdir(dirPath);
      this.logger.log(`已删除空日期目录: ${dirPath}`);
      
      // 递归清理父目录
      const parentDir = path.dirname(dirPath);
      await this.cleanupEmptyDirectories(parentDir, baseDir, maxDepth - 1);
    } catch (error: any) {
      // 忽略错误（目录非空或权限问题）
      this.logger.debug(`清理目录跳过: ${dirPath}, 原因: ${error.message}`);
    }
  }
}
