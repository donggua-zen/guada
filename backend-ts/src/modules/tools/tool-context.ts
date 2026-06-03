import { Injectable } from "@nestjs/common";
import { ToolOrchestrator } from "./tool-orchestrator.service";
import { ToolProviderMetadata } from "./interfaces/tool-provider.interface";

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

  getAllProviderConfigs(): Map<string, ProviderConfig> {
    return this.providerConfigs;
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
   * 从工具配置中创建工具上下文
   * @param injectParams 注入参数对象（包含 sessionId, userId, sessionType, workspacePath 等）
   * @param toolsConfig 角色工具配置（boolean | string[] | Record<string, boolean>）
   * @param mcpServersConfig MCP 服务器配置（boolean | string[]）
   * @param excludeTools 需要排除的工具命名空间列表（如 ['knowledge_base']）
   */
  async createContext(
    injectParams: Record<string, any>,
    toolsConfig: any,
    mcpServersConfig: any,
    excludeTools: string[] = [],
  ): Promise<ToolContext> {
    // 动态遍历所有工具提供者，避免硬编码
    const providerConfigs: Record<string, ProviderConfig> = {};

    // 获取全局启用的工具列表
    const globalTools = await this.toolOrchestrator.getLocalToolsList();
    console.log("Global Tools:", globalTools,toolsConfig);
    const globalEnabled = globalTools.filter((t) => t.enabled);
    for (const tool of globalEnabled) {
      if (excludeTools.includes(tool.namespace)) {
        providerConfigs[tool.namespace] = {
          enabledTools: false,
        };
        continue;
      }

      // 全局未启用 → 禁用
      if (tool.isMcp) {
        providerConfigs[tool.namespace] = {
          enabledTools: mcpServersConfig,
        };
        continue;
      }
      if (toolsConfig === true) {
        providerConfigs[tool.namespace] = {
          enabledTools: true,
        };
        continue;
      }
      providerConfigs[tool.namespace] = {
        enabledTools: toolsConfig[tool.namespace] || false,
      };
    }
    console.log("Provider Configs:", providerConfigs);
    return new ToolContext(injectParams, providerConfigs);
  }
}
