/**
 * thinkingFormat wire 断言：11 种 format × 开启/关闭/强度/门控 全量矩阵。
 * 行为逐行对齐 pi-ai openai-completions 的 thinkingFormat 分派。
 */

// 直接实例化适配器，绕过 Nest DI
import { OpenAIAdapter } from '../../src/modules/llm-core/adapters/openai.adapter';
import { OpenAIResponseAdapter } from '../../src/modules/llm-core/adapters/openai-response.adapter';

interface CapabilityStubOptions {
  /** 档位 → wire 字符串映射（真实实现从 store 查表） */
  map?: Record<string, string>;
  /** 档位菜单（决定能不能关：含 none 才可关） */
  menu?: string[];
}

function makeCapabilityStub(options: CapabilityStubOptions = {}) {
  const map = options.map;
  const menu = options.menu ?? ['none', 'low', 'medium', 'high'];
  return {
    resolveThinkingWireValue: (
      _pid: string | undefined,
      _model: string | undefined,
      level: string | undefined,
    ) => {
      if (!level || level === 'none' || level === 'on') return undefined;
      return map?.[level];
    },
    resolveThinkingOff: () => {
      const wire = typeof map?.['none'] === 'string' ? map['none'] : undefined;
      return { supported: menu.includes('none'), wire };
    },
  } as any;
}

interface BuildOptions {
  level: string | undefined;
  format?: string;
  supportsReasoningEffort?: boolean;
  chatTemplateKwargs?: Record<string, unknown>;
  chatTemplateArgs?: Record<string, unknown>;
  capability?: ReturnType<typeof makeCapabilityStub>;
}

function buildParams(options: BuildOptions): any {
  const capability =
    options.capability ??
    makeCapabilityStub({ map: { high: 'high' }, menu: ['none', 'high'] });
  const adapter = new OpenAIAdapter(capability);
  const req = (adapter as any).buildRequestParam({
    model: 'm',
    messages: [],
    stream: false,
    thinkingEffort: options.level,
    providerConfig: {
      compat: {
        ...(options.format ? { thinkingFormat: options.format } : {}),
        ...(options.supportsReasoningEffort !== undefined
          ? { supportsReasoningEffort: options.supportsReasoningEffort }
          : {}),
        ...(options.chatTemplateKwargs ? { chatTemplateKwargs: options.chatTemplateKwargs } : {}),
        ...(options.chatTemplateArgs ? { chatTemplateArgs: options.chatTemplateArgs } : {}),
      },
    },
  });
  // 只返回 thinking 相关字段，断言更聚焦
  const {
    reasoning_effort,
    reasoning,
    thinking,
    enable_thinking,
    chat_template_kwargs,
    chat_template_args,
  } = req;
  return {
    reasoning_effort,
    reasoning,
    thinking,
    enable_thinking,
    chat_template_kwargs,
    chat_template_args,
  };
}

describe('openai adapter thinkingFormat → wire 矩阵', () => {
  describe('openai（默认）', () => {
    it('强度档直传 reasoning_effort', () => {
      expect(buildParams({ level: 'high' }).reasoning_effort).toBe('high');
      expect(buildParams({ level: 'minimal' }).reasoning_effort).toBe('minimal');
    });
    it('关闭：菜单含 none 但无映射 → 不发任何字段（参数缺席即关闭）', () => {
      const p = buildParams({ level: 'none' });
      expect(p.reasoning_effort).toBeUndefined();
      expect(p.thinking).toBeUndefined();
    });
    it('关闭：map 把 none 映射到值（如 OpenAI gpt-5.1 的 none）→ 发该值', () => {
      const cap = makeCapabilityStub({ map: { none: 'none' }, menu: ['none', 'high'] });
      const p = buildParams({ level: 'none', capability: cap });
      expect(p.reasoning_effort).toBe('none');
    });
    it('supportsReasoningEffort=false → 强度值不上 wire', () => {
      const p = buildParams({ level: 'high', supportsReasoningEffort: false });
      expect(p.reasoning_effort).toBeUndefined();
    });
    it('legacy on → 不发任何思考字段', () => {
      const p = buildParams({ level: 'on' });
      expect(p.reasoning_effort).toBeUndefined();
      expect(p.thinking).toBeUndefined();
    });
    it('通用兜底菜单（6 档 + none→"none"）→ 关闭按官方档位值发出', () => {
      // 场景：自定义供应商（无 compat）+ 型号名不匹配任何 preset
      // → 菜单 = OpenAI 官方 6 档，关闭 = reasoning_effort:"none"（而非参数缺席）
      const cap = makeCapabilityStub({
        map: { none: 'none' },
        menu: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
      });
      expect(buildParams({ level: 'none', capability: cap }).reasoning_effort).toBe('none');
      expect(buildParams({ level: 'high', capability: cap }).reasoning_effort).toBe('high');
      expect(buildParams({ level: 'xhigh', capability: cap }).reasoning_effort).toBe('xhigh');
      expect(buildParams({ level: 'max', capability: cap }).reasoning_effort).toBe('max');
    });
  });

  describe('deepseek（开关 + 强度并存）', () => {
    it('强度档 → thinking:{type:enabled} + reasoning_effort', () => {
      const p = buildParams({ level: 'high', format: 'deepseek' });
      expect(p.thinking).toEqual({ type: 'enabled' });
      expect(p.reasoning_effort).toBe('high');
    });
    it('关闭且可关 → thinking:{type:disabled}', () => {
      const p = buildParams({ level: 'none', format: 'deepseek' });
      expect(p.thinking).toEqual({ type: 'disabled' });
      expect(p.reasoning_effort).toBeUndefined();
    });
    it('关闭但菜单不含 none（不可关，如 kimi-k2.7-code off:null）→ 不发 disabled', () => {
      const cap = makeCapabilityStub({ menu: ['low', 'high'] });
      const p = buildParams({ level: 'high', format: 'deepseek', capability: cap });
      expect(p.thinking).toEqual({ type: 'enabled' });
    });
    it('supportsReasoningEffort=false → 只发开关', () => {
      const p = buildParams({ level: 'high', format: 'deepseek', supportsReasoningEffort: false });
      expect(p.thinking).toEqual({ type: 'enabled' });
      expect(p.reasoning_effort).toBeUndefined();
    });
    it('legacy on → thinking enabled，不发强度', () => {
      const p = buildParams({ level: 'on', format: 'deepseek' });
      expect(p.thinking).toEqual({ type: 'enabled' });
      expect(p.reasoning_effort).toBeUndefined();
    });
  });

  describe('zai（智谱：只认开关 + clear_thinking）', () => {
    it('开启 → thinking:{type:enabled, clear_thinking:false}，默认不发强度', () => {
      const p = buildParams({ level: 'high', format: 'zai' });
      expect(p.thinking).toEqual({ type: 'enabled', clear_thinking: false });
      expect(p.reasoning_effort).toBeUndefined();
    });
    it('显式 supportsReasoningEffort=true → 附 reasoning_effort', () => {
      const p = buildParams({ level: 'high', format: 'zai', supportsReasoningEffort: true });
      expect(p.reasoning_effort).toBe('high');
    });
    it('关闭 → thinking:{type:disabled}（无条件）', () => {
      const p = buildParams({ level: 'none', format: 'zai' });
      expect(p.thinking).toEqual({ type: 'disabled' });
    });
  });

  describe('qwen（布尔开关，强度可叠加）', () => {
    it('开启 → enable_thinking:true + reasoning_effort', () => {
      const p = buildParams({ level: 'high', format: 'qwen' });
      expect(p.enable_thinking).toBe(true);
      expect(p.reasoning_effort).toBe('high');
    });
    it('supportsReasoningEffort=false → 只发布尔（DSH 阿里云 deepseek-v3.2/kimi-k2.5 形态）', () => {
      const p = buildParams({ level: 'high', format: 'qwen', supportsReasoningEffort: false });
      expect(p.enable_thinking).toBe(true);
      expect(p.reasoning_effort).toBeUndefined();
    });
    it('关闭 → enable_thinking:false', () => {
      const p = buildParams({ level: 'none', format: 'qwen' });
      expect(p.enable_thinking).toBe(false);
    });
  });

  describe('together（开关嵌套、强度扁平）', () => {
    it('开启 → reasoning:{enabled:true}，默认不发强度', () => {
      const p = buildParams({ level: 'high', format: 'together' });
      expect(p.reasoning).toEqual({ enabled: true });
      expect(p.reasoning_effort).toBeUndefined();
    });
    it('显式 supportsEffort → 附扁平 reasoning_effort', () => {
      const p = buildParams({ level: 'high', format: 'together', supportsReasoningEffort: true });
      expect(p.reasoning_effort).toBe('high');
    });
    it('关闭 → reasoning:{enabled:false}', () => {
      expect(buildParams({ level: 'none', format: 'together' }).reasoning).toEqual({
        enabled: false,
      });
    });
  });

  describe('openrouter（嵌套 effort，关闭也是 effort 值）', () => {
    it('强度档 → reasoning:{effort}', () => {
      expect(buildParams({ level: 'high', format: 'openrouter' }).reasoning).toEqual({
        effort: 'high',
      });
    });
    it('关闭且可关 → reasoning:{effort: off映射 ?? none}', () => {
      expect(buildParams({ level: 'none', format: 'openrouter' }).reasoning).toEqual({
        effort: 'none',
      });
      const cap = makeCapabilityStub({ map: { none: 'off' }, menu: ['none', 'high'] });
      expect(
        buildParams({ level: 'none', format: 'openrouter', capability: cap }).reasoning,
      ).toEqual({ effort: 'off' });
    });
    it('关闭但不可关 → 不发', () => {
      const cap = makeCapabilityStub({ menu: ['low', 'high'] });
      const p = buildParams({ level: 'high', format: 'openrouter', capability: cap });
      expect(p.reasoning).toEqual({ effort: 'high' });
    });
  });

  describe('ant-ling（仅映射值才发）', () => {
    it('有映射 → reasoning:{effort: 映射值}', () => {
      const cap = makeCapabilityStub({ map: { high: 'high' }, menu: ['none', 'high'] });
      expect(buildParams({ level: 'high', format: 'ant-ling', capability: cap }).reasoning).toEqual({
        effort: 'high',
      });
    });
    it('无映射 → 不发（对齐 pi-ai：`map[level]` 是 string 才发）', () => {
      const cap = makeCapabilityStub({ menu: ['none', 'high'] });
      const p = buildParams({ level: 'high', format: 'ant-ling', capability: cap });
      expect(p.reasoning).toBeUndefined();
    });
    it('关闭不发', () => {
      const p = buildParams({ level: 'none', format: 'ant-ling' });
      expect(p.reasoning).toBeUndefined();
    });
  });

  describe('string-thinking（thinking 是字符串）', () => {
    it('强度档 → thinking:"<映射值/档位名>"', () => {
      const p = buildParams({ level: 'high', format: 'string-thinking' });
      expect(p.thinking).toBe('high');
    });
    it('关闭且可关 → thinking:"<off映射 ?? none>"', () => {
      expect(buildParams({ level: 'none', format: 'string-thinking' }).thinking).toBe('none');
      const cap = makeCapabilityStub({ map: { none: 'off' }, menu: ['none', 'high'] });
      expect(buildParams({ level: 'none', format: 'string-thinking', capability: cap }).thinking).toBe(
        'off',
      );
    });
  });

  describe('baseten（模板参数 + effort）', () => {
    it('chat_template_args 原样写入 + 强度 reasoning_effort', () => {
      const p = buildParams({
        level: 'high',
        format: 'baseten',
        chatTemplateArgs: { thinking: { type: 'on' } },
      });
      expect(p.chat_template_args).toEqual({ thinking: { type: 'on' } });
      expect(p.reasoning_effort).toBe('high');
    });
    it('关闭 → effort 用 off 映射（缺省不发）', () => {
      const cap = makeCapabilityStub({ map: { none: 'off' }, menu: ['none', 'high'] });
      const p = buildParams({
        level: 'none',
        format: 'baseten',
        capability: cap,
      });
      expect(p.reasoning_effort).toBe('off');
      expect(buildParams({ level: 'none', format: 'baseten' }).reasoning_effort).toBeUndefined();
    });
  });

  describe('qwen-chat-template / chat-template（模板参数承载开关）', () => {
    it('qwen-chat-template 开启 → kwargs enable_thinking+preserve_thinking', () => {
      expect(buildParams({ level: 'high', format: 'qwen-chat-template' }).chat_template_kwargs).toEqual({
        enable_thinking: true,
        preserve_thinking: true,
      });
    });
    it('qwen-chat-template 关闭 → enable_thinking:false', () => {
      expect(buildParams({ level: 'none', format: 'qwen-chat-template' }).chat_template_kwargs).toEqual({
        enable_thinking: false,
        preserve_thinking: true,
      });
    });
    it('chat-template → kwargs 取 compat 声明值', () => {
      const p = buildParams({
        level: 'high',
        format: 'chat-template',
        chatTemplateKwargs: { enable_thinking: true },
      });
      expect(p.chat_template_kwargs).toEqual({ enable_thinking: true });
    });
  });

  describe('OpenAI Responses 侧（无 format，off 也是 effort 值）', () => {
    function buildResponseParams(
      level: string | undefined,
      extra?: { map?: Record<string, string>; menu?: string[]; includeEncrypted?: boolean },
    ): any {
      const adapter = new OpenAIResponseAdapter(makeCapabilityStub(extra));
      const req = (adapter as any).buildRequestParam({
        model: 'm',
        messages: [],
        stream: false,
        thinkingEffort: level,
        providerConfig: {
          compat: extra?.includeEncrypted ? { includeEncryptedReasoning: true } : {},
        },
      });
      return req;
    }

    it('强度档 → reasoning:{effort}', () => {
      expect(buildResponseParams('high').reasoning).toEqual({ effort: 'high' });
    });
    it('关闭且可关 → reasoning:{effort: none}（DSH Responses 无独立开关）', () => {
      expect(buildResponseParams('none').reasoning).toEqual({ effort: 'none' });
    });
    it('关闭但不可关 → 不发', () => {
      const p = buildResponseParams('high', { menu: ['low', 'high'] });
      expect(p.reasoning).toEqual({ effort: 'high' });
    });
    it('includeEncryptedReasoning=true → include 加密推理内容', () => {
      expect(buildResponseParams('high', { includeEncrypted: true }).include).toEqual([
        'reasoning.encrypted_content',
      ]);
      expect(buildResponseParams('high').include).toBeUndefined();
    });
  });
});
