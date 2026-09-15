import { PluginManifest } from "./types/plugin.types";
import { PluginApi } from "./api/plugin-api";

export abstract class PluginBase {
  abstract manifest: PluginManifest;

  _enabled: boolean = true;
  _instanceId?: string;

  /** 声明阶段：始终调用，注册工具/提示词/工具集等元数据 */
  onLoad?(api: PluginApi): Promise<void>;

  /** 活跃阶段：插件启用时调用（启动定时器/连接等） */
  onStart?(): Promise<void>;

  /** 活跃阶段：插件禁用时调用，对应 onStart 的清理 */
  onStop?(): Promise<void>;

  /** 卸载阶段：插件从系统中移除时调用 */
  onUnload?(): Promise<void>;
}
