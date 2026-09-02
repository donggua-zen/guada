import type { Message, ContentBlock } from '../../common/types/conversation.types';
import {
  TransformContext,
  imageProjectionStep,
  reasoningPolicyStep,
  emptyContentCompatStep,
  createDefaultMessageTransformPipeline,
} from './message-transform.pipeline';

function makeMsg(
  role: Message['role'],
  content: ContentBlock[],
  overrides: Partial<Message> = {},
): Message {
  return {
    id: overrides.id ?? `m-${Math.random().toString(36).slice(2, 8)}`,
    role,
    kind: role === 'user' ? 'user' : 'model',
    source: overrides.source ?? { kind: 'user' },
    metadata: overrides.metadata ?? {},
    content,
  } as Message;
}

const text = (t: string): ContentBlock => ({
  type: 'text',
  text: t,
});

const image = (id: string): ContentBlock => ({
  type: 'image',
  attachment: {
    attachmentId: id,
    mediaType: 'image/png',
    bytes: 100,
    url: `uploads/images/${id}.png`,
  },
} as ContentBlock);

const reasoning = (summary: string): ContentBlock => ({
  type: 'reasoning',
  summary,
});

const baseCtx: TransformContext = {
  supportsImageInput: true,
  thinkingMode: false,
};

describe('image-projection step', () => {
  it('支持图片输入时原样透传', () => {
    const msgs = [makeMsg('user', [text('看图'), image('img1')])];
    expect(imageProjectionStep.apply(msgs, baseCtx)).toBe(msgs);
  });

  it('不支持图片输入时 image 块 → 含文件路径的英文占位文本', () => {
    const msgs = [makeMsg('user', [text('看图'), image('img1')])];
    const out = imageProjectionStep.apply(msgs, {
      ...baseCtx,
      supportsImageInput: false,
    });

    expect(out).not.toBe(msgs);
    const blocks = out[0].content;
    expect(blocks).toHaveLength(2);
    expect(blocks[1].type).toBe('text');
    const placeholder = (blocks[1] as { text: string }).text;
    expect(placeholder).toContain('Image omitted');
    expect(placeholder).toContain('Image file path: uploads/images/img1.png');
    expect(placeholder).not.toContain('image_id');
    // 原消息对象不被修改（副本变换）
    expect(msgs[0].content[1].type).toBe('image');
  });

  it('占位文本含文件路径、不含 image_id', () => {
    const msgs = [makeMsg('user', [image('img2')])];
    const out = imageProjectionStep.apply(msgs, {
      ...baseCtx,
      supportsImageInput: false,
    });
    const t = (out[0].content[0] as { text: string }).text;
    expect(t).toContain('uploads/images/img2.png');
    expect(t).not.toContain('image_id');
  });
});

describe('reasoning-policy step', () => {
  it('思考模式：无 reasoning 的 assistant 消息补占位块', () => {
    const msgs = [makeMsg('assistant', [text('hi')])];
    const out = reasoningPolicyStep.apply(msgs, { ...baseCtx, thinkingMode: true });
    expect(out[0].content).toHaveLength(2);
    expect(out[0].content[1]).toMatchObject({ type: 'reasoning', summary: ' ' });
  });

  it('思考模式：summary 为空时填充空格', () => {
    const msgs = [makeMsg('assistant', [reasoning(''), text('hi')])];
    const out = reasoningPolicyStep.apply(msgs, { ...baseCtx, thinkingMode: true });
    expect(out[0].content[0]).toMatchObject({ type: 'reasoning', summary: ' ' });
  });

  it('非思考模式：剥离 reasoning 块', () => {
    const msgs = [makeMsg('assistant', [reasoning('deep thought'), text('hi')])];
    const out = reasoningPolicyStep.apply(msgs, { ...baseCtx, thinkingMode: false });
    expect(out[0].content).toHaveLength(1);
    expect(out[0].content[0].type).toBe('text');
  });

  it('非 assistant 消息不受影响', () => {
    const msgs = [makeMsg('user', [text('q')])];
    const out = reasoningPolicyStep.apply(msgs, { ...baseCtx, thinkingMode: false });
    expect(out[0].content).toHaveLength(1);
  });
});

describe('empty-content-compat step', () => {
  it('assistant 空 content → 单个换行文本块', () => {
    const msgs = [makeMsg('assistant', [])];
    const out = emptyContentCompatStep.apply(msgs, baseCtx);
    expect(out[0].content).toEqual([{ type: 'text', text: '\n' }]);
  });

  it('user 空 content 同样 → 换行文本块（否则 OpenAI 400 missing messages.content）', () => {
    const msgs = [makeMsg('user', [])];
    const out = emptyContentCompatStep.apply(msgs, baseCtx);
    expect(out[0].content).toEqual([{ type: 'text', text: '\n' }]);
  });

  it('非空 content 不受影响', () => {
    const msgs = [makeMsg('user', [text('q')])];
    const out = emptyContentCompatStep.apply(msgs, baseCtx);
    expect(out[0].content).toHaveLength(1);
  });
});

describe('default pipeline', () => {
  it('按注册顺序执行：图片投影先于 reasoning/空 content', () => {
    const pipeline = createDefaultMessageTransformPipeline();
    const msgs = [
      makeMsg('user', [image('img1'), text('看这张图')]),
      makeMsg('assistant', [reasoning('th'), text('ok')]),
    ];
    const out = pipeline.run(msgs, {
      ...baseCtx,
      supportsImageInput: false,
      thinkingMode: false,
    });

    // user 消息：图片已被投影为文本
    expect(out[0].content.every((b) => b.type === 'text')).toBe(true);
    // assistant 消息：reasoning 已被剥离
    expect(out[1].content.every((b) => b.type !== 'reasoning')).toBe(true);
  });

  it('入参数组不被任何步骤修改', () => {
    const pipeline = createDefaultMessageTransformPipeline();
    const msgs = [makeMsg('user', [image('img1')]), makeMsg('assistant', [])];
    const snapshot = JSON.stringify(msgs);
    pipeline.run(msgs, { ...baseCtx, supportsImageInput: false });
    expect(JSON.stringify(msgs)).toBe(snapshot);
  });
});
