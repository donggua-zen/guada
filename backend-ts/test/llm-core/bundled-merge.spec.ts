import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ProviderFileStore } from '../../src/modules/llm-core/provider-file.store';
import { BundledCatalogService } from '../../src/modules/llm-core/bundled-catalog.service';

/**
 * 继承 + 覆盖合并语义（对齐 DSH「route inherits catalog, user layer overrides」）
 *
 * bundled 类型卡 = 随应用版本分发的模型目录；实例文件只存覆盖项：
 * - 目录条目未覆盖 → 原样继承（目录更新自动流到实例）
 * - 实例条目匹配目录 modelName → 字段级覆盖（name/config/thinkingEfforts/isActive）
 * - 实例条目 deleted: true → 用户删除的继承模型（目录更新不复活）
 * - 实例条目 modelName 不在目录 → 用户自建模型
 */
describe('目录继承 + 覆盖合并', () => {
  let dir: string;
  let bundledDir: string;
  let store: ProviderFileStore;

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'merge-providers-'));
    bundledDir = fs.mkdtempSync(path.join(os.tmpdir(), 'merge-bundled-'));
    process.env.PROVIDERS_DIR = dir;
    process.env.BUNDLED_PROVIDERS_DIR = bundledDir;

    // bundled 类型卡：openai 目录 3 个模型
    fs.writeFileSync(
      path.join(bundledDir, 'openai.yaml'),
      [
        'type: openai',
        'name: OpenAI',
        'description: OpenAI 目录',
        'protocol: openai',
        'defaultApiUrl: https://api.openai.com/v1/',
        'thinking:',
        '  defaultEfforts: [low, medium, high]',
        'models:',
        '  - modelName: gpt-4o',
        '    modelType: text',
        '    name: GPT-4o',
        '    config: { contextWindow: 128000, features: [tools] }',
        '  - modelName: gpt-5',
        '    modelType: text',
        '    config: { contextWindow: 1100000, features: [tools, thinking] }',
        '    thinkingEffortsMap:',
        '      low: low',
        '      medium: high',
        '      high: ultra',
        '  - modelName: text-embedding-3-small',
        '    modelType: embedding',
        '    thinkingEfforts: false',
      ].join('\n'),
      'utf8',
    );

    // 实例文件：连接信息 + 覆盖条目（零复制起步形态）
    fs.writeFileSync(
      path.join(dir, 'my-openai.yaml'),
      [
        'id: my-openai',
        'type: openai',
        'name: 我的 OpenAI',
        'enabled: true',
        'protocol: openai',
        'apiUrl: https://proxy.example.com/v1',
        "apiKey: 'sk-x'",
        'models:',
        '  # 覆盖条目：改显示名 + 禁用',
        '  - modelName: gpt-4o',
        '    name: GPT-4o (proxy)',
        '    isActive: false',
        '  # 删除标记：继承模型被移除',
        '  - modelName: text-embedding-3-small',
        '    deleted: true',
        '  # 用户自建模型（目录没有）',
        '  - modelName: my-finetune',
        '    modelType: text',
        '    config: { contextWindow: 32000 }',
      ].join('\n'),
      'utf8',
    );

    store = new ProviderFileStore(new BundledCatalogService());
    await store.initialize();
  });

  afterEach(() => {
    store.onModuleDestroy();
    delete process.env.PROVIDERS_DIR;
    delete process.env.BUNDLED_PROVIDERS_DIR;
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(bundledDir, { recursive: true, force: true });
  });

  it('目录模型继承：未覆盖条目按目录原样出现', () => {
    const gpt5 = store.findModel('my-openai:gpt-5');
    expect(gpt5).toBeDefined();
    expect(gpt5!.name).toBe('gpt-5');
    expect(gpt5!.config.contextWindow).toBe(1100000);
    expect(gpt5!.thinkingEfforts).toEqual(['low', 'medium', 'high']);
    expect(gpt5!.isActive).toBe(true);
  });

  it('覆盖条目字段级合并：改显示名不丢目录参数', () => {
    const gpt4o = store.findModel('my-openai:gpt-4o');
    expect(gpt4o!.name).toBe('GPT-4o (proxy)'); // 实例覆盖
    expect(gpt4o!.config.contextWindow).toBe(128000); // 目录继承
    expect(gpt4o!.isActive).toBe(false); // 禁用态
  });

  it('deleted: true 的继承模型不出现（目录更新不复活）', () => {
    const all = store.resolveMergedModels(store.getProvider('my-openai')!);
    expect(all.some((m) => m.modelName === 'text-embedding-3-small')).toBe(false);
  });

  it('用户自建模型直接出现', () => {
    const mine = store.findModel('my-openai:my-finetune');
    expect(mine).toBeDefined();
    expect(mine!.config.contextWindow).toBe(32000);
  });

  it('listModels 合并视图：继承 + 覆盖 + 自建，无重复', () => {
    const models = store.listModels(true).map((m) => m.modelName).sort();
    expect(models).toEqual(['gpt-4o', 'gpt-5', 'my-finetune']);
  });

  it('addProvider 创建的实例 models 为空（纯继承），视图仍有完整目录', async () => {
    await store.saveProvider({
      id: 'openai',
      type: 'openai',
      name: 'OpenAI',
      enabled: true,
      protocol: 'openai',
      apiUrl: 'https://api.openai.com/v1/',
      apiKey: 'sk-new',
    });
    const provider = store.getProvider('openai')!;
    expect(provider.models || []).toHaveLength(0); // 文件零复制
    const merged = store.resolveMergedModels(provider);
    expect(merged.map((m) => m.modelName)).toEqual([
      'gpt-4o',
      'gpt-5',
      'text-embedding-3-small',
    ]); // 视图完整继承目录
  });

  it('目录更新自动流到未覆盖的实例（模拟应用升级）', async () => {
    // 应用升级：bundled 卡新增模型 + 修正 gpt-5 上下文
    fs.writeFileSync(
      path.join(bundledDir, 'openai.yaml'),
      [
        'type: openai',
        'name: OpenAI',
        'protocol: openai',
        'thinking:',
        '  defaultEfforts: [low, medium, high]',
        'models:',
        '  - modelName: gpt-4o',
        '    modelType: text',
        '    config: { contextWindow: 128000 }',
        '  - modelName: gpt-5',
        '    modelType: text',
        '    config: { contextWindow: 400000 }',
        '  - modelName: gpt-6',
        '    modelType: text',
        '    config: { contextWindow: 2000000 }',
      ].join('\n'),
      'utf8',
    );
    const store2 = new ProviderFileStore(new BundledCatalogService());
    await store2.initialize();
    const merged = store2.resolveMergedModels(store2.getProvider('my-openai')!);
    const byName = new Map(merged.map((m) => [m.modelName, m]));
    expect(byName.get('gpt-5')!.config.contextWindow).toBe(400000); // 修正流入
    expect(byName.has('gpt-6')).toBe(true); // 新模型流入
    expect(byName.has('text-embedding-3-small')).toBe(false); // 删除标记仍生效
    await store2.onModuleDestroy();
  });
  it('目录 map 被未覆盖实例继承：菜单与 wire 值均生效', () => {
    const gpt5 = store.findModel('my-openai:gpt-5');
    expect(gpt5!.thinkingEfforts).toEqual(['low', 'medium', 'high']);
    expect(gpt5!.thinkingEffortMap).toEqual({ low: 'low', medium: 'high', high: 'ultra' });
  });

  it('实例 map 整体覆盖目录 map', async () => {
    const provider = store.getProvider('my-openai')!;
    await store.updateModel('my-openai', 'gpt-5', {
      thinkingEffortsMap: { high: 'max' } as any,
    });
    const gpt5 = store.findModel('my-openai:gpt-5');
    expect(gpt5!.thinkingEfforts).toEqual(['high']);
    expect(gpt5!.thinkingEffortMap).toEqual({ high: 'max' });
    void provider;
  });
});
