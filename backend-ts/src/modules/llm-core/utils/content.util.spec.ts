import type { Message } from '../../../common/types/conversation.types';
import { hasImageBlock, assertNoImageContent } from './content.util';

function msgWithImage(hasImage: boolean): Message {
  return {
    id: 'm1',
    role: 'user',
    kind: 'user',
    source: { kind: 'user' },
    metadata: {},
    content: hasImage
      ? [
          {
            type: 'image',
            attachment: { attachmentId: 'a1', mediaType: 'image/png', bytes: 1, url: 'u' },
          },
        ]
      : [{ type: 'text', text: 'hi' }],
  } as Message;
}

describe('content.util', () => {
  describe('hasImageBlock', () => {
    it('检测 image 块', () => {
      expect(hasImageBlock([msgWithImage(true)])).toBe(true);
      expect(hasImageBlock([msgWithImage(false)])).toBe(false);
      expect(hasImageBlock([])).toBe(false);
    });

    it('检测 tool-result 内嵌图片（工具图片不拆分落库）', () => {
      const msg: Message = {
        id: 'm2',
        role: 'tool',
        kind: 'model',
        source: { kind: 'tool', toolCallId: 'c1' },
        metadata: {},
        content: [
          {
            type: 'tool-result',
            toolCallId: 'c1',
            name: 'image_view',
            content: 'loaded',
            images: [{ mediaType: 'image/png', bytes: 1, url: 'u' }],
          },
        ],
      };
      expect(hasImageBlock([msg])).toBe(true);
    });
  });

  describe('assertNoImageContent', () => {
    it('能力未知（undefined）时跳过断言（向后兼容）', () => {
      expect(() =>
        assertNoImageContent([msgWithImage(true)], undefined, 'openai', 'gpt-4o'),
      ).not.toThrow();
    });

    it('支持图片时不抛错', () => {
      expect(() =>
        assertNoImageContent([msgWithImage(true)], true, 'openai', 'gpt-4o'),
      ).not.toThrow();
    });

    it('不支持图片且含 image 块 → 抛 UNSUPPORTED_CONTENT（含定位信息）', () => {
      expect(() =>
        assertNoImageContent([msgWithImage(true)], false, 'openai', 'deepseek-chat'),
      ).toThrow(/UNSUPPORTED_CONTENT.*deepseek-chat.*openai/s);
    });

    it('不支持图片但无 image 块 → 不抛错', () => {
      expect(() =>
        assertNoImageContent([msgWithImage(false)], false, 'openai', 'deepseek-chat'),
      ).not.toThrow();
    });

    it('不支持图片且 tool-result 含图片 → 抛 UNSUPPORTED_CONTENT', () => {
      const msg: Message = {
        id: 'm2',
        role: 'tool',
        kind: 'model',
        source: { kind: 'tool', toolCallId: 'c1' },
        metadata: {},
        content: [
          {
            type: 'tool-result',
            toolCallId: 'c1',
            name: 'image_view',
            content: 'loaded',
            images: [{ mediaType: 'image/png', bytes: 1, url: 'u' }],
          },
        ],
      };
      expect(() =>
        assertNoImageContent([msg], false, 'openai', 'deepseek-chat'),
      ).toThrow(/UNSUPPORTED_CONTENT.*deepseek-chat.*openai/s);
    });
  });
});
