/**
 * 档位选择策略（菜单 → 生效档位）
 *
 * 单一实现，两处消费者共用，避免"校验用一个规则、会话判定用另一个规则"的分叉：
 * - `ModelCapabilityService`（请求前校验，抛错）
 * - `JsonlSessionContext`（决定是否回传 reasoning 的 thinkingMode）
 *
 * 语义（对齐 DSH：不支持的显式选择一律报错，不做 alias；仅"存量设置与当前模型
 * 不匹配"这种非用户当下的选择才静默调整）：
 * - `undefined` 请求 / 能力未知（菜单 undefined）→ 原样透传
 * - 菜单无非 off 档（不能思考）却请求非 none → `unsupported`（调用方决定抛错）
 * - 请求档位不在菜单 → 调整：`none` 取首个非 off 档，其余取中位档
 * - 请求档位在菜单 → 原样
 */
import type { ThinkingEffort } from './thinking-vocabulary';

/** 解析结果：要么给出最终档位，要么标记为"模型不支持所请求的档位" */
export type ThinkingEffortResolution =
  | { effort: string | undefined; unsupported?: false }
  | { effort: undefined; unsupported: true };

/**
 * @param menu      模型已解析的档位菜单（undefined = 能力未知，不校验）
 * @param requested 调用方请求的档位
 */
export function clampThinkingEffort(
  menu: readonly ThinkingEffort[] | undefined,
  requested: string | undefined,
): ThinkingEffortResolution {
  if (requested === undefined || menu === undefined) {
    return { effort: requested };
  }

  const nonOff = menu.filter((e) => e !== 'none');
  if (nonOff.length === 0) {
    // 不能思考：只有 none 合法
    if (requested !== 'none') return { effort: undefined, unsupported: true };
    return { effort: requested };
  }

  if (menu.includes(requested as ThinkingEffort)) {
    return { effort: requested };
  }

  // 档位不受支持（含 none 不被支持）：调整到合法档
  return {
    effort:
      requested === 'none' ? nonOff[0] : nonOff[Math.floor(nonOff.length / 2)],
  };
}

/**
 * 菜单的默认档位（会话从未显式选过档位时的取值）
 *
 * 取非关闭档的中位数（向下取整），即"中等强度"——格式能发强度值时等价于
 * "默认开启思考"，而不是默认关闭。菜单只有 none / 空菜单（不能思考）→ none。
 *
 * 与 clampThinkingEffort 同处一份实现：后端会话侧与前端初始值都按这个规则，
 * 避免"UI 显示关闭、实际发了强度值"这类分叉。
 */
export function defaultThinkingEffort(
  menu: readonly ThinkingEffort[] | undefined,
): ThinkingEffort {
  if (!menu || menu.length === 0) return 'none';
  const nonOff = menu.filter((e) => e !== 'none');
  if (nonOff.length === 0) return 'none';
  return nonOff[Math.floor((nonOff.length - 1) / 2)];
}
