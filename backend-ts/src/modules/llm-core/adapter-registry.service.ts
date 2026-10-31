import { Injectable, Logger } from '@nestjs/common';
import { IProtocolAdapter, ProtocolCapabilities } from './adapters/base.adapter';
import type { ProtocolDescriptor } from './types/provider-plugin.types';

/** 协议注册冲突错误（内建保留位 / 插件之间重名） */
export class ProtocolConflictError extends Error {
  constructor(
    readonly protocol: string,
    readonly owner: string,
    readonly pluginId?: string,
  ) {
    super(
      `Protocol "${protocol}" is already registered by ${owner}` +
        (pluginId ? `; plugin "${pluginId}" cannot override it` : ''),
    );
    this.name = 'ProtocolConflictError';
  }
}

/** 协议存在但当前不可用（贡献它的插件被禁用） */
export class ProtocolDisabledError extends Error {
  constructor(readonly protocol: string, readonly pluginId?: string) {
    super(
      `Protocol "${protocol}" is registered but disabled` +
        (pluginId ? ` (plugin ${pluginId})` : ''),
    );
    this.name = 'ProtocolDisabledError';
  }
}

interface AdapterEntry {
  adapter: IProtocolAdapter;
  source: 'builtin' | 'plugin';
  pluginId?: string;
  displayName?: string;
  capabilities?: ProtocolCapabilities;
  active: boolean;
}

/**
 * 协议适配器注册表
 *
 * 从「构造器硬编码的不可变注册表」演进为动态注册表：
 * - 内置 5 个适配器由 LlmCoreModule 在构造期 registerBuiltin（顺序确定）；
 * - 插件通过 ProviderContributionCoordinator 调用 registerPluginAdapters；
 * - 插件禁用只置 active=false（保留定义，恢复即时生效），卸载才删除条目。
 *
 * 冲突策略：内建协议是保留位，任何插件都不得覆盖（防止恶意包劫持 openai
 * 等协议、把用户密钥发往攻击者地址）；插件之间协议重名同样拒绝。需要派生
 * 行为时使用新协议名（如 `openai-acme`）。
 */
@Injectable()
export class AdapterRegistry {
  private readonly logger = new Logger(AdapterRegistry.name);
  private readonly entries = new Map<string, AdapterEntry>();

  /** 注册内置协议（随应用分发，冲突即编程错误） */
  registerBuiltin(adapter: IProtocolAdapter): void {
    this.registerEntry(adapter, {
      source: 'builtin',
      active: true,
      displayName: adapter.displayName,
      capabilities: adapter.capabilities,
    });
  }

  /** 校验插件协议是否可以注册（不落库） */
  validatePluginAdapters(pluginId: string, adapters: IProtocolAdapter[]): string[] {
    const errors: string[] = [];
    const seen = new Set<string>();
    for (const adapter of adapters) {
      const protocol = adapter?.protocol;
      if (!protocol || typeof protocol !== 'string') {
        errors.push(`plugin "${pluginId}" contributed an adapter without protocol`);
        continue;
      }
      if (typeof adapter.chatCompletion !== 'function') {
        errors.push(`protocol "${protocol}" adapter must implement chatCompletion()`);
        continue;
      }
      if (seen.has(protocol)) {
        errors.push(`plugin "${pluginId}" contributes duplicate protocol "${protocol}"`);
        continue;
      }
      seen.add(protocol);
      const existing = this.entries.get(protocol);
      if (existing) {
        const owner = existing.source === 'builtin'
          ? 'builtin catalog'
          : `plugin "${existing.pluginId}"`;
        errors.push(
          `protocol "${protocol}" is already registered by ${owner}; plugin "${pluginId}" cannot override it`,
        );
      }
    }
    return errors;
  }

  /** 整组注册插件协议（调用前应通过 validatePluginAdapters） */
  registerPluginAdapters(pluginId: string, adapters: IProtocolAdapter[]): void {
    const errors = this.validatePluginAdapters(pluginId, adapters);
    if (errors.length > 0) {
      throw new Error(errors.join('; '));
    }
    for (const adapter of adapters) {
      this.registerEntry(adapter, {
        source: 'plugin',
        pluginId,
        active: true,
        displayName: adapter.displayName,
        capabilities: adapter.capabilities,
      });
    }
  }

  /** 移除某插件的全部协议（卸载/重载） */
  removePlugin(pluginId: string): void {
    let removed = 0;
    for (const [protocol, entry] of this.entries) {
      if (entry.pluginId === pluginId) {
        this.entries.delete(protocol);
        removed += 1;
      }
    }
    if (removed > 0) {
      this.logger.log(`Removed ${removed} protocol adapter(s) from plugin ${pluginId}`);
    }
  }

  /** 插件启停：保留定义，仅切换可用性 */
  setPluginActive(pluginId: string, active: boolean): void {
    for (const entry of this.entries.values()) {
      if (entry.pluginId === pluginId) entry.active = active;
    }
  }

  private registerEntry(
    adapter: IProtocolAdapter,
    meta: Omit<AdapterEntry, 'adapter'>,
  ): void {
    const protocol = adapter.protocol;
    if (!protocol || typeof protocol !== 'string') {
      throw new Error('Protocol adapter must declare a non-empty protocol');
    }
    const existing = this.entries.get(protocol);
    if (existing) {
      throw new ProtocolConflictError(protocol, existing.source, existing.pluginId);
    }
    this.entries.set(protocol, { adapter, ...meta });
  }

  /** 按 wire 协议取可用适配器；未注册或已禁用返回 undefined */
  getAdapter(protocol: string): IProtocolAdapter | undefined {
    const entry = this.entries.get(protocol);
    return entry?.active ? entry.adapter : undefined;
  }

  /** 取注册条目（含禁用态，供错误诊断区分「未注册」与「已禁用」） */
  getEntry(protocol: string): Readonly<AdapterEntry> | undefined {
    return this.entries.get(protocol);
  }

  /** 协议是否已注册且可用 */
  hasAdapter(protocol: string): boolean {
    return this.getAdapter(protocol) !== undefined;
  }

  /** 协议是否被注册过（含禁用态） */
  hasProtocol(protocol: string): boolean {
    return this.entries.has(protocol);
  }

  /** 可用协议描述（前端下拉/管理面） */
  listProtocols(): ProtocolDescriptor[] {
    return this.listAllProtocols().filter((p) => p.active);
  }

  /** 全部协议描述（含禁用态，供插件管理/诊断） */
  listAllProtocols(): ProtocolDescriptor[] {
    return Array.from(this.entries.values())
      .map((entry) => ({
        protocol: entry.adapter.protocol,
        displayName: entry.displayName || entry.adapter.protocol,
        capabilities: entry.capabilities,
        source: entry.source,
        pluginId: entry.pluginId,
        active: entry.active,
      }))
      .sort((a, b) => {
        if (a.source !== b.source) return a.source === 'builtin' ? -1 : 1;
        return a.protocol.localeCompare(b.protocol);
      });
  }
}
