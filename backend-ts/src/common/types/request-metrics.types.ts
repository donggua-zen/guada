/**
 * 单次 LLM 请求的媒体负载统计（不参与 wire 请求）。
 *
 * 口径：请求实际携带的图片按 base64 计的字节数，来自 media-budget 投影，精确值；
 * 不含文本、工具定义与 JSON 外壳。前端用于展示「媒体 / 预算 / 图片数」。
 */
export interface RequestMetrics {
  /** 本请求实际内联的图片字节（base64 计） */
  mediaBytes?: number;
  /** 本次生效的媒体预算（413 压力收缩后） */
  mediaBudgetBytes?: number;
  /** 被替换成路径占位的图片数 */
  omittedImages?: number;
  /** 实际保留的图片数 */
  retainedImages?: number;
}
