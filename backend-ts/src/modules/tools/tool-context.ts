import { Injectable } from "@nestjs/common";

/**
 * 提供者配置接口
 */
export interface ProviderConfig {
  /**
   * 启用的工具列表或布尔值
   * - true: 启用所有工具
   * - false: 禁用所有工具
   * - string[]: 启用指定的工具 ID 列表
   */
  enabledTools: boolean | string[];
}

/**
 * 工具执行上下文
 * 
 * 封装工具调用所需的所有配置和参数，避免在多处重复构建相同的结构。
 * 由调用方创建并传递给 ToolOrchestrator，实现状态与行为的分离。
 */
export class ToolContext {
  /**
   * 注入参数（如 session_id、user_id 等）
   */
  readonly injectParams: Record<string, any>;

  /**
   * 各命名空间的提供者配置
   */
  private readonly providerConfigs: Map<string, ProviderConfig>;

  constructor(
    injectParams: Record<string, any>,
    providerConfigs: Record<string, ProviderConfig>,
  ) {
    this.injectParams = injectParams;
    this.providerConfigs = new Map(Object.entries(providerConfigs));
  }

  /**
   * 获取指定命名空间的提供者配置
   */
  getProviderConfig(namespace: string): ProviderConfig | undefined {
    return this.providerConfigs.get(namespace);
  }

  /**
   * 检查指定命名空间的工具是否启用
   */
  isToolEnabled(namespace: string): boolean {
    const config = this.getProviderConfig(namespace);
    if (!config) return false;
    return config.enabledTools !== false;
  }
}

/**
 * ToolContext 工厂类
 * 
 * 提供便捷的上下文创建方法，统一上下文构建逻辑。
 */
@Injectable()
export class ToolContextFactory {
  /**
   * 从合并的设置中创建工具上下文
   */
  createContext(
    sessionId: string,
    userId: string,
    mergedSettings: any,
    containsKnowledgeBase: boolean = false,
  ): ToolContext {
    const injectParams = {
      session_id: sessionId,
      user_id: userId,
    };

    const providerConfigs: Record<string, ProviderConfig> = {
      mcp: {
        enabledTools: mergedSettings?.mcpServers ?? true,
      },
      time: {
        enabledTools: mergedSettings?.tools?.includes("get_current_time") ?? true,
      },
      memory: {
        enabledTools: mergedSettings?.tools?.includes("memory") ?? false,
      },
      knowledge_base: {
        enabledTools: containsKnowledgeBase,
      },
    };

    return new ToolContext(injectParams, providerConfigs);
  }
}
