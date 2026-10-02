/**
 * 思考字段拼装（thinkingFormat 分派）
 *
 * 从 openai.adapter 抽取的纯函数：把中立档位翻译为各家 wire 字段，
 * 逐行对齐 DSH/pi-ai 的 openai-completions 分派。抽出的目的：
 * 1) 适配器只做「解析依赖 → 合并字段」，拼装规则可独立单测；
 * 2) 「拼法模板」（thinking-patch-templates）用等价性测试锁定——
 *    每个模板表达式在各档位的输出必须与这里的默认 compat 输出逐字段相等。
 *
 * 返回待合并进请求体的字段对象（调用方 Object.assign）。
 */

/** 拼装所需的 compat 视图（ResolvedThinkingCompat 的结构子集） */
export interface ThinkingComposeCompat {
  thinkingFormat: string;
  supportsReasoningEffort: boolean;
  chatTemplateArgs?: Record<string, unknown>;
  chatTemplateKwargs?: Record<string, unknown>;
}

/**
 * 按 thinkingFormat 将中立档位翻译为 wire 字段。
 *
 * @param level 'none'（关闭）| 'on'（legacy 开关档）| 强度档；undefined = 不拼装
 * @param compat 生效 compat（format / 强度门控 / 模板参数）
 * @param mappedValue 档位的映射字符串（thinkingEffortsMap 查表结果，未映射为
 *   undefined——ant-ling 只发映射值）；多数分支回退档位名
 * @param off 菜单含 none 才可关；wire = thinkingEffortsMap.none 的映射值
 */
export function composeThinkingFields(
  level: string | undefined,
  compat: ThinkingComposeCompat,
  mappedValue?: string,
  off?: { supported: boolean; wire?: string },
): Record<string, unknown> {
  if (level === undefined) return {};
  const fields: Record<string, unknown> = {};
  const format = compat.thinkingFormat;
  const supportsEffort = compat.supportsReasoningEffort;
  const isNone = level === 'none';
  const isOn = level === 'on';
  const enable = !isNone; // on（legacy）按"开启"处理
  // 多数 format：未映射时 wire 值 = 档位名（对齐 pi-ai 的 `?? level` 回退）
  const wireValue = mappedValue ?? level;

  // 强度值上 wire 的统一门控：仅真实强度档 + compat 允许
  const sendEffort = (value: string | undefined) => {
    if (!enable || isOn || !supportsEffort) return;
    if (typeof value === 'string' && value) fields.reasoning_effort = value;
  };

  switch (format) {
    case 'zai': {
      // 智谱：只认开关（supportsEffort 默认 false）；clear_thinking=false 保留历史思考
      fields.thinking = enable
        ? { type: 'enabled', clear_thinking: false }
        : { type: 'disabled' };
      sendEffort(wireValue);
      break;
    }
    case 'qwen': {
      // 百炼/硅基/千帆：enable_thinking 布尔承载，强度可选叠加
      fields.enable_thinking = enable;
      sendEffort(wireValue);
      break;
    }
    case 'qwen-chat-template': {
      fields.chat_template_kwargs = {
        enable_thinking: enable,
        preserve_thinking: true,
      };
      break;
    }
    case 'chat-template': {
      // 模板参数完全由 compat.chatTemplateKwargs 声明
      if (compat.chatTemplateKwargs && Object.keys(compat.chatTemplateKwargs).length > 0) {
        fields.chat_template_kwargs = { ...compat.chatTemplateKwargs };
      }
      break;
    }
    case 'baseten': {
      if (compat.chatTemplateArgs && Object.keys(compat.chatTemplateArgs).length > 0) {
        fields.chat_template_args = { ...compat.chatTemplateArgs };
      }
      if (supportsEffort) {
        // 强度档用映射值；关闭用 off 映射（缺省不发）
        const mapped = enable && !isOn ? wireValue : off?.wire;
        if (typeof mapped === 'string' && mapped) {
          fields.reasoning_effort = mapped;
        }
      }
      break;
    }
    case 'deepseek': {
      // 开关 + 强度并存；关闭仅当模型声明可关（菜单含 none）
      if (enable) {
        fields.thinking = { type: 'enabled' };
      } else if (off?.supported) {
        fields.thinking = { type: 'disabled' };
      }
      sendEffort(wireValue);
      break;
    }
    case 'openrouter': {
      // 嵌套 reasoning 对象；关闭也是 effort 值（off 映射，缺省 'none'）
      if (enable) {
        fields.reasoning = { effort: wireValue };
      } else if (off?.supported) {
        fields.reasoning = { effort: off.wire ?? 'none' };
      }
      break;
    }
    case 'ant-ling': {
      // 仅映射过的档位才发（对齐 pi-ai：`map[level]` 是 string 才发）；关闭不发
      if (enable && !isOn && typeof mappedValue === 'string' && mappedValue) {
        fields.reasoning = { effort: mappedValue };
      }
      break;
    }
    case 'together': {
      // 开关嵌套、强度扁平
      fields.reasoning = { enabled: enable };
      sendEffort(wireValue);
      break;
    }
    case 'string-thinking': {
      // thinking 是纯字符串（不是对象）
      if (enable) {
        fields.thinking = wireValue;
      } else if (off?.supported) {
        fields.thinking = off.wire ?? 'none';
      }
      break;
    }
    case 'openai':
    default: {
      // OpenAI 兼容默认：强度直传 reasoning_effort；
      // 关闭 = 参数缺席，除非模型把 none 映射到了具体值（如 'none'）
      if (enable && !isOn && supportsEffort) {
        if (typeof wireValue === 'string' && wireValue) {
          fields.reasoning_effort = wireValue;
        }
      } else if (isNone && typeof off?.wire === 'string' && off.wire) {
        fields.reasoning_effort = off.wire;
      }
      // on / 未知值：不设置，让模型使用默认行为
      break;
    }
  }
  return fields;
}
