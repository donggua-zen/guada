import {
  clampThinkingEffort,
  defaultThinkingEffort,
} from '../../src/modules/llm-core/thinking/thinking-effort-policy';

/**
 * 档位策略：菜单 → 生效档位
 *
 * 请求侧校验与会话侧 relay 判定共用这一个实现——两份实现是「UI 显示的档位」与
 * 「实际发出的档位」分叉的根因（例如菜单 [high,max] 而存量设置为 none 时，
 * 旧实现会判定"关思考"但实际发 high）。
 */
describe('clampThinkingEffort', () => {
  it('未请求档位 → 原样透传', () => {
    expect(clampThinkingEffort(['none', 'high'], undefined)).toEqual({ effort: undefined });
  });

  it('能力未知（菜单 undefined）→ 不校验，原样透传', () => {
    expect(clampThinkingEffort(undefined, 'max')).toEqual({ effort: 'max' });
  });

  it('不能思考（无非 off 档）+ 请求非 none → unsupported', () => {
    expect(clampThinkingEffort([], 'high')).toEqual({ effort: undefined, unsupported: true });
    // 只声明了 none 的模型同样不能思考
    expect(clampThinkingEffort(['none'], 'high')).toEqual({ effort: undefined, unsupported: true });
  });

  it('不能思考 + 请求 none → 合法', () => {
    expect(clampThinkingEffort([], 'none')).toEqual({ effort: 'none' });
  });

  it('档位在菜单内 → 原样', () => {
    expect(clampThinkingEffort(['none', 'low', 'high'], 'low')).toEqual({ effort: 'low' });
  });

  it('档位不在菜单（存量设置）→ 调整到中位档', () => {
    expect(clampThinkingEffort(['none', 'low', 'high'], 'max')).toEqual({ effort: 'high' });
    expect(clampThinkingEffort(['low', 'medium', 'high'], 'minimal')).toEqual({ effort: 'medium' });
  });

  it('请求 none 但菜单无 none → 调整到首个非 off 档', () => {
    expect(clampThinkingEffort(['low', 'high'], 'none')).toEqual({ effort: 'low' });
  });

  it('legacy on 不在菜单 → 按普通未知档调整', () => {
    expect(clampThinkingEffort(['none', 'low', 'high'], 'on')).toEqual({ effort: 'high' });
  });
});

/**
 * 会话从未显式选过档位时的默认值：取非关闭档的中位数（向下取整），
 * 即"默认开启思考、取中等强度"，而不是默认关闭。
 */
describe('defaultThinkingEffort', () => {
  it('官方 6 档兜底 → high（非关闭档的中位）', () => {
    expect(defaultThinkingEffort(['none', 'low', 'medium', 'high', 'xhigh', 'max'])).toBe('high');
  });

  it('deepseek 菜单 [none,high,max] → high（两档时取较低那档）', () => {
    expect(defaultThinkingEffort(['none', 'high', 'max'])).toBe('high');
  });

  it('四档菜单 → medium', () => {
    expect(defaultThinkingEffort(['none', 'low', 'medium', 'high'])).toBe('medium');
  });

  it('纯开关菜单 [none,on] → on（开启思考）', () => {
    expect(defaultThinkingEffort(['none', 'on'])).toBe('on');
  });

  it('强制思考菜单 [on] → on', () => {
    expect(defaultThinkingEffort(['on'])).toBe('on');
  });

  it('不能思考（空菜单 / 只有 none）→ none', () => {
    expect(defaultThinkingEffort([])).toBe('none');
    expect(defaultThinkingEffort(['none'])).toBe('none');
    expect(defaultThinkingEffort(undefined)).toBe('none');
  });
});
