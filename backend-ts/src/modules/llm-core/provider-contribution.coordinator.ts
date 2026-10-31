import { Injectable, Logger } from '@nestjs/common';
import { AdapterRegistry } from './adapter-registry.service';
import {
  BundledCatalogService,
  ProviderTypeCard,
} from './bundled-catalog.service';
import type { IProtocolAdapter } from './adapters/base.adapter';
import type { ProtocolAdapterContribution } from './types/provider-plugin.types';

/** 一个插件贡献的供应商能力集合 */
export interface ProviderContributionBundle {
  /** 代码协议适配器（可选） */
  adapters?: ProtocolAdapterContribution[];
  /** 声明式类型卡（可选） */
  types?: ProviderTypeCard[];
}

/**
 * 贡献声明里的 displayName/capabilities 优先级低于 adapter 自身声明；
 * 这里用 Proxy 只覆盖未声明字段，方法绑定到原 adapter（保留 this/私有字段）。
 */
function withContributionMeta(
  contribution: ProtocolAdapterContribution,
): IProtocolAdapter {
  const { adapter, displayName, capabilities } = contribution;
  if (!displayName && !capabilities) return adapter;
  return new Proxy(adapter, {
    get(target, prop) {
      if (prop === 'displayName') return displayName ?? target.displayName;
      if (prop === 'capabilities') return capabilities ?? target.capabilities;
      const value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

/**
 * 供应商贡献协调器
 *
 * 插件生命周期与 llm-core 注册表之间的唯一桥：
 * - 插件 onLoad 收集贡献 → PluginManager 在 flush 后 commit；
 * - 插件启用/禁用 → setActive（保留定义，不重新 require）；
 * - 插件卸载/重载 → remove / commit 新版本。
 *
 * 原子性：commit 先校验协议与类型卡冲突，校验通过才移除旧定义并写入新定义；
 * 热更新失败时旧定义原样保留，不产生「半注册」状态。
 */
@Injectable()
export class ProviderContributionCoordinator {
  private readonly logger = new Logger(ProviderContributionCoordinator.name);
  private readonly bundles = new Map<string, ProviderContributionBundle>();
  private readonly active = new Map<string, boolean>();

  constructor(
    private readonly adapterRegistry: AdapterRegistry,
    private readonly catalog: BundledCatalogService,
  ) {}

  /** 提交/替换一个插件的供应商贡献 */
  commit(
    pluginId: string,
    bundle: ProviderContributionBundle,
    active: boolean,
  ): void {
    const adapters = (bundle.adapters || [])
      .filter((c) => c && c.adapter)
      .map((c) => withContributionMeta(c));
    const types = bundle.types || [];

    if (adapters.length === 0 && types.length === 0) {
      // 插件不再贡献供应商能力（例如版本回退）：清掉旧定义
      this.remove(pluginId);
      return;
    }

    const errors = [
      ...this.adapterRegistry.validatePluginAdapters(pluginId, adapters),
      ...this.catalog.validatePluginCards(pluginId, types),
    ];
    if (errors.length > 0) {
      throw new Error(
        `Provider pack "${pluginId}" rejected: ${errors.join('; ')}`,
      );
    }

    // 校验通过后才替换：中途失败不会破坏上一版
    this.removeFromRegistries(pluginId);
    try {
      this.adapterRegistry.registerPluginAdapters(pluginId, adapters);
      this.catalog.registerPluginCards(pluginId, types);
    } catch (err) {
      // 理论上不会再失败（上面已校验）；兜底清掉可能的部分注册
      this.removeFromRegistries(pluginId);
      throw err;
    }

    this.bundles.set(pluginId, { adapters: bundle.adapters, types });
    this.active.set(pluginId, active);
    this.applyActive(pluginId, active);

    // 类型卡引用的协议可能由另一个插件提供（加载顺序不保证）：
    // 不阻断注册，管理面会用 protocolAvailable=false 提示；这里只告警。
    const missingProtocols = types
      .filter((t) => !this.adapterRegistry.hasProtocol(t.protocol))
      .map((t) => `${t.type} → ${t.protocol}`);
    if (missingProtocols.length > 0) {
      this.logger.warn(
        `Provider pack ${pluginId} type cards reference unregistered protocols: ${missingProtocols.join(', ')}`,
      );
    }

    this.logger.log(
      `Provider pack committed: ${pluginId} (adapters=${adapters.length}, types=${types.length}, active=${active})`,
    );
  }

  /** 卸载插件：移除全部协议与类型卡 */
  remove(pluginId: string): void {
    const had = this.bundles.has(pluginId) || this.hasRegistryEntries(pluginId);
    this.removeFromRegistries(pluginId);
    this.bundles.delete(pluginId);
    this.active.delete(pluginId);
    if (had) {
      this.logger.log(`Provider pack removed: ${pluginId}`);
    }
  }

  /** 插件启停：保留定义，仅切换可用性 */
  setActive(pluginId: string, active: boolean): void {
    if (!this.bundles.has(pluginId)) return;
    if (this.active.get(pluginId) === active) return;
    this.active.set(pluginId, active);
    this.applyActive(pluginId, active);
    this.logger.log(`Provider pack ${pluginId} ${active ? 'enabled' : 'disabled'}`);
  }

  isActive(pluginId: string): boolean {
    return this.active.get(pluginId) === true;
  }

  getBundle(pluginId: string): ProviderContributionBundle | undefined {
    return this.bundles.get(pluginId);
  }

  private removeFromRegistries(pluginId: string): void {
    this.adapterRegistry.removePlugin(pluginId);
    this.catalog.removePlugin(pluginId);
  }

  private applyActive(pluginId: string, active: boolean): void {
    this.adapterRegistry.setPluginActive(pluginId, active);
    this.catalog.setPluginActive(pluginId, active);
  }

  private hasRegistryEntries(pluginId: string): boolean {
    return this.adapterRegistry
      .listAllProtocols()
      .some((p) => p.pluginId === pluginId);
  }
}
