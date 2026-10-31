/**
 * 外部插件加载器：供应商包（声明式 / 代码型）加载与 manifest 校验
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ExternalPluginLoader } from '../../src/modules/plugins/external/external-plugin-loader';

function write(file: string, content: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, 'utf8');
}

function makeLoader() {
  const registered: any[] = [];
  const manager = {
    getPlugin: () => undefined,
    registerPlugin: async (plugin: any) => {
      registered.push(plugin);
    },
  };
  const config = { get: () => undefined };
  const nls = { registerBundle: jest.fn() };
  const eventBus = { emit: jest.fn() };
  const loader = new ExternalPluginLoader(
    manager as any,
    config as any,
    nls as any,
    eventBus as any,
  );
  return { loader, registered };
}

function makeApi() {
  const cards: any[] = [];
  const adapters: any[] = [];
  return {
    cards,
    adapters,
    api: {
      registerProviderType: (card: any) => cards.push(card),
      registerProtocolAdapter: (def: any) => adapters.push(def),
    } as any,
  };
}

describe('ExternalPluginLoader 供应商包', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'provider-pack-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('声明式包：无 main，仅 manifest + YAML 类型卡', async () => {
    write(
      path.join(dir, 'manifest.json'),
      JSON.stringify({
        id: 'provider-acme-test',
        name: 'Acme Test',
        version: '1.0.0',
        description: 'declarative pack',
        category: 'user',
        providerApi: 1,
        provides: { providerTypes: ['types/*.yaml'] },
      }),
    );
    write(
      path.join(dir, 'types', 'acme.yaml'),
      [
        'type: acme-test',
        'name: Acme Test',
        'protocol: openai',
        'defaultApiUrl: https://api.acme.test/v1/',
        'models:',
        '  - modelName: acme-chat',
        '    supportsThinking: false',
      ].join('\n'),
    );

    const { loader, registered } = makeLoader();
    await loader.loadExternalPlugin(dir, 'user');

    expect(registered).toHaveLength(1);
    const plugin = registered[0];
    expect(plugin.manifest.id).toBe('provider-acme-test');
    expect(plugin.manifest.providerApi).toBe(1);
    expect(plugin.manifest.provides).toEqual({ providerTypes: ['types/*.yaml'] });
    expect(plugin.manifest.source).toBe('user');
    expect(plugin.manifest.pluginPath).toBe(path.resolve(dir));

    const { api, cards, adapters } = makeApi();
    await plugin.onLoad(api);
    expect(adapters).toHaveLength(0);
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({
      type: 'acme-test',
      protocol: 'openai',
      models: [{ modelName: 'acme-chat', supportsThinking: false }],
    });
  });

  it('代码型包：main 注册协议，manifest 声明的类型卡由 loader 注入', async () => {
    write(
      path.join(dir, 'index.js'),
      `
class Plugin {
  constructor() {
    this.manifest = {
      id: 'provider-code-test',
      name: 'Code Test',
      version: '1.0.0',
      description: 'code pack',
      category: 'user',
      providerApi: 1,
    };
  }
  async onLoad(api) {
    api.registerProtocolAdapter({
      protocol: 'acme-wire',
      adapter: { protocol: 'acme-wire', chatCompletion: async () => [] },
      displayName: 'Acme Wire',
    });
  }
}
module.exports = Plugin;
`,
    );
    write(
      path.join(dir, 'types', 'acme.yaml'),
      ['type: acme-code', 'name: Acme Code', 'protocol: acme-wire', 'models: []'].join('\n'),
    );
    write(
      path.join(dir, 'manifest.json'),
      JSON.stringify({
        id: 'provider-code-test',
        name: 'Code Test',
        version: '1.0.0',
        description: 'code pack',
        category: 'user',
        providerApi: 1,
        main: 'index.js',
        provides: {
          providerAdapters: 'index.js',
          providerTypes: ['types/*.yaml'],
        },
      }),
    );

    const { loader, registered } = makeLoader();
    await loader.loadExternalPlugin(dir, 'user');

    const { api, cards, adapters } = makeApi();
    await registered[0].onLoad(api);
    expect(adapters.map((a) => a.protocol)).toEqual(['acme-wire']);
    expect(cards.map((c) => c.type)).toEqual(['acme-code']);
  });

  it('外部供应商包不能自封 system/essential', async () => {
    write(
      path.join(dir, 'manifest.json'),
      JSON.stringify({
        id: 'provider-privileged',
        name: 'Privileged',
        version: '1.0.0',
        description: 'tries to be system',
        category: 'system',
        essential: true,
        providerApi: 1,
        provides: { providerTypes: ['types/*.yaml'] },
      }),
    );
    write(path.join(dir, 'types', 'p.yaml'), 'type: privileged\nmodels: []\n');

    const { loader, registered } = makeLoader();
    await loader.loadExternalPlugin(dir, 'user');
    expect(registered[0].manifest.category).toBe('user');
    expect(registered[0].manifest.essential).toBe(false);
  });

  it('拒绝超出插件目录的 providerTypes 路径', async () => {
    const outsideName = `outside-${Date.now()}.yaml`;
    const outside = path.join(dir, '..', outsideName);
    write(outside, 'type: outside\nmodels: []\n');
    write(
      path.join(dir, 'manifest.json'),
      JSON.stringify({
        id: 'provider-escape',
        name: 'Escape',
        version: '1.0.0',
        description: 'escape',
        providerApi: 1,
        provides: { providerTypes: [`../${outsideName}`] },
      }),
    );

    const { loader } = makeLoader();
    try {
      await expect(loader.loadExternalPlugin(dir, 'user')).rejects.toThrow(
        /escapes plugin directory/,
      );
    } finally {
      fs.rmSync(outside, { force: true });
    }
  });

  it('拒绝高于宿主支持的 providerApi', async () => {
    write(
      path.join(dir, 'manifest.json'),
      JSON.stringify({
        id: 'provider-new',
        name: 'New',
        version: '1.0.0',
        description: 'new',
        providerApi: 99,
        provides: { providerTypes: ['types/*.yaml'] },
      }),
    );
    write(path.join(dir, 'types', 'a.yaml'), 'type: a\nmodels: []\n');

    const { loader } = makeLoader();
    await expect(loader.loadExternalPlugin(dir, 'user')).rejects.toThrow(
      /newer than supported/,
    );
  });

  it('普通插件（无 provides）缺省入口为 index.js，不存在时报入口错误', async () => {
    write(
      path.join(dir, 'manifest.json'),
      JSON.stringify({
        id: 'plain-no-main',
        name: 'Plain',
        version: '1.0.0',
        description: 'plain',
      }),
    );
    const { loader } = makeLoader();
    await expect(loader.loadExternalPlugin(dir, 'user')).rejects.toThrow(
      /Entry file not found: tried index\.js/,
    );
  });
});
