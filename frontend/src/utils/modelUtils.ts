/**
 * 模型工具函数
 * 用于处理模型名称显示和头像获取
 */

import { computed } from "vue";
import { fixFrontendAssetUrl } from "./url";
import { t } from "@/locales";

// 已知提供商的标识符映射（用于匹配头像文件）
const PROVIDER_LOGOS: Record<string, string> = {
  // OpenAI
  openai: "OpenAI",
  gpt: "OpenAI",

  // Anthropic
  anthropic: "Anthropic",
  claude: "Anthropic",

  // Google
  google: "Google",
  gemini: "Google",

  // 百度文心一言
  baidu: "baidu",
  ernie: "baidu",
  wenxin: "baidu",

  // 阿里通义千问
  tongyi: "Tongyi",
  qwen: "Tongyi",
  aliyun: "Tongyi",

  // 腾讯混元
  hunyuan: "hunyuan",
  tencent: "hunyuan",

  // 智谱 AI
  zhipu: "zhipu",
  glm: "zhipu",

  // 月之暗面 Kimi
  kimi: "kimi",
  moonshot: "kimi",

  // DeepSeek
  deepseek: "DeepSeek",

  // 零一万物
  yi: "Yi",
  "01ai": "Yi",

  // MiniMax
  minimax: "minimax",

  // StepFun
  stepfun: "Stepfun",
  step: "Stepfun",

  // 百川智能
  baichuan: "Baichuan",

  // BAAI（北京智源）
  baai: "BAAI",
  zhiyuan: "BAAI",

  // 字节跳动
  bytedance: "ByteDance",
  doubao: "ByteDance",

  // 书生·浦语
  internlm: "internlm",
  shusheng: "internlm",

  // 灵犀
  ling: "ling",
};

/**
 * 从模型名称中提取简洁的显示名称
 * - 去除命名空间前缀（如 "provider/model-name" -> "model-name"）
 * - 保持原始大小写
 *
 * @param modelName 完整的模型名称
 * @returns 简化后的显示名称
 */
export function getModelDisplayName(modelName: string): string {
  if (!modelName) return "";

  // 如果包含 "/"，取最后一部分（去除命名空间）
  const parts = modelName.split("/");
  return parts[parts.length - 1] || modelName;
}

/**
 * 启发式判断模型所属的提供商
 * 通过小写化、去前缀后与已知提供商进行开头匹配
 *
 * @param modelName 模型名称
 * @param providerName 提供商名称（可选，作为后备）
 * @returns 提供商标识符
 */
export function detectModelProvider(
  modelName: string,
  providerName?: string,
): string {
  if (!modelName) return providerName?.toLowerCase() || "default";

  // 获取简化后的模型名称
  const displayName = getModelDisplayName(modelName).toLowerCase();

  // 尝试匹配已知提供商
  for (const [key, value] of Object.entries(PROVIDER_LOGOS)) {
    if (displayName.startsWith(key)) {
      return value.toLowerCase();
    }
  }

  // 如果没有匹配到，返回提供商名称的小写形式
  return providerName?.toLowerCase() || "default";
}

/**
 * 获取模型的头像路径
 * 优先使用提供商的 Logo，如果没有则返回 null（由 Avatar 组件显示首字母）
 *
 * @param modelName 模型名称
 * @param providerName 提供商名称
 * @returns 头像路径或 null
 */
export function getModelAvatarPath(
  modelName: string,
  providerName?: string,
): string | null {
  const providerId = detectModelProvider(modelName, providerName);

  // 检查是否有对应的 Logo 文件
  const logoFile = PROVIDER_LOGOS[providerId];
  if (logoFile) {
    // 根据实际文件存在情况返回路径
    // 注意：这里假设所有 Logo 都是 .svg 格式（除了 kimi.png 和 ling.png）
    const isPng = logoFile === "kimi" || logoFile === "ling";
    const ext = isPng ? "png" : "svg";
    return fixFrontendAssetUrl(`/images/models/${logoFile}.${ext}`);
  }

  return null;
}

/**
 * Vue Composable: 用于在组件中便捷地获取模型显示信息
 *
 * @param modelName 模型名称
 * @param providerName 提供商名称
 * @returns 包含显示名称和头像路径的对象
 */
export function useModelDisplay(modelName: string, providerName?: string) {
  const displayName = computed(() => getModelDisplayName(modelName));
  const avatarPath = computed(() =>
    getModelAvatarPath(modelName, providerName),
  );

  return {
    displayName,
    avatarPath,
  };
}

/**
 * 获取模型的思考强度选项
 * @param model 模型对象（包含 providerId 和 features）
 * @param providers 供应商列表（从 API 获取，仅用于备用）
 * @returns 思考强度选项数组，如 ['none', 'low', 'medium', 'high'] 或 ['minimal', 'low', 'medium', 'high']
 */
export function getModelThinkingEfforts(
  model: any,
  providers: any[],
): string[] {
  if (!model) {
    return [];
  }

  // 直接从模型自身的 thinkingEfforts 字段读取（后端完整控制选项）
  const efforts = model.thinkingEfforts || [];

  // 如果后端返回了配置，直接返回（后端已决定是否包含 'none'）
  if (efforts.length > 0) {
    return efforts;
  }

  // 备用逻辑：如果模型支持思考功能但没有配置具体强度，提供简化的开关模式
  // 注意：后端已根据协议过滤了无效选项，此处不额外添加
  return [];
}

/**
 * 检查模型是否支持思考功能
 */
export function isThinkingSupported(model: any, providers: any[]): boolean {
  const efforts = getModelThinkingEfforts(model, providers);
  return efforts.length > 0;
}

/**
 * 菜单的默认档位（用户从未显式选过时的取值）
 *
 * 取非关闭档的中位数（向下取整）——即"默认开启思考"、取中等强度，
 * 而不是默认关闭。规则与后端 `defaultThinkingEffort` 一致，避免
 * "UI 显示关闭、实际发了强度值"这类分叉。
 */
export function getDefaultThinkingEffort(options: string[] | undefined): string {
  if (!options || options.length === 0) return 'none';
  const nonOff = options.filter((e) => e !== 'none');
  if (nonOff.length === 0) return 'none';
  return nonOff[Math.floor((nonOff.length - 1) / 2)];
}

/**
 * 获取思考强度的显示标签
 */
export function getThinkingEffortLabel(effort: string): string {
  const key = `common.thinkingEffort.${effort}`;
  const label = t(key);
  return label !== key ? label : effort;
}

/**
 * 规范思考档位全集（编辑表单复选框数据源）。
 * 与后端 THINKING_EFFORTS 同集同序（none/on/minimal/low/medium/high/xhigh/max），
 * 词表增删时两处需同步（后端有漂移门控，此处靠注释约束）。
 */
export const THINKING_EFFORT_OPTIONS: readonly string[] = [
  'none',
  'on',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
];

/**
 * 表达式文本 → 拼法模板选择态：
 * - '' = 跟随继承（表达式为空）
 * - format 名 = 表达式与某模板逐字相等（trim 后比较）
 * - 'custom' = 自定义表达式
 *
 * 模板列表来自后端 GET /models/thinking-patch-templates（与内置拼法等价，
 * 由后端矩阵测试锁定），前端只做文本匹配，不内置模板内容。
 */
export const PATCH_TEMPLATE_CUSTOM = 'custom'

export function matchPatchTemplate(
  expression: string | undefined | null,
  templates: Array<{ format: string; expression: string }>,
): string {
  const source = (expression || '').trim()
  if (!source) return ''
  const hit = templates.find((tpl) => tpl.expression.trim() === source)
  return hit ? hit.format : PATCH_TEMPLATE_CUSTOM
}
