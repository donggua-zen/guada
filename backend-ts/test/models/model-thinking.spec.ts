import { BadRequestException } from '@nestjs/common';
import {
  parseProviderCompatPatch,
  parseThinkingPatch,
} from '../../src/modules/models/model-thinking.util';
import { ModelService } from '../../src/modules/models/model.service';

describe('parseThinkingPatch（模型条目 thinking 声明写入口）', () => {
  it('档位数组：去重 + 规范序', () => {
    const { patch, clears } = parseThinkingPatch({
      thinkingEfforts: ['max', 'none', 'high', 'none'],
    });
    expect(patch.thinkingEfforts).toEqual(['none', 'high', 'max']);
    expect(clears).toEqual([]);
  });

  it('off 归一为 none；false 为显式无档位', () => {
    expect(
      parseThinkingPatch({ thinkingEfforts: ['off', 'high'] }).patch.thinkingEfforts,
    ).toEqual(['none', 'high']);
    expect(parseThinkingPatch({ thinkingEfforts: false }).patch.thinkingEfforts).toBe(false);
  });

  it('thinkingEfforts: null = 清除条目覆盖（回退继承链）', () => {
    const { patch, clears } = parseThinkingPatch({ thinkingEfforts: null });
    expect(patch).toEqual({});
    expect(clears).toEqual(['thinkingEfforts']);
  });

  it('thinkingEffortsMap 合法映射：off 键归一、trim、规范序', () => {
    const { patch, clears } = parseThinkingPatch({
      thinkingEffortsMap: { max: ' maximum ', off: 'none', high: 'high' },
    });
    expect(patch.thinkingEffortsMap).toEqual({ none: 'none', high: 'high', max: 'maximum' });
    expect(clears).toEqual([]);
  });

  it('thinkingEffortsMap: null = 清除条目覆盖；null 值 = 显式不支持', () => {
    const { patch, clears } = parseThinkingPatch({ thinkingEffortsMap: null });
    expect(patch).toEqual({});
    expect(clears).toEqual(['thinkingEffortsMap']);
    expect(parseThinkingPatch({ thinkingEffortsMap: { low: null } }).patch.thinkingEffortsMap).toEqual({
      low: null,
    });
  });

  it('thinkingEffortsMap 非法输入 fail-loud（400）', () => {
    // 未知档位键
    expect(() => parseThinkingPatch({ thinkingEffortsMap: { bogus: 'x' } })).toThrow(
      BadRequestException,
    );
    // on 不能作键：开关行为由 thinkingFormat 承载
    expect(() => parseThinkingPatch({ thinkingEffortsMap: { on: 'true' } })).toThrow(
      BadRequestException,
    );
    // 非对象 / 数组 / 空对象
    expect(() => parseThinkingPatch({ thinkingEffortsMap: 'high' })).toThrow(BadRequestException);
    expect(() => parseThinkingPatch({ thinkingEffortsMap: ['high'] })).toThrow(BadRequestException);
    expect(() => parseThinkingPatch({ thinkingEffortsMap: {} })).toThrow(BadRequestException);
    // 值须为非空字符串或 null
    expect(() => parseThinkingPatch({ thinkingEffortsMap: { high: '' } })).toThrow(
      BadRequestException,
    );
    expect(() => parseThinkingPatch({ thinkingEffortsMap: { high: 42 } })).toThrow(
      BadRequestException,
    );
  });

  it('thinkingEffortsPatch 合法映射：off 键归一、规范序', () => {
    const { patch, clears } = parseThinkingPatch({
      thinkingEffortsPatch: {
        high: { reasoning_effort: 'high', thinking: { type: 'enabled' } },
        off: { thinking: { type: 'disabled' } },
      },
    });
    expect(patch.thinkingEffortsPatch).toEqual({
      none: { thinking: { type: 'disabled' } },
      high: { reasoning_effort: 'high', thinking: { type: 'enabled' } },
    });
    expect(clears).toEqual([]);
  });

  it('thinkingEffortsPatch: null = 清除条目覆盖', () => {
    expect(parseThinkingPatch({ thinkingEffortsPatch: null })).toEqual({
      patch: {},
      clears: ['thinkingEffortsPatch'],
    });
  });

  it('thinkingEffortsPatch 非法输入 fail-loud（400）', () => {
    // 未知档位键 / on 键
    expect(() => parseThinkingPatch({ thinkingEffortsPatch: { bogus: {} } })).toThrow(
      BadRequestException,
    );
    expect(() => parseThinkingPatch({ thinkingEffortsPatch: { on: {} } })).toThrow(
      BadRequestException,
    );
    // 值须为对象
    expect(() => parseThinkingPatch({ thinkingEffortsPatch: { high: 'x' } })).toThrow(
      BadRequestException,
    );
    expect(() => parseThinkingPatch({ thinkingEffortsPatch: { high: ['x'] } })).toThrow(
      BadRequestException,
    );
    expect(() => parseThinkingPatch({ thinkingEffortsPatch: { high: null } })).toThrow(
      BadRequestException,
    );
    // 空 patch / 整体空对象
    expect(() => parseThinkingPatch({ thinkingEffortsPatch: { high: {} } })).toThrow(
      BadRequestException,
    );
    expect(() => parseThinkingPatch({ thinkingEffortsPatch: {} })).toThrow(BadRequestException);
    // 非 JSON 值（undefined 条目被丢弃后空 patch → 400）
    expect(() =>
      parseThinkingPatch({ thinkingEffortsPatch: { high: { a: undefined } } as any }),
    ).toThrow(BadRequestException);
  });

  it('compat 合法值写入 patch', () => {
    const { patch } = parseThinkingPatch({
      compat: { thinkingFormat: 'deepseek', supportsReasoningEffort: true },
    });
    expect(patch.compat).toEqual({
      thinkingFormat: 'deepseek',
      supportsReasoningEffort: true,
    });
  });

  it('legacy thinking.style 归一到 compat.thinkingFormat（显式 compat 优先）', () => {
    expect(
      parseThinkingPatch({ thinking: { style: 'thinking-toggle' } }).patch.compat,
    ).toEqual({ thinkingFormat: 'deepseek' });
    expect(
      parseThinkingPatch({
        thinking: { style: 'thinking-toggle' },
        compat: { thinkingFormat: 'zai' },
      }).patch.compat,
    ).toEqual({ thinkingFormat: 'zai' });
  });

  it('compat: null / thinking: null = 清除条目 compat', () => {
    expect(parseThinkingPatch({ compat: null }).clears).toEqual(['compat']);
    expect(parseThinkingPatch({ thinking: null }).clears).toEqual(['compat']);
  });

  it('字段缺省 = 不变', () => {
    expect(parseThinkingPatch({})).toEqual({ patch: {}, clears: [] });
  });

  it('非法输入 fail-loud（400）', () => {
    expect(() => parseThinkingPatch({ thinkingEfforts: [] })).toThrow(BadRequestException);
    expect(() => parseThinkingPatch({ thinkingEfforts: ['none'] })).toThrow(BadRequestException);
    // on 已是正典档位：['on', 'high'] 合法（菜单声明含开关档）
    expect(parseThinkingPatch({ thinkingEfforts: ['on', 'high'] }).patch.thinkingEfforts).toEqual([
      'on',
      'high',
    ]);
    expect(() => parseThinkingPatch({ thinkingEfforts: ['bogus'] })).toThrow(BadRequestException);
    expect(() => parseThinkingPatch({ thinkingEfforts: true })).toThrow(BadRequestException);
    expect(() => parseThinkingPatch({ thinkingEfforts: 42 })).toThrow(BadRequestException);
    expect(() => parseThinkingPatch({ thinking: { style: 'bogus' } })).toThrow(BadRequestException);
    expect(() => parseThinkingPatch({ thinking: 'thinking-toggle' })).toThrow(BadRequestException);
    expect(() =>
      parseThinkingPatch({ compat: { thinkingFormat: 'thinking-toggle-response' } }),
    ).toThrow(BadRequestException);
  });

  it('supportsThinking 声明：布尔写入 / null 清除 / 非布尔 400', () => {
    expect(parseThinkingPatch({ supportsThinking: true }).patch.supportsThinking).toBe(true);
    expect(parseThinkingPatch({ supportsThinking: false }).patch.supportsThinking).toBe(false);
    expect(parseThinkingPatch({ supportsThinking: null }).clears).toEqual(['supportsThinking']);
    expect(() => parseThinkingPatch({ supportsThinking: 'yes' })).toThrow(BadRequestException);
  });
});

describe('parseProviderCompatPatch（供应商级 compat 写入口）', () => {
  it('合法值归一；未声明 → undefined', () => {
    expect(parseProviderCompatPatch({ compat: { thinkingFormat: 'zai' } })).toEqual({
      thinkingFormat: 'zai',
    });
    expect(parseProviderCompatPatch({})).toBeUndefined();
    expect(parseProviderCompatPatch({ compat: null })).toBeUndefined();
  });

  it('未知 format fail-loud；legacy 别名归一', () => {
    expect(() =>
      parseProviderCompatPatch({ compat: { thinkingFormat: 'reasoning-split' } }),
    ).toThrow(BadRequestException);
    // legacy 别名宽容归一（读侧同源）
    expect(parseProviderCompatPatch({ compat: { thinkingFormat: 'thinking-toggle' } })).toEqual({
      thinkingFormat: 'deepseek',
    });
  });
});

/** ModelService 依赖桩：只覆盖 getModelsAndProviders/updateModel/addModel 路径 */
class StubStore {
  provider = {
    id: 'p1',
    type: 'custom',
    name: 'P1',
    enabled: true,
    protocol: 'openai',
    compat: { thinkingFormat: 'thinking-toggle' },
    models: [
      {
        modelName: 'm-override',
        thinkingEfforts: ['high'] as string[],
        thinkingEffortsMap: { high: 'max' } as Record<string, string | null>,
        compat: { thinkingFormat: 'enable-thinking' },
      },
      { modelName: 'm-inherit' },
    ],
  };
  updateModel = jest.fn();
  addModel = jest.fn();

  listProviders() {
    return [this.provider];
  }
  listEnabledProviders() {
    return [this.provider];
  }
  resolveMergedModels() {
    return [
      { modelName: 'm-override', modelType: 'text', isActive: true },
      { modelName: 'm-inherit', modelType: 'text', isActive: true },
    ];
  }
  resolveModelView(_provider: any, m: any) {
    return {
      id: `p1:${m.modelName}`,
      modelName: m.modelName,
      name: m.modelName,
      modelType: 'text',
      config: {},
      isFavorite: false,
      isActive: true,
      thinkingEfforts: m.modelName === 'm-override' ? ['none', 'high'] : ['low'],
      thinkingCompat: {
        thinkingFormat: m.modelName === 'm-override' ? 'qwen' : 'deepseek',
        supportsReasoningEffort: true,
      },
    };
  }
}

describe('ModelService：thinking 载荷与白名单 patch', () => {
  const buildService = () => {
    const store = new StubStore();
    const service = new ModelService(
      store as any,
      { hasAdapter: () => true } as any,
      { getType: () => undefined, hasType: () => false } as any,
    );
    return { store, service };
  };

  it('getModelsAndProviders 暴露生效 format/supportsEffort 与条目级覆盖', async () => {
    const { service } = buildService();
    const result = await service.getModelsAndProviders(true);
    const models = result.items[0].models as any[];

    const override = models.find((m) => m.modelName === 'm-override')!;
    expect(override.thinkingFormat).toBe('qwen');
    expect(override.supportsReasoningEffort).toBe(true);
    expect(override.compatOverride).toEqual({ thinkingFormat: 'enable-thinking' });
    expect(override.thinkingEffortsMapOverride).toEqual({ high: 'max' });

    const inherit = models.find((m) => m.modelName === 'm-inherit')!;
    expect(inherit.thinkingFormat).toBe('deepseek');
    expect(inherit.compatOverride).toBeUndefined();
    expect(inherit.thinkingEffortsMapOverride).toBeUndefined();
  });

  it('updateModel 白名单 patch：表单杂字段与 modelName 不落盘', async () => {
    const { store, service } = buildService();
    await service.updateModel('p1:m-override', {
      modelName: 'renamed',
      junk: 1,
      modelType: 'text',
      config: { contextWindow: 1 },
      thinkingEfforts: ['high', 'none', 'high'],
      thinkingEffortsMap: { high: 'max', low: ' low ' },
      compat: { thinkingFormat: 'enable-thinking' },
    });
    expect(store.updateModel).toHaveBeenCalledWith('p1', 'm-override', {
      modelType: 'text',
      config: { contextWindow: 1 },
      thinkingEfforts: ['none', 'high'],
      thinkingEffortsMap: { low: 'low', high: 'max' },
      compat: { thinkingFormat: 'qwen' },
    });
  });

  it('updateModel：thinkingEffortsMap null 原样下发，由 store 翻译为清除', async () => {
    const { store, service } = buildService();
    await service.updateModel('p1:m-override', { thinkingEffortsMap: null });
    expect(store.updateModel).toHaveBeenCalledWith('p1', 'm-override', {
      thinkingEffortsMap: null,
    });
  });

  it('updateModel：thinkingEffortsPatch 白名单 patch 与 null 清除', async () => {
    const { store, service } = buildService();
    await service.updateModel('p1:m-override', {
      thinkingEffortsPatch: {
        high: { reasoning_effort: 'ultra', thinking: { type: 'enabled' } },
      },
    });
    expect(store.updateModel).toHaveBeenCalledWith('p1', 'm-override', {
      thinkingEffortsPatch: {
        high: { reasoning_effort: 'ultra', thinking: { type: 'enabled' } },
      },
    });

    await service.updateModel('p1:m-override', { thinkingEffortsPatch: null });
    expect(store.updateModel).toHaveBeenCalledWith('p1', 'm-override', {
      thinkingEffortsPatch: null,
    });
  });

  it('updateModel 继承模式的 null 原样下发，由 store 翻译为清除', async () => {
    const { store, service } = buildService();
    await service.updateModel('p1:m-override', { thinkingEfforts: null, compat: null });
    expect(store.updateModel).toHaveBeenCalledWith('p1', 'm-override', {
      thinkingEfforts: null,
      compat: null,
    });
  });

  it('updateModel 非法 thinking 声明 fail-loud', async () => {
    const { service } = buildService();
    await expect(
      service.updateModel('p1:m-override', { thinkingEfforts: ['bogus'] }),
    ).rejects.toThrow(BadRequestException);
  });

  it('addModel 应用 thinking/compat 声明（自建模型可声明档位与格式）', async () => {
    const { store, service } = buildService();
    await service.addModel({
      providerId: 'p1',
      modelName: 'custom-1',
      thinkingEfforts: ['medium', 'low'],
      compat: { thinkingFormat: 'deepseek' },
    });
    expect(store.addModel).toHaveBeenCalledWith(
      'p1',
      expect.objectContaining({
        modelName: 'custom-1',
        thinkingEfforts: ['low', 'medium'],
        compat: { thinkingFormat: 'deepseek' },
      }),
    );
  });
});
