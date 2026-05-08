import { Injectable } from "@nestjs/common";
import { ToolOrchestrator } from "./tool-orchestrator.service";

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
  constructor(private readonly toolOrchestrator: ToolOrchestrator) { }

  /**
   * 从工具配置中创建工具上下文
   * @param sessionId 会话 ID
   * @param userId 用户 ID
   * @param toolsConfig 工具配置（boolean | string[] | Record<string, boolean>）
   * @param mcpServersConfig MCP 服务器配置（boolean | string[]）
   * @param excludeTools 需要排除的工具命名空间列表（如 ['knowledge_base']）
   */
  createContext(
    sessionId: string,
    userId: string,
    toolsConfig: any,
    mcpServersConfig: any,
    excludeTools: string[] = [],
  ): ToolContext {
    const injectParams = {
      session_id: sessionId,
      user_id: userId,
    };

    // 动态遍历所有工具提供者，避免硬编码
    const providerConfigs: Record<string, ProviderConfig> = {};

    for (const [namespace, provider] of this.toolOrchestrator.getProviders()) {
      const metadata = provider.getMetadata();

      // 特殊处理：MCP 工具
      if (metadata.isMcp) {
        // MCP 的配置可能是 boolean 或 array
        let enabled: boolean | string[] = true;
        if (typeof mcpServersConfig === 'boolean') {
          enabled = mcpServersConfig;
        } else if (Array.isArray(mcpServersConfig)) {
          // 如果是指定服务器列表，直接传递数组以实现精细控制
          enabled = mcpServersConfig;
        }

        providerConfigs[namespace] = {
          enabledTools: enabled,
        };
        continue;
      }

      // 对于其他工具，根据 toolsConfig 的类型判断是否启用
      // 如果该工具在排除列表中，强制禁用
      const enabled = !excludeTools.includes(namespace) && this.resolveToolEnabled(toolsConfig, namespace);

      providerConfigs[namespace] = {
        enabledTools: enabled,
      };
    }

    return new ToolContext(injectParams, providerConfigs);
  }

  /**
   * 解析工具配置，判断指定命名空间的工具是否启用
   * 规则：
   * 1. 如果 toolsConfig 是 boolean：
   *    - true: 全部启用
   *    - false: 全部禁用
   * 2. 如果 toolsConfig 是对象 { namespace: boolean | string[] }：
   *    - namespace 为 true: 全部启用
   *    - namespace 为 false: 全部禁用
   *    - namespace 为 string[]: 部分启用（数组中的工具）
   *    - namespace 未配置: 默认为 true
   * 3. 如果 toolsConfig 未定义或为其他类型：默认启用
   */
  private resolveToolEnabled(toolsConfig: any, namespace: string): boolean | string[] {
    // 情况1：boolean 类型
    if (typeof toolsConfig === 'boolean') {
      return toolsConfig;
    }

    // 情况2：对象类型 { namespace: boolean | string[] }
    if (typeof toolsConfig === 'object' && toolsConfig !== null) {
      const config = toolsConfig[namespace];
      
      // 如果是数组，直接返回数组（表示部分启用）
      if (Array.isArray(config)) {
        return config;
      }
      
      // 如果是 boolean，返回 boolean
      if (typeof config === 'boolean') {
        return config;
      }
      
      // 未配置时默认为 true
      return true;
    }

    // 情况3：未定义或其他类型，默认启用
    return true;
  }
}
