/**
 * CompactionService 单元测试（v1.3：压缩编排彻底移出会话）
 *
 * CompactionService 只依赖 CompactionDataSource 窄接口：
 * - shouldCompress：token/窗口/triggerRatio 决策
 * - compress：skip（force 外）→ pre_compact 事件 → Provider 工厂 → CompressionEngine →
 *   getHistory（写路径已播种快照）→ DB 压缩历史 + memory.compacted
 * - DISABLED 模式不构建 Provider；压缩模型解析（配置优先回退会话模型）
 */
import { CompactionService } from '../../src/modules/chat/compaction/compaction.service';
import { SummaryMode } from '../../src/modules/chat/compaction/compression-engine';
import type { CompactionDataSource } from '../../src/modules/chat/compaction/types';
import type { Message } from '../../src/common/types/conversation.types';

/// <reference types="jest" />

function makeMsg(id: string): Message {
  return {
    id,
    role: 'user',
    kind: 'user',
    source: { kind: 'user' },
    metadata: {},
    content: [{ type: 'text', contentId: `${id}_c`, text: 'hi' }],
  };
}

function createDataSource(overrides: Partial<CompactionDataSource> = {}): CompactionDataSource {
  return {
    sessionId: 's1',
    getCompressionConfig: jest.fn(() => ({
      compressionTriggerRatio: 0.8,
      compressionTargetRatio: 0.5,
      summaryMode: SummaryMode.MEMORY_SYNC,
    })),
    getHistory: jest.fn(async () => [makeMsg('m0'), makeMsg('m1')]),
    getPerMessageTokens: jest.fn(async () => [10, 20]),
    getModelConfig: jest.fn(() => ({ modelName: 'gpt-4o' } as any)),
    getTokenCount: jest.fn(async () => 100),
    getEffectiveContextWindow: jest.fn(() => 1000),
    getSystemText: jest.fn(() => 'sys'),
    getTools: jest.fn(() => []),
    appendPrune: jest.fn(async () => {}),
    appendCompact: jest.fn(async () => ({ summaryMessageId: 'm_sum', endSeq: 0 })),
    ...overrides,
  };
}

function createService(overrides: any = {}) {
  const engine = {
    execute: jest.fn(async () => ({
      pruneEvents: 1,
      compacted: true,
      shadowedCount: 1,
      shadowedEndId: 'm0',
      summaryMessageId: 'm_sum',
      summary: '检查点',
    })),
  };
  const settingsStorage = {
    getSettingValue: jest.fn(async () => null), // 无专用压缩模型 → 回退会话模型
  };
  const modelRepository = { findById: jest.fn() };
  const contextStateRepo = { create: jest.fn(async () => {}) };
  const eventBus = { emit: jest.fn(), parallel: jest.fn(async () => []) };
  const llmService = { completions: jest.fn() };

  const service = new CompactionService(
    engine as any,
    llmService as any,
    settingsStorage as any,
    modelRepository as any,
    contextStateRepo as any,
    eventBus as any,
  );
  return { service, engine, settingsStorage, modelRepository, contextStateRepo, eventBus, llmService };
}

describe('CompactionService', () => {
  describe('shouldCompress', () => {
    it('token 压力达到 triggerRatio 返回 true', async () => {
      const { service } = createService();
      const ds = createDataSource(); // 100/1000 = 0.1 < 0.8
      expect(await service.shouldCompress(ds)).toBe(false);
      const hot = createDataSource({ getTokenCount: jest.fn(async () => 900) }); // 0.9 >= 0.8
      expect(await service.shouldCompress(hot)).toBe(true);
    });
  });

  describe('compress', () => {
    it('force 外且未超目标 → skip（返回 getMessages，不触引擎/事件）', async () => {
      const { service, engine, eventBus } = createService();
      const ds = createDataSource({ getTokenCount: jest.fn(async () => 100) }); // 100 <= 500 target
      const result = await service.compress(ds);
      expect(result.messages.length).toBe(2);
      expect(result.compacted).toBe(false);
      expect(engine.execute).not.toHaveBeenCalled();
      expect(eventBus.emit).not.toHaveBeenCalled();
    });

    it('完整编排：pre_compact → 引擎(messages=history) → refresh → DB 历史 + memory.compacted', async () => {
      const { service, engine, eventBus, contextStateRepo } = createService();
      const ds = createDataSource({ getTokenCount: jest.fn(async () => 900) }); // > target 500
      const refreshed = await service.compress(ds);

      // 引擎以请求消息列表作为唯一数据源
      expect(engine.execute).toHaveBeenCalledWith(
        's1',
        expect.objectContaining({
          messages: [makeMsg('m0'), makeMsg('m1')],
          summaryMode: SummaryMode.MEMORY_SYNC,
          force: false,
        }),
      );
      // 压缩后 surface：写路径已播种快照，compress 直接 getHistory()
      expect(ds.getHistory).toHaveBeenCalled();
      expect(refreshed.messages.length).toBe(2);
      expect(refreshed.compacted).toBe(true);
      // v1.4：遮蔽为区间 + 条数（不再离散 id 清单）
      expect(refreshed.shadowedCount).toBe(1);
      expect(refreshed.shadowedEndId).toBe('m0');
      // 事件：pre_compact 与 compacted
      const emits = eventBus.emit.mock.calls.map((c: any[]) => c[0]);
      expect(emits).toContain('memory.pre_compact');
      expect(emits).toContain('memory.compacted');
      // DB 压缩历史（含统计）
      expect(contextStateRepo.create).toHaveBeenCalledWith(
        's1',
        expect.objectContaining({
          summaryContent: '检查点',
          cleaningStrategy: 'summarized',
          compressionStats: { beforeTokenCount: 900, afterTokenCount: 900 },
        }),
      );
    });

    it('force 透传：手动/溢出路径 force=true 传给引擎（跳过触发判断；retain 仍按配置比例）', async () => {
      const { service, engine } = createService();
      const ds = createDataSource({ getTokenCount: jest.fn(async () => 900) });
      await service.compress(ds, { force: true });
      expect(engine.execute).toHaveBeenCalledWith(
        's1',
        expect.objectContaining({ force: true }),
      );
    });

    it('纯裁剪（prune-only）→ 调 recordContextAnchor 写锚点；outcome 携带 contextStats', async () => {
      const { service, engine } = createService();
      engine.execute.mockResolvedValueOnce({
        pruneEvents: 2,
        compacted: false,
        shadowedCount: 0,
      } as any);
      const recordContextAnchor = jest.fn(async () => {});
      const ds = createDataSource({ recordContextAnchor });
      const result = await service.compress(ds, { force: true });
      expect(recordContextAnchor).toHaveBeenCalledTimes(1);
      expect(result.compacted).toBe(false);
      expect(result.contextStats).toEqual({ usedTokens: 100, effectiveContextWindow: 1000 });
    });

    it('compacted 路径不调 recordContextAnchor（锚点已由 appendCompact 的 compaction/end 承载）', async () => {
      const { service } = createService();
      const recordContextAnchor = jest.fn(async () => {});
      const ds = createDataSource({ recordContextAnchor });
      await service.compress(ds, { force: true });
      expect(recordContextAnchor).not.toHaveBeenCalled();
    });

    it('传入 hook 时：确认二级压缩后发 compaction.before（parallel 等待订阅者，payload 完整）', async () => {
      const { eventBus } = createService();
      // 引擎在确认二级压缩后调用 onBeforeCompaction
      const engine = { execute: jest.fn(async (_sid: string, opts: any) => {
        await opts.onBeforeCompaction();
        return { pruneEvents: 1, compacted: true, shadowedCount: 1, shadowedEndId: 'm0', summaryMessageId: 'm_sum', summary: '检查点' };
      }) };
      const service2 = new CompactionService(
        engine as any,
        { completions: jest.fn() } as any,
        { getSettingValue: jest.fn(async () => null) } as any,
        { findById: jest.fn() } as any,
        { create: jest.fn(async () => {}) } as any,
        eventBus as any,
      );
      const sessionContext = { sessionId: 's1' } as any;
      const ds = createDataSource({ getTokenCount: jest.fn(async () => 900) });
      await service2.compress(ds, {
        hook: { sessionContext },
      });

      const calls = (eventBus.parallel as jest.Mock).mock.calls as any[];
      expect(calls.length).toBe(1);
      expect(calls[0][0]).toBe('compaction.before');
      expect(calls[0][1].sessionContext).toBe(sessionContext);
      expect(calls[0][1].summaryMode).toBe(SummaryMode.MEMORY_SYNC);
    });

    it('DISABLED 模式：不构建 Provider（llmService 不被调用）', async () => {
      const { service, llmService } = createService();
      const ds = createDataSource({
        getTokenCount: jest.fn(async () => 900),
        getCompressionConfig: jest.fn(() => ({
          compressionTriggerRatio: 0.8,
          compressionTargetRatio: 0.5,
          summaryMode: SummaryMode.DISABLED,
        })),
      });
      await service.compress(ds);
      expect(llmService.completions).not.toHaveBeenCalled();
    });

    it('压缩模型解析：配置专用模型优先，回退会话模型', async () => {
      const { service, settingsStorage, modelRepository, llmService } = createService();
      const customModel = { modelName: 'deepseek-compress', provider: { provider: 'deepseek' }, config: {} };
      settingsStorage.getSettingValue.mockResolvedValueOnce('custom_id');
      modelRepository.findById.mockResolvedValueOnce(customModel);
      const ds = createDataSource({
        getTokenCount: jest.fn(async () => 900),
        getCompressionConfig: jest.fn(() => ({
          compressionTriggerRatio: 0.8,
          compressionTargetRatio: 0.5,
          summaryMode: SummaryMode.FAST,
        })),
      });
      await service.compress(ds);
      expect(modelRepository.findById).toHaveBeenCalledWith('custom_id');
      expect(llmService.completions).not.toHaveBeenCalled(); // 引擎 mock 不真正调 provider
      // Provider 已用专用模型构建（llmService.completions 未被引擎 mock 调，验证 resolve 发生）
      expect(settingsStorage.getSettingValue).toHaveBeenCalled();
    });
  });
});