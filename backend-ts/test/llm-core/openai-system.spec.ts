/// <reference types="jest" />

import { OpenAIAdapter } from '../../src/modules/llm-core/adapters/openai.adapter';
import type { Message } from '../../src/common/types/conversation.types';

function userMsg(id: string, text: string): Message {
  return {
    id,
    role: 'user',
    kind: 'user',
    source: { kind: 'user' },
    metadata: {},
    content: [{ type: 'text', text }],
  };
}

describe('OpenAIAdapter system 映射（envelope 独立字段）', () => {
  it('有 system 时：作为消息数组首条 {role:system}', async () => {
    const adapter = new OpenAIAdapter();
    const out = await (adapter as any).formatMessages(
      [userMsg('u1', 'hi')],
      'sys prompt',
    );
    expect(out[0]).toEqual({ role: 'system', content: 'sys prompt' });
    expect(out[1]).toMatchObject({ role: 'user' });
    expect(out).toHaveLength(2);
  });

  it('无 system 时：不插入 system 首条', async () => {
    const adapter = new OpenAIAdapter();
    const out = await (adapter as any).formatMessages(
      [userMsg('u1', 'hi')],
      undefined,
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ role: 'user' });
  });

  it('空 system 字符串按无 system 处理', async () => {
    const adapter = new OpenAIAdapter();
    const out = await (adapter as any).formatMessages(
      [userMsg('u1', 'hi')],
      '',
    );
    expect(out).toHaveLength(1);
  });
});
