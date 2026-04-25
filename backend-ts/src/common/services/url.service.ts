import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

/**
 * URL 工具服务
 * 用于统一处理资源 URL 的生成和转换
 */
@Injectable()
export class UrlService {
  private baseUrl: string;
  private autoMode: boolean = false;

  constructor(private configService: ConfigService) {
    const configuredUrl = this.configService.get<string>("BASE_URL") || "";
    
    // 检测是否为自动模式
    if (configuredUrl === "__auto__") {
      this.autoMode = true;
      this.baseUrl = "";
    } else {
      this.baseUrl = configuredUrl;
    }
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
   * 将相对路径转换为完整 URL
   * @param path 相对路径（如 /static/images/xxx.svg 或 /uploads/xxx.jpg）
   * @returns 完整 URL（如 http://localhost:3000/static/images/xxx.svg）
   *          如果 BASE_URL 未配置，则返回原路径
   */
  toAbsoluteUrl(path: string): string {
    if (!path) {
      return path;
    }

    // 如果已经是绝对 URL，直接返回
    if (path.startsWith("http://") || path.startsWith("https://")) {
      return path;
    }

    // 如果配置了 BASE_URL，拼接完整 URL
    if (this.baseUrl) {
      // 确保路径以 / 开头
      const normalizedPath = path.startsWith("/") ? path : `/${path}`;
      return `${this.baseUrl}${normalizedPath}`;
    }

    // 未配置 BASE_URL，返回原路径（相对路径）
    return path;
  }

  /**
   * 批量转换对象中的 URL 字段
   * @param obj 包含 URL 字段的对象
   * @param urlFields 需要转换的字段名列表
   * @returns 转换后的对象
   */
  transformUrls<T extends Record<string, any>>(
    obj: T,
    urlFields: string[] = ["avatarUrl", "imageUrl", "fileUrl", "url", "logoUrl"]
  ): T {
    if (!obj || typeof obj !== "object") {
      return obj;
    }

    const result: any = { ...obj };

    for (const field of urlFields) {
      if (result[field] && typeof result[field] === "string") {
        result[field] = this.toAbsoluteUrl(result[field]);
      }
    }

    return result as T;
  }

  /**
   * 批量转换数组中每个对象的 URL 字段
   * @param arr 对象数组
   * @param urlFields 需要转换的字段名列表
   * @returns 转换后的数组
   */
  transformArrayUrls<T extends Record<string, any>>(
    arr: T[],
    urlFields?: string[]
  ): T[] {
    if (!Array.isArray(arr)) {
      return arr;
    }

    return arr.map((item) => this.transformUrls(item, urlFields));
  }
}
