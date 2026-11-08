import { Injectable, Logger, Optional } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import type { PluginHookDef, PluginHookName } from "../types/plugin.types";

/**
 * 插件 Hook 注册表（v2）
 *
 * 设计要点：
 * - 复用宿主既有的 EventBusService（emit / parallel / serial）：它通过
 *   `eventEmitter.listeners(event)` 实时取监听器，因此动态 on/off 天然生效。
 * - 内置订阅者在模块初始化时先注册 → 决策型钩子上内置逻辑优先；插件后置。
 * - 插件启用态在包装器内过滤（禁用后不执行，但保留注册，避免反复注册抖动）。
 * - fail-open：插件异常只记日志，绝不影响主流程。
 * - 返回值形状校验：
 *     agent.pre_step       只允许副作用（非 undefined 被忽略并告警）
 *     agent.request_error  只接受 { kind: 'retry' }
 *     turn.stopping        只接受 { kind: 'continue', messages: string[] }
 *     emit 事件            返回值忽略
 */

const SERIAL_EVENTS = new Set<PluginHookName>(["agent.pre_step", "agent.request_error"]);
const PLUGIN_HOOK_EVENTS = new Set<PluginHookName>([
  "agent.pre_step",
  "agent.request_error",
  "turn.stopping",
  "session.created",
]);

interface Entry {
  id: string;
  pluginId: string;
  event: PluginHookName;
  order: number;
  handler: PluginHookDef["handler"];
  /** 非 serial 事件：每个 entry 一个监听器 */
  wrapper?: (payload: unknown) => unknown;
}

@Injectable()
export class PluginHookRegistry {
  private readonly logger = new Logger(PluginHookRegistry.name);
  private readonly entries = new Map<PluginHookName, Entry[]>();
  /** serial 事件只装一个分发器；记录已安装的事件 */
  private readonly installed = new Set<PluginHookName>();
  private enabledResolver: (pluginId: string) => boolean = () => true;
  private seq = 0;

  constructor(@Optional() private readonly emitter?: EventEmitter2) {}

  /** 由 PluginManager 注入：插件是否处于启用态 */
  setEnabledResolver(resolver: (pluginId: string) => boolean): void {
    this.enabledResolver = resolver;
  }

  register(pluginId: string, def: PluginHookDef): void {
    if (!PLUGIN_HOOK_EVENTS.has(def.event)) {
      throw new Error(`hook event not open to plugins: ${def.event}`);
    }
    const entry: Entry = {
      id: `${pluginId}:${def.event}:${this.seq++}`,
      pluginId,
      event: def.event,
      order: def.order ?? 0,
      handler: def.handler,
    };
    const list = this.entries.get(def.event) || [];
    list.push(entry);
    list.sort((a, b) => a.order - b.order);
    this.entries.set(def.event, list);

    if (SERIAL_EVENTS.has(def.event)) {
      this.installSerialDispatcher(def.event);
    } else {
      this.installPerEntryListener(entry);
    }
  }

  /** 插件卸载/禁用清理（禁用由 enabledResolver 过滤，无需移除） */
  unregisterPlugin(pluginId: string): void {
    for (const [event, list] of this.entries) {
      for (const entry of list) {
        if (entry.pluginId !== pluginId) continue;
        if (entry.wrapper && this.emitter) {
          try {
            this.emitter.off(event, entry.wrapper as any);
          } catch {
            /* ignore */
          }
        }
      }
      this.entries.set(
        event,
        list.filter((e) => e.pluginId !== pluginId),
      );
    }
  }

  /** 诊断用：当前注册数 */
  size(): number {
    let n = 0;
    for (const list of this.entries.values()) n += list.length;
    return n;
  }

  private installSerialDispatcher(event: PluginHookName): void {
    if (!this.emitter || this.installed.has(event)) return;
    this.installed.add(event);
    this.emitter.on(event, async (payload: unknown) => {
      const list = (this.entries.get(event) || []).slice().sort((a, b) => a.order - b.order);
      for (const entry of list) {
        if (!this.isEnabled(entry.pluginId)) continue;
        try {
          const result = await entry.handler(payload);
          const sanitized = sanitizeResult(event, result, this.logger, entry);
          if (sanitized !== undefined) return sanitized; // serial 语义：接管并短路
        } catch (err: any) {
          this.logger.warn(
            `plugin hook ${entry.pluginId}/${event} failed: ${err?.message ?? err}`,
          );
        }
      }
      return undefined;
    });
  }

  private installPerEntryListener(entry: Entry): void {
    if (!this.emitter) return;
    entry.wrapper = async (payload: unknown) => {
      if (!this.isEnabled(entry.pluginId)) return undefined;
      try {
        const result = await entry.handler(payload);
        return sanitizeResult(entry.event, result, this.logger, entry);
      } catch (err: any) {
        this.logger.warn(
          `plugin hook ${entry.pluginId}/${entry.event} failed: ${err?.message ?? err}`,
        );
        return undefined;
      }
    };
    this.emitter.on(entry.event, entry.wrapper as any);
  }

  private isEnabled(pluginId: string): boolean {
    try {
      return this.enabledResolver(pluginId);
    } catch {
      return false;
    }
  }
}

function sanitizeResult(
  event: PluginHookName,
  result: unknown,
  logger: Logger,
  entry: Entry,
): unknown {
  if (result === undefined) return undefined;

  if (event === "agent.pre_step") {
    // 宿主把非 undefined 视为接管（会跳过压缩等内置订阅者）——插件只允许副作用。
    logger.warn(
      `plugin hook ${entry.pluginId}/agent.pre_step returned a value; ignored (side-effect only)`,
    );
    return undefined;
  }

  if (event === "agent.request_error") {
    const r = result as any;
    if (r && r.kind === "retry") return { kind: "retry" };
    logger.warn(
      `plugin hook ${entry.pluginId}/agent.request_error returned invalid decision; ignored`,
    );
    return undefined;
  }

  if (event === "turn.stopping") {
    const r = result as any;
    if (
      r &&
      r.kind === "continue" &&
      Array.isArray(r.messages) &&
      r.messages.every((m: unknown) => typeof m === "string")
    ) {
      return { kind: "continue", messages: r.messages };
    }
    logger.warn(
      `plugin hook ${entry.pluginId}/turn.stopping returned invalid decision; ignored`,
    );
    return undefined;
  }

  // emit 事件：返回值无意义
  return undefined;
}
