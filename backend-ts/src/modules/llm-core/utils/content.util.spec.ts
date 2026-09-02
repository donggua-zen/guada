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
  });
});
