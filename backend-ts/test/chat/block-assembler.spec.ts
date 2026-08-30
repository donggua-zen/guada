/// <reference types="jest" />

import { BlockAssembler } from '../../src/modules/chat/block-assembler';
import type { StreamChunk } from '../../src/common/types/stream-chunk.types';
import type {
  BlockTiming,
  ContentBlock,
} from '../../src/common/types/conversation.types';

/** 带 timing 访问器的块视图（所有流式块类型共有可选 timing） */
type TimedBlock = ContentBlock & { timing?: BlockTiming };

/** 剥离 timing 字段，专注内容形状断言（timing 行为在专门用例中验证） */
function stripTiming(blocks: ContentBlock[]): Omit<TimedBlock, 'timing'>[] {
  return (blocks as TimedBlock[]).map(({ timing: _timing, ...rest }) => rest);
}

function feed(assembler: BlockAssembler, chunks: StreamChunk[]) {
  for (const chunk of chunks) assembler.push(chunk);
}

describe('BlockAssembler', () => {
  describe('基础组装', () => {
    it('text 块：delta 累加，block_end 权威终态优先', () => {
      const assembler = new BlockAssembler();
      feed(assembler, [
        { type: 'block_start', index: 0, blockType: 'text' },
        { type: 'text_delta', index: 0, text: '你好' },
        { type: 'text_delta', index: 0, text: '，世界' },
        {
          type: 'block_end',
          index: 0,
          block: { type: 'text', contentId: 'c1', text: '权威终态文本' },
        },
        // 迟到 delta 应被忽略（first close wins）
        { type: 'text_delta', index: 0, text: '（迟到）' },
      ]);

      expect(stripTiming(assembler.blocks())).toEqual([
        { type: 'text', contentId: 'c1', text: '权威终态文本' },
      ]);
    });

    it('交错块保持首见顺序（reasoning → text）', () => {
      const assembler = new BlockAssembler();
      feed(assembler, [
        { type: 'block_start', index: 0, blockType: 'reasoning' },
        { type: 'reasoning_delta', index: 0, text: '思考中' },
        { type: 'block_start', index: 1, blockType: 'text' },
        { type: 'text_delta', index: 1, text: '答案' },
        { type: 'reasoning_delta', index: 0, text: '…继续' },
      ]);

      expect(stripTiming(assembler.blocks())).toEqual([
        { type: 'reasoning', contentId: '', summary: '思考中…继续' },
        { type: 'text', contentId: '', text: '答案' },
      ]);
    });

    it('tool_call_delta：参数分片拼装 + id/name 回填', () => {
      const assembler = new BlockAssembler();
      feed(assembler, [
        { type: 'tool_call_delta', index: 2, name: 'read_file', argumentsDelta: '{"path' },
        { type: 'tool_call_delta', index: 2, toolCallId: 'call_1', argumentsDelta: '":"a.ts"}' },
      ]);

      expect(stripTiming(assembler.blocks())).toEqual([
        {
          type: 'tool-call',
          contentId: '',
          toolCallId: 'call_1',
          name: 'read_file',
          arguments: '{"path":"a.ts"}',
        },
      ]);
    });

    it('空 text/reasoning 不成块', () => {
      const assembler = new BlockAssembler();
      feed(assembler, [
        { type: 'block_start', index: 0, blockType: 'reasoning' },
        { type: 'block_start', index: 1, blockType: 'text' },
        { type: 'text_delta', index: 1, text: '有内容' },
      ]);

      expect(stripTiming(assembler.blocks())).toEqual([{ type: 'text', contentId: '', text: '有内容' }]);
    });
  });

  describe('断点续传 seed', () => {
    it('既有块作为前缀，新流块 index 接续偏移', () => {
      const assembler = new BlockAssembler();
      const history: ContentBlock[] = [
        { type: 'text', contentId: 'old-c1', text: '截断前半句' },
      ];
      assembler.seed(history);
      feed(assembler, [
        // 上游续传响应的 wire index 从 0 重新计数，映射后应接在既有块之后
        { type: 'text_delta', index: 0, text: '后半句' },
      ]);

      expect(stripTiming(assembler.blocks())).toEqual([
        { type: 'text', contentId: 'old-c1', text: '截断前半句' },
        { type: 'text', contentId: '', text: '后半句' },
      ]);
    });

    it('seed 后 tool_call 块接续且互不干扰', () => {
      const assembler = new BlockAssembler();
      assembler.seed([
        { type: 'reasoning', contentId: 'old-r', summary: '旧思考' },
      ]);
      feed(assembler, [
        { type: 'tool_call_delta', index: 0, toolCallId: 'call_x', name: 'shell', argumentsDelta: '{"cmd":"ls"}' },
      ]);

      expect(stripTiming(assembler.blocks())).toEqual([
        { type: 'reasoning', contentId: 'old-r', summary: '旧思考' },
        { type: 'tool-call', contentId: '', toolCallId: 'call_x', name: 'shell', arguments: '{"cmd":"ls"}' },
      ]);
    });
  });

  describe('检测与元数据', () => {
    it('hasContent：无可见内容为 false，任一块出现即为 true', () => {
      const empty = new BlockAssembler();
      expect(empty.hasContent()).toBe(false);

      const withText = new BlockAssembler();
      feed(withText, [{ type: 'text_delta', index: 0, text: 'x' }]);
      expect(withText.hasContent()).toBe(true);

      const withTool = new BlockAssembler();
      feed(withTool, [{ type: 'tool_call_delta', index: 0, argumentsDelta: '{' }]);
      expect(withTool.hasContent()).toBe(true);
    });

    it('usage 先于 finish 到达，snapshot 收口全部元数据', () => {
      const assembler = new BlockAssembler();
      feed(assembler, [
        { type: 'text_delta', index: 0, text: 'hi' },
        {
          type: 'usage',
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        },
        { type: 'finish', finishReason: 'stop', signature: 'sig-abc' },
      ]);

      const snap = assembler.snapshot();
      expect(snap.usage).toEqual({ promptTokens: 10, completionTokens: 5, totalTokens: 15 });
      expect(snap.finishReason).toBe('stop');
      expect(snap.signature).toBe('sig-abc');
    });

    it('toMessage 组装三层 assistant Message（含元数据浅合并）', () => {
      const assembler = new BlockAssembler();
      feed(assembler, [
        { type: 'reasoning_delta', index: 0, text: 'think' },
        { type: 'text_delta', index: 1, text: 'answer' },
        { type: 'finish', finishReason: 'tool-calls' },
      ]);

      const message = assembler.toMessage({
        id: 'msg-1',
        provider: 'openai',
        model: 'gpt-test',
        extraMetadata: { modelName: 'gpt-test' },
      });

      expect(message.id).toBe('msg-1');
      expect(message.role).toBe('assistant');
      expect(message.kind).toBe('model');
      expect(message.source).toEqual({ kind: 'model', provider: 'openai', model: 'gpt-test' });
      expect(message.metadata).toEqual({
        modelName: 'gpt-test',
        finishReason: 'tool-calls',
      });
      expect(message.content.map((b) => b.type)).toEqual(['reasoning', 'text']);
    });
  });

  describe('块生命周期计时（timing）', () => {
    it('闭合块：startedAt 在块首见打点，finishedAt 在 block_end 收口', () => {
      const assembler = new BlockAssembler();
      feed(assembler, [
        { type: 'block_start', index: 0, blockType: 'reasoning' },
        { type: 'reasoning_delta', index: 0, text: '思考' },
        {
          type: 'block_end',
          index: 0,
          block: { type: 'reasoning', contentId: '', summary: '权威终态思考' },
        },
      ]);

      const [block] = assembler.blocks() as TimedBlock[];
      expect(block.timing?.startedAt).toBeGreaterThan(0);
      expect(block.timing?.finishedAt).toBeGreaterThanOrEqual(block.timing!.startedAt);
      expect(block.timing!.finishedAt!).toBeLessThanOrEqual(Date.now());
    });

    it('未闭合块（中止/截断）：以最近一次流活动时间收口，时长仍完整', () => {
      const assembler = new BlockAssembler();
      feed(assembler, [
        { type: 'reasoning_delta', index: 0, text: '半截思考' },
        { type: 'text_delta', index: 1, text: '半截回答' },
      ]);
      const blocks = assembler.blocks() as TimedBlock[];

      for (const block of blocks) {
        expect(block.timing?.startedAt).toBeGreaterThan(0);
        expect(block.timing?.finishedAt).toBeDefined();
        expect(block.timing!.finishedAt!).toBeGreaterThanOrEqual(block.timing!.startedAt);
      }
    });

    it('seed 的历史块保留持久化 timing，不被覆盖；新块独立计时', () => {
      const assembler = new BlockAssembler();
      const persistedTiming: BlockTiming = { startedAt: 1_000, finishedAt: 1_500 };
      assembler.seed([
        { type: 'reasoning', contentId: 'old-r', summary: '旧思考', timing: persistedTiming },
      ]);
      feed(assembler, [{ type: 'text_delta', index: 0, text: '续传新文本' }]);

      const [oldBlock, newBlock] = assembler.blocks() as TimedBlock[];
      // 历史块原样保留（不重打点）
      expect(oldBlock.timing).toEqual(persistedTiming);
      // 新块按当前时钟计时
      expect(newBlock.timing?.startedAt).toBeGreaterThanOrEqual(1_500);
    });

    it('reset 后重新计时（重试场景：半截累积清空）', () => {
      const assembler = new BlockAssembler();
      feed(assembler, [{ type: 'text_delta', index: 0, text: '第一次尝试' }]);
      const firstStartAt = (assembler.blocks()[0] as TimedBlock).timing!.startedAt;

      assembler.reset();
      feed(assembler, [{ type: 'text_delta', index: 0, text: '重试后内容' }]);

      const retryBlock = assembler.blocks()[0] as TimedBlock;
      expect(retryBlock.timing?.startedAt).toBeGreaterThanOrEqual(firstStartAt);
      // reset 前的半截累积不应残留
      expect((retryBlock as any).text ?? (retryBlock as any).summary).not.toContain('第一次');
    });
  });

  describe('repairArguments（截断 JSON 修复）', () => {
    it('合法 JSON 原样返回；残缺 JSON 经 partialParse 修复；空值兜底 {}', () => {
      const assembler = new BlockAssembler();

      expect(assembler.repairArguments('{"a":1}')).toBe('{"a":1}');
      // 值完整后的截断可抢救
      expect(assembler.repairArguments('{"path":"a.ts", "line":12')).toBe(
        '{"path":"a.ts","line":12}',
      );
      expect(assembler.repairArguments('')).toBe('{}');

      // 字符串值中间截断无法抢救（partial-json 既有行为）；完全不可解析兜底 {}
      expect(assembler.repairArguments('{"path":"src/')).toBe('{}');
      expect(assembler.repairArguments('{{{')).toBe('{}');
    });
  });
});
