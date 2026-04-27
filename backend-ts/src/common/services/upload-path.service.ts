import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { UrlService } from "./url.service";
import * as path from "path";
import * as fs from "fs";

@Injectable()
export class UploadPathService {
  private readonly baseDir: string;
  private readonly publicPrefix: string;
  private readonly subDirs: {
    avatar: string;
    image: string;
    preview: string;
    file: string;
    kb: string;
  };

  constructor(private urlService: UrlService) {
    // 直接从环境变量读取配置
    const uploadRoot = process.env.UPLOAD_ROOT_DIR;
    const uploadUrlPrefix = process.env.UPLOAD_URL_PREFIX;

    // 验证配置是否完整
    if (!uploadRoot || !uploadUrlPrefix) {
      throw new Error(
        "Upload configuration is incomplete. Please set UPLOAD_ROOT_DIR and UPLOAD_URL_PREFIX environment variables. " +
        "Example: UPLOAD_ROOT_DIR=/path/to/uploads UPLOAD_URL_PREFIX=/uploads"
      );
    }

    // 物理基础目录（解析为绝对路径）
    this.baseDir = path.resolve(uploadRoot);
    // Web 访问前缀
    this.publicPrefix = uploadUrlPrefix;
    
    // 子目录配置
    this.subDirs = {
      avatar: process.env.UPLOAD_AVATAR_SUBDIR || "avatars",
      image: process.env.UPLOAD_IMAGE_SUBDIR || "images",
      preview: process.env.UPLOAD_PREVIEW_SUBDIR || "previews",
      file: process.env.UPLOAD_FILE_SUBDIR || "files",
      kb: process.env.UPLOAD_KB_SUBDIR || "knowledge-base",
    };
  }

  /**
   * 获取指定子目录的物理绝对路径，并自动确保目录存在
   */
  getPhysicalPath(subDir: string): string {
    const fullPath = path.join(this.baseDir, subDir);
    if (!fs.existsSync(fullPath)) {
      fs.mkdirSync(fullPath, { recursive: true });
    }
    return fullPath;
  }

  /**
   * 获取文件的数据库存储路径（带 uploads/ 前缀）
   * @param subDir 子目录（如 kb, avatars, images）
   * @param filename 文件名
   * @returns 带前缀的存储路径（如 uploads/kb/test.pdf 或 uploads/avatars/user123.jpg）
   * @note 数据库中存储的是带 uploads/ 前缀的路径，便于区分资源类型
   * @note 返回给前端时，通过 UrlService.toResourceAbsoluteUrl() 转换为完整 URL
   */
  getStoragePath(subDir: string, filename: string): string {
    // 确保路径分隔符在 URL 中是正斜杠
    const normalizedSubDir = subDir.replace(/\\/g, "/");
    const normalizedFilename = filename.replace(/\\/g, "/");
    // 添加 uploads/ 前缀，统一存储格式
    return `uploads/${normalizedSubDir}/${normalizedFilename}`;
  }


  /**
   * 将存储路径转换为物理路径
   * @param storagePath 存储路径（如 uploads/kb/test.pdf 或 http://localhost:3000/uploads/avatars/xxx.jpg）
   * @returns 物理路径（如 ./data/uploads/kb/test.pdf）
   * @note 用于从数据库读取路径后，定位磁盘上的实际文件
   */
  toPhysicalPath(storagePath: string): string {
    let actualPath = storagePath;
    
    // 如果是完整 URL，提取路径部分
    if (storagePath.startsWith("http://") || storagePath.startsWith("https://")) {
      try {
        const url = new URL(storagePath);
        const pathname = url.pathname; // 如 /uploads/avatars/xxx.jpg
        // 去除开头的 /
        actualPath = pathname.startsWith("/") ? pathname.substring(1) : pathname;
      } catch (error) {
        // URL 解析失败，使用原值
        console.warn(`[UploadPathService] 无法解析 URL: ${storagePath}`);
      }
    }
    
    // 去除 uploads/ 前缀
    if (actualPath.startsWith("uploads/")) {
      actualPath = actualPath.substring("uploads/".length);
    }
    
    return path.join(this.baseDir, actualPath);
  }

  /**
   * 获取存储路径并直接转换为完整 URL（便捷方法）
   * @param subDir 子目录（如 kb, avatars, images）
   * @param filename 文件名
   * @returns 完整 URL（如 http://localhost:3000/uploads/avatars/uuid.jpg）
   */
  getStorageUrl(subDir: string, filename: string): string {
    const storagePath = this.getStoragePath(subDir, filename);
    return this.urlService.toResourceAbsoluteUrl(storagePath);
  }
}
