import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ProviderFileStore } from '../../src/modules/llm-core/provider-file.store';
import { BundledCatalogService } from '../../src/modules/llm-core/bundled-catalog.service';
import {
  ModelCapabilityService,
  UnsupportedReasoningEffortError,
} from '../../src/modules/llm-core/model-capability.service';

describe('ModelCapabilityService', () => {
  let store: ProviderFileStore;
  let capability: ModelCapabilityService;
  let dir: string;
  let bundledDir: string;

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-providers-'));
    bundledDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-bundled-'));
    process.env.PROVIDERS_DIR = dir;
    process.env.BUNDLED_PROVIDERS_DIR = bundledDir;

    // 实例：连接信息 + 覆盖条目（map 改名 / 无思考能力 / 四档菜单）
    fs.writeFileSync(
      path.join(dir, 'p1.yaml'),
      [
        'id: p1',
        'type: custom',
        'name: P1',
        'enabled: true',
        'protocol: openai',
        'apiKey: k',
        'models:',
        '  - modelName: think-a',
        '    thinkingEffortsMap: { low: low, high: ultra }',
        '  - modelName: plain-b',
        '    thinkingEfforts: false',
        '  - modelName: think-c',
        '    thinkingEfforts: [none, low, high, max]',
      ].join('\n'),
      'utf8',
    );

    store = new ProviderFileStore(new BundledCatalogService());
    await store.initialize();
    capability = new ModelCapabilityService(store);
  });

  afterEach(() => {
    store.onModuleDestroy();
    delete process.env.PROVIDERS_DIR;
    delete process.env.BUNDLED_PROVIDERS_DIR;
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(bundledDir, { recursive: true, force: true });
  });

  describe('resolveThinkingWireValue', () => {
    it('非 none/on 档查映射（改名）', () => {
      expect(capability.resolveThinkingWireValue('p1', 'think-a', 'high')).toBe('ultra');
      expect(capability.resolveThinkingWireValue('p1', 'think-a', 'low')).toBe('low');
    });

    it('未映射的档位 → undefined（调用方回退档位名）', () => {
      expect(capability.resolveThinkingWireValue('p1', 'think-a', 'max')).toBeUndefined();
    });

    it('none/on 不查映射（开关态归 style）', () => {
      expect(capability.resolveThinkingWireValue('p1', 'think-a', 'none')).toBeUndefined();
      expect(capability.resolveThinkingWireValue('p1', 'think-a', 'on')).toBeUndefined();
    });

    it('查不到实例/模型 → undefined', () => {
      expect(capability.resolveThinkingWireValue('nope', 'think-a', 'high')).toBeUndefined();
      expect(capability.resolveThinkingWireValue(undefined, 'think-a', 'high')).toBeUndefined();
    });
  });

  describe('resolveThinkingEffort（校验 + 调整，菜单不出服务边界）', () => {
    it('实例/模型查不到（能力未知）→ 原样透传，不校验', () => {
      expect(capability.resolveThinkingEffort(undefined, 'think-a', 'max')).toBe('max');
      expect(capability.resolveThinkingEffort('p1', undefined, 'max')).toBe('max');
      expect(capability.resolveThinkingEffort('nope', 'think-a', 'max')).toBe('max');
      expect(capability.resolveThinkingEffort('p1', 'ghost', 'max')).toBe('max');
    });

    it('未请求档位（undefined）→ 原样返回 undefined', () => {
      expect(capability.resolveThinkingEffort('p1', 'think-a', undefined)).toBeUndefined();
    });

    it('合法选择原样通过', () => {
      expect(capability.resolveThinkingEffort('p1', 'think-a', 'low')).toBe('low');
      expect(capability.resolveThinkingEffort('p1', 'think-c', 'max')).toBe('max');
    });

    it('无思考能力 + 非 none 请求 → 抛 UNSUPPORTED_REASONING_EFFORT', () => {
      let thrown: any;
      try {
        capability.resolveThinkingEffort('p1', 'plain-b', 'high');
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBeInstanceOf(UnsupportedReasoningEffortError);
      expect(thrown.code).toBe('UNSUPPORTED_REASONING_EFFORT');
      expect(thrown.message).toContain('plain-b');
      expect(thrown.message).toContain('p1');
    });

    it('无思考能力 + none 请求 → 合法通过', () => {
      expect(capability.resolveThinkingEffort('p1', 'plain-b', 'none')).toBe('none');
    });

    it('档位不受支持 → 静默调整到中位档', () => {
      expect(capability.resolveThinkingEffort('p1', 'think-c', 'medium')).toBe('high');
    });

    it('请求 none 但菜单无 none → 调整到首个非 off 档', () => {
      expect(capability.resolveThinkingEffort('p1', 'think-a', 'none')).toBe('low');
    });
  });
});
