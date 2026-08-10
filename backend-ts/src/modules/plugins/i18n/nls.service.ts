import { Injectable, Logger } from "@nestjs/common";

/**
 * NLS (National Language Support) 服务
 *
 * VS Code 式的插件国际化机制：
 * - 每个插件注册自己的语言包（key→string），插件间隔离
 * - display 字段中的字符串可以是 "%key%" 引用或字面量
 * - resolveDisplay 在返回前端前就地解析为最终字符串
 *
 * 作用域：仅作用于 display 等展示层字符串，绝不动 description/inputSchema（LLM 保持英文）
 */
@Injectable()
export class NlsService {
  private readonly logger = new Logger(NlsService.name);

  // pluginId → locale → key→string
  private bundles = new Map<string, Map<string, Record<string, string>>>();

  /**
   * 注册语言包
   *
   * @param pluginId 插件 ID（作用域隔离）
   * @param locale 语言代码（如 "zh"、"en"）
   * @param messages 扁平 key→string 字典
   */
  registerBundle(
    pluginId: string,
    locale: string,
    messages: Record<string, string>,
  ): void {
    if (!this.bundles.has(pluginId)) {
      this.bundles.set(pluginId, new Map());
    }
    this.bundles.get(pluginId)!.set(locale, messages);
    this.logger.debug(
      `Registered NLS bundle: plugin=${pluginId}, locale=${locale}, keys=${Object.keys(messages).length}`,
    );
  }

  /**
   * 解析单个字符串：%key% → 本插件语言包查找，字面量原样返回
   *
   * 降级策略：
   * - 匹配 %key% → 查找语言包
   *   - 命中 → 返回 locale 值
   *   - 未命中 → 返回 key 内部文本（去掉 %% 后的值）
   * - 不匹配 %key% → 原样返回（字面量）
   *
   * @param pluginId 插件 ID（作用域隔离）
   * @param str 待解析字符串
   * @param locale 语言代码（默认 "zh"）
   */
  resolveString(pluginId: string, str: string, locale = "zh"): string {
    const m = str.match(/^%([^%]+)%$/);
    if (!m) return str; // 字面量，原样返回

    const key = m[1];
    const bundle = this.bundles.get(pluginId)?.get(locale);
    return bundle?.[key] ?? key; // 命中→值，未命中→key 降级
  }

  /**
   * 递归解析 display 对象的所有字符串字段
   *
   * 只作用于 display 对象，不碰 description/inputSchema。
   *
   * @param pluginId 插件 ID（作用域隔离）
   * @param display 待解析的 display 对象
   * @param locale 语言代码（默认 "zh"）
   */
  resolveDisplay(pluginId: string, display: any, locale = "zh"): any {
    if (typeof display === "string") {
      return this.resolveString(pluginId, display, locale);
    }
    if (Array.isArray(display)) {
      return display.map((d) => this.resolveDisplay(pluginId, d, locale));
    }
    if (display && typeof display === "object") {
      const out: any = {};
      for (const [k, v] of Object.entries(display)) {
        out[k] = this.resolveDisplay(pluginId, v, locale);
      }
      return out;
    }
    return display;
  }
}
