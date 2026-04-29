/**
 * 模型工具函数
 * 用于处理模型名称显示和头像获取
 */

import { computed } from 'vue'

// 已知提供商的标识符映射（用于匹配头像文件）
const PROVIDER_LOGOS: Record<string, string> = {
  // OpenAI
  'openai': 'OpenAI',
  'gpt': 'OpenAI',
  
  // Anthropic
  'anthropic': 'Anthropic',
  'claude': 'Anthropic',
  
  // Google
  'google': 'Google',
  'gemini': 'Google',
  
  // 百度文心一言
  'baidu': 'baidu',
  'ernie': 'baidu',
  'wenxin': 'baidu',
  
  // 阿里通义千问
  'tongyi': 'Tongyi',
  'qwen': 'Tongyi',
  'aliyun': 'Tongyi',
  
  // 腾讯混元
  'hunyuan': 'hunyuan',
  'tencent': 'hunyuan',
  
  // 智谱 AI
  'zhipu': 'zhipu',
  'glm': 'zhipu',
  
  // 月之暗面 Kimi
  'kimi': 'kimi',
  'moonshot': 'kimi',
  
  // DeepSeek
  'deepseek': 'DeepSeek',
  
  // 零一万物
  'yi': 'Yi',
  '01ai': 'Yi',
  
  // MiniMax
  'minimax': 'minimax',
  
  // StepFun
  'stepfun': 'Stepfun',
  'step': 'Stepfun',
  
  // 百川智能
  'baichuan': 'Baichuan',
  
  // BAAI（北京智源）
  'baai': 'BAAI',
  'zhiyuan': 'BAAI',
  
  // 字节跳动
  'bytedance': 'ByteDance',
  'doubao': 'ByteDance',
  
  // 书生·浦语
  'internlm': 'internlm',
  'shusheng': 'internlm',
  
  // 灵犀
  'ling': 'ling',
}

/**
 * 从模型名称中提取简洁的显示名称
 * - 去除命名空间前缀（如 "provider/model-name" -> "model-name"）
 * - 保持原始大小写
 * 
 * @param modelName 完整的模型名称
 * @returns 简化后的显示名称
 */
export function getModelDisplayName(modelName: string): string {
  if (!modelName) return ''
  
  // 如果包含 "/"，取最后一部分（去除命名空间）
  const parts = modelName.split('/')
  return parts[parts.length - 1] || modelName
}

/**
 * 启发式判断模型所属的提供商
 * 通过小写化、去前缀后与已知提供商进行开头匹配
 * 
 * @param modelName 模型名称
 * @param providerName 提供商名称（可选，作为后备）
 * @returns 提供商标识符
 */
export function detectModelProvider(modelName: string, providerName?: string): string {
  if (!modelName) return providerName?.toLowerCase() || 'default'
  
  // 获取简化后的模型名称
  const displayName = getModelDisplayName(modelName).toLowerCase()
  
  // 尝试匹配已知提供商
  for (const [key, value] of Object.entries(PROVIDER_LOGOS)) {
    if (displayName.startsWith(key)) {
      return value.toLowerCase()
    }
  }
  
  // 如果没有匹配到，返回提供商名称的小写形式
  return providerName?.toLowerCase() || 'default'
}

/**
 * 获取模型的头像路径
 * 优先使用提供商的 Logo，如果没有则返回 null（由 Avatar 组件显示首字母）
 * 
 * @param modelName 模型名称
 * @param providerName 提供商名称
 * @returns 头像路径或 null
 */
export function getModelAvatarPath(modelName: string, providerName?: string): string | null {
  const providerId = detectModelProvider(modelName, providerName)
  
  // 检查是否有对应的 Logo 文件
  const logoFile = PROVIDER_LOGOS[providerId]
  if (logoFile) {
    // 根据实际文件存在情况返回路径
    // 注意：这里假设所有 Logo 都是 .svg 格式（除了 kimi.png 和 ling.png）
    const isPng = logoFile === 'kimi' || logoFile === 'ling'
    const ext = isPng ? 'png' : 'svg'
    return `/images/models/${logoFile}.${ext}`
  }
  
  return null
}

/**
 * Vue Composable: 用于在组件中便捷地获取模型显示信息
 * 
 * @param modelName 模型名称
 * @param providerName 提供商名称
 * @returns 包含显示名称和头像路径的对象
 */
export function useModelDisplay(modelName: string, providerName?: string) {
  const displayName = computed(() => getModelDisplayName(modelName))
  const avatarPath = computed(() => getModelAvatarPath(modelName, providerName))
  
  return {
    displayName,
    avatarPath,
  }
}
