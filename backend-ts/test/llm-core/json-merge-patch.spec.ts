import { applyJsonMergePatch } from '../../src/modules/llm-core/thinking/json-merge-patch';

describe('applyJsonMergePatch（RFC 7386 语义）', () => {
  it('标量与数组整体替换', () => {
    const target = { a: 1, b: [1, 2], c: 'x' };
    const result = applyJsonMergePatch(target, {
      a: 'replaced',
      b: [3],
      c: null,
    });
    expect(result).toEqual({ a: 'replaced', b: [3] });
  });

  it('对象递归合并；null 删键', () => {
    const target = {
      thinking: { type: 'enabled', clear_thinking: false },
      reasoning: { effort: 'low', extra: 'keep' },
    };
    const result = applyJsonMergePatch(target, {
      thinking: { type: 'adaptive' },
      reasoning: { effort: 'high', extra: null },
    });
    expect(result).toEqual({
      thinking: { type: 'adaptive', clear_thinking: false },
      reasoning: { effort: 'high' },
    });
  });

  it('目标键非对象时以空对象为基础合并', () => {
    const target = { config: 'scalar' } as any;
    const result = applyJsonMergePatch(target, {
      config: { effort: 'high' },
    });
    expect(result).toEqual({ config: { effort: 'high' } });
  });

  it('目标缺失键时创建嵌套对象', () => {
    const result = applyJsonMergePatch({} as any, {
      output_config: { effort: 'max' },
    });
    expect(result).toEqual({ output_config: { effort: 'max' } });
  });

  it('不修改入参（深拷贝语义）', () => {
    const target = { thinking: { type: 'enabled' }, nested: { deep: { v: 1 } } };
    const snapshot = JSON.parse(JSON.stringify(target));
    applyJsonMergePatch(target, {
      thinking: { type: 'disabled' },
      nested: { deep: { v: 2 } },
    });
    expect(target).toEqual(snapshot);
  });

  it('数组内的对象不被递归合并（数组整体替换）', () => {
    const target = { items: [{ id: 1, keep: true }] };
    const result = applyJsonMergePatch(target, {
      items: [{ id: 2 }],
    });
    expect(result).toEqual({ items: [{ id: 2 }] });
  });
});
