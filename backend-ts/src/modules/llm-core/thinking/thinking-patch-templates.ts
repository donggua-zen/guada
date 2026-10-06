/**
 * 拼法模板：thinkingFormat → 等价 CEL 表达式
 *
 * 模板是「请求拼法」表达式的起点：前端选模板即把表达式回填编辑器，用户可再
 * 自定义。每个模板在默认 compat 下必须与内置拼装（composeThinkingFields）
 * 逐字段等价——由 thinking-patch-templates.spec.ts 的矩阵测试锁定：
 * 改内置分派必须同步模板，否则测试失败。
 *
 * 概念边界（与前端对齐）：「请求拼法」= 内置表达式 + 特殊配置集合，仅供
 * 自动识别 / 内置供应商链路使用；用户在模型上手动配置表达式后，请求完全
 * 使用该表达式。模板下拉只展示 curated 3 条（覆盖主流场景），其余 6 条
 * 仅为等价性测试与「填入等价表达式」桥接保留。
 *
 * 变量（求值上下文见 cel-evaluator.ts）：
 *   reasoningLevel  当前档位 none/on/minimal/low/medium/high/xhigh/max
 *   wireValue       该档 wire 值（强度档=映射值??档位名；none=映射值??""；on="on"）
 *   mappedWire      该档显式映射值（未映射 ""；none 档即 offWire）
 *   offWire         none 档映射值（与档位无关，始终可见）
 *   off / on        布尔快捷（== none / == on）
 *
 * chat-template / baseten 的模板参数（chatTemplateKwargs/Args）完全由 compat
 * 声明，表达式无法静态复刻——标注 requiresCustomization，模板仅给等效示例。
 */
import { ThinkingFormat, THINKING_FORMATS } from './thinking-vocabulary';

export interface ThinkingPatchTemplate {
  format: ThinkingFormat;
  expression: string;
  /** true = 模板下拉展示的预制项（覆盖主流场景的 3 条） */
  curated?: boolean;
  /** true = 依赖 compat 字段（chatTemplateArgs/Kwargs），选模板后需自行补全 */
  requiresCustomization?: boolean;
}

/** 表达式可用的上下文变量（前端编辑器提示用；语义见本文件头） */
export const PATCH_EXPR_VARIABLES: ReadonlyArray<{ name: string; type: string }> = [
  { name: 'reasoningLevel', type: 'string' },
  { name: 'wireValue', type: 'string' },
  { name: 'mappedWire', type: 'string' },
  { name: 'offWire', type: 'string' },
  { name: 'off', type: 'bool' },
  { name: 'on', type: 'bool' },
];

export const THINKING_PATCH_TEMPLATES: ThinkingPatchTemplate[] = [
  {
    format: 'openai',
    // 强度直传 reasoning_effort；关闭 = 参数缺席（除非 none 映射了具体值）
    expression:
      'off ? (wireValue == "" ? {} : {"reasoning_effort": wireValue}) : (on ? {} : {"reasoning_effort": wireValue})',
    curated: true,
  },
  {
    format: 'deepseek',
    // 开关 + 强度并存：enabled/disabled 承载开关，强度档叠加 reasoning_effort
    expression:
      'off ? {"thinking": {"type": "disabled"}} : (on ? {"thinking": {"type": "enabled"}} : {"thinking": {"type": "enabled"}, "reasoning_effort": wireValue})',
    curated: true,
  },
  {
    format: 'zai',
    // 只认开关（强度不上 wire）；clear_thinking=false 保留历史思考
    expression:
      'off ? {"thinking": {"type": "disabled"}} : {"thinking": {"type": "enabled", "clear_thinking": false}}',
  },
  {
    format: 'qwen',
    // enable_thinking 布尔承载，强度可选叠加
    expression:
      'off ? {"enable_thinking": false} : (on ? {"enable_thinking": true} : {"enable_thinking": true, "reasoning_effort": wireValue})',
    curated: true,
  },
  {
    format: 'qwen-chat-template',
    expression:
      '{"chat_template_kwargs": {"enable_thinking": !off, "preserve_thinking": true}}',
  },
  {
    format: 'chat-template',
    // 参数完全由 compat.chatTemplateKwargs 声明；此模板仅为示例
    expression: '{"chat_template_kwargs": {"enable_thinking": !off}}',
    requiresCustomization: true,
  },
  {
    format: 'openrouter',
    // 嵌套 reasoning 对象；关闭也是 effort 值（off 映射，缺省 'none'）
    expression:
      '{"reasoning": {"effort": off ? (wireValue == "" ? "none" : wireValue) : wireValue}}',
  },
  {
    format: 'together',
    // 开关嵌套；强度不上 wire
    expression: '{"reasoning": {"enabled": !off}}',
  },
  {
    format: 'ant-ling',
    // 仅显式映射过的强度档才发；关闭/开关档不发
    expression: '(off || on || mappedWire == "") ? {} : {"reasoning": {"effort": mappedWire}}',
  },
  {
    format: 'baseten',
    // 强度档发映射值；关闭/开关档用 off 映射（缺省不发）；chat_template_args 需自行补
    expression:
      '(off || on) ? (offWire == "" ? {} : {"reasoning_effort": offWire}) : {"reasoning_effort": wireValue}',
    requiresCustomization: true,
  },
  {
    format: 'string-thinking',
    // thinking 是纯字符串（不是对象）；强度档发档位 wire 值
    expression:
      'off ? (wireValue == "" ? {"thinking": "none"} : {"thinking": wireValue}) : {"thinking": wireValue}',
  },
];

/** 模板覆盖全部内置拼法（漂移门控；THINKING_FORMATS 增删时测试会失败） */
export const TEMPLATE_FORMATS: ThinkingFormat[] = THINKING_PATCH_TEMPLATES.map(
  (t) => t.format,
);
