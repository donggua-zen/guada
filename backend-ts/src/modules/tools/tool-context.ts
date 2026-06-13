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
  constructor(
    readonly injectParams: Record<string, any>,
    readonly tools: Record<string, ToolDefinition[]>,
    readonly lazyTools: Record<string, ToolDefinition[]> = {},
  ) {}

  /**
   * 返回扁平化的工具列表
   * @param includeLazy 是否包含懒加载命名空间的工具（默认 false）
   */
  getFlatTools(includeLazy = false): ToolDefinition[] {
    const result: ToolDefinition[] = [];
    for (const namespaceTools of Object.values(this.tools)) {
      result.push(...namespaceTools);
    }
    if (includeLazy) {
      for (const namespaceTools of Object.values(this.lazyTools)) {
        result.push(...namespaceTools);
      }
    }
    return result;
  }
}
