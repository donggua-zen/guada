import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { UrlService } from "./url.service";
import * as path from "path";
import * as fs from "fs";

@Injectable()
export class UploadPathService {
  private readonly baseDir: string;
  private readonly publicPrefix: string;

  constructor(
    private configService: ConfigService,
    private urlService: UrlService
  ) {
    // 物理基础目录 (例如: /app/static/file_stores)
    this.baseDir =
      this.configService.get<string>("upload.baseDir") ||
      "./static/file_stores";
    // Web 访问前缀 (例如: /static/file_stores)
    this.publicPrefix =
      this.configService.get<string>("upload.publicPrefix") ||
      "/static/file_stores";
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
   * 根据文件名生成 Web 访问 URL（自动转换为完整 URL）
   */
  getWebUrl(subDir: string, filename: string): string {
    // 确保路径分隔符在 URL 中是正斜杠
    const normalizedSubDir = subDir.replace(/\\/g, "/");
    const normalizedFilename = filename.replace(/\\/g, "/");
    const relativeUrl = `${this.publicPrefix}/${normalizedSubDir}/${normalizedFilename}`;
    
    // 使用 UrlService 转换为完整 URL
    return this.urlService.toAbsoluteUrl(relativeUrl);
  }

  /**
   * 从 Web URL 还原物理路径
   */
  getPathFromWebUrl(webUrl: string): string | null {
    if (!webUrl || !webUrl.startsWith(this.publicPrefix)) {
      return null;
    }

    // 提取相对路径部分
    const relativePath = webUrl
      .substring(this.publicPrefix.length)
      .replace(/^\//, "");
    return path.join(this.baseDir, relativePath);
  }
}
