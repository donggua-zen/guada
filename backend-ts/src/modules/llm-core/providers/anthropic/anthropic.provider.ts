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

  // 自适应思考模式下支持的 effort 级别
  private defaultThinkingEfforts: string[] = ['low', 'medium', 'high', 'xhigh', 'max'];

  private models: ModelDefinition[] = [
    // Fable 5 — 能力最强，自适应思考始终开启
    createTextModel(
      "claude-fable-5",
      ConfigFragments.ContextWindow._1M,
      ConfigFragments.MaxOutput._128K,
      ConfigFragments.WithTools,
    ),
    // Mythos 5 — Project Glasswing
    createTextModel(
      "claude-mythos-5",
      ConfigFragments.ContextWindow._1M,
      ConfigFragments.MaxOutput._128K,
      ConfigFragments.WithTools,
    ),
    // Opus 4.8 — 复杂推理
    createTextModel(
      "claude-opus-4-8",
      ConfigFragments.ContextWindow._1M,
      ConfigFragments.MaxOutput._128K,
      ConfigFragments.WithTools,
    ),
    // Sonnet 4.6 — 速度与智能平衡
    createTextModel(
      "claude-sonnet-4-6",
      ConfigFragments.ContextWindow._1M,
      ConfigFragments.MaxOutput._66K,
      ConfigFragments.WithTools,
    ),
    // Haiku 4.5 — 最快
    createTextModel(
      "claude-haiku-4-5",
      ConfigFragments.ContextWindow._200K,
      ConfigFragments.MaxOutput._66K,
      ConfigFragments.WithTools,
    ),
  ];

  getMetadata(): ProviderMetadata {
    return {
      id: this.id,
      name: this.name,
      description: "Anthropic 的 Claude 系列模型，以安全和高质量对话著称。",
      avatarUrl: "anthropic.svg",
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
