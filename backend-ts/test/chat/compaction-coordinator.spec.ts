/**
 * CompactionCoordinatorService 单元测试（v1.3：编排委托 CompactionService）
 *
 * 覆盖（对齐 DSH agent 钩子语义）：
 * - onPreStep：压力触发返回 enter.messages / 未触发旁路（undefined）+ 重置溢出计数
 * - onRequestError：非溢出旁路；溢出 force 压缩返回 retry；溢出重试上限后保留错误
 * - maybeCompress：经 sessionContext.publishStream 直发 compression_start/error；把钩子
 *   payload 来源（hook）传给 CompactionService（compaction.before 事件由 CompactionService
 *   在确认二级压缩后发射）
 */
import { CompactionCoordinatorService } from '../../src/modules/chat/compaction/compaction-coordinator.service';
import { SummaryMode } from '../../src/modules/chat/compaction/compression-engine';
import type { CompactionDataSource } from '../../src/modules/chat/compaction/types';
import type { Message } from '../../src/common/types/conversation.types';
import type { PreStepPayload, RequestErrorPayload } from '../../src/modules/chat/types/hooks.contract';
import {
  clearMediaBudgetPressure,
  getMediaBudgetBytesForSession,
} from '../../src/modules/llm-core/media-budget';

/// <reference types="jest" />

function makeMsg(id: string): Message {
  return {
    id,
    role: 'user',
    kind: 'user',
    source: { kind: 'user' },
    metadata: {},
    content: [{ type: 'text', text: 'hi' }],
  };
}

/** 会话 mock：满足 CompactionDataSource（coordinator 内部窄化使用）+ publishStream 捕获 */
function createContext(overrides: Partial<CompactionDataSource> = {}): any {
  return {
    sessionId: 's1',
    publishStream: jest.fn(async () => {}),
    getCompressionConfig: jest.fn(() => ({ enabled: true, summaryMode: 'memory_sync' })),
    getHistory: jest.fn(async () => [makeMsg('m1')]),
    getMessages: jest.fn(async () => [makeMsg('m1')]),
    getModelConfig: jest.fn(() => ({ modelName: 'gpt-4o' } as any)),
    getTokenCount: jest.fn(() => 100),
    getEffectiveContextWindow: jest.fn(() => 1000),
    getPrelude: jest.fn(async () => []),
    getTools: jest.fn(() => []),
    ...overrides,
  };
}

/** 压缩成功（替换 surface）的 CompressOutcome 形状——旧用例曾直接返回 Message[]，与现状失真 */
function replacedOutcome(): any {
  return {
    messages: [makeMsg('m1')],
    compacted: true,
    replaced: true,
    shadowedCount: 1,
    shadowedEndId: 'm0',
    summaryMessageId: 'm_sum',
    summary: '检查点',
  };
}

function createCoordinator(
  compactionService: any = {
    shouldCompress: jest.fn(async () => true),
    compress: jest.fn(async () => replacedOutcome()),
  },
  microcompactService: any = {
    maybeMicrocompact: jest.fn(async () => ({ applied: false })),
  },
) {
  return new CompactionCoordinatorService(compactionService, microcompactService);
}

function preStepPayload(ctx: CompactionDataSource): PreStepPayload {
  return { sessionContext: ctx as any };
}
function requestErrorPayload(ctx: CompactionDataSource, error: unknown): RequestErrorPayload {
  return { sessionContext: ctx as any, error };
}

describe('CompactionCoordinatorService', () => {
  describe('onPreStep（agent/pre_step，副作用管线）', () => {
    it('压力触发 → 执行压缩（副作用），返回 void 放行', async () => {
      const ctx = createContext();
      const compactionService = {
        shouldCompress: jest.fn(async () => true),
        compress: jest.fn(async () => replacedOutcome()),
      };
      const coordinator = createCoordinator(compactionService);
      const result = await coordinator.onPreStep(preStepPayload(ctx));
      expect(result).toBeUndefined(); // 只做副作用，不返回决策（agent-engine 钩子后重读消息）
      expect(compactionService.compress).toHaveBeenCalled();
    });

    it('压力未触发 → 不压缩，并重置溢出计数', async () => {
      const ctx = createContext();
      const coordinator = createCoordinator({
        shouldCompress: jest.fn(async () => false),
        compress: jest.fn(),
      });
      // 先制造一个溢出计数
      (coordinator as any).overflowRetries.set('s1', 1);
      await coordinator.onPreStep(preStepPayload(ctx));
      expect((coordinator as any).overflowRetries.has('s1')).toBe(false);
    });

    it('压缩失败 → 直发 compression_error 并放行（fail-open）', async () => {
      const ctx = createContext();
      const coordinator = createCoordinator({
        shouldCompress: jest.fn(async () => true),
        compress: jest.fn(async () => {
          throw new Error('boom');
        }),
      });
      const result = await coordinator.onPreStep(preStepPayload(ctx));
      expect(result).toBeUndefined();
      const events = (ctx.publishStream as jest.Mock).mock.calls.map((c) => c[0]);
      expect(events[0].type).toBe('compression_start');
      expect(events[1].type).toBe('compression_error');
    });

    it('微压缩先于 LLM 压缩执行（同一订阅者内显式串行，对齐 zcode）', async () => {
      const ctx = createContext();
      const callOrder: string[] = [];
      const microcompactService = {
        maybeMicrocompact: jest.fn(async () => {
          callOrder.push('micro');
          return { applied: false };
        }),
      };
      const compactionService = {
        shouldCompress: jest.fn(async () => {
          callOrder.push('llm');
          return false;
        }),
        compress: jest.fn(),
      };
      const coordinator = createCoordinator(compactionService, microcompactService);
      await coordinator.onPreStep(preStepPayload(ctx));
      expect(callOrder).toEqual(['micro', 'llm']);
    });

    it('auto 熔断：连续 3 次未替换 surface 后，跳过后续 auto 压缩', async () => {
      const ctx = createContext();
      const compactionService = {
        shouldCompress: jest.fn(async () => true),
        // 压缩"跑了"但没替换 surface（例如摘要输入超窗被拒）
        compress: jest.fn(async () => ({
          messages: [makeMsg('m1')],
          compacted: false,
          replaced: false,
          shadowedCount: 0,
        })),
      };
      const coordinator = createCoordinator(compactionService);
      await coordinator.onPreStep(preStepPayload(ctx));
      await coordinator.onPreStep(preStepPayload(ctx));
      expect(compactionService.compress).toHaveBeenCalledTimes(2);
      // 第 3 次仍失败 → 计数达上限
      await coordinator.onPreStep(preStepPayload(ctx));
      expect(compactionService.compress).toHaveBeenCalledTimes(3);
      expect((coordinator as any).autoCompactFailures.get('s1')).toBe(3);
      // 熔断打开：后续 pre_step 不再调用压缩
      await coordinator.onPreStep(preStepPayload(ctx));
      expect(compactionService.compress).toHaveBeenCalledTimes(3);
    });

    it('auto 熔断：一次成功替换后计数清零（恢复尝试）', async () => {
      const ctx = createContext();
      const compress = jest
        .fn()
        .mockResolvedValueOnce({
          messages: [makeMsg('m1')],
          compacted: false,
          replaced: false,
          shadowedCount: 0,
        })
        .mockResolvedValueOnce(replacedOutcome());
      const coordinator = createCoordinator({
        shouldCompress: jest.fn(async () => true),
        compress,
      });
      await coordinator.onPreStep(preStepPayload(ctx));
      expect((coordinator as any).autoCompactFailures.get('s1')).toBe(1);
      await coordinator.onPreStep(preStepPayload(ctx));
      expect((coordinator as any).autoCompactFailures.has('s1')).toBe(false);
    });

    it('模型窗口变小且历史超窗 → 发 context_window_changed（model-switch），同窗口不重复', async () => {
      let model: any = {
        id: 'providerA:long',
        modelName: 'long',
        config: { contextWindow: 1_000_000 },
      };
      let window = 1_000_000;
      const ctx = createContext({
        getModelConfig: jest.fn(() => model),
        getEffectiveContextWindow: jest.fn(() => window),
        getTokenCount: jest.fn(async () => 450_000),
        getCompressionConfig: jest.fn(() => ({
          enabled: true,
          compressionTriggerRatio: 0.9,
        })),
      } as any);
      const compactionService = {
        shouldCompress: jest.fn(async () => false),
        compress: jest.fn(),
      };
      const coordinator = createCoordinator(compactionService);

      // 基线：长窗口，不发提示
      await coordinator.onPreStep(preStepPayload(ctx));
      expect(ctx.publishStream).not.toHaveBeenCalled();

      // 切到短窗口：历史 450K > 128K
      model = {
        id: 'providerB:short',
        modelName: 'short',
        config: { contextWindow: 128_000 },
      };
      window = 128_000;
      await coordinator.onPreStep(preStepPayload(ctx));
      const events = (ctx.publishStream as jest.Mock).mock.calls.map((c) => c[0]);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: 'context_window_changed',
        reason: 'model-switch',
        previousModelId: 'providerA:long',
        modelId: 'providerB:short',
        previousEffectiveContextWindow: 1_000_000,
        effectiveContextWindow: 128_000,
        usedTokens: 450_000,
        overWindow: true,
        willAutoCompact: true,
      });
      expect(events[0].triggerRatio).toBe(0.9);

      // 同窗口再走一步：不重复提示
      await coordinator.onPreStep(preStepPayload(ctx));
      expect(ctx.publishStream).toHaveBeenCalledTimes(1);
    });

    it('同模型调小 maxTokensLimit → reason=token-limit（不当作换模型）', async () => {
      const model: any = {
        id: 'p:m',
        modelName: 'm',
        config: { contextWindow: 1_000_000 },
      };
      let window = 1_000_000;
      const ctx = createContext({
        getModelConfig: jest.fn(() => model),
        getEffectiveContextWindow: jest.fn(() => window),
        getTokenCount: jest.fn(async () => 500_000),
        getCompressionConfig: jest.fn(() => ({
          enabled: true,
          compressionTriggerRatio: 0.9,
        })),
      } as any);
      const coordinator = createCoordinator({
        shouldCompress: jest.fn(async () => false),
        compress: jest.fn(),
      });

      await coordinator.onPreStep(preStepPayload(ctx));
      expect(ctx.publishStream).not.toHaveBeenCalled();

      window = 200_000;
      await coordinator.onPreStep(preStepPayload(ctx));
      const events = (ctx.publishStream as jest.Mock).mock.calls.map((c) => c[0]);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: 'context_window_changed',
        reason: 'token-limit',
        effectiveContextWindow: 200_000,
        overWindow: true,
      });
    });

    it('无历史基线但已硬超窗（如进程重启后）→ reason=over-window', async () => {
      const ctx = createContext({
        getModelConfig: jest.fn(() => ({
          id: 'p:short',
          modelName: 'short',
          config: { contextWindow: 128_000 },
        })),
        getEffectiveContextWindow: jest.fn(() => 128_000),
        getTokenCount: jest.fn(async () => 200_000),
        getCompressionConfig: jest.fn(() => ({
          enabled: false,
          compressionTriggerRatio: 0.9,
        })),
      } as any);
      const coordinator = createCoordinator({
        shouldCompress: jest.fn(async () => false),
        compress: jest.fn(),
      });

      await coordinator.onPreStep(preStepPayload(ctx));
      const events = (ctx.publishStream as jest.Mock).mock.calls.map((c) => c[0]);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: 'context_window_changed',
        reason: 'over-window',
        overWindow: true,
        willAutoCompact: false, // 压缩档位关闭
      });
    });

    it('模型切换后 useStablePrefix=false；同模型后续步恢复 true', async () => {
      let model: any = {
        id: 'providerA:long',
        modelName: 'long',
        config: { contextWindow: 1_000_000 },
      };
      let window = 1_000_000;
      const ctx = createContext({
        getModelConfig: jest.fn(() => model),
        getEffectiveContextWindow: jest.fn(() => window),
        getTokenCount: jest.fn(async () => 450_000),
        getCompressionConfig: jest.fn(() => ({
          enabled: true,
          compressionTriggerRatio: 0.9,
        })),
      } as any);
      const compactionService = {
        shouldCompress: jest.fn(async () => true),
        compress: jest.fn(async () => replacedOutcome()),
      };
      const coordinator = createCoordinator(compactionService);
      const lastCompressArgs = () => {
        const calls = (compactionService.compress as jest.Mock).mock.calls;
        return calls[calls.length - 1][1];
      };

      // 首步：无基线 → 不可假设前缀缓存
      await coordinator.onPreStep(preStepPayload(ctx));
      expect(lastCompressArgs()).toMatchObject({ useStablePrefix: false });

      // 切换到短窗口模型：上一次主请求在旧模型 → 缓存不可复用
      model = {
        id: 'providerB:short',
        modelName: 'short',
        config: { contextWindow: 128_000 },
      };
      window = 128_000;
      await coordinator.onPreStep(preStepPayload(ctx));
      expect(lastCompressArgs()).toMatchObject({ useStablePrefix: false });

      // 同模型同窗口的下一步：上一次主请求就是当前模型 → 可复用
      await coordinator.onPreStep(preStepPayload(ctx));
      expect(lastCompressArgs()).toMatchObject({ useStablePrefix: true });
    });

    it('窗口变化清零旧窗口下的 auto 熔断（切回大窗口后可恢复尝试）', async () => {
      let model: any = {
        id: 'providerA:long',
        modelName: 'long',
        config: { contextWindow: 1_000_000 },
      };
      let window = 1_000_000;
      const ctx = createContext({
        getModelConfig: jest.fn(() => model),
        getEffectiveContextWindow: jest.fn(() => window),
        getTokenCount: jest.fn(async () => 200_000),
        getCompressionConfig: jest.fn(() => ({
          enabled: true,
          compressionTriggerRatio: 0.9,
        })),
      } as any);
      const compactionService = {
        shouldCompress: jest.fn(async () => true),
        compress: jest.fn(async () => replacedOutcome()),
      };
      const coordinator = createCoordinator(compactionService);
      (coordinator as any).autoCompactFailures.set('s1', 3);
      (coordinator as any).overflowRetries.set('s1', 1);

      // 基线步：旧窗口下熔断仍生效（跳过压缩）
      await coordinator.onPreStep(preStepPayload(ctx));
      expect(compactionService.compress).not.toHaveBeenCalled();

      // 切到新窗口：清零熔断/溢出计数 → 压缩重新执行并成功
      model = {
        id: 'providerB:short',
        modelName: 'short',
        config: { contextWindow: 128_000 },
      };
      window = 128_000;
      await coordinator.onPreStep(preStepPayload(ctx));
      expect(compactionService.compress).toHaveBeenCalledTimes(1);
      expect((coordinator as any).autoCompactFailures.has('s1')).toBe(false);
    });
  });

  describe('onRequestError（agent/request_error）', () => {
    it('非溢出错误 → 返回 undefined（保留原始错误）', async () => {
      const ctx = createContext();
      const coordinator = createCoordinator();
      const action = await coordinator.onRequestError(requestErrorPayload(ctx, new Error('network')));
      expect(action).toBeUndefined();
    });

    it('溢出错误 → force 压缩并返回 { kind: "retry" }', async () => {
      const ctx = createContext();
      const compactionService = {
        shouldCompress: jest.fn(async () => true),
        compress: jest.fn(async (_ds: any, opts: any) => {
          expect(opts.force).toBe(true);
          return replacedOutcome();
        }),
      };
      const coordinator = createCoordinator(compactionService);
      const overflowError = { message: 'maximum context length exceeded', status: 400 };
      const action = await coordinator.onRequestError(requestErrorPayload(ctx, overflowError));
      expect(action).toEqual({ kind: 'retry' });
      expect(compactionService.compress).toHaveBeenCalled();
    });

    it('溢出重试达到上限后返回 undefined（防死循环）', async () => {
      const ctx = createContext();
      const coordinator = createCoordinator();
      const overflowError = { message: 'context length exceeded' };
      await coordinator.onRequestError(requestErrorPayload(ctx, overflowError)); // 第一次 → retry
      const action2 = await coordinator.onRequestError(requestErrorPayload(ctx, overflowError)); // 第二次 → undefined
      expect(action2).toBeUndefined();
    });

    it('压缩未替换 surface（replaced=false）→ 不 retry，保留原始 provider 错误', async () => {
      const ctx = createContext();
      const compactionService = {
        shouldCompress: jest.fn(async () => true),
        // 压缩跑了但被跳过/失败（如摘要输入超窗终结）
        compress: jest.fn(async () => {
          throw new Error('Compaction failed: the summary input exceeds the model context window');
        }),
      };
      const coordinator = createCoordinator(compactionService);
      const overflowError = { message: 'context length exceeded' };
      const action = await coordinator.onRequestError(requestErrorPayload(ctx, overflowError));
      expect(action).toBeUndefined();
      expect(compactionService.compress).toHaveBeenCalled();
      // 未替换不占用溢出重试额度：后续仍可尝试（错误被保留给上层）
      expect((coordinator as any).overflowRetries.has('s1')).toBe(false);
    });

    it('工具配对非法（Console Go/DeepSeek 实测文案）→ 修复悬空调用并返回 retry，且不走压缩', async () => {
      const repair = jest.fn(async () => 2);
      const ctx = createContext({ repairDanglingToolCalls: repair } as any);
      const compactionService = {
        shouldCompress: jest.fn(async () => true),
        compress: jest.fn(),
      };
      const coordinator = createCoordinator(compactionService);
      const action = await coordinator.onRequestError(
        requestErrorPayload(
          ctx,
          new Error(
            "LLM API Error: 400 - 400 Error from provider (Console Go): Upstream request failed: " +
              "[invalid_request_error] An assistant message with 'tool_calls' must be followed by tool " +
              "messages responding to each 'tool_call_id'. (insufficient tool messages following tool_calls message)",
          ),
        ),
      );

      expect(repair).toHaveBeenCalledTimes(1);
      expect(action).toEqual({ kind: 'retry' });
      // 这类 400 与上下文长度无关：必须修历史，绝不能去压缩（白花一次摘要调用且救不了）
      expect(compactionService.compress).not.toHaveBeenCalled();
    });

    it('无悬空调用可修（0 条）→ 不重试、不占额度，保留原始错误', async () => {
      const repair = jest.fn(async () => 0);
      const ctx = createContext({ repairDanglingToolCalls: repair } as any);
      const coordinator = createCoordinator();
      const action = await coordinator.onRequestError(
        requestErrorPayload(
          ctx,
          new Error('insufficient tool messages following tool_calls message'),
        ),
      );

      expect(repair).toHaveBeenCalledTimes(1);
      expect(action).toBeUndefined();
      expect((coordinator as any).pairingRepairRetries.has('s1')).toBe(false);
    });

    it('配对修复重试达到上限后返回 undefined（防死循环）', async () => {
      const repair = jest.fn(async () => 1);
      const ctx = createContext({ repairDanglingToolCalls: repair } as any);
      const coordinator = createCoordinator();
      const error = new Error('insufficient tool messages following tool_calls message');

      expect(await coordinator.onRequestError(requestErrorPayload(ctx, error))).toEqual({
        kind: 'retry',
      });
      expect(await coordinator.onRequestError(requestErrorPayload(ctx, error))).toBeUndefined();
    });

    it('配对修复预算在下一步迭代（pre_step）复位 → 后续步骤仍可自愈', async () => {
      const repair = jest.fn(async () => 1);
      const ctx = createContext({ repairDanglingToolCalls: repair } as any);
      const coordinator = createCoordinator();
      const error = new Error('insufficient tool messages following tool_calls message');

      expect(await coordinator.onRequestError(requestErrorPayload(ctx, error))).toEqual({
        kind: 'retry',
      });
      await coordinator.onPreStep(preStepPayload(ctx));
      expect(await coordinator.onRequestError(requestErrorPayload(ctx, error))).toEqual({
        kind: 'retry',
      });
    });

    it('修复抛错 / 会话不支持该能力 → 不重试（退化为请求侧配对兜底）', async () => {
      const throwing = jest.fn(async () => {
        throw new Error('io fail');
      });
      const coordinator = createCoordinator();
      expect(
        await coordinator.onRequestError(
          requestErrorPayload(
            createContext({ repairDanglingToolCalls: throwing } as any),
            new Error('insufficient tool messages following tool_calls message'),
          ),
        ),
      ).toBeUndefined();
      // 会话未实现可选能力（如内存态实现）
      expect(
        await coordinator.onRequestError(
          requestErrorPayload(
            createContext(),
            new Error('insufficient tool messages following tool_calls message'),
          ),
        ),
      ).toBeUndefined();
    });
  });

  describe('maybeCompress（手动路径）', () => {
    it('把钩子 payload 来源（hook）传给 CompactionService（确认二级后由其发射 compaction.before）', async () => {
      const ctx = createContext();
      let hookOpts: any;
      const compactionService = {
        shouldCompress: jest.fn(async () => true),
        compress: jest.fn(async (_ds: any, opts: any) => {
          hookOpts = opts;
          return replacedOutcome();
        }),
      };
      const coordinator = createCoordinator(compactionService);
      const outcome = await coordinator.maybeCompress(ctx as any, {
        force: true,
        reason: 'manual',
      });
      expect(outcome.didRun).toBe(true);
      // 协调器不再自己注入回调；只透传 payload 来源（sessionContext）给服务，
      // 流内事件由各方经 sessionContext.publishStream 直发
      expect(hookOpts.hook.sessionContext).toBe(ctx);
    });

    it('压缩完成（compacted）→ 直发 compaction_summary（遮蔽区间信息）', async () => {
      const ctx = createContext();
      const compactionService = {
        shouldCompress: jest.fn(async () => true),
        compress: jest.fn(async () => ({
          messages: [makeMsg('m1')],
          compacted: true,
          replaced: true,
          shadowedCount: 2,
          shadowedEndId: 'a1',
          summaryMessageId: 'm_sum',
          summary: '已压缩',
        })),
      };
      const coordinator = createCoordinator(compactionService);
      const outcome = await coordinator.maybeCompress(ctx as any, {
        force: true,
        reason: 'auto',
      });
      expect(outcome.didRun).toBe(true);
      const events = (ctx.publishStream as jest.Mock).mock.calls.map((c) => c[0]);
      // compression_start（瞬态）→ compaction_summary（结果）
      expect(events[0].type).toBe('compression_start');
      const summary = events.find((e: any) => e.type === 'compaction_summary');
      expect(summary).toBeDefined();
      // v1.4：遮蔽为有序 messageId 区间 + 条数（不再离散 id 清单）
      expect(summary.shadowedEndId).toBe('a1');
      expect(summary.shadowedCount).toBe(2);
      expect(summary.messageId).toBe('m_sum');
      expect(summary.summary).toBe('已压缩');
    });

    it('未遮蔽任何消息（compacted=false）→ 不发 compaction_summary', async () => {
      const ctx = createContext();
      const compactionService = {
        shouldCompress: jest.fn(async () => true),
        compress: jest.fn(async () => ({
          messages: [makeMsg('m1')],
          compacted: false,
          replaced: false,
          shadowedMessageIds: [],
        })),
      };
      const coordinator = createCoordinator(compactionService);
      await coordinator.maybeCompress(ctx as any, {
        force: true,
        reason: 'auto',
      });
      const events = (ctx.publishStream as jest.Mock).mock.calls.map((c) => c[0]);
      expect(events.some((e: any) => e.type === 'compaction_summary')).toBe(false);
    });

    it('压缩完成 → 先发 compression_end（携带 contextStats），compaction_summary 亦携带', async () => {
      const ctx = createContext();
      const compactionService = {
        shouldCompress: jest.fn(async () => true),
        compress: jest.fn(async () => ({
          messages: [makeMsg('m1')],
          compacted: true,
          replaced: true,
          shadowedCount: 2,
          shadowedEndId: 'a1',
          summaryMessageId: 'm_sum',
          summary: '已压缩',
          contextStats: { usedTokens: 600, effectiveContextWindow: 1000 },
        })),
      };
      const coordinator = createCoordinator(compactionService);
      await coordinator.maybeCompress(ctx as any, { force: true, reason: 'manual' });
      const events = (ctx.publishStream as jest.Mock).mock.calls.map((c) => c[0]);
      const end = events.find((e: any) => e.type === 'compression_end');
      expect(end).toBeDefined();
      expect(end.reason).toBe('manual');
      expect(end.contextStats).toEqual({ usedTokens: 600, effectiveContextWindow: 1000 });
      const summary = events.find((e: any) => e.type === 'compaction_summary');
      expect(summary.contextStats).toEqual({ usedTokens: 600, effectiveContextWindow: 1000 });
    });

    it('未压缩（compacted=false）→ 仍发 compression_end 携带 contextStats，不发 compaction_summary', async () => {
      const ctx = createContext();
      const compactionService = {
        shouldCompress: jest.fn(async () => true),
        compress: jest.fn(async () => ({
          messages: [makeMsg('m1')],
          compacted: false,
          replaced: false,
          shadowedCount: 0,
          contextStats: { usedTokens: 500, effectiveContextWindow: 1000 },
        })),
      };
      const coordinator = createCoordinator(compactionService);
      await coordinator.maybeCompress(ctx as any, { force: true, reason: 'auto' });
      const events = (ctx.publishStream as jest.Mock).mock.calls.map((c) => c[0]);
      expect(events.some((e: any) => e.type === 'compression_end')).toBe(true);
      expect(events.some((e: any) => e.type === 'compaction_summary')).toBe(false);
    });

    it('force=false 且未达阈值 → 不压缩（didRun=false）', async () => {
      const ctx = createContext();
      const coordinator = createCoordinator({
        shouldCompress: jest.fn(async () => false),
        compress: jest.fn(),
      });
      const outcome = await coordinator.maybeCompress(ctx as any);
      expect(outcome.didRun).toBe(false);
    });

    it('档位关闭（enabled=false）→ 非 force 旁路（不发流事件）；force（手动）仍执行', async () => {
      const ctx = createContext({
        getCompressionConfig: jest.fn(() => ({ enabled: false, summaryMode: SummaryMode.MEMORY_SYNC })),
      });
      const compactionService = {
        shouldCompress: jest.fn(async () => true),
        compress: jest.fn(async () => ({
          messages: [makeMsg('m1')],
          compacted: true,
          replaced: true,
          shadowedCount: 1,
          shadowedEndId: 'a1',
          summaryMessageId: 'm_sum',
          summary: '已压缩',
        })),
      };
      const coordinator = createCoordinator(compactionService);

      const bypassed = await coordinator.maybeCompress(ctx as any);
      expect(bypassed).toEqual({ messages: null, didRun: false, replaced: false });
      expect(compactionService.compress).not.toHaveBeenCalled();
      expect((ctx.publishStream as jest.Mock).mock.calls.length).toBe(0);

      const forced = await coordinator.maybeCompress(ctx as any, { force: true, reason: 'manual' });
      expect(forced.didRun).toBe(true);
      expect(compactionService.compress).toHaveBeenCalledTimes(1);
    });
  });

  describe('onRequestError（请求体过大 / 413）', () => {
    afterEach(() => clearMediaBudgetPressure('s1'));

    it('413 → 收紧媒体预算并返回 retry，不走压缩', async () => {
      const ctx = createContext();
      const compactionService = {
        shouldCompress: jest.fn(async () => true),
        compress: jest.fn(),
      };
      const coordinator = createCoordinator(compactionService);
      const before = getMediaBudgetBytesForSession('s1');

      const action = await coordinator.onRequestError(
        requestErrorPayload(ctx, { message: 'Payload Too Large', status: 413 }),
      );

      expect(action).toEqual({ kind: 'retry' });
      expect(getMediaBudgetBytesForSession('s1')).toBe(Math.floor(before / 2));
      // token 未超窗时压缩无用（图片集中在保留尾），不应白跑一次摘要
      expect(compactionService.compress).not.toHaveBeenCalled();
    });

    it('连续 413：预算每次对半砍，用尽次数后保留原始错误', async () => {
      const ctx = createContext();
      const coordinator = createCoordinator();
      const error = { status: 413, message: 'request entity too large' };

      const seen: number[] = [];
      for (let i = 0; i < 3; i++) {
        const action = await coordinator.onRequestError(requestErrorPayload(ctx, error));
        expect(action).toEqual({ kind: 'retry' });
        seen.push(getMediaBudgetBytesForSession('s1'));
      }
      expect(seen[1]).toBeLessThan(seen[0]!);
      expect(seen[2]).toBeLessThan(seen[1]!);
      expect(
        await coordinator.onRequestError(requestErrorPayload(ctx, error)),
      ).toBeUndefined();
    });

    it('普通 4xx 不触发媒体预算收缩', async () => {
      const ctx = createContext();
      const coordinator = createCoordinator();
      const before = getMediaBudgetBytesForSession('s1');

      const action = await coordinator.onRequestError(
        requestErrorPayload(ctx, { message: 'bad request', status: 400 }),
      );

      expect(action).toBeUndefined();
      expect(getMediaBudgetBytesForSession('s1')).toBe(before);
    });
  });
});