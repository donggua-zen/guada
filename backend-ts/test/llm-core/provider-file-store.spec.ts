import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ProviderFileStore } from '../../src/modules/llm-core/provider-file.store';
import { BundledCatalogService } from '../../src/modules/llm-core/bundled-catalog.service';

describe('ProviderFileStore', () => {
  let dir: string;
  let bundledDir: string;
  let store: ProviderFileStore;

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'provider-store-'));
    process.env.PROVIDERS_DIR = dir;
    // 隔离 bundled 目录（空目录 = 无类型目录，实例条目即全部）
    bundledDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bundled-empty-'));
    process.env.BUNDLED_PROVIDERS_DIR = bundledDir;
    fs.writeFileSync(
      path.join(dir, 'openai.yaml'),
      [
        'id: openai',
        'type: openai',
        'name: OpenAI',
        'enabled: true',
        'protocol: openai',
        'apiUrl: https://api.openai.com/v1/',
        "apiKey: 'sk-test'",
        'thinking:',
        '  defaultEfforts: [low, medium, high]',
        'models:',
        '  - modelName: gpt-4o',
        '    modelType: text',
        '    config: { contextWindow: 128000, features: [tools] }',
        '  - modelName: gpt-5',
        '    isActive: false',
      ].join('\n'),
      'utf8',
    );
    fs.writeFileSync(
      path.join(dir, 'deepseek-toggle.yaml'),
      [
        'id: deepseek-toggle',
        'type: deepseek',
        'name: DeepSeek 第二实例',
        'enabled: false',
        'protocol: openai',
        'thinking: { style: thinking-toggle, defaultEfforts: [none, high, max] }',
        'models:',
        '  - modelName: deepseek-v4-pro',
        '    thinking: { style: reasoning-effort }',
      ].join('\n'),
      'utf8',
    );
    fs.writeFileSync(path.join(dir, 'broken.yaml'), 'id: [unclosed', 'utf8');

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

  it('加载全部实例；非法文件隔离并上报', () => {
    const ids = store.listProviders().map((p) => p.id).sort();
    expect(ids).toEqual(['deepseek-toggle', 'openai']);
    expect(store.listLoadErrors().map((e) => e.file)).toEqual(['broken.yaml']);
  });

  it('findModel 解析 {instanceId}:{modelName} 并带 thinkingEfforts 与 provider', () => {
    const model = store.findModel('openai:gpt-4o');
    expect(model).toBeDefined();
    expect(model!.modelName).toBe('gpt-4o');
    expect(model!.provider.apiKey).toBe('sk-test');
    expect(model!.provider.thinking).toEqual({ defaultEfforts: ['low', 'medium', 'high'] });
    expect(model!.thinkingEfforts).toEqual(['low', 'medium', 'high']);
  });

  it('findModel 不存在/非法 id → undefined（悬空引用语义）', () => {
    expect(store.findModel('nope:x')).toBeUndefined();
    expect(store.findModel('garbage')).toBeUndefined();
  });

  it('listModels 默认只含启用实例且跳过 isActive=false', () => {
    const models = store.listModels().map((m) => m.id);
    expect(models).toEqual(['openai:gpt-4o']);
    const all = store.listModels(true).map((m) => m.id);
    expect(all).toContain('openai:gpt-5');
  });

  it('setEnabled 写盘并生效（重新加载后保持）', async () => {
    await store.setEnabled('openai', false);
    expect(store.getProvider('openai')!.enabled).toBe(false);
    const reread = fs.readFileSync(path.join(dir, 'openai.yaml'), 'utf8');
    expect(reread).toContain('enabled: false');
  });

  it('模型级 compat.thinkingFormat 覆盖供应商级', () => {
    const model = store.findModel('deepseek-toggle:deepseek-v4-pro');
    // 该实例 disabled，findModel 仍可解析（运行时启用校验在调用方），
    // 此处验证覆盖合并：format 覆盖不改变档位菜单解析
    expect(model).toBeDefined();
    expect(model!.thinkingEfforts).toEqual(['none', 'high', 'max']);
    expect(model!.thinkingCompat.thinkingFormat).toBe('openai'); // 模型条目 legacy style 归一
  });

  it('addModel/updateModel/deleteModel 操作文件条目', async () => {
    await store.addModel('openai', { modelName: 'new-model', modelType: 'text' });
    expect(store.findModel('openai:new-model')).toBeDefined();

    await store.updateModel('openai', 'new-model', { isFavorite: true });
    expect(store.findModel('openai:new-model')!.isFavorite).toBe(true);

    expect(await store.deleteModel('openai', 'new-model')).toBe(true);
    expect(store.findModel('openai:new-model')).toBeUndefined();
  });

  it('addModel 为 upsert：已存在条目更新而非报错', async () => {
    await store.addModel('openai', {
      modelName: 'gpt-4o',
      modelType: 'text',
      name: 'GPT-4o 覆盖名',
    });
    const model = store.findModel('openai:gpt-4o');
    expect(model!.name).toBe('GPT-4o 覆盖名');
    // 未产生重复条目
    const provider = store.getProvider('openai')!;
    expect(provider.models!.filter((m) => m.modelName === 'gpt-4o')).toHaveLength(1);
  });

  it('updateModel null 值清除条目字段（回退继承链）', async () => {
    // openai 实例 provider 级 defaultEfforts: [low, medium, high]
    await store.updateModel('openai', 'gpt-4o', { thinkingEfforts: false });
    expect(store.findModel('openai:gpt-4o')!.thinkingEfforts).toEqual([]);
    expect(
      store.getProvider('openai')!.models!.find((m) => m.modelName === 'gpt-4o')!
        .thinkingEfforts,
    ).toBe(false);

    // null 清除声明 → 回退实例级 defaultEfforts，YAML 条目不再含该键。
    // 注意：thinkingEfforts: false 的写入已在解析时物化 supportsThinking: false，
    // 因此还需显式清除能力声明，模型才会重新回到 defaultEfforts 链。
    await store.updateModel('openai', 'gpt-4o', {
      thinkingEfforts: null,
      supportsThinking: null,
    });
    expect(store.findModel('openai:gpt-4o')!.thinkingEfforts).toEqual([
      'low',
      'medium',
      'high',
    ]);
    expect(
      store
        .getProvider('openai')!
        .models!.find((m) => m.modelName === 'gpt-4o')!.thinkingEfforts,
    ).toBeUndefined();
    const reread = fs.readFileSync(path.join(dir, 'openai.yaml'), 'utf8');
    expect(reread).not.toContain('thinkingEfforts');
  });

  it('思考调节三态（卡片 false → 覆盖 true → 清除回退卡片）', async () => {
    // 模拟 mock.yaml 的场景：类型卡硬声明 supportsThinking: false。
    // 卡片声明为 false 时，未声明能力的实例条目继承 false → 空菜单（不思考）。
    fs.writeFileSync(
      path.join(bundledDir, 'mockcard.yaml'),
      [
        'type: mockcard',
        'name: MockCard',
        'protocol: openai',
        'models:',
        '  - modelName: mock-normal',
        '    modelType: text',
        '    supportsThinking: false',
      ].join('\n'),
      'utf8',
    );
    fs.writeFileSync(
      path.join(dir, 'mockcard-inst.yaml'),
      [
        'id: mockcard-inst',
        'type: mockcard',
        'name: 测试供应商',
        'protocol: openai',
        'apiKey: k',
        'models:',
        '  - modelName: mock-normal',
      ].join('\n'),
      'utf8',
    );
    // 卡片与实例文件都必须在首次 initialize 前落盘（initialize 幂等）
    store.onModuleDestroy();
    store = new ProviderFileStore(new BundledCatalogService());
    await store.initialize();

    // ① 自动判断（无覆盖）→ 继承卡片的 false → 不能思考
    expect(store.findModel('mockcard-inst:mock-normal')!.thinkingEfforts).toEqual([]);

    // ② UI 选「支持」→ 条目级覆盖 true，能力不受卡片 false 约束；
    //    档位走通用兜底（该型号名不匹配任何 preset）
    await store.updateModel('mockcard-inst', 'mock-normal', { supportsThinking: true });
    const supported = store.findModel('mockcard-inst:mock-normal')!;
    expect(supported.thinkingEfforts).toEqual([
      'none',
      'low',
      'medium',
      'high',
      'xhigh',
      'max',
    ]);
    expect(supported.thinkingEffortMap).toEqual({ none: 'none' });

    // ③ 切回「自动判断」→ 发 null 清除覆盖，能力回退卡片的 false
    await store.updateModel('mockcard-inst', 'mock-normal', { supportsThinking: null });
    expect(store.findModel('mockcard-inst:mock-normal')!.thinkingEfforts).toEqual([]);
    const reread = fs.readFileSync(path.join(dir, 'mockcard-inst.yaml'), 'utf8');
    expect(reread).not.toContain('supportsThinking');

    // ④ UI 选「不支持」→ 显式 false 落盘
    await store.updateModel('mockcard-inst', 'mock-normal', { supportsThinking: false });
    expect(
      store
        .getProvider('mockcard-inst')!
        .models!.find((m) => m.modelName === 'mock-normal')!.supportsThinking,
    ).toBe(false);
    expect(store.findModel('mockcard-inst:mock-normal')!.thinkingEfforts).toEqual([]);
  });

  it('updateModel 写入 compat 并在视图暴露生效 format（清除回退默认）', async () => {    // openai 实例与（空的）类型卡均未声明 → 回退默认 openai
    expect(store.findModel('openai:gpt-4o')!.thinkingCompat.thinkingFormat).toBe('openai');

    await store.updateModel('openai', 'gpt-4o', {
      compat: { thinkingFormat: 'zai', supportsReasoningEffort: false },
    });
    const model = store.findModel('openai:gpt-4o')!;
    expect(model.thinkingCompat.thinkingFormat).toBe('zai');
    expect(model.thinkingCompat.supportsReasoningEffort).toBe(false);

    // null 清除 → 回退默认
    await store.updateModel('openai', 'gpt-4o', { compat: null });
    expect(store.findModel('openai:gpt-4o')!.thinkingCompat.thinkingFormat).toBe('openai');
  });

  it('deleteProvider 移除文件', async () => {
    expect(await store.deleteProvider('deepseek-toggle')).toBe(true);
    expect(store.getProvider('deepseek-toggle')).toBeUndefined();
    expect(fs.existsSync(path.join(dir, 'deepseek-toggle.yaml'))).toBe(false);
  });
});
