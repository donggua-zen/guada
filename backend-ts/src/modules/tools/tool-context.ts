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
    // mergedSettings.tools 是角色级别的配置（对象格式：{ namespace: boolean | 'all' }）
    // mergedSettings.mcpServers 是 MCP 服务器的配置（boolean 或 string[]）
    const characterTools = mergedSettings?.tools || {};
    const mcpServersConfig = mergedSettings?.mcpServers;

    // 动态遍历所有工具提供者，避免硬编码
    const providerConfigs: Record<string, ProviderConfig> = {};
    
    for (const [namespace, provider] of this.toolOrchestrator.getProviders()) {
      const metadata = provider.getMetadata();
      
      // 获取角色级别的配置
      const characterValue = characterTools[namespace];
      
      // 计算默认值（所有工具默认为启用）
      const defaultEnabled = true;
      
      // 特殊处理：MCP 工具
      if (metadata.isMcp) {
        // MCP 的配置可能是 boolean 或 array
        let enabled = true;
        if (typeof mcpServersConfig === 'boolean') {
          enabled = mcpServersConfig;
        } else if (Array.isArray(mcpServersConfig)) {
          // 如果是指定服务器列表，则启用 MCP 提供者
          enabled = mcpServersConfig.length > 0;
        }
        
        providerConfigs[namespace] = {
          enabledTools: enabled,
        };
        continue;
      }
      
      // 特殊处理：知识库工具需要检查是否包含知识库
      let enabled = true;
      if (namespace === 'knowledge_base') {
        enabled = containsKnowledgeBase && 
          this.mergeToolConfig(
            defaultEnabled,
            characterValue ?? defaultEnabled,
          );
      } else {
        // 对于其他工具，使用角色配置（如果没有配置则默认为启用）
        enabled = this.mergeToolConfig(
          defaultEnabled,
          characterValue ?? defaultEnabled,
        );
      }
      
      providerConfigs[namespace] = {
        enabledTools: enabled,
      };
    }

    return new ToolContext(injectParams, providerConfigs);
  }

  /**
   * 合并全局和角色级别的工具配置
   * 规则：
   * 1. 如果角色设置为 "all"，则使用全局设置
   * 2. 否则取全局和角色的交集（两者都为 true 才启用）
   */
  private mergeToolConfig(globalValue: any, characterValue: any): boolean {
    // 角色设置为 "all" 表示启用所有全局允许的工具
    if (characterValue === "all") {
      return globalValue === true;
    }

    // 角色设置为布尔值，取交集
    if (typeof characterValue === "boolean") {
      return globalValue === true && characterValue === true;
    }

    // 默认使用全局设置
    return globalValue === true;
  }
}
