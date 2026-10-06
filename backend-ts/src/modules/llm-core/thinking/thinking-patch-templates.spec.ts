import {
  buildPatchExprContext,
  evaluatePatchExpr,
} from './cel-evaluator';
import { composeThinkingFields } from './thinking-format-compose';
import {
  TEMPLATE_FORMATS,
  THINKING_PATCH_TEMPLATES,
} from './thinking-patch-templates';
import {
  THINKING_EFFORTS,
  THINKING_FORMATS,
  defaultSupportsReasoningEffort,
} from './thinking-vocabulary';

/**
 * 拼法模板等价性矩阵。
 *
 * 「请求拼法」从内置分派（composeThinkingFields）迁移到用户可编辑的 CEL 表达式，
 * 模板是迁移的桥：模板表达式在默认 compat 下必须与内置分派逐字段等价，
 * 否则「选模板」后的行为会与「跟随继承」不一致。改内置分派必须同步模板，
 * 本测试即漂移门控。
 */

/** 全映射上下文：每档都有显式映射值（覆盖 mappedWire 分支） */
const MAPPED: Record<string, string> = {
  none: 'minimal',
  minimal: 'm_min',
  low: 'm_low',
  medium: 'm_med',
  high: 'm_high',
  xhigh: 'm_xhigh',
  max: 'm_max',
};

describe('拼法模板等价性', () => {
  it('模板覆盖全部内置拼法（增删 format 必须同步模板）', () => {
    expect([...TEMPLATE_FORMATS].sort()).toEqual([...THINKING_FORMATS].sort());
  });

  it('模板在全部档位 × 映射/未映射下与内置拼装逐字段相等', () => {
    const failures: string[] = [];
    for (const template of THINKING_PATCH_TEMPLATES) {
      // chat-template 的参数完全由 compat.chatTemplateKwargs 声明，表达式
      // 无法静态复刻（模板仅为示例），不参与等价矩阵
      if (template.format === 'chat-template') continue;
      const compat = {
        thinkingFormat: template.format,
        supportsReasoningEffort: defaultSupportsReasoningEffort(template.format),
      };
      for (const level of THINKING_EFFORTS) {
        for (const mapped of [false, true]) {
          const mappedValue = mapped ? MAPPED[level] : undefined;
          const offWire = mapped ? MAPPED.none : undefined;
          const expected = composeThinkingFields(level, compat, mappedValue, {
            supported: true,
            wire: offWire,
          });
          const actual = evaluatePatchExpr(
            template.expression,
            buildPatchExprContext(level, { mappedValue, offWire }),
          );
          if (JSON.stringify(expected) !== JSON.stringify(actual)) {
            failures.push(
              `${template.format} / ${level} / ${mapped ? 'mapped' : 'plain'}\n` +
                `  compose:  ${JSON.stringify(expected)}\n` +
                `  template: ${JSON.stringify(actual)}`,
            );
          }
        }
      }
    }
    expect(failures).toEqual([]);
  });
});
