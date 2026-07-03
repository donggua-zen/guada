import { Injectable, Logger } from "@nestjs/common";
import { PluginRegistry } from "./registry/plugin-registry";
import {
  PromptPiece,
  PluginContext,
  ToolLoadMode,
  ResolvedPluginInfo,
} from "./types/plugin.types";

/**
 * 提示词收集器
 *
 * 职责：
 * 1. 按 loadMode（eager/lazy）收集插件的提示词
 * 2. 按 frequency（STATIC→REGULAR→VOLATILE）排序
 */
@Injectable()
export class PromptCollector {
  private readonly logger = new Logger(PromptCollector.name);

  /**
   * 收集所有启用插件中 loadMode=eager 的提示词（始终注入 system prompt）
   */
  async collectPrompts(
    resolvedPlugins: ResolvedPluginInfo[],
    context: PluginContext,
  ): Promise<PromptPiece[]> {
    return this.collectByLoadMode(resolvedPlugins, context, "eager");
  }

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
   * 获取指定插件的所有 eager 提示词
   */
  async collectPluginPrompts(
    pluginId: string,
    resolvedPlugins: ResolvedPluginInfo[],
    context: PluginContext,
  ): Promise<PromptPiece[]> {
    const all = await this.collectByLoadMode(resolvedPlugins, context, "eager");
    return all.filter((p) => p.pluginId === pluginId);
  }

  /**
   * 获取指定插件的所有 lazy 提示词
   */
  async collectPluginLazyPrompts(
    pluginId: string,
    resolvedPlugins: ResolvedPluginInfo[],
    context: PluginContext,
  ): Promise<PromptPiece[]> {
    const all = await this.collectByLoadMode(resolvedPlugins, context, "lazy");
    return all.filter((p) => p.pluginId === pluginId);
  }

  /**
   * 从已决议的插件信息中，按 loadMode 收集提示词
   *
   * 提示词来源：
   * - 通过 registerPrompt 注册在 ToolKit 中的提示词
   * - 通过 api.registerPrompt 注册的插件级提示词（始终 eager）
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

      // 插件级 prompts（始终 eager）
      if (loadMode === "eager") {
        const { prompts: pluginPrompts } = PluginRegistry.getPromptMetas(pluginId);
        for (const meta of pluginPrompts) {
          try {
            const content = await meta.handler(context);
            if (content) {
              pieces.push({
                content,
                frequency: meta.frequency as any,
                loadMode: "eager",
                pluginId,
                description: meta.description,
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
