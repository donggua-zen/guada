import { Injectable } from "@nestjs/common";
import {
  IModelProvider,
  ProviderMetadata,
  ModelDefinition,
  ModelFilterOptions,
} from "../../types/provider.types";
import { createTextModel, ConfigFragments } from "../../utils/model-config.helper";
import { AnthropicAdapter } from "../../adapters/anthropic.adapter";
import { IProtocolAdapter } from "../../adapters/base.adapter";

/**
 * Anthropic 供应商实现
 * Claude 系列模型提供商
 */
@Injectable()
export class AnthropicProvider implements IModelProvider {
  readonly id = "anthropic";
  readonly name = "Anthropic";
  readonly protocols = ["anthropic"];
  readonly defaultApiUrl = "https://api.anthropic.com";

  private adapter: AnthropicAdapter;

  constructor() {
    this.adapter = new AnthropicAdapter();
  }

  getAdapter(protocol: string): IProtocolAdapter | null {
    if (protocol === "anthropic") {
      return this.adapter;
    }
    return null;
  }

  // 支持官方全部思考档次
  private defaultThinkingEfforts: string[] = ['off', 'low', 'medium', 'high', 'xhigh', 'max'];

  private models: ModelDefinition[] = [
    // Claude 4 系列
    createTextModel(
      "claude-sonnet-4-20250514",
      ConfigFragments.ContextWindow._200K,
      ConfigFragments.MaxOutput._128K,
      ConfigFragments.WithTools,
    ),
    createTextModel(
      "claude-opus-4-20250514",
      ConfigFragments.ContextWindow._200K,
      ConfigFragments.MaxOutput._128K,
      ConfigFragments.WithTools,
    ),
    // Claude 3.5 系列
    createTextModel(
      "claude-sonnet-4.5-20250214",
      ConfigFragments.ContextWindow._200K,
      ConfigFragments.MaxOutput._128K,
      ConfigFragments.WithTools,
    ),
    // Claude 3 系列
    createTextModel(
      "claude-3-5-sonnet-20241022",
      ConfigFragments.ContextWindow._200K,
      ConfigFragments.MaxOutput._128K,
      ConfigFragments.WithTools,
    ),
    createTextModel(
      "claude-3-5-haiku-20241022",
      ConfigFragments.ContextWindow._200K,
      ConfigFragments.MaxOutput._128K,
      ConfigFragments.WithTools,
    ),
    // Claude 3 (Opus)
    createTextModel(
      "claude-3-opus-20240229",
      ConfigFragments.ContextWindow._200K,
      ConfigFragments.MaxOutput._128K,
      ConfigFragments.WithTools,
    ),
  ];

  getMetadata(): ProviderMetadata {
    return {
      id: this.id,
      name: this.name,
      description: "Anthropic 的 Claude 系列模型，以安全和高质量对话著称。",
      avatarUrl: "static/images/providers/anthropic.svg",
      apiKeyUrl: "https://console.anthropic.com/settings/keys",
      protocols: this.protocols,
      defaultApiUrl: this.defaultApiUrl,
      features: [],
    };
  }

  getModels(options?: ModelFilterOptions): ModelDefinition[] {
    if (!options) return this.models;
    return this.models.filter((model) => {
      if (
        options.modeType &&
        model.modeType !== options.modeType
      ) {
        return false;
      }
      if (
        options.feature &&
        !model.config.features.includes(options.feature)
      ) {
        return false;
      }
      return true;
    });
  }

  getModelThinkingEfforts(modelName: string): string[] {
    return this.defaultThinkingEfforts;
  }
}
