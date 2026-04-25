import { Injectable } from "@nestjs/common";

/**
 * URL 工具服务
 * 用于统一处理资源 URL 的生成和转换
 */
@Injectable()
export class UrlService {
  private baseUrl: string;
  private autoMode: boolean = false;
  private staticPrefix: string;
  private uploadPrefix: string;

  constructor() {
    const configuredUrl = process.env.BASE_URL || "";
    
    // 检测是否为自动模式
    if (configuredUrl === "__auto__") {
      this.autoMode = true;
      this.baseUrl = "";
    } else {
      this.baseUrl = configuredUrl;
    }
    
    // 读取静态资源前缀配置
    this.staticPrefix = process.env.STATIC_URL || "/static";
    this.uploadPrefix = process.env.UPLOAD_URL_PREFIX || "/uploads";
  }

  /**
   * 动态设置基础 URL（用于 Electron 等动态端口场景）
   * @param url 完整的基础 URL（如 http://localhost:3000）
   */
  setBaseUrl(url: string): void {
    this.baseUrl = url;
  }

  /**
   * 获取当前基础 URL
   */
  getBaseUrl(): string {
    return this.baseUrl;
  }

  /**
   * 检查是否处于自动模式
   */
  isAutoMode(): boolean {
    return this.autoMode;
  }

  /**
   * 将静态资源相对路径转换为完整 URL
   * @param relativePath 相对于 STATIC_DIR 的路径（如 images/models/openai.png）
   * @returns 完整 URL（如 http://localhost:3000/static/images/models/openai.png）
   */
  toStaticAbsoluteUrl(relativePath: string): string {
    if (!relativePath) {
      return relativePath;
    }

    // 如果已经是绝对 URL，直接返回
    if (relativePath.startsWith("http://") || relativePath.startsWith("https://")) {
      return relativePath;
    }

    // 构建完整的静态资源路径
    const normalizedPath = relativePath.startsWith("/") ? relativePath : `/${relativePath}`;
    const fullPath = `${this.staticPrefix}${normalizedPath}`;
    
    // 直接拼接 BASE_URL
    if (this.baseUrl) {
      return `${this.baseUrl}${fullPath}`;
    }
    return fullPath;
  }

  /**
   * 将上传文件相对路径转换为完整 URL
   * @param relativePath 相对于 UPLOAD_ROOT_DIR 的路径（如 kb/test.pdf 或 avatars/user123.jpg）
   * @returns 完整 URL（如 http://localhost:3000/uploads/kb/test.pdf）
   */
  toUploadAbsoluteUrl(relativePath: string): string {
    if (!relativePath) {
      return relativePath;
    }

    // 如果已经是绝对 URL，直接返回
    if (relativePath.startsWith("http://") || relativePath.startsWith("https://")) {
      return relativePath;
    }

    // 构建完整的上传文件路径
    const normalizedPath = relativePath.startsWith("/") ? relativePath : `/${relativePath}`;
    const fullPath = `${this.uploadPrefix}${normalizedPath}`;
    
    // 直接拼接 BASE_URL
    if (this.baseUrl) {
      return `${this.baseUrl}${fullPath}`;
    }
    return fullPath;
  }
}
