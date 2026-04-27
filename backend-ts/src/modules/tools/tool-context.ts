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
  constructor(private readonly toolOrchestrator: ToolOrchestrator) {}

  /**
   * 从合并的设置中创建工具上下文
   * 支持全局设置和角色设置的两级管理
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

    // 从合并设置中提取工具配置
    // mergedSettings.tools 可能是：
    // - boolean: true(全部启用) / false(全部禁用)
    // - 对象: { namespace: boolean } 指定具体工具的启用状态
    // mergedSettings.mcpServers 是 MCP 服务器的配置（boolean 或 string[]）
    const toolsConfig = mergedSettings?.tools;
    const mcpServersConfig = mergedSettings?.mcpServers;

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
      let enabled = this.resolveToolEnabled(toolsConfig, namespace);
      
      // 特殊处理：知识库工具需要检查是否包含知识库
      if (namespace === 'knowledge_base') {
        // 知识库必须同时满足：配置启用 && 包含知识库内容
        enabled = enabled && containsKnowledgeBase;
      }
      
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
   * 2. 如果 toolsConfig 是对象 { namespace: boolean }：
   *    - 优先使用 namespace 对应的值，未配置默认为 true
   * 3. 如果 toolsConfig 未定义或为其他类型：默认启用
   */
  private resolveToolEnabled(toolsConfig: any, namespace: string): boolean {
    // 情况1：boolean 类型
    if (typeof toolsConfig === 'boolean') {
      return toolsConfig;
    }

    // 情况2：对象类型 { namespace: boolean }
    if (typeof toolsConfig === 'object' && toolsConfig !== null) {
      // 优先使用 namespace 配置，未配置时默认为 true
      return toolsConfig[namespace] !== false;
    }

    // 情况3：未定义或其他类型，默认启用
    return true;
  }
}
