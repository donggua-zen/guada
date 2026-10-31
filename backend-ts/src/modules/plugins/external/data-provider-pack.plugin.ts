import { PluginBase } from "../base-plugin";
import type { PluginApi } from "../api/plugin-api";
import type { PluginManifest } from "../types/plugin.types";
import type { ProviderTypeCard } from "../../llm-core/bundled-catalog.service";

/**
 * 声明式供应商包
 *
 * 没有后端代码（manifest 无 main / provides.providerAdapters），只贡献
 * 类型卡（YAML）：用于接入 OpenAI/Anthropic/Gemini/Responses 同协议的新品牌。
 * 包装成 PluginBase 是为了复用现有插件装载、启停、卸载与 UI 列表机制。
 */
export class DataProviderPackPlugin extends PluginBase {
  manifest: PluginManifest;

  constructor(
    manifest: PluginManifest,
    private readonly cards: ProviderTypeCard[],
  ) {
    super();
    this.manifest = manifest;
  }

  async onLoad(api: PluginApi): Promise<void> {
    for (const card of this.cards) {
      api.registerProviderType(card);
    }
  }
}
