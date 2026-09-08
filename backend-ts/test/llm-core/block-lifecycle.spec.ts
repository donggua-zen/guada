/// <reference types="jest" />

import { StreamBlockTracker } from '../../src/modules/llm-core/utils/block-lifecycle.util';

/**
 * StreamBlockTracker 通道切换闭块测试
 *
 * 覆盖：
 * - reasoning → text 首见：立即补发 block_end[reasoning]（对齐 Anthropic
 *   content_block_stop 时机，下游思考态即时翻转），并携带完整 summary
 * - text → tool 首见：立即闭合 text + reasoning 通道
 * - closeAll：跳过通道切换时已闭的块（不重复 block_end），仅收尾未闭块
 * - 空 reasoning：不发 block_end（与组装规则一致）
 * - text 后再度思考：新开 reasoning 通道（新 index），不向已闭块追加增量
 */
describe('StreamBlockTracker 通道切换闭块', () => {
  it('reasoning → text 首见时立即补发 block_end[reasoning]', () => {
    const tracker = new StreamBlockTracker();
    const chunks = [
      ...tracker.reasoningDelta('思考中'),
      ...tracker.reasoningDelta('继续思考'),
      ...tracker.textDelta('正文开始'),
    ];

    const types = chunks.map((c) => c.type);
    // block_end[reasoning] 出现在 block_start[text] 之前，紧跟最后一个 reasoning_delta
    const reasoningEndIdx = types.lastIndexOf('block_end');
    const textStartIdx = chunks.findIndex(
      (c) => c.type === 'block_start' && (c as any).blockType === 'text',
    );
    expect(reasoningEndIdx).toBeGreaterThanOrEqual(0);
    expect(textStartIdx).toBeGreaterThan(reasoningEndIdx);

    const endChunk = chunks.find(
      (c) => c.type === 'block_end' && (c as any).index === 0,
    ) as any;
    expect(endChunk.block).toEqual({ type: 'reasoning', summary: '思考中继续思考' });
  });

  it('tool 首见时立即闭合 text 与 reasoning 通道', () => {
    const tracker = new StreamBlockTracker();
    const chunks = [
      ...tracker.reasoningDelta('想一想'),
      ...tracker.textDelta('先说两句'),
      ...tracker.toolCallDelta(0, {
        toolCallId: 'call_1',
        name: 'edit',
        argumentsDelta: '{"a":1}',
      }),
    ];

    const ends = chunks.filter((c) => c.type === 'block_end') as any[];
    expect(ends).toHaveLength(2);
    expect(ends.map((e) => e.block.type).sort()).toEqual(['reasoning', 'text']);
    const textEnd = ends.find((e) => e.block.type === 'text');
    expect(textEnd.block.text).toBe('先说两句');
  });

  it('closeAll 跳过已闭通道，仅收尾未闭块', () => {
    const tracker = new StreamBlockTracker();
    tracker.reasoningDelta('思考');
    tracker.textDelta('正文');
    const tail = tracker.closeAll();

    // reasoning 已在 text 首见时闭合；closeAll 只补发 text
    expect(tail.filter((c) => c.type === 'block_end')).toHaveLength(1);
    expect((tail[0] as any).block).toEqual({ type: 'text', text: '正文' });
  });

  it('空 reasoning 通道不发 block_end', () => {
    const tracker = new StreamBlockTracker();
    // 首见空 delta 不产生通道；随后 text 首见无可闭的 reasoning
    const chunks1 = tracker.reasoningDelta('');
    expect(chunks1).toHaveLength(0);

    const chunks = [...tracker.textDelta('正文'), ...tracker.closeAll()];
    const ends = chunks.filter((c) => c.type === 'block_end') as any[];
    expect(ends).toHaveLength(1);
    expect(ends[0].block.type).toBe('text');
  });

  it('text 后再度思考：新开 reasoning 通道（新 index）', () => {
    const tracker = new StreamBlockTracker();
    const chunks = [
      ...tracker.reasoningDelta('第一段思考'),
      ...tracker.textDelta('中间正文'),
      ...tracker.reasoningDelta('第二段思考'),
    ];

    const starts = chunks.filter((c) => c.type === 'block_start') as any[];
    // 第二段思考新开通道：block_start[reasoning] 出现两次，index 递增
    const reasoningStarts = starts.filter((s) => s.blockType === 'reasoning');
    expect(reasoningStarts).toHaveLength(2);
    expect(reasoningStarts[1].index).toBeGreaterThan(reasoningStarts[0].index);

    const tail = tracker.closeAll();
    const endBlocks = tail.filter((c) => c.type === 'block_end') as any[];
    // 收尾补发：text 块 + 第二段 reasoning 块（第一段已在切换时闭合）
    expect(endBlocks.map((e) => e.block.type).sort()).toEqual(['reasoning', 'text']);
    const reasoning2 = endBlocks.find((e) => e.block.type === 'reasoning');
    expect(reasoning2.block.summary).toBe('第二段思考');
  });

  it('纯文本流（无思考）行为不变', () => {
    const tracker = new StreamBlockTracker();
    const chunks = [...tracker.textDelta('你好'), ...tracker.closeAll()];

    const types = chunks.map((c) => c.type);
    expect(types).toEqual(['block_start', 'text_delta', 'block_end']);
  });
});
