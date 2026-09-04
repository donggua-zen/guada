/// <reference types="jest" />

import { TagParserPipeline } from '../../src/modules/chat/parsers/tag-parser-pipeline.service';
import { CommandProviderRegistry } from '../../src/modules/commands/command-provider-registry.service';
import type { CommandContext, ParserResult } from '../../src/modules/commands/interfaces/command-provider.interface';

describe('TagParserPipeline（注入块模式）', () => {
  let registry: CommandProviderRegistry;
  let pipeline: TagParserPipeline;

  beforeEach(() => {
    registry = new CommandProviderRegistry();
    pipeline = new TagParserPipeline(registry);
  });

  const registerProvider = (
    id: string,
    parse?: (attrs: Record<string, string>, ctx?: CommandContext) => ParserResult | undefined,
  ) => {
    registry.register({
      id,
      trigger: 'slash',
      fetchItems: () => [],
      parse: parse as any,
    });
  };

  it('无标记：正文原样返回，无注入块', async () => {
    const result = await pipeline.parse('普通消息，没有任何标记');
    expect(result.originalText).toBe('普通消息，没有任何标记');
    expect(result.injectionBlocks).toEqual([]);
  });

  it('单一标记：正文原样保留（不改写），产物冻结为单个 origin=system 注入块', async () => {
    registerProvider('skill', () => ({
      replacement: '`skill:coder`',
      appendix: '---skill:coder---\ndescription:编程技能',
    }));

    const text = '请使用[/skill:coder label="coder"]技能帮我写代码';
    const result = await pipeline.parse(text);

    // 正文永不改写：标记原样保留（前端徽章渲染依赖原文）
    expect(result.originalText).toBe(text);
    expect(result.injectionBlocks).toHaveLength(1);
    const block = result.injectionBlocks[0];
    expect(block.type).toBe('text');
    expect((block as any).origin).toBe('system');
    expect((block as any).text).toContain('---skill:coder---');
    expect((block as any).text).toContain('description:编程技能');
  });

  it('多个标记：所有注入文案合并为单个注入块（\\n\\n 分隔）', async () => {
    registerProvider('skill', (attrs) => ({
      replacement: `\`skill:${attrs.name}\``,
      appendix: `---skill:${attrs.name}---`,
    }));

    const result = await pipeline.parse(
      '[/skill:coder label="a"] 和 [/skill:writer label="b"]',
    );

    expect(result.injectionBlocks).toHaveLength(1);
    const text = (result.injectionBlocks[0] as any).text;
    expect(text).toContain('---skill:coder---');
    expect(text).toContain('---skill:writer---');
    expect(text).toContain('\n\n');
  });

  it('commandCount 透传：parse 收到本次消息的标记总数', async () => {
    let receivedCount: number | undefined;
    registerProvider('skill', (_attrs, ctx) => {
      receivedCount = ctx?.commandCount;
      return { replacement: 'x', appendix: 'A' };
    });

    await pipeline.parse('[/skill:a] 中间话 [/skill:b] [/skill:c]');
    expect(receivedCount).toBe(3);
  });

  it('未注册的提供者：无注入块，正文原样', async () => {
    const result = await pipeline.parse('[/unknown:foo label="x"]');
    expect(result.originalText).toBe('[/unknown:foo label="x"]');
    expect(result.injectionBlocks).toEqual([]);
  });

  it('parse 返回 undefined：无注入块，正文原样（降级）', async () => {
    registerProvider('skill', () => undefined);
    const result = await pipeline.parse('[/skill:missing label="x"]');
    expect(result.injectionBlocks).toEqual([]);
    expect(result.originalText).toBe('[/skill:missing label="x"]');
  });

  it('parse 抛错：无注入块，正文原样（不向上传播）', async () => {
    registerProvider('skill', () => {
      throw new Error('boom');
    });
    const result = await pipeline.parse('[/skill:boom]');
    expect(result.injectionBlocks).toEqual([]);
  });

  it('相同标记重复出现：只解析一次，注入文案只生成一份', async () => {
    let callCount = 0;
    registerProvider('skill', () => {
      callCount += 1;
      return { replacement: 'x', appendix: 'ONCE' };
    });

    const result = await pipeline.parse('[/skill:a] 再来 [/skill:a]');
    expect(callCount).toBe(1);
    expect(result.injectionBlocks).toHaveLength(1);
    expect((result.injectionBlocks[0] as any).text).toBe('ONCE');
  });

  it('appendix 缺省的解析结果：不产生注入块', async () => {
    registerProvider('skill', () => ({ replacement: '`skill:x`' }));
    const result = await pipeline.parse('[/skill:x]');
    expect(result.injectionBlocks).toEqual([]);
  });
});
