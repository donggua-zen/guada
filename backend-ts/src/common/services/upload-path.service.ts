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
   * 获取上传文件的相对路径（用于存储到数据库）
   * @param subDir 子目录（如 kb, avatars, images）
   * @param filename 文件名
   * @returns 相对路径（如 kb/test.pdf 或 avatars/user123.jpg）
   * @note 数据库中存储的是相对路径，不包含 UPLOAD_URL_PREFIX
   * @note 返回给前端时，通过 UrlService.toUploadAbsoluteUrl() 转换为完整 URL
   */
  getRelativePath(subDir: string, filename: string): string {
    // 确保路径分隔符在 URL 中是正斜杠
    const normalizedSubDir = subDir.replace(/\\/g, "/");
    const normalizedFilename = filename.replace(/\\/g, "/");
    return `${normalizedSubDir}/${normalizedFilename}`;
  }

  /**
   * 将相对路径转换为物理路径
   * @param relativePath 相对路径（如 kb/test.pdf 或 avatars/user123.jpg）
   * @returns 物理路径（如 ./data/uploads/kb/test.pdf）
   * @note 用于从数据库读取相对路径后，定位磁盘上的实际文件
   */
  toPhysicalPath(relativePath: string): string {
    return path.join(this.baseDir, relativePath);
  }
}
