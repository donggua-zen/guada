export { PluginBase } from "./base-plugin";
export { PluginManager } from "./plugin.manager";
export { PluginRegistry } from "./registry/plugin-registry";
export { LegacyProviderAdapter } from "./adapter/legacy-provider.adapter";
export { PluginsModule } from "./plugins.module";
export type {
  PluginManifest,
  PluginContext,
  PromptPiece,
  ToolHandlerDef,
  ToolParamSchema,
  ToolUsingEvent,
  PromptFrequency,
  ToolLoadMode,
} from "./types/plugin.types";
