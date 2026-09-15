/**
 * 适配器的 Nest DI 装配回归测试。
 *
 * 背景：`OpenAIAdapter` / `OpenAIResponseAdapter` 声明了构造依赖
 * （`constructor(private readonly capability: ModelCapabilityService)`），
 * 但类上漏了 `@Injectable()`。`emitDecoratorMetadata` 只在类上存在装饰器时
 * 才产出 `design:paramtypes`，因此 Nest 以「零参数」构造实例，
 * `this.capability === undefined`，请求时才炸
 * （`Cannot read properties of undefined (reading 'resolveThinkingWireValue')`）。
 *
 * 这类缺陷编译期不报错、启动期也不报错，只在业务请求上失败。
 * `test/llm-core/` 下其它测试都是手工 `new OpenAIAdapter(capability)`，
 * **绕过 Nest DI**，所以对缺陷完全不可见——本文件专门走容器解析来堵这个盲区。
 *
 * 注意：断言不能只查 `(adapter as any).capability` 这个字段（实现细节、
 * 且将来换注入方式就失效），必须同时验证「依赖真的被用上了」的行为效果。
 */
import { Test, TestingModule } from '@nestjs/testing';
import { OpenAIAdapter } from '../../src/modules/llm-core/adapters/openai.adapter';
import { OpenAIResponseAdapter } from '../../src/modules/llm-core/adapters/openai-response.adapter';
import { AnthropicAdapter } from '../../src/modules/llm-core/adapters/anthropic.adapter';
import { GeminiAdapter } from '../../src/modules/llm-core/adapters/gemini.adapter';
import { MockAdapter } from '../../src/modules/llm-core/adapters/mock.adapter';
import { ModelCapabilityService } from '../../src/modules/llm-core/model-capability.service';

/** 档位映射 stub：high → 'HIGH_WIRE'，用于证明注入的依赖真的参与了拼参 */
function makeCapabilityStub() {
  return {
    resolveThinkingWireValue: jest.fn(
      (_pid: string | undefined, _model: string | undefined, level: string | undefined) =>
        level === 'high' ? 'HIGH_WIRE' : undefined,
    ),
    resolveThinkingOff: jest.fn(() => ({ supported: true, wire: undefined })),
  };
}

describe('LLM 适配器的 Nest DI 装配', () => {
  let capability: ReturnType<typeof makeCapabilityStub>;

  beforeEach(() => {
    capability = makeCapabilityStub();
  });

  async function resolve<T>(provider: any): Promise<T> {
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [provider, { provide: ModelCapabilityService, useValue: capability }],
    }).compile();
    return moduleRef.get<T>(provider);
  }

  // 5 个适配器都是 providers.module.ts 里的 class-shorthand provider，
  // 逐个过容器解析：漏装饰器 / 构造参数解析不到都会在这里失败。
  it.each([
    ['OpenAIAdapter', OpenAIAdapter],
    ['OpenAIResponseAdapter', OpenAIResponseAdapter],
    ['AnthropicAdapter', AnthropicAdapter],
    ['GeminiAdapter', GeminiAdapter],
    ['MockAdapter', MockAdapter],
  ])('%s 能被 Nest 容器解析出来', async (_name, provider) => {
    const adapter = await resolve(provider);
    expect(adapter).toBeInstanceOf(provider as any);
  });

  it('OpenAIAdapter 的构造依赖被真正注入（非 undefined）', async () => {
    const adapter = await resolve<OpenAIAdapter>(OpenAIAdapter);
    // 这是缺陷的直接表征：漏 @Injectable() 时该字段为 undefined
    expect((adapter as any).capability).toBe(capability);
  });

  it('OpenAIAdapter 用注入的依赖完成档位→wire 映射（行为级）', async () => {
    const adapter = await resolve<OpenAIAdapter>(OpenAIAdapter);
    const requestParams = (adapter as any).buildRequestParam({
      model: 'm',
      messages: [],
      stream: false,
      thinkingEffort: 'high',
      providerConfig: { compat: { thinkingFormat: 'openai', supportsReasoningEffort: true } },
    });

    // 依赖被查询过，且映射值真的落到了 wire 上
    expect(capability.resolveThinkingWireValue).toHaveBeenCalled();
    expect(requestParams.reasoning_effort).toBe('HIGH_WIRE');
  });

  it('OpenAIResponseAdapter 用注入的依赖完成档位→wire 映射（行为级）', async () => {
    const adapter = await resolve<OpenAIResponseAdapter>(OpenAIResponseAdapter);
    const requestParams = (adapter as any).buildRequestParam({
      model: 'm',
      messages: [],
      stream: false,
      thinkingEffort: 'high',
      providerConfig: { compat: { supportsReasoningEffort: true } },
    });

    expect(capability.resolveThinkingWireValue).toHaveBeenCalled();
    expect(requestParams.reasoning?.effort).toBe('HIGH_WIRE');
  });

  it('容器解析出的实例不共享手工构造的依赖（防回归：确认走的是 DI 路径）', async () => {
    const adapter = await resolve<OpenAIAdapter>(OpenAIAdapter);
    const manual = new OpenAIAdapter(capability as any);
    expect((adapter as any).capability).toBe(capability);
    expect((manual as any).capability).toBe(capability);
    // 两个实例独立，说明容器确实自己构造了一份
    expect(adapter).not.toBe(manual);
  });
});
