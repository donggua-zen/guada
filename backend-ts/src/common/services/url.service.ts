import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

/**
 * URL 工具服务
 * 用于统一处理资源 URL 的生成和转换
 */
@Injectable()
export class UrlService {
  private readonly baseUrl: string;

  constructor(private configService: ConfigService) {
    // 从环境变量读取基础 URL，如果未设置则使用空字符串（相对路径）
    this.baseUrl = this.configService.get<string>("BASE_URL") || "";
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
