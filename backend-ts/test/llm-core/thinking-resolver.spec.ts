import {
  GENERIC_EFFORT_MENU,
  resolveThinkingEfforts,
  resolveThinkingMenu,
} from '../../src/modules/llm-core/thinking/resolve-thinking-efforts';
import { normalizeThinkingEffort } from '../../src/modules/llm-core/thinking/thinking-vocabulary';

describe('normalizeThinkingEffort', () => {
  it('off 归一为 none（pi-ai 拼写宽容）', () => {
    expect(normalizeThinkingEffort('off')).toBe('none');
    expect(normalizeThinkingEffort('OFF')).toBe('none');
  });

  it('规范档位原样通过', () => {
    expect(normalizeThinkingEffort('minimal')).toBe('minimal');
    expect(normalizeThinkingEffort('xhigh')).toBe('xhigh');
    expect(normalizeThinkingEffort('max')).toBe('max');
  });

  it('legacy on 保留识别', () => {
    expect(normalizeThinkingEffort('on')).toBe('on');
  });

  it('未知词返回 undefined', () => {
    expect(normalizeThinkingEffort('turbo')).toBeUndefined();
  });
});

describe('resolveThinkingEfforts 三级声明链', () => {
  it('模型条目显式声明优先，且按规范顺序排列', () => {
    const efforts = resolveThinkingEfforts(
      { modelName: 'm', thinkingEfforts: ['high', 'none', 'medium'] },
      { defaultEfforts: ['none', 'low'] },
    );
    expect(efforts).toEqual(['none', 'medium', 'high']);
  });

  it('声明 false → 空数组（不能思考）', () => {
    expect(
      resolveThinkingEfforts(
        { modelName: 'm', supportsThinking: false, thinkingEfforts: false },
        undefined,
      ),
    ).toEqual([]);
  });

  it('显式 supportsThinking: false 短路一切（即使有档位声明）', () => {
    expect(
      resolveThinkingEfforts(
        {
          modelName: 'm',
          supportsThinking: false,
          thinkingEfforts: ['none', 'high'],
        },
        undefined,
      ),
    ).toEqual([]);
  });

  it('声明 true（legacy 写法）→ 通用兜底菜单（格式能发强度值）', () => {
    expect(
      resolveThinkingEfforts({ modelName: 'gpt-5.4', thinkingEfforts: true as any }, undefined),
    ).toEqual(GENERIC_EFFORT_MENU);
  });

  it('supportsThinking: true 且未声明档位 → 通用兜底菜单', () => {
    expect(
      resolveThinkingEfforts({ modelName: 'unknown-model-xyz', supportsThinking: true }, undefined),
    ).toEqual(GENERIC_EFFORT_MENU);
  });

  it('supportsThinking: true + [on] → 强制思考菜单（无 none = 不可关）', () => {
    expect(
      resolveThinkingEfforts(
        { modelName: 'm', supportsThinking: true, thinkingEfforts: ['on'] },
        undefined,
      ),
    ).toEqual(['on']);
  });

  it('条目缺省回退供应商 defaultEfforts（实例文件的显式声明；on 为正典档位）', () => {
    const efforts = resolveThinkingEfforts(
      { modelName: 'm' },
      { defaultEfforts: ['none', 'on', 'high'] },
    );
    expect(efforts).toEqual(['none', 'on', 'high']);
  });

  it('供应商缺省 → preset 目录匹配', () => {
    const efforts = resolveThinkingEfforts({ modelName: 'gpt-5.4' }, undefined);
    expect(efforts.length).toBeGreaterThan(0);
  });

  it('三级都缺省 → 通用兜底菜单（OpenAI 官方 6 档，不再有协议猜测）', () => {
    expect(
      resolveThinkingEfforts({ modelName: 'unknown-model-xyz' }, undefined),
    ).toEqual(GENERIC_EFFORT_MENU);
    expect(
      resolveThinkingEfforts({ modelName: 'unknown-model-xyz' }, {}),
    ).toEqual(GENERIC_EFFORT_MENU);
  });

  it('开关型格式（supportsReasoningEffort=false）不给强度档：仅声明过能力才有最小开关', () => {
    // zai/together/ant-ling 这类格式无法把强度值写上 wire，塞 6 档会造出假档位
    const opts = { supportsEffort: false };
    expect(
      resolveThinkingEfforts({ modelName: 'unknown-model-xyz', supportsThinking: true }, undefined, opts),
    ).toEqual(['none', 'on']);
    expect(
      resolveThinkingEfforts({ modelName: 'unknown-model-xyz' }, undefined, opts),
    ).toEqual([]);
    // 显式声明的档位不受兜底策略影响
    expect(
      resolveThinkingEfforts({ modelName: 'm', thinkingEfforts: ['none', 'high'] }, undefined, opts),
    ).toEqual(['none', 'high']);
  });

  it('embedding 模型横切排除（最高优先）', () => {
    expect(
      resolveThinkingEfforts(
        { modelName: 'text-embedding-3-small', modelType: 'embedding', thinkingEfforts: ['low'] },
        undefined,
      ),
    ).toEqual([]);
    expect(
      resolveThinkingEfforts(
        { modelName: 'some-embed-model', thinkingEfforts: ['low'] },
        undefined,
      ),
    ).toEqual([]);
  });
});

describe('thinkingEffortsMap（菜单与 wire 值解耦）', () => {
  it('map 派生菜单：非 null 键按规范顺序，null/缺失键隐藏', () => {
    const r = resolveThinkingMenu(
      {
        modelName: 'acme-think',
        thinkingEffortsMap: {
          none: null,
          low: 'low',
          medium: 'high',
          high: 'high',
          max: 'ultra',
        },
      },
      undefined,
    );
    expect(r.menu).toEqual(['low', 'medium', 'high', 'max']);
    expect(r.wireValues).toEqual({ low: 'low', medium: 'high', high: 'high', max: 'ultra' });
  });

  it('off 键归一为 none，未知键丢弃', () => {
    const r = resolveThinkingMenu(
      {
        modelName: 'm',
        thinkingEffortsMap: { off: 'off', turbo: 'x', high: 'high' } as any,
      },
      undefined,
    );
    expect(r.menu).toEqual(['none', 'high']);
    expect(r.wireValues).toEqual({ none: 'off', high: 'high' });
  });

  it('false 优先于 map（不推理）', () => {
    const r = resolveThinkingMenu(
      { modelName: 'm', thinkingEfforts: false, thinkingEffortsMap: { high: 'high' } },
      undefined,
    );
    expect(r.menu).toEqual([]);
  });

  it('map 优先于数组，wireValues 缺省为空（wire=档位名）', () => {
    const withMap = resolveThinkingMenu(
      { modelName: 'm', thinkingEfforts: ['none', 'high'], thinkingEffortsMap: { high: 'ultra' } },
      undefined,
    );
    expect(withMap.menu).toEqual(['high']);

    const arrayOnly = resolveThinkingMenu(
      { modelName: 'm', thinkingEfforts: ['none', 'high'] },
      undefined,
    );
    expect(arrayOnly.menu).toEqual(['none', 'high']);
    expect(arrayOnly.wireValues).toEqual({});
  });

  it('embedding 模型即使有 map 也返回空菜单', () => {
    const r = resolveThinkingMenu(
      { modelName: 'x-embed', modelType: 'embedding', thinkingEffortsMap: { high: 'high' } },
      undefined,
    );
    expect(r.menu).toEqual([]);
    expect(r.wireValues).toEqual({});
  });
});

describe('通用兜底的 wire 值（关闭按官方档位值发出）', () => {
  it('走兜底 → 合成 none → "none"（openai 拼法据此发 reasoning_effort:"none"）', () => {
    const r = resolveThinkingMenu({ modelName: 'unknown-model-xyz' }, undefined);
    expect(r.menu).toEqual(GENERIC_EFFORT_MENU);
    expect(r.wireValues).toEqual({ none: 'none' });
  });

  it('开关型格式的兜底不合成 wire 值（关闭走格式原生开关）', () => {
    const r = resolveThinkingMenu(
      { modelName: 'unknown-model-xyz', supportsThinking: true },
      undefined,
      { supportsEffort: false },
    );
    expect(r.menu).toEqual(['none', 'on']);
    expect(r.wireValues).toEqual({});
  });

  it('显式声明的菜单不合成 none 映射（既有行为不变）', () => {
    const r = resolveThinkingMenu(
      { modelName: 'm', thinkingEfforts: ['none', 'high'] },
      undefined,
    );
    expect(r.menu).toEqual(['none', 'high']);
    expect(r.wireValues).toEqual({});
  });

  it('命中 preset / 实例 defaultEfforts 的菜单也不合成', () => {
    const preset = resolveThinkingMenu({ modelName: 'gpt-5.4' }, undefined);
    expect(preset.wireValues).toEqual({});

    const withDefault = resolveThinkingMenu(
      { modelName: 'm' },
      { defaultEfforts: ['none', 'high'] },
    );
    expect(withDefault.menu).toEqual(['none', 'high']);
    expect(withDefault.wireValues).toEqual({});
  });
});
