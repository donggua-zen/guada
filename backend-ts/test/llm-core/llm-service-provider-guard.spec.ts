/**
 * LLMService 供应商配置守卫（单一数据源契约）
 *
 * providerConfig 的供应商身份字段是 `type`（文件形态的 `type`）。
 * 历史字段名 `provider` 由 DB 行提供，文件来源为空 → 曾导致标题生成、
 * 图片识别、bot 主循环在 LLMService 入口直接抛错。
 */
import { LLMService } from '../../src/modules/llm-core/llm.service';
import { AdapterRegistry } from '../../src/modules/llm-core/adapter-registry.service';
import { ProtocolDisabledError, UnsupportedProtocolError } from '../../src/modules/llm-core/provider-errors';
import { OpenAIAdapter } from '../../src/modules/llm-core/adapters/openai.adapter';
import { OpenAIResponseAdapter } from '../../src/modules/llm-core/adapters/openai-response.adapter';
import { AnthropicAdapter } from '../../src/modules/llm-core/adapters/anthropic.adapter';
import { GeminiAdapter } from '../../src/modules/llm-core/adapters/gemini.adapter';
import { MockAdapter } from '../../src/modules/llm-core/adapters/mock.adapter';

/// <reference types="jest" />

function makeService(): LLMService {
  const capability = {
    resolveThinkingWireValue: () => undefined,
    resolveThinkingEffort: (_p: any, _m: any, effort: any) => effort,
  } as any;
  const registry = new AdapterRegistry();
  registry.registerBuiltin(new OpenAIAdapter(capability));
  registry.registerBuiltin(new OpenAIResponseAdapter(capability));
  registry.registerBuiltin(new AnthropicAdapter());
  registry.registerBuiltin(new GeminiAdapter());
  registry.registerBuiltin(new MockAdapter());
  const settings = { getSettingValue: jest.fn(async () => null) } as any;
  // 本套件只验证 providerConfig 守卫：usage 观测替身即可（守卫在写 usage 之前抛错）
  const usage = {
    resolveSource: jest.fn(() => 'other'),
    recordSafely: jest.fn(),
  } as any;
  return new LLMService(registry, settings, capability, usage);
}

describe('LLMService 供应商配置守卫', () => {
  it('缺 type → 明确报错（不会走到适配器选择）', async () => {
    const service = makeService();
    await expect(
      service.completions({
        model: 'm1',
        messages: [],
        providerConfig: { protocol: 'openai' },
      } as any),
    ).rejects.toThrow(/Provider type is required/);
  });

  it('有 type 时越过守卫，未注册协议给出协议级错误', async () => {
    const service = makeService();
    await expect(
      service.completions({
        model: 'm1',
        messages: [],
        providerConfig: { id: 'inst1', type: 'custom', protocol: 'no-such-protocol' },
      } as any),
    ).rejects.toThrow(UnsupportedProtocolError);
  });

  it('插件协议被禁用 → 明确报 PROTOCOL_DISABLED（不是未注册）', async () => {
    const capability = {
      resolveThinkingWireValue: () => undefined,
      resolveThinkingEffort: (_p: any, _m: any, effort: any) => effort,
    } as any;
    const registry = new AdapterRegistry();
    registry.registerBuiltin(new OpenAIAdapter(capability));
    registry.registerPluginAdapters('provider-acme', [
      { protocol: 'acme-wire', chatCompletion: async () => [] } as any,
    ]);
    registry.setPluginActive('provider-acme', false);

    const settings = { getSettingValue: jest.fn(async () => null) } as any;
    const usage = { resolveSource: jest.fn(() => 'other'), recordSafely: jest.fn() } as any;
    const service = new LLMService(registry, settings, capability, usage);

    await expect(
      service.completions({
        model: 'm1',
        messages: [],
        providerConfig: { id: 'inst1', type: 'custom', protocol: 'acme-wire' },
      } as any),
    ).rejects.toThrow(ProtocolDisabledError);
  });
});
