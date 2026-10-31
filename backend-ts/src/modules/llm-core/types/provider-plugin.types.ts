/**
 * 供应商插件（Provider Pack）契约
 *
 * 供应商包是插件体系的一种贡献类型：一个包可以声明式贡献类型卡（YAML），
 * 也可以代码贡献 wire 协议适配器（PluginBase.onLoad + registerProtocolAdapter）。
 * 这里只放跨模块共享的类型与版本常量，运行时注册表分别位于
 * AdapterRegistry（协议）与 BundledCatalogService（类型卡）。
 */
import type { ProtocolCapabilities } from '../adapters/base.adapter';
import type { ProviderTypeCard } from '../bundled-catalog.service';

/** Provider Pack 契约版本；不兼容升级时递增主版本 */
export const PROVIDER_API_VERSION = 1;

/** 类型卡/协议来源（builtin=随应用分发；plugin=插件贡献） */
export type ProviderContributionSource = 'builtin' | 'plugin';

/** 协议描述（管理面与前端协议下拉的数据源） */
export interface ProtocolDescriptor {
  protocol: string;
  displayName?: string;
  capabilities?: ProtocolCapabilities;
  source: ProviderContributionSource;
  /** 贡献该协议的插件 id（source=plugin 时存在） */
  pluginId?: string;
  /** 当前是否可用（插件禁用后仍保留描述，active=false） */
  active: boolean;
}

/** 协议适配器贡献（插件 onLoad 中注册） */
export interface ProtocolAdapterContribution {
  protocol: string;
  adapter: import('../adapters/base.adapter').IProtocolAdapter;
  displayName?: string;
  capabilities?: ProtocolCapabilities;
}

/** 供应商包 manifest 扩展字段（与 PluginManifest 合并使用） */
export interface ProviderPackManifestFields {
  /** provider 契约版本；缺失 = 非供应商包 */
  providerApi?: number;
  provides?: {
    /** 相对 manifest 的 YAML/JSON 类型卡路径（支持 glob） */
    providerTypes?: string[];
    /** 代码适配器入口；缺省用 main */
    providerAdapters?: string;
    /** 资源目录（logo 等），默认 assets */
    assets?: string;
  };
}

export type { ProviderTypeCard, ProtocolCapabilities };
