import { ToolDefinition, ProviderContext } from "./interfaces/tool-provider.interface";
import { PluginConfig } from "../plugins/types/plugin.types";

/**
 * 懒加载工具集信息
 */
export interface LazyToolSet {
  /** 该工具集下的所有工具定义 */
  tools: ToolDefinition[];
  /** 所属插件 ID */
  pluginId: string;
}

/**
 * 工具执行上下文
 *
 * 封装工具调用所需的所有配置和参数，由调用方创建并传递给 ToolOrchestrator。
 */
export class ToolRuntime {
  constructor(
    readonly injectParams: ProviderContext,
    /** 普通工具（eager）：工具名 → 定义 */
    readonly eagerTools: Map<string, ToolDefinition>,
    /** 懒加载工具集：工具集名 → { 工具列表, 所属插件 } */
    readonly lazyToolSets: Map<string, LazyToolSet>,
    /** 角色插件配置（用于提示词收集时的二次过滤） */
    readonly rolePluginsCfg?: PluginConfig,
  ) {}

  /**
   * 判断工具名是否在 eager 或 lazy 工具中存在
   */
  hasTool(toolName: string): boolean {
    if (this.eagerTools.has(toolName)) return true;
    for (const ls of this.lazyToolSets.values()) {
      if (ls.tools.some(t => t.name === toolName)) return true;
    }
    return false;
  }

  /**
   * 返回扁平化的工具列表
   * @param includeLazy 是否包含懒加载工具集的工具（默认 false）
   */
  getFlatTools(includeLazy = false): ToolDefinition[] {
    const result: ToolDefinition[] = [];
    for (const tool of this.eagerTools.values()) {
      result.push(tool);
    }
    if (includeLazy) {
      for (const ls of this.lazyToolSets.values()) {
        result.push(...ls.tools);
      }
    }
    return result;
  }

  /**
   * 获取懒加载工具集信息
   * @param toolSet 工具集名称
   * @returns 工具集信息（含工具列表和所属插件），未找到返回 undefined
   */
  getLazyToolSet(toolSet: string): LazyToolSet | undefined {
    return this.lazyToolSets.get(toolSet);
  }
}
