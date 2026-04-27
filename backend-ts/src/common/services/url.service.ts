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
   * 判断是否为静态资源路径
   * @param resourcePath 资源路径
   * @returns 是否为静态资源
   */
  isStaticResource(resourcePath: string): boolean {
    if (!resourcePath) {
      return false;
    }

    // 如果是完整 URL，提取路径部分
    if (resourcePath.startsWith("http://") || resourcePath.startsWith("https://")) {
      try {
        const url = new URL(resourcePath);
        const pathname = url.pathname;
        const normalizedPath = pathname.startsWith("/") ? pathname.substring(1) : pathname;
        return normalizedPath.startsWith("static/");
      } catch (error) {
        return false;
      }
    }

    // 相对路径判断
    const normalizedPath = resourcePath.startsWith("/") ? resourcePath.substring(1) : resourcePath;
    return normalizedPath.startsWith("static/");
  }

  /**
   * 将资源路径转换为完整 URL（智能识别资源类型）
   * @param resourcePath 资源路径，支持三种格式：
   *   - 外部 URL: "https://example.com/xxx.jpg" → 直接返回
   *   - 静态资源: "static/images/xxx.jpg" → 使用 staticPrefix
   *   - 上传文件: "uploads/avatars/uuid.jpg" → 使用 uploadPrefix
   * @returns 完整 URL
   */
  toResourceAbsoluteUrl(resourcePath: string): string {
    if (!resourcePath) {
      return resourcePath;
    }

    // 如果已经是绝对 URL，直接返回
    if (resourcePath.startsWith("http://") || resourcePath.startsWith("https://")) {
      return resourcePath;
    }

    // 规范化：去除开头的 /
    const normalizedPath = resourcePath.startsWith("/") ? resourcePath.substring(1) : resourcePath;

    // 根据前缀判断类型
    if (normalizedPath.startsWith("static/")) {
      // 静态资源
      const fullPath = `${this.staticPrefix}/${normalizedPath.substring("static/".length)}`;
      return this.baseUrl ? `${this.baseUrl}${fullPath}` : fullPath;
    } else if (normalizedPath.startsWith("uploads/")) {
      // 上传文件
      const fullPath = `${this.uploadPrefix}/${normalizedPath.substring("uploads/".length)}`;
      return this.baseUrl ? `${this.baseUrl}${fullPath}` : fullPath;
    } else {
      // 兼容旧数据：默认当作上传文件处理
      const fullPath = `${this.uploadPrefix}/${normalizedPath}`;
      return this.baseUrl ? `${this.baseUrl}${fullPath}` : fullPath;
    }
  }
}
