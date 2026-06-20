import { Logger } from "@nestjs/common";
import { PluginBase } from "../base-plugin";
import { PluginManifest, ToolHandlerDef, PromptPiece, PluginContext } from "../types/plugin.types";
import { IToolProvider, ToolProviderMetadata } from "../../tools/interfaces/tool-provider.interface";

/**
 * 将旧的 IToolProvider 适配为 Plugin
 *
 * 用于过渡期：旧 Provider 无需修改即可在插件体系中工作。
 * 工具和提示词都通过适配器桥接到新接口。
 */
export class LegacyProviderAdapter extends PluginBase {
  private readonly logger = new Logger(LegacyProviderAdapter.name);
  public readonly manifest: PluginManifest;

  constructor(private provider: IToolProvider) {
    super();

    const meta: ToolProviderMetadata = provider.getMetadata();
    this.manifest = {
      id: meta.pluginId,
      name: meta.displayName || meta.pluginId,
      version: "1.0.0",
      description: meta.description || "",
      category: meta.type === "extended" ? "user" : "core",
    };
  }

  async getToolHandlers(): Promise<ToolHandlerDef[]> {
    // 从原始 IToolProvider 获取工具定义，每个工具包装一个 handler 委托给 provider.execute()
    try {
      const rawTools = await this.provider.getTools(true, {} as any);
      if (!rawTools || !Array.isArray(rawTools)) return [];

      return rawTools.map((t: any) => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters || { type: "object", properties: {} },
        handler: async (args: any, context?: any, abortSignal?: AbortSignal) => {
          const result = await this.provider.execute(
            { id: "", name: t.name, arguments: args },
            context,
            abortSignal,
          );
          return result;
        },
      }));
    } catch {
      return [];
    }
  }

  async getPrompts(context: PluginContext): Promise<PromptPiece[]> {
    if (!this.provider.getPrompt) return [];
    try {
      const content = await this.provider.getPrompt(context);
      if (!content) return [];
      const meta = this.provider.getMetadata();
      const freq = meta.promptFrequency === "STATIC" ? "STATIC"
        : meta.promptFrequency === "VOLATILE" ? "VOLATILE" : "REGULAR";
      return [{ content, frequency: freq as any, pluginId: this.manifest.id, description: `${this.manifest.name} 使用说明` }];
    } catch {
      return [];
    }
  }

  async getPersistentPrompts(context: PluginContext): Promise<PromptPiece[]> {
    if (!this.provider.getPersistentPrompt) return [];
    try {
      const content = await this.provider.getPersistentPrompt(context);
      if (!content) return [];
      const meta = this.provider.getMetadata();
      return [{ content, frequency: (meta.promptFrequency || "REGULAR") as any, pluginId: this.manifest.id, description: `${this.manifest.name} 持久数据` }];
    } catch {
      return [];
    }
  }
}
