import { Injectable, Logger } from "@nestjs/common";
import { PluginRegistry } from "./registry/plugin-registry";
import {
  PromptPiece,
  PluginContext,
  ResolvedPluginInfo,
} from "./types/plugin.types";

/**
 * 提示词收集器（仅 lazy 通道）
 *
 * v3 起提示词只有**一条**注入管线：
 * - eager（系统提示词）：`registerPrompt` / `toolkit.registerPrompt` 都折算成
 *   提示词段，由 `PromptAssembler` 统一装配；
 * - lazy（`skill_learn` / `tool_load` 后注入消息）：仍由本收集器按需取出。
 *
 * 因此这里只保留 lazy 收集；eager 不再经过收集器。
 */
@Injectable()
export class PromptCollector {
  private readonly logger = new Logger(PromptCollector.name);

  /**
   * 收集所有启用插件中 loadMode=lazy 的提示词（仅在 tool_load 时注入）
   */
  async collectLazyPrompts(
    resolvedPlugins: ResolvedPluginInfo[],
    context: PluginContext,
  ): Promise<PromptPiece[]> {
    return this.collectByLoadMode(resolvedPlugins, context, "lazy");
  }

  /**
   * 从已决议的插件信息中，按 loadMode 收集**工具包级**提示词
   *
   * v3 起插件级 `registerPrompt` 已折算为命名提示词段，不再经过本收集器；
   * 这里只剩工具包作用域的提示词（eager → 系统提示词；lazy → skill_learn 后注入）。
   */
  private async collectByLoadMode(
    resolvedPlugins: ResolvedPluginInfo[],
    context: PluginContext,
    loadMode: string,
  ): Promise<PromptPiece[]> {
    const pieces: PromptPiece[] = [];

    for (const rp of resolvedPlugins) {
      if (!rp.enabled) continue;

      const pluginId = rp.plugin.id;

      // 从 rp.toolKits 取已决议的工具包信息，无需重复调用 handler
      for (const tk of rp.enabledToolKits) {
        if (!tk.enabled) continue;
        if (tk.loadMode !== loadMode) continue;

        const kitRegs = PluginRegistry.getToolKits(pluginId);
        const kitReg = kitRegs.find((k) => k.def.id === tk.id);
        if (!kitReg) continue;

        for (const pm of kitReg.prompts) {
          try {
            const content = await pm.handler(context);
            if (content) {
              pieces.push({
                content,
                frequency: pm.frequency as any,
                loadMode: tk.loadMode as any,
                pluginId,
                description: pm.description,
              });
            }
          } catch {}
        }
      }
    }

    const order = { STATIC: 0, REGULAR: 1, VOLATILE: 2 };
    pieces.sort((a, b) => {
      const diff = (order[a.frequency] ?? 1) - (order[b.frequency] ?? 1);
      return diff !== 0 ? diff : a.pluginId.localeCompare(b.pluginId);
    });
    return pieces;
  }
}
