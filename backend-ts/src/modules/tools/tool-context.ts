import { ToolDefinition } from "./interfaces/tool-provider.interface";

/**
 * 工具执行上下文
 *
 * 封装工具调用所需的所有配置和参数，由调用方创建并传递给 ToolOrchestrator。
 * tools 以命名空间为 key 分组，方便按命名空间判断工具可用性。
 * lazyTools 同样按命名空间分组，记录懒加载命名空间下的完整工具定义，
 * 用于执行时判断懒加载工具内部具体哪个工具启用。
 */
export class ToolRuntime {
  /**
   * 工具名到插件标识的映射，用于快速查表定位工具所属插件
   */
  private readonly _toolNameToPluginId: Map<string, string>;

  constructor(
    readonly injectParams: Record<string, any>,
    readonly tools: Record<string, ToolDefinition[]>,
    readonly lazyTools: Record<string, ToolDefinition[]> = {},
  ) {
    // 构建工具名到插件标识的映射
    this._toolNameToPluginId = new Map();
    for (const [pluginId, toolList] of Object.entries(this.tools)) {
      for (const tool of toolList) {
        this._toolNameToPluginId.set(tool.name, pluginId);
      }
    }
    for (const [pluginId, toolList] of Object.entries(this.lazyTools)) {
      for (const tool of toolList) {
        this._toolNameToPluginId.set(tool.name, pluginId);
      }
    }
  }

  /**
   * 返回扁平化的工具列表
   * @param includeLazy 是否包含懒加载插件的工具（默认 false）
   */
  getFlatTools(includeLazy = false): ToolDefinition[] {
    const result: ToolDefinition[] = [];
    for (const pluginTools of Object.values(this.tools)) {
      result.push(...pluginTools);
    }
    if (includeLazy) {
      for (const pluginTools of Object.values(this.lazyTools)) {
        result.push(...pluginTools);
      }
    }
    return result;
  }

  /**
   * 根据工具名查找其所属插件标识
   * @param toolName 工具名
   * @returns 插件标识，未找到返回 undefined
   */
  resolvePluginId(toolName: string): string | undefined {
    return this._toolNameToPluginId.get(toolName);
  }

  /**
   * 根据工具名查找工具定义及其所属插件标识
   * @param toolName 工具名
   * @returns 包含 pluginId 和 tool 的对象，未找到返回 undefined
   */
  resolveTool(toolName: string): { pluginId: string; tool: ToolDefinition } | undefined {
    const pluginId = this._toolNameToPluginId.get(toolName);
    if (!pluginId) return undefined;

    const toolList = this.tools[pluginId] || this.lazyTools[pluginId];
    const tool = toolList?.find((t) => t.name === toolName);
    return tool ? { pluginId, tool } : undefined;
  }
}
