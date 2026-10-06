import { BadRequestException } from '@nestjs/common';
import { parseThinkingPatch } from './model-thinking.util';

/**
 * 拼法表达式（thinkingPatchExpr）写入口校验测试。
 *
 * 保存即校验：非法表达式必须在写入前 400（消息带定位），合法表达式 trim 后入库；
 * 空串/null 语义 = 清除覆盖（回退内置拼法）。
 */
describe('parseThinkingPatch：thinkingPatchExpr', () => {
  it('合法表达式：trim 后进入 patch', () => {
    const result = parseThinkingPatch({
      thinkingPatchExpr:
        '  off ? {} : {"reasoning_effort": wireValue}  ',
    });
    expect(result.patch.thinkingPatchExpr).toBe(
      'off ? {} : {"reasoning_effort": wireValue}',
    );
    expect(result.clears).toEqual([]);
  });

  it('语法错误 / 未知变量 / 非对象返回 → 400 且消息可读', () => {
    expect(() =>
      parseThinkingPatch({ thinkingPatchExpr: '{"a": }' }),
    ).toThrow(BadRequestException);

    expect(() =>
      parseThinkingPatch({ thinkingPatchExpr: '{"a": typoVar}' }),
    ).toThrow(/Unknown variable/);

    expect(() =>
      parseThinkingPatch({ thinkingPatchExpr: '"just a string"' }),
    ).toThrow(/必须返回 JSON 对象/);
  });

  it('空串/null = 清除覆盖；非字符串类型 → 400', () => {
    expect(parseThinkingPatch({ thinkingPatchExpr: '' }).clears).toEqual([
      'thinkingPatchExpr',
    ]);
    expect(parseThinkingPatch({ thinkingPatchExpr: '   ' }).clears).toEqual([
      'thinkingPatchExpr',
    ]);
    expect(parseThinkingPatch({ thinkingPatchExpr: null }).clears).toEqual([
      'thinkingPatchExpr',
    ]);
    expect(() => parseThinkingPatch({ thinkingPatchExpr: 42 })).toThrow(
      /须为字符串或 null/,
    );
  });

  it('字段缺省 → 不变（既不进 patch 也不清除）', () => {
    const result = parseThinkingPatch({});
    expect(result.patch.thinkingPatchExpr).toBeUndefined();
    expect(result.clears).toEqual([]);
  });
});
