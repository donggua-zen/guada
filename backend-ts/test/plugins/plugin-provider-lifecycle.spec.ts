/**
 * PluginManager ↔ ProviderContributionCoordinator 生命周期联动
 *
 * 覆盖：注册即生效、启停切换、卸载移除、贡献冲突时整包失败且不留半状态。
 */
import { PluginManager } from '../../src/modules/plugins/plugin.manager';
import { PluginBase } from '../../src/modules/plugins/base-plugin';
import { DataProviderPackPlugin } from '../../src/modules/plugins/external/data-provider-pack.plugin';
import { PluginRegistry } from '../../src/modules/plugins/registry/plugin-registry';
import { AdapterRegistry } from '../../src/modules/llm-core/adapter-registry.service';
import { BundledCatalogService } from '../../src/modules/llm-core/bundled-catalog.service';
import { ProviderContributionCoordinator } from '../../src/modules/llm-core/provider-contribution.coordinator';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

function makeManager() {
  const adapterRegistry = new AdapterRegistry();
  adapterRegistry.registerBuiltin({
    protocol: 'openai',
    chatCompletion: async () => [],
  } as any);
  const catalog = new BundledCatalogService();
  const coordinator = new ProviderContributionCoordinator(adapterRegistry, catalog);
  const settings = {
    getSettings: jest.fn().mockResolvedValue({}),
    updateSettings: jest.fn().mockResolvedValue(undefined),
  };
  const manager = new PluginManager(
    settings as any,
    null as any,
    { register: jest.fn() } as any,
    null as any,
    { emit: jest.fn() } as any,
    undefined,
    coordinator,
  );
  (manager as any).logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  return { manager, adapterRegistry, catalog, coordinator };
}

const card = {
  type: 'acme',
  name: 'Acme',
  protocol: 'openai',
  models: [],
};

describe('PluginManager 供应商包生命周期', () => {
  let bundledDir: string;
  let originalEnv: string | undefined;

  beforeEach(() => {
    originalEnv = process.env.BUNDLED_PROVIDERS_DIR;
    bundledDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-provider-lifecycle-'));
    process.env.BUNDLED_PROVIDERS_DIR = bundledDir;
    (PluginRegistry as any).registrations?.clear?.();
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.BUNDLED_PROVIDERS_DIR;
    else process.env.BUNDLED_PROVIDERS_DIR = originalEnv;
    fs.rmSync(bundledDir, { recursive: true, force: true });
  });

  it('声明式包注册后类型卡可用；停用/启用/卸载联动', async () => {
    const { manager, catalog } = makeManager();
    const plugin = new DataProviderPackPlugin(
      {
        id: 'provider-declarative',
        name: 'Declarative',
        version: '1.0.0',
        description: '',
        category: 'user',
        providerApi: 1,
      },
      [card],
    );

    await manager.registerPlugin(plugin, true);
    expect(catalog.hasType('acme')).toBe(true);

    await manager.setPluginEnabled('provider-declarative', false);
    expect(catalog.hasType('acme')).toBe(false);
    expect(catalog.getTypeSource('acme')?.active).toBe(false);

    await manager.setPluginEnabled('provider-declarative', true);
    expect(catalog.hasType('acme')).toBe(true);

    await manager.unregisterPlugin('provider-declarative');
    expect(catalog.hasType('acme')).toBe(false);
    expect(catalog.getTypeSource('acme')).toBeUndefined();
  });

  it('代码包的协议适配器随插件启停', async () => {
    const { manager, adapterRegistry } = makeManager();
    const adapter = { protocol: 'acme-wire', chatCompletion: async () => [] } as any;

    class CodePackPlugin extends PluginBase {
      manifest = {
        id: 'provider-code',
        name: 'Code',
        version: '1.0.0',
        description: '',
        category: 'user' as const,
        providerApi: 1,
      };
      async onLoad(api: any): Promise<void> {
        api.registerProtocolAdapter({ protocol: 'acme-wire', adapter });
      }
    }

    await manager.registerPlugin(new CodePackPlugin(), true);
    expect(adapterRegistry.getAdapter('acme-wire')).toBe(adapter);

    await manager.setPluginEnabled('provider-code', false);
    expect(adapterRegistry.getAdapter('acme-wire')).toBeUndefined();

    await manager.setPluginEnabled('provider-code', true);
    expect(adapterRegistry.getAdapter('acme-wire')).toBe(adapter);

    await manager.unregisterPlugin('provider-code');
    expect(adapterRegistry.hasProtocol('acme-wire')).toBe(false);
  });

  it('供应商包 onLoad 失败 → 整包注册失败，不提交部分贡献', async () => {
    const { manager, catalog } = makeManager();

    class BrokenPackPlugin extends PluginBase {
      manifest = {
        id: 'provider-broken',
        name: 'Broken',
        version: '1.0.0',
        description: '',
        category: 'user' as const,
        providerApi: 1,
      };
      async onLoad(api: any): Promise<void> {
        api.registerProviderType({ ...card, type: 'broken-type' });
        throw new Error('boom');
      }
    }

    await expect(manager.registerPlugin(new BrokenPackPlugin(), true)).rejects.toThrow(
      /Provider pack provider-broken onLoad failed: boom/,
    );
    expect(manager.getPlugin('provider-broken')).toBeUndefined();
    expect(catalog.hasType('broken-type')).toBe(false);
  });

  it('贡献冲突（覆盖内置协议）→ 整包注册失败，不留半状态', async () => {
    const { manager, adapterRegistry, catalog } = makeManager();

    class EvilPackPlugin extends PluginBase {
      manifest = {
        id: 'provider-evil',
        name: 'Evil',
        version: '1.0.0',
        description: '',
        category: 'user' as const,
        providerApi: 1,
      };
      async onLoad(api: any): Promise<void> {
        api.registerProtocolAdapter({
          protocol: 'openai',
          adapter: { protocol: 'openai', chatCompletion: async () => [] },
        });
        api.registerProviderType({ ...card, type: 'evil-type' });
      }
    }

    await expect(manager.registerPlugin(new EvilPackPlugin(), true)).rejects.toThrow(
      /already registered by builtin catalog/,
    );

    expect(manager.getPlugin('provider-evil')).toBeUndefined();
    expect(adapterRegistry.getAdapter('openai')?.protocol).toBe('openai');
    expect(catalog.hasType('evil-type')).toBe(false);
    expect(PluginRegistry.getTools('provider-evil')).toEqual([]);
  });
});
