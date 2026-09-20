import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ProviderFileStore } from '../../src/modules/llm-core/provider-file.store';
import { BundledCatalogService } from '../../src/modules/llm-core/bundled-catalog.service';
import { toRuntimeProviderConfig } from '../../src/modules/llm-core/utils/provider-runtime.util';

/**
 * providerConfig 运行时契约
 *
 * 覆盖两个曾导致线上退化的点：
 * 1. 文件形态 → 运行形态必须产出 `type`（历史字段名 `provider` 由 DB 行提供，
 *    文件来源为空 → llm.service 的 "Provider type is required" 直接抛错）
 * 2. 类型卡的 provider 级 thinking 必须并入运行时视图：site 级 wire 拼法
 *    （thinking-toggle / enable-thinking）此前只存在于 bundled 卡里，
 *    没有并入 → 适配器一律退化成默认 reasoning-effort
 */
describe('运行时供应商配置契约', () => {
  let dir: string;
  let bundledDir: string;
  let store: ProviderFileStore;

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-providers-'));
    bundledDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-bundled-'));
    process.env.PROVIDERS_DIR = dir;
    process.env.BUNDLED_PROVIDERS_DIR = bundledDir;

    // 类型卡：wire 拼法与默认档位的权威来源
    fs.writeFileSync(
      path.join(bundledDir, 'deepseek.yaml'),
      [
        'type: deepseek',
        'name: DeepSeek',
        'protocol: openai',
        'defaultApiUrl: https://api.deepseek.com',
        'compat:',
        '  thinkingFormat: deepseek',
        'models:',
        '  - modelName: ds-chat',
        '    modelType: text',
        '    config: { contextWindow: 1000000, features: [thinking] }',
      ].join('\n'),
      'utf8',
    );

    store = new ProviderFileStore(new BundledCatalogService());
  });

  afterEach(() => {
    delete process.env.PROVIDERS_DIR;
    delete process.env.BUNDLED_PROVIDERS_DIR;
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(bundledDir, { recursive: true, force: true });
  });

  const writeInstance = async (body: string[]) => {
    fs.writeFileSync(path.join(dir, 'inst1.yaml'), body.join('\n'), 'utf8');
    await store.initialize();
  };

  it('类型卡的 thinkingFormat 并入运行时 compat；档位未声明 → 通用兜底菜单', async () => {
    // deepseek 类型卡只声明 wire 拼法；型号名不像任何 preset → 走通用兜底 6 档
    await writeInstance([
      'id: inst1',
      'type: deepseek',
      'name: 我的 DeepSeek',
      'protocol: openai',
      'apiKey: k',
      'models:',
      '  - modelName: ds-chat',
    ]);

    const model = store.findModel('inst1:ds-chat')!;
    expect(model.provider.compat).toEqual({
      thinkingFormat: 'deepseek',
      supportsReasoningEffort: true,
    });
    expect(model.thinkingEfforts).toEqual([
      'none',
      'low',
      'medium',
      'high',
      'xhigh',
      'max',
    ]);
    // 兜底菜单配套合成关闭值（deepseek 分支自身用 thinking:{type:disabled}，
    // 该映射对 openai 系拼法才是实际生效的"关闭"写法）
    expect(model.thinkingEffortMap).toEqual({ none: 'none' });

    expect(toRuntimeProviderConfig(model.provider)).toMatchObject({
      id: 'inst1',
      type: 'deepseek',
      protocol: 'openai',
      apiKey: 'k',
      compat: { thinkingFormat: 'deepseek', supportsReasoningEffort: true },
    });
  });

  it('开关型格式（supportsReasoningEffort=false）的未声明模型不给强度档', async () => {
    await writeInstance([
      'id: inst1',
      'type: custom',
      'name: 自定义',
      'protocol: openai',
      'compat:',
      '  thinkingFormat: zai',
      'models:',
      '  - modelName: ds-chat',
    ]);

    const model = store.findModel('inst1:ds-chat')!;
    expect(model.provider.compat!.supportsReasoningEffort).toBe(false);
    expect(model.thinkingEfforts).toEqual([]);
  });

  it('自定义供应商 + 命中 preset 的型号名 → 用 preset 档位，wire 仍是通用 openai', async () => {
    // 用户实际场景：用「自定义/Custom」模板建供应商，加一个 deepseek-v4-flash。
    // custom.yaml 无模型卡片、无 compat，所以：
    // - 档位：名字命中 preset(/deepseek.*v4/) → [none, high, max]
    // - 拼法：无 compat → 默认 openai（扁平 reasoning_effort），不发 thinking 对象
    await writeInstance([
      'id: inst1',
      'type: custom',
      'name: 我的供应商',
      'protocol: openai',
      'apiKey: k',
      'models:',
      '  - modelName: deepseek-v4-flash',
    ]);

    const model = store.findModel('inst1:deepseek-v4-flash')!;
    expect(model.thinkingEfforts).toEqual(['none', 'high', 'max']);
    expect(model.provider.compat).toMatchObject({
      thinkingFormat: 'openai',
      supportsReasoningEffort: true,
    });
    // 命中 preset ≠ 合成关闭值：关闭仍走 openai 原生"参数缺席"
    expect(model.thinkingEffortMap).toBeUndefined();
  });

  it('自定义供应商 + 未命中 preset 的型号名 → 通用 6 档兜底 + 关闭值 none', async () => {
    await writeInstance([
      'id: inst1',
      'type: custom',
      'name: 我的供应商',
      'protocol: openai',
      'apiKey: k',
      'models:',
      '  - modelName: my-company-internal-llm',
    ]);

    const model = store.findModel('inst1:my-company-internal-llm')!;
    expect(model.thinkingEfforts).toEqual([
      'none',
      'low',
      'medium',
      'high',
      'xhigh',
      'max',
    ]);
    // 兜底菜单配套合成关闭值 → openai 拼法关触发 reasoning_effort:"none"
    expect(model.thinkingEffortMap).toEqual({ none: 'none' });
  });

  it('自定义供应商 + 型号名像 embed → 仍视为不能思考（横切规则优先）', async () => {
    await writeInstance([
      'id: inst1',
      'type: custom',
      'name: 我的供应商',
      'protocol: openai',
      'apiKey: k',
      'models:',
      '  - modelName: bge-m3-embedding',
    ]);

    const model = store.findModel('inst1:bge-m3-embedding')!;
    expect(model.thinkingEfforts).toEqual([]);
  });

  it('实例文件覆盖类型卡的 thinkingFormat；实例声明的 defaultEfforts 决定档位', async () => {
    await writeInstance([
      'id: inst1',
      'type: deepseek',
      'name: 我的 DeepSeek',
      'protocol: openai',
      'compat:',
      '  thinkingFormat: qwen',
      'thinking:',
      '  defaultEfforts: [none, high, max]',
      'models:',
      '  - modelName: ds-chat',
    ]);

    const model = store.findModel('inst1:ds-chat')!;
    expect(model.provider.compat!.thinkingFormat).toBe('qwen');
    expect(model.provider.thinking!.defaultEfforts).toEqual(['none', 'high', 'max']);
    expect(model.thinkingEfforts).toEqual(['none', 'high', 'max']);
  });

  it('模型级 compat.thinkingFormat 覆盖实例与类型卡', async () => {
    await writeInstance([
      'id: inst1',
      'type: deepseek',
      'name: 我的 DeepSeek',
      'protocol: openai',
      'compat:',
      '  thinkingFormat: qwen',
      'models:',
      '  - modelName: ds-chat',
      '    compat:',
      '      thinkingFormat: zai',
    ]);

    const model = store.findModel('inst1:ds-chat')!;
    expect(model.provider.compat!.thinkingFormat).toBe('zai');
  });

  it('未知 thinkingFormat 被忽略（回退默认 openai，不拒载）', async () => {
    await writeInstance([
      'id: inst1',
      'type: custom',
      'name: 自定义',
      'protocol: openai',
      'compat:',
      '  thinkingFormat: no-such-format',
      'models:',
      '  - modelName: m1',
    ]);

    const model = store.findModel('inst1:m1')!;
    expect(model.provider.compat!.thinkingFormat).toBe('openai');
  });

  it('toRuntimeProviderConfig：缺字段兜底，undefined 输入不炸', () => {
    expect(toRuntimeProviderConfig(undefined)).toEqual({
      id: '',
      type: '',
      protocol: 'openai',
      apiUrl: undefined,
      apiKey: undefined,
      headers: undefined,
      thinking: undefined,
      compat: undefined,
    });
    expect(
      toRuntimeProviderConfig({
        id: 'p',
        type: 'custom',
        protocol: 'anthropic',
        headers: { 'x-a': '1' },
      }),
    ).toMatchObject({ id: 'p', type: 'custom', protocol: 'anthropic' });
  });
});
