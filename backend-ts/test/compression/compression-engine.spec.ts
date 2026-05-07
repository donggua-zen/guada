/// <reference types="jest" />

import { Test, TestingModule } from '@nestjs/testing';
import { CompressionEngine } from '../../src/modules/chat/compression-engine';
import { LLMService } from '../../src/modules/llm-core/llm.service';
import { TokenizerService } from '../../src/common/utils/tokenizer.service';
import { SessionContextStateRepository } from '../../src/common/database/session-context-state.repository';
import { MessageRecord } from '../../src/modules/llm-core/types/llm.types';

describe('CompressionEngine', () => {
  let engine: CompressionEngine;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CompressionEngine,
        {
          provide: LLMService,
          useValue: {}, // Mock LLMService as it's not needed for prune tests
        },
        {
          provide: TokenizerService,
          useValue: {
            countTokens: jest.fn().mockReturnValue(10), // Mock token counting
          },
        },
        {
          provide: SessionContextStateRepository,
          useValue: {}, // Mock Repository
        },
      ],
    }).compile();

    engine = module.get<CompressionEngine>(CompressionEngine);
  });

  describe('pruneMessages and applyPruningOverlay', () => {
    it('should prune long tool results and metadata should match overlay result', () => {
      // 1. 构造测试数据：包含一个超长的工具调用结果
      const longContent = 'A'.repeat(3000); // 超过 2000 字符阈值
      const messages: MessageRecord[] = [
        { role: 'user', content: 'Hello', messageId: 'msg1', contentId: 'c1' },
        { role: 'tool', content: longContent, messageId: 'msg2', contentId: 'c2' },
        { role: 'assistant', content: 'OK', messageId: 'msg3', contentId: 'c3' },
        { role: 'assistant', content: 'OK', messageId: 'msg4', contentId: 'c4' },
        { role: 'assistant', content: 'OK', messageId: 'msg5', contentId: 'c5' },
        { role: 'assistant', content: 'OK', messageId: 'msg6', contentId: 'c6' },
      ];

      // 2. 执行裁剪 (不传入 lastProcessedContentId，确保从头开始处理)
      const { prunedMessages, metadata, lastPrunedContentId } = engine.pruneMessages(messages);

      // 3. 验证裁剪结果
      // 注意：由于 PROTECTED_RECENT_TOOL_RESULTS_COUNT = 3，且我们只有一条 tool 消息，它会被保护。
      // 为了触发裁剪，我们需要在 c2 后面再增加 3 条 tool 消息，或者修改测试逻辑。
      // 让我们增加更多的 tool 消息来确保 c2 被裁剪。
      
      const moreMessages: MessageRecord[] = [
        ...messages,
        { role: 'tool', content: 'B'.repeat(3000), messageId: 'msg7', contentId: 'c7' },
        { role: 'tool', content: 'C'.repeat(3000), messageId: 'msg8', contentId: 'c8' },
        { role: 'tool', content: 'D'.repeat(3000), messageId: 'msg9', contentId: 'c9' },
      ];

      const result = engine.pruneMessages(moreMessages);
      const { prunedMessages: finalPruned, metadata: finalMeta, lastPrunedContentId: finalLastId } = result;

      // c2 应该是被裁剪的，因为它不在最近的 3 条 tool 消息（c7, c8, c9）之内
      expect(finalPruned[1].content).not.toEqual(longContent);
      expect(finalMeta['c2']).toBeDefined();
      
      // 验证一致性：应用覆盖层后的结果应与直接裁剪的结果一致
      const restoredMessages = [...moreMessages];
      if (finalMeta && finalLastId) {
        engine.applyPruningOverlay(restoredMessages, finalMeta, finalLastId);
      }
      expect(restoredMessages[1].content).toEqual(finalPruned[1].content);
    });

    it('should respect the protected recent tool results limit', () => {
      const longContent = 'B'.repeat(3000);
      const messages: MessageRecord[] = [
        { role: 'tool', content: longContent, messageId: 'msg1', contentId: 'c1' },
        { role: 'tool', content: longContent, messageId: 'msg2', contentId: 'c2' },
        { role: 'tool', content: longContent, messageId: 'msg3', contentId: 'c3' }, // 最近的 3 条应受保护
      ];

      const { metadata } = engine.pruneMessages(messages);

      // 最近的 3 条不应被裁剪，因此元数据应为空
      expect(Object.keys(metadata)).toHaveLength(0);
    });
  });
});
