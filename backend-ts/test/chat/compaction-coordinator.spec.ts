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

function createCoordinator(
  compactionService: any = {
    shouldCompress: jest.fn(async () => true),
    compress: jest.fn(async () => [makeMsg('m1')]),
  },
) {
  return new CompactionCoordinatorService(compactionService);
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
        compress: jest.fn(async () => [makeMsg('m1')]),
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
          return [makeMsg('m1')];
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
  });

  describe('maybeCompress（手动路径）', () => {
    it('把钩子 payload 来源（hook）传给 CompactionService（确认二级后由其发射 compaction.before）', async () => {
      const ctx = createContext();
      let hookOpts: any;
      const compactionService = {
        shouldCompress: jest.fn(async () => true),
        compress: jest.fn(async (_ds: any, opts: any) => {
          hookOpts = opts;
          return [makeMsg('m1')];
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

    it('纯裁剪（compacted=false）→ 仍发 compression_end 携带 contextStats，不发 compaction_summary', async () => {
      const ctx = createContext();
      const compactionService = {
        shouldCompress: jest.fn(async () => true),
        compress: jest.fn(async () => ({
          messages: [makeMsg('m1')],
          compacted: false,
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
          shadowedCount: 1,
          shadowedEndId: 'a1',
          summaryMessageId: 'm_sum',
          summary: '已压缩',
        })),
      };
      const coordinator = createCoordinator(compactionService);

      const bypassed = await coordinator.maybeCompress(ctx as any);
      expect(bypassed).toEqual({ messages: null, didRun: false });
      expect(compactionService.compress).not.toHaveBeenCalled();
      expect((ctx.publishStream as jest.Mock).mock.calls.length).toBe(0);

      const forced = await coordinator.maybeCompress(ctx as any, { force: true, reason: 'manual' });
      expect(forced.didRun).toBe(true);
      expect(compactionService.compress).toHaveBeenCalledTimes(1);
    });
  });
});