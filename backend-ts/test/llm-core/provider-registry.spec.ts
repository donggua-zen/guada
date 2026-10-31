/**
 * 供应商能力注册表：动态注册、冲突保护、启停与原子替换
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AdapterRegistry } from '../../src/modules/llm-core/adapter-registry.service';
import { BundledCatalogService } from '../../src/modules/llm-core/bundled-catalog.service';
import { ProviderContributionCoordinator } from '../../src/modules/llm-core/provider-contribution.coordinator';
import { ModelService } from '../../src/modules/models/model.service';

function makeAdapter(protocol: string) {
  return {
    protocol,
    chatCompletion: async () => [],
  } as any;
}

function makeCard(type: string) {
  return {
    type,
    name: type.toUpperCase(),
    protocol: 'openai',
    models: [],
  };
}

describe('AdapterRegistry 动态注册', () => {
  it('内置注册后可查询；协议描述带 builtin 来源', () => {
    const registry = new AdapterRegistry();
    const adapter = makeAdapter('openai');
    registry.registerBuiltin(adapter);

    expect(registry.getAdapter('openai')).toBe(adapter);
    expect(registry.listProtocols()).toEqual([
      expect.objectContaining({ protocol: 'openai', source: 'builtin', active: true }),
    ]);
  });

  it('插件不得覆盖内置协议（保留位）', () => {
    const registry = new AdapterRegistry();
    registry.registerBuiltin(makeAdapter('openai'));

    expect(() =>
      registry.registerPluginAdapters('evil', [makeAdapter('openai')]),
    ).toThrow(/already registered by builtin catalog/);
  });

  it('插件之间协议重名被拒绝', () => {
    const registry = new AdapterRegistry();
    registry.registerPluginAdapters('p1', [makeAdapter('acme')]);

    expect(() =>
      registry.registerPluginAdapters('p2', [makeAdapter('acme')]),
    ).toThrow(/already registered by plugin "p1"/);
  });

  it('禁用插件后适配器不可用但定义保留；重新启用恢复；卸载删除', () => {
    const registry = new AdapterRegistry();
    const adapter = makeAdapter('acme');
    registry.registerPluginAdapters('p1', [adapter]);

    registry.setPluginActive('p1', false);
    expect(registry.getAdapter('acme')).toBeUndefined();
    expect(registry.getEntry('acme')?.active).toBe(false);
    expect(registry.listProtocols()).toEqual([]);

    registry.setPluginActive('p1', true);
    expect(registry.getAdapter('acme')).toBe(adapter);

    registry.removePlugin('p1');
    expect(registry.hasProtocol('acme')).toBe(false);
  });
});

describe('BundledCatalogService 插件类型卡', () => {
  let bundledDir: string;
  let originalEnv: string | undefined;

  beforeEach(() => {
    originalEnv = process.env.BUNDLED_PROVIDERS_DIR;
    bundledDir = fs.mkdtempSync(path.join(os.tmpdir(), 'catalog-plugin-'));
    process.env.BUNDLED_PROVIDERS_DIR = bundledDir;
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.BUNDLED_PROVIDERS_DIR;
    else process.env.BUNDLED_PROVIDERS_DIR = originalEnv;
    fs.rmSync(bundledDir, { recursive: true, force: true });
  });

  it('插件类型卡与内置目录合并；禁用后不可见，来源快照保留', () => {
    const catalog = new BundledCatalogService();
    catalog.registerPluginCards('p1', [makeCard('acme')]);

    expect(catalog.hasType('acme')).toBe(true);
    expect(catalog.listTypes().map((c) => c.type)).toContain('acme');
    expect(catalog.getTypeSource('acme')).toEqual({
      source: 'plugin',
      pluginId: 'p1',
      active: true,
    });

    catalog.setPluginActive('p1', false);
    expect(catalog.hasType('acme')).toBe(false);
    expect(catalog.getType('acme')).toBeUndefined();
    expect(catalog.getCatalogModels('acme')).toEqual([]);
    expect(catalog.getTypeSource('acme')?.active).toBe(false);

    catalog.setPluginActive('p1', true);
    expect(catalog.hasType('acme')).toBe(true);

    catalog.removePlugin('p1');
    expect(catalog.hasType('acme')).toBe(false);
  });

  it('内置 type 是保留位：插件不能覆盖', () => {
    fs.writeFileSync(
      path.join(bundledDir, 'openai.yaml'),
      ['type: openai', 'name: OpenAI', 'protocol: openai', 'models: []'].join('\n'),
      'utf8',
    );
    const catalog = new BundledCatalogService();

    expect(catalog.validatePluginCards('p1', [makeCard('openai')])).toEqual([
      expect.stringContaining('reserved by builtin catalog'),
    ]);
    expect(() => catalog.registerPluginCards('p1', [makeCard('openai')])).toThrow(
      /reserved by builtin catalog/,
    );
  });
});

describe('ModelService 供应商模板视图', () => {
  let bundledDir: string;
  let originalEnv: string | undefined;

  beforeEach(() => {
    originalEnv = process.env.BUNDLED_PROVIDERS_DIR;
    bundledDir = fs.mkdtempSync(path.join(os.tmpdir(), 'catalog-template-'));
    process.env.BUNDLED_PROVIDERS_DIR = bundledDir;
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.BUNDLED_PROVIDERS_DIR;
    else process.env.BUNDLED_PROVIDERS_DIR = originalEnv;
    fs.rmSync(bundledDir, { recursive: true, force: true });
  });

  it('插件类型卡的 avatarUrl 转为插件 assets marker，来源/协议展示名可下发', () => {
    const registry = new AdapterRegistry();
    registry.registerBuiltin({
      protocol: 'openai',
      displayName: 'OpenAI',
      chatCompletion: async () => [],
    } as any);
    const catalog = new BundledCatalogService();
    catalog.registerPluginCards('p1', [
      {
        ...makeCard('acme'),
        avatarUrl: 'assets/logo.svg',
      },
    ]);

    const service = new ModelService({} as any, registry, catalog);
    const template = service.getProviderTemplates().find((t) => t.id === 'acme')!;

    expect(template.source).toBe('plugin');
    expect(template.pluginId).toBe('p1');
    // 插件 assets 路由：/plugins/<id>/assets/<相对插件根的路径>
    expect(template.avatarUrl).toBe('plugin:p1/assets/assets/logo.svg');
    expect(template.protocolDisplayName).toBe('OpenAI');
    expect(template.protocolAvailable).toBe(true);
    expect(template.capabilities).toEqual(undefined);
  });
});

describe('ProviderContributionCoordinator', () => {
  let bundledDir: string;
  let originalEnv: string | undefined;

  beforeEach(() => {
    originalEnv = process.env.BUNDLED_PROVIDERS_DIR;
    bundledDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coordinator-plugin-'));
    process.env.BUNDLED_PROVIDERS_DIR = bundledDir;
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.BUNDLED_PROVIDERS_DIR;
    else process.env.BUNDLED_PROVIDERS_DIR = originalEnv;
    fs.rmSync(bundledDir, { recursive: true, force: true });
  });

  function makeCoordinator() {
    const registry = new AdapterRegistry();
    registry.registerBuiltin(makeAdapter('openai'));
    const catalog = new BundledCatalogService();
    return { registry, catalog, coordinator: new ProviderContributionCoordinator(registry, catalog) };
  }

  it('提交后协议与类型卡同时生效；启停/卸载联动', () => {
    const { registry, catalog, coordinator } = makeCoordinator();
    const adapter = makeAdapter('acme');

    coordinator.commit(
      'p1',
      { adapters: [{ protocol: 'acme', adapter }], types: [makeCard('acme')] },
      true,
    );
    expect(registry.getAdapter('acme')).toBe(adapter);
    expect(catalog.hasType('acme')).toBe(true);

    coordinator.setActive('p1', false);
    expect(registry.getAdapter('acme')).toBeUndefined();
    expect(catalog.hasType('acme')).toBe(false);

    coordinator.setActive('p1', true);
    expect(registry.getAdapter('acme')).toBe(adapter);
    expect(catalog.hasType('acme')).toBe(true);

    coordinator.remove('p1');
    expect(registry.hasProtocol('acme')).toBe(false);
    expect(catalog.hasType('acme')).toBe(false);
  });

  it('热更新校验失败时保留上一版贡献（不产生半注册）', () => {
    const { registry, catalog, coordinator } = makeCoordinator();
    const adapter = makeAdapter('acme');
    coordinator.commit(
      'p1',
      { adapters: [{ protocol: 'acme', adapter }], types: [makeCard('acme')] },
      true,
    );

    // 第二次提交试图覆盖内置协议 → 校验失败
    expect(() =>
      coordinator.commit(
        'p1',
        {
          adapters: [{ protocol: 'openai', adapter: makeAdapter('openai') }],
          types: [makeCard('acme2')],
        },
        true,
      ),
    ).toThrow(/already registered by builtin catalog/);

    // 旧贡献仍在
    expect(registry.getAdapter('acme')).toBe(adapter);
    expect(catalog.hasType('acme')).toBe(true);
    // 新贡献没有被写入
    expect(registry.hasProtocol('acme2')).toBe(false);
    expect(catalog.hasType('acme2')).toBe(false);
  });
});
