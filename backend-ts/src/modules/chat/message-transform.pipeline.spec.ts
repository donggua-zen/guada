import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import type { Message, ContentBlock } from '../../common/types/conversation.types';
import {
  TransformContext,
  kbRefProjectionStep,
  imageProjectionStep,
  imagePathAnnotationStep,
  filePathBridgeStep,
  reasoningPolicyStep,
  emptyContentCompatStep,
  isFullReasoningRelayModel,
  createDefaultMessageTransformPipeline,
} from './message-transform.pipeline';
import { fileBlockToText } from '../llm-core/utils/attachment.util';

function makeMsg(
  role: Message['role'],
  content: ContentBlock[],
  overrides: Partial<Message> & { turnId?: string | null } = {},
): Message {
  const { turnId, ...rest } = overrides;
  const msg = {
    id: rest.id ?? `m-${Math.random().toString(36).slice(2, 8)}`,
    role,
    kind: role === 'user' ? 'user' : 'model',
    source: rest.source ?? { kind: 'user' },
    metadata: rest.metadata ?? {},
    content,
  };
  // turnId 是 store 折叠视图（MessageNode）的归属标签，不属于 Message 本体
  return (turnId !== undefined ? { ...msg, turnId } : msg) as Message;
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

const kbRef = (id: string, name: string): ContentBlock =>
  ({
    type: 'kb-ref',
    kbRefs: [{ id, name }],
  }) as ContentBlock;

const reasoning = (summary: string): ContentBlock => ({
  type: 'reasoning',
  summary,
});

const baseCtx: TransformContext = {
  supportsImageInput: true,
  thinkingMode: false,
};

// 桥接依赖 UPLOAD_ROOT_DIR（与运行时 Electron/standalone 注入同源），测试内指向临时目录
let uploadRoot = '';
beforeAll(async () => {
  uploadRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pipeline-img-'));
  process.env.UPLOAD_ROOT_DIR = uploadRoot;
});
afterAll(async () => {
  delete process.env.UPLOAD_ROOT_DIR;
  await fs.rm(uploadRoot, { recursive: true, force: true });
});

describe('kb-ref-projection step', () => {
  it('kb-ref 块 → 引用清单文本（name/id 形状，含 description；原文块在前保留）', () => {
    const msgs = [
      makeMsg('user', [
        text('查资料'),
        {
          type: 'kb-ref',
          kbRefs: [
            { id: 'kb1', name: '产品手册', description: 'v2 说明' },
            { id: 'kb2', name: 'FAQ' },
          ],
        } as ContentBlock,
      ]),
    ];
    const out = kbRefProjectionStep.apply(msgs, baseCtx);

    expect(out).not.toBe(msgs);
    const blocks = out[0].content;
    expect(blocks).toHaveLength(2);
    expect(blocks[0].type).toBe('text'); // 用户原文不受影响
    expect(blocks[1].type).toBe('text'); // kb-ref 投影为文本
    const listing = (blocks[1] as { text: string }).text;
    expect(listing).toContain('[referenced knowledge bases]');
    expect(listing).toContain('- name: 产品手册, id: kb1, description: v2 说明');
    expect(listing).toContain('- name: FAQ, id: kb2');
    // 存储层原样保留（副本变换），前端 chips 仍可读 kbRefs
    expect(msgs[0].content[1].type).toBe('kb-ref');
  });

  it('空 kbRefs 兜底为 (none) 清单（与 token-meter/摘要口径一致）', () => {
    const msgs = [makeMsg('user', [{ type: 'kb-ref', kbRefs: [] } as ContentBlock])];
    const out = kbRefProjectionStep.apply(msgs, baseCtx);
    expect((out[0].content[0] as { text: string }).text).toContain('(none)');
  });

  it('无 kb-ref 的消息原样返回（消息对象同一引用，零拷贝；map 仅重建数组壳）', () => {
    const msgs = [makeMsg('user', [text('q')])];
    const out = kbRefProjectionStep.apply(msgs, baseCtx);
    expect(out[0]).toBe(msgs[0]);
  });
});

describe('image-projection step', () => {
  it('支持图片输入时原样透传', () => {
    const msgs = [makeMsg('user', [text('看图'), image('img1')])];
    expect(imageProjectionStep.apply(msgs, baseCtx)).toBe(msgs);
  });

  it('不支持图片输入时 image 块 → 含桥接绝对路径的英文占位文本', () => {
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
    // 存储引用被请求时桥接为 UPLOAD_ROOT_DIR下的绝对路径，不再出现相对引用
    expect(placeholder).toContain(
      `Image file path: ${path.join(path.resolve(uploadRoot), 'images/img1.png')}`,
    );
    expect(placeholder).not.toContain('uploads/images/img1.png');
    expect(placeholder).not.toContain('image_id');
    // 原消息对象不被修改（副本变换）
    expect(msgs[0].content[1].type).toBe('image');
  });

  it('data: 内联图无法桥接 → 占位文本明确告知无可用文件路径', () => {
    const msgs = [
      makeMsg('user', [
        {
          type: 'image',
          attachment: { attachmentId: 'x', mediaType: 'image/png', bytes: 1, url: 'data:image/png;base64,QUJD' },
        } as ContentBlock,
      ]),
    ];
    const out = imageProjectionStep.apply(msgs, {
      ...baseCtx,
      supportsImageInput: false,
    });
    const t = (out[0].content[0] as { text: string }).text;
    expect(t).toContain('No readable file path is available');
  });
});

describe('image-path-annotation step', () => {
  it('多模态模型：image 块后追加只读绝对路径注解文本块', () => {
    const msgs = [makeMsg('user', [text('看图'), image('img1')])];
    const out = imagePathAnnotationStep.apply(msgs, baseCtx);

    const blocks = out[0].content;
    expect(blocks).toHaveLength(3);
    expect(blocks[1].type).toBe('image'); // image 块原样保留
    expect(blocks[2].type).toBe('text');
    const note = (blocks[2] as { text: string }).text;
    expect(note).toContain('[Image attachment (read-only):');
    expect(note).toContain(path.join(path.resolve(uploadRoot), 'images/img1.png'));
    // 注解只附路径、不暗示调用工具（文案设计约定，见 imagePathAnnotationStep）
    expect(note).not.toContain('image_recognize');
  });

  it('data: 内联图无物理路径 → 不追加注解', () => {
    const msgs = [
      makeMsg('user', [
        {
          type: 'image',
          attachment: { attachmentId: 'x', mediaType: 'image/png', bytes: 1, url: 'data:image/png;base64,QUJD' },
        } as ContentBlock,
      ]),
    ];
    const out = imagePathAnnotationStep.apply(msgs, baseCtx);
    expect(out).toBe(msgs);
    expect(out[0].content).toHaveLength(1);
  });

  it('不支持图片输入的模型不做注解（路径由 image-projection 负责）', () => {
    const msgs = [makeMsg('user', [image('img1')])];
    expect(imagePathAnnotationStep.apply(msgs, { ...baseCtx, supportsImageInput: false })).toBe(msgs);
  });

  it('无图片的消息不受影响', () => {
    const msgs = [makeMsg('user', [text('q')])];
    expect(imagePathAnnotationStep.apply(msgs, baseCtx)).toBe(msgs);
  });
});

describe('reasoning-policy step', () => {
  it('思考模式：无 reasoning 的 assistant 消息补占位块', () => {
    const msgs = [makeMsg('assistant', [text('hi')])];
    const out = reasoningPolicyStep.apply(msgs, { ...baseCtx, thinkingMode: true });
    expect(out[0].content).toHaveLength(2);
    expect(out[0].content[1]).toMatchObject({ type: 'reasoning', summary: '' });
  });

  it('思考模式：summary 为空时填充空串（对齐 DSH/pi-ai，不用空格）', () => {
    const msgs = [makeMsg('assistant', [reasoning(''), text('hi')])];
    const out = reasoningPolicyStep.apply(msgs, { ...baseCtx, thinkingMode: true });
    expect(out[0].content[0]).toMatchObject({ type: 'reasoning', summary: '' });
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

describe('reasoning-policy step — 最后一轮判定（currentTurnId）', () => {
  const thinkCtx = (overrides: Partial<TransformContext> = {}): TransformContext => ({
    ...baseCtx,
    thinkingMode: true,
    ...overrides,
  });

  it('思考模式：最后一轮保留原文思考，历史轮次剥离', () => {
    const msgs = [
      makeMsg('assistant', [reasoning('old thought'), text('a1')], { turnId: 'T1' }),
      makeMsg('user', [text('q2')], { turnId: 'T2' }),
      makeMsg('assistant', [reasoning('fresh thought'), text('a2')], { turnId: 'T2' }),
    ];
    const out = reasoningPolicyStep.apply(msgs, thinkCtx({ currentTurnId: 'T2' }));
    expect(out[0].content).toHaveLength(1); // T1 思考已剥离
    expect(out[0].content[0].type).toBe('text');
    expect(out[2].content).toHaveLength(2); // T2 思考保留
    expect(out[2].content[0]).toMatchObject({ type: 'reasoning', summary: 'fresh thought' });
  });

  it('思考模式：最后一轮无 reasoning 补占位、空 summary 填空串；同回合多条 assistant 均填充', () => {
    const msgs = [
      makeMsg('assistant', [text('tool-call-round')], { turnId: 'T2' }),
      makeMsg('assistant', [reasoning(''), text('final')], { turnId: 'T2' }),
    ];
    const out = reasoningPolicyStep.apply(msgs, thinkCtx({ currentTurnId: 'T2' }));
    expect(out[0].content[1]).toMatchObject({ type: 'reasoning', summary: '' });
    expect(out[1].content[0]).toMatchObject({ type: 'reasoning', summary: '' });
  });

  it('思考模式：currentTurnId 在视图中无消息时历史全部剥离（无位置歧义）', () => {
    const msgs = [
      makeMsg('assistant', [reasoning('history thought'), text('a1')], { turnId: 'T1' }),
      makeMsg('user', [text('q1')], { turnId: 'T1' }),
    ];
    const out = reasoningPolicyStep.apply(msgs, thinkCtx({ currentTurnId: 'T2' }));
    expect(out[0].content).toHaveLength(1);
    expect(out[0].content[0].type).toBe('text');
  });

  it('思考模式：currentTurnId 缺省 → 全部视为最后一轮（保守回退 = 现状填充行为）', () => {
    const msgs = [
      makeMsg('assistant', [text('a1')], { turnId: 'T1' }),
      makeMsg('assistant', [reasoning('kept'), text('a2')], { turnId: 'T2' }),
    ];
    const out = reasoningPolicyStep.apply(msgs, thinkCtx());
    expect(out[0].content[1]).toMatchObject({ type: 'reasoning', summary: '' });
    expect(out[1].content[0]).toMatchObject({ type: 'reasoning', summary: 'kept' });
  });
});

describe('reasoning-policy step — fullReasoningRelay 例外（deepseek-v4 系）', () => {
  const relayCtx = (overrides: Partial<TransformContext> = {}): TransformContext => ({
    ...baseCtx,
    thinkingMode: true,
    currentTurnId: 'T2',
    ...overrides,
  });

  it('思考模式 + relay：全部轮次保留思考，缺失填充', () => {
    const msgs = [
      makeMsg('assistant', [reasoning('old thought'), text('a1')], { turnId: 'T1' }),
      makeMsg('assistant', [text('a2')], { turnId: 'T2' }),
    ];
    const out = reasoningPolicyStep.apply(msgs, relayCtx({ fullReasoningRelay: true }));
    expect(out[0].content[0]).toMatchObject({ type: 'reasoning', summary: 'old thought' });
    expect(out[1].content[1]).toMatchObject({ type: 'reasoning', summary: '' });
  });

  it('非思考模式 + relay：仍剥离全部 reasoning（relay 仅在思考模式生效）', () => {
    const msgs = [makeMsg('assistant', [reasoning('t'), text('a')], { turnId: 'T2' })];
    const out = reasoningPolicyStep.apply(msgs, {
      ...baseCtx,
      thinkingMode: false,
      fullReasoningRelay: true,
    });
    expect(out[0].content).toHaveLength(1);
    expect(out[0].content[0].type).toBe('text');
  });
});

describe('isFullReasoningRelayModel', () => {
  it.each([
    'deepseek-v4',
    'DeepSeek-V4-Flash',
    'deepseek-ai/DeepSeek-V4-0324',
  ])('命中：%s', (name) => {
    expect(isFullReasoningRelayModel(name)).toBe(true);
  });

  it.each([
    'provider/deepseek_v4-turbo',
    'deepseek-chat',
    'deepseek-reasoner',
    'DeepSeek-V3.2',
    'deepseek-ai/DeepSeek-R1',
    'gpt-4o',
    'claude-sonnet-4',
    '',
  ])('不命中：%s', (name) => {
    expect(isFullReasoningRelayModel(name)).toBe(false);
  });

  it('空值安全', () => {
    expect(isFullReasoningRelayModel(undefined)).toBe(false);
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
  it('按注册顺序执行：KB 引用投影最先，kb-ref 与 image 同存时全部投影为文本', () => {
    const pipeline = createDefaultMessageTransformPipeline();
    const msgs = [
      makeMsg('user', [text('查资料'), kbRef('kb1', '产品手册'), image('img1')]),
      makeMsg('assistant', [reasoning('th'), text('ok')]),
    ];
    const out = pipeline.run(msgs, {
      ...baseCtx,
      supportsImageInput: false,
      thinkingMode: false,
    });

    // user 消息：kb-ref 与 image 均已投影为文本
    expect(out[0].content.every((b) => b.type === 'text')).toBe(true);
    const joined = out[0].content
      .map((b) => (b as { text: string }).text)
      .join('\n');
    expect(joined).toContain('[referenced knowledge bases]');
    expect(joined).toContain('Image omitted');
    // assistant 消息：reasoning 已被剥离
    expect(out[1].content.every((b) => b.type !== 'reasoning')).toBe(true);
  });

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

  it('思考模式历史轮次剥离后空 content 由 empty-content-compat 兜底', () => {
    const pipeline = createDefaultMessageTransformPipeline();
    const msgs = [
      makeMsg('assistant', [reasoning('only thought')], { turnId: 'T1' }),
      makeMsg('user', [text('q')], { turnId: 'T2' }),
    ];
    const out = pipeline.run(msgs, {
      ...baseCtx,
      thinkingMode: true,
      currentTurnId: 'T2',
    });
    expect(out[0].content).toEqual([{ type: 'text', text: '\n' }]);
  });

  it('入参数组不被任何步骤修改', () => {
    const pipeline = createDefaultMessageTransformPipeline();
    const msgs = [makeMsg('user', [image('img1')]), makeMsg('assistant', [])];
    const snapshot = JSON.stringify(msgs);
    pipeline.run(msgs, { ...baseCtx, supportsImageInput: false });
    expect(JSON.stringify(msgs)).toBe(snapshot);
  });
});

/**
 * file-path-bridge：把 'workspace' 形态的 file 块引用改写成绝对路径副本，
 * 使 adapter 侧的 fileBlockToText（拿不到会话上下文）也能打印真实可读路径。
 */
describe('file-path-bridge step', () => {
  const workspaceRef = (name: string, url = `uploads/20260915/${name}`): ContentBlock =>
    ({
      type: 'file',
      attachment: { name, url, mediaType: 'application/pdf', bytes: 1, refType: 'workspace' },
    }) as ContentBlock;

  const storeRef = (name: string): ContentBlock =>
    ({
      type: 'file',
      attachment: { name, url: `uploads/files/${name}`, mediaType: 'text/plain', bytes: 1 },
    }) as ContentBlock;

  const ctx: TransformContext = { ...baseCtx, workspaceDir: '/ws' };

  it("'workspace' 引用被改写为绝对路径副本，形态标记为 local", () => {
    const out = filePathBridgeStep.apply([makeMsg('user', [workspaceRef('a.pdf')])], ctx);
    const block: any = out[0].content[0];
    expect(block.type).toBe('file');
    expect(block.attachment.refType).toBe('local');
    expect(block.attachment.url).toBe(
      path.join(path.resolve('/ws'), 'uploads/20260915/a.pdf'),
    );
  });

  it("'store' 引用不被改写", () => {
    const msgs = [makeMsg('user', [storeRef('a.txt')])];
    expect(filePathBridgeStep.apply(msgs, ctx)).toBe(msgs);
  });

  it('无 workspaceDir 时整体原样返回（下游退化为只给文件名）', () => {
    const msgs = [makeMsg('user', [workspaceRef('a.pdf')])];
    expect(
      filePathBridgeStep.apply(msgs, { ...baseCtx, workspaceDir: null }),
    ).toBe(msgs);
  });

  it('引用越出工作目录时不改写（不给可疑路径）', () => {
    const msgs = [makeMsg('user', [workspaceRef('a.pdf', '../../../etc/passwd')])];
    expect(filePathBridgeStep.apply(msgs, ctx)).toBe(msgs);
  });

  it('改写的是副本，入参数组保持原状', () => {
    const msgs = [makeMsg('user', [workspaceRef('a.pdf')])];
    const snapshot = JSON.stringify(msgs);
    filePathBridgeStep.apply(msgs, ctx);
    expect(JSON.stringify(msgs)).toBe(snapshot);
  });

  it('接入默认管线后路径文案只由 fileBlockToText 输出一次（不追加文本块）', () => {
    const pipeline = createDefaultMessageTransformPipeline();
    const out = pipeline.run([makeMsg('user', [workspaceRef('a.pdf')])], ctx);
    expect(out[0].content).toHaveLength(1);
    const expectedUrl = path.join(path.resolve('/ws'), 'uploads/20260915/a.pdf');
    expect(fileBlockToText((out[0].content[0] as any).attachment)).toBe(
      `[文件: a.pdf (${expectedUrl})]。解析内容请调用 document.doc_parse（file_path 传上面的绝对路径）`,
    );
  });
});
