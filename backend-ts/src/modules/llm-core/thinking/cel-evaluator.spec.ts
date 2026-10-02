import {
  PATCH_EXPR_MAX_LENGTH,
  buildPatchExprContext,
  evaluatePatchExpr,
  validatePatchExpr,
} from './cel-evaluator';

/**
 * CEL 拼法表达式求值器测试。
 *
 * 关注三件事：求值结果的形状契约（必须是 JSON 对象，可直接进 merge patch）、
 * 失败时的诊断质量（消息 + range，供编辑器与保存校验使用）、上下文语义
 * （wireValue / mappedWire / offWire 在四个档位族的取值规则）。
 */
describe('CEL 拼法表达式求值器', () => {
  it('求值返回普通对象，支持混合类型映射（字符串 + 嵌套对象）', () => {
    const result = evaluatePatchExpr(
      'off ? {} : {"reasoning_effort": wireValue, "thinking": {"type": "enabled"}}',
      buildPatchExprContext('high'),
    );
    expect(result).toEqual({
      reasoning_effort: 'high',
      thinking: { type: 'enabled' },
    });
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
  });

  it('空对象与三元分支都可用（模板的常见形状）', () => {
    expect(
      evaluatePatchExpr('off ? {} : {"a": wireValue}', buildPatchExprContext('none')),
    ).toEqual({});
    expect(
      evaluatePatchExpr('off ? {} : {"a": wireValue}', buildPatchExprContext('low')),
    ).toEqual({ a: 'low' });
  });

  it('CEL int（BigInt）归一化为 JSON 数字，深层嵌套同样处理', () => {
    expect(
      evaluatePatchExpr(
        '{"thinking_budget": 8192, "nested": {"max": 4096}}',
        buildPatchExprContext('high'),
      ),
    ).toEqual({ thinking_budget: 8192, nested: { max: 4096 } });
  });

  it('非对象返回值被拒绝（merge patch 只接受对象）', () => {
    expect(() => evaluatePatchExpr('"str"', buildPatchExprContext('high'))).toThrow(
      /必须返回 JSON 对象/,
    );
    expect(() => evaluatePatchExpr('[1, 2]', buildPatchExprContext('high'))).toThrow(
      /必须返回 JSON 对象/,
    );
    expect(() => evaluatePatchExpr('null', buildPatchExprContext('high'))).toThrow(
      /必须返回 JSON 对象/,
    );
  });

  it('语法错误 / 未知变量 / 类型不匹配 → 抛错且诊断可读', () => {
    expect(() => evaluatePatchExpr('foo ===', buildPatchExprContext('high'))).toThrow();
    expect(() =>
      evaluatePatchExpr('unknownVar + 1', buildPatchExprContext('high')),
    ).toThrow(/Unknown variable/);
    expect(() =>
      evaluatePatchExpr('reasoningLevel == 1', buildPatchExprContext('high')),
    ).toThrow(/no such overload|overload/i);
  });

  it('validatePatchExpr：合法表达式返回 null，非法表达式返回带定位的诊断', () => {
    expect(
      validatePatchExpr('off ? {} : {"reasoning_effort": wireValue}'),
    ).toBeNull();
    expect(validatePatchExpr('off ? {} : {"reasoning_effort": wireValue}')).toBeNull();

    const diag = validatePatchExpr('{"a": }');
    expect(diag).not.toBeNull();
    expect(diag!.message.length).toBeGreaterThan(0);

    const unknownVar = validatePatchExpr('{"a": typoVar}');
    expect(unknownVar).not.toBeNull();
    expect(unknownVar!.message).toMatch(/Unknown variable/);

    const nonObject = validatePatchExpr('"just a string"');
    expect(nonObject).not.toBeNull();
    expect(nonObject!.message).toMatch(/必须返回 JSON 对象/);
  });

  it('超长表达式被拒绝', () => {
    const long = `{"a": "${'x'.repeat(PATCH_EXPR_MAX_LENGTH)}"}`;
    expect(() => evaluatePatchExpr(long, buildPatchExprContext('high'))).toThrow(
      /过长/,
    );
  });

  it('上下文语义：wireValue / mappedWire / offWire 按档位族取值', () => {
    // 强度档：未映射 → wire 值回退档位名，mappedWire 为空
    expect(buildPatchExprContext('high')).toMatchObject({
      reasoningLevel: 'high',
      wireValue: 'high',
      mappedWire: '',
      offWire: '',
      off: false,
      on: false,
    });
    // 强度档：已映射 → wire 值 = 映射值
    expect(
      buildPatchExprContext('high', { mappedValue: 'H' }),
    ).toMatchObject({ wireValue: 'H', mappedWire: 'H' });
    // none：wire 值 = none 映射值（缺省为空），mappedWire 同源
    expect(buildPatchExprContext('none')).toMatchObject({
      wireValue: '',
      mappedWire: '',
      off: true,
    });
    expect(buildPatchExprContext('none', { offWire: 'minimal' })).toMatchObject({
      wireValue: 'minimal',
      mappedWire: 'minimal',
      offWire: 'minimal',
    });
    // on：wire 值锁定 'on'（映射表不允许 on 键）
    expect(buildPatchExprContext('on', { mappedValue: 'ignored' })).toMatchObject({
      wireValue: 'on',
      mappedWire: '',
      on: true,
    });
  });
});
