/// <reference types="jest" />

/**
 * ToolImagePruneService 单元测试
 *
 * 覆盖：
 * - 保留最近 N 轮，只裁更早轮次的 tool-result.images；用户上传 image 块不动
 * - 只写一条 tool_image/prune（keepFromSeq 分界，无 messageIds 列表）
 * - recordContextAnchor 的 savings 按 1500/张
 * - 裁剪后 context_stats.request 反映下次请求的媒体投影
 * - keepTurns >= 总轮数时 no-op
 */
import { ToolImagePruneService } from '../../src/modules/chat/compaction/tool-image-prune.service';
import type { FileRef } from '../../src/common/types/conversation.types';
import type { MessageNode } from '../../src/common/persistence/types';

function imageRef(name: string, bytes = 1024): FileRef {
  return {
    mediaType: 'image/jpeg',
    bytes,
    name,
    url: `sessions/s1/images/${name}`,
    refType: 'session',
  };
}

function userNode(id: string, seq: number, turnId: string): MessageNode {
  return {
    id,
    seq,
    turnId,
    role: 'user',
    kind: 'user',
    source: { kind: 'user' },
    metadata: {},
    content: [{ type: 'text', text: `q-${turnId}` }],
  };
}

function assistantCallNode(
  id: string,
  seq: number,
  turnId: string,
  toolCallId: string,
): MessageNode {
  return {
    id,
    seq,
    turnId,
    role: 'assistant',
    kind: 'model',
    source: { kind: 'model', provider: 'p', model: 'm' },
    metadata: {},
    content: [
      {
        type: 'tool-call',
        toolCallId,
        name: 'browser',
        arguments: '{}',
      },
    ],
  };
}

function toolNode(
  id: string,
  seq: number,
  turnId: string,
  toolCallId: string,
  images: FileRef[],
  prunedImages?: FileRef[],
): MessageNode {
  return {
    id,
    seq,
    turnId,
    role: 'tool',
    kind: 'model',
    source: { kind: 'tool', toolCallId },
    metadata: {},
    content: [
      {
        type: 'tool-result',
        toolCallId,
        name: 'browser',
        content: 'ok',
        images,
        ...(prunedImages ? { prunedImages } : {}),
      },
    ],
  };
}

const old1 = imageRef('old1.jpg');
const old2a = imageRef('old2a.jpg');
const old2b = imageRef('old2b.jpg');
const keep = imageRef('keep.jpg');

/** 3 轮：t1/t2 旧截图，t3 保留；after 模拟 replayer 已把旧图迁到 prunedImages */
function makeHistories(): { before: MessageNode[]; after: MessageNode[] } {
  const base: MessageNode[] = [
    userNode('u1', 1, 't1'),
    assistantCallNode('a1', 2, 't1', 'c1'),
    toolNode('r1', 3, 't1', 'c1', [old1]),
    userNode('u2', 4, 't2'),
    assistantCallNode('a2', 5, 't2', 'c2'),
    toolNode('r2', 6, 't2', 'c2', [old2a, old2b]),
    userNode('u3', 7, 't3'),
    assistantCallNode('a3', 8, 't3', 'c3'),
    toolNode('r3', 9, 't3', 'c3', [keep]),
  ];
  const after = base.map((node) => {
    if (node.id !== 'r1' && node.id !== 'r2') return node;
    const block = node.content[0] as {
      type: 'tool-result';
      images?: FileRef[];
    };
    return {
      ...node,
      content: [
        {
          ...block,
          images: [],
          prunedImages: block.images ?? [],
        },
      ],
    } as MessageNode;
  });
  return { before: base, after };
}

function createHarness(opts: { userImage?: boolean } = {}) {
  const { before, after } = makeHistories();
  if (opts.userImage) {
    before[0] = {
      ...before[0]!,
      content: [
        ...before[0]!.content,
        { type: 'image', attachment: imageRef('user.jpg') },
      ],
    };
    after[0] = {
      ...after[0]!,
      content: [
        ...after[0]!.content,
        { type: 'image', attachment: imageRef('user.jpg') },
      ],
    };
  }

  let pruned = false;
  let event: any;
  const context = {
    sessionId: 's1',
    sessionType: 'web',
    getModelConfig: () => ({
      id: 'm1',
      modelName: 'test-model',
      name: 'test',
      provider: {},
      modelType: 'chat',
      thinkingEfforts: [],
      config: {
        temperature: 0.7,
        topP: 1,
        frequencyPenalty: 0,
        maxOutputTokens: 1024,
        inputCapabilities: ['image'],
      },
    }),
    getSystemText: () => 'system',
    getResolvedPlugins: () => [],
    getThinkingEffort: () => undefined,
    getWorkspacePath: () => null,
    getHistory: jest.fn(async () => (pruned ? after : before)),
    getTokenCount: jest.fn(async () => 10000),
    getContextStats: jest.fn(async () => ({
      usedTokens: 5500,
      effectiveContextWindow: 100000,
      messageCount: after.length,
      breakdown: { systemPrompt: 10, history: 5480, tools: 10 },
    })),
    appendToolImagePrune: jest.fn(async (data: any) => {
      event = data;
      pruned = true;
      return 11;
    }),
    recordContextAnchor: jest.fn(async () => {}),
    appendContextStats: jest.fn(async () => {}),
    publishStream: jest.fn(async () => {}),
  };
  const service = new ToolImagePruneService();
  return { service, context, getEvent: () => event };
}

describe('ToolImagePruneService', () => {
  it('保留最近 1 轮：只裁 t1/t2 的工具截图，一条事件 + anchor + context_stats', async () => {
    const { service, context, getEvent } = createHarness();
    const result = await service.prune(context as any, 1);

    expect(result).toEqual({
      keptTurns: 1,
      prunedImages: 3,
      prunedBytes: 3 * 1368, // 1024 原始字节 → 1368 base64 字符
    });

    const event = getEvent();
    expect(event).toMatchObject({
      keepTurns: 1,
      keepFromSeq: 7, // u3 的 seq
      boundaryMessageId: 'u3',
      imageCount: 3,
      prunedBytes: 3 * 1368,
      prunedTokens: 3 * 1500,
    });
    expect(context.appendToolImagePrune).toHaveBeenCalledTimes(1);
    expect(context.recordContextAnchor).toHaveBeenCalledWith({
      beforeTokens: 10000,
      savings: [
        { index: 2, tokens: 1500 },
        { index: 5, tokens: 3000 },
      ],
    });

    // context_stats.request 来自裁剪后的视图：只保留 r3 的 1 张
    const statsCall = (context.appendContextStats as jest.Mock).mock.calls[0];
    expect(statsCall[0]).toBe('t3');
    expect(statsCall[1].request).toMatchObject({
      mediaBytes: 1368,
      mediaBudgetBytes: expect.any(Number),
      retainedImages: 1,
      omittedImages: 0,
    });
    expect(context.publishStream).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'context_stats', turnId: 't3' }),
    );
    expect(context.publishStream).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'tool_image_prune',
        seq: 11,
        imageCount: 3,
        keepTurns: 1,
      }),
    );
  });

  it('用户上传 image 块不参与裁剪，仍计入下次请求媒体', async () => {
    const { service, context, getEvent } = createHarness({ userImage: true });
    const result = await service.prune(context as any, 1);
    expect(result.prunedImages).toBe(3);
    expect(getEvent().imageCount).toBe(3); // 不含 user.jpg

    const stats = (context.appendContextStats as jest.Mock).mock.calls[0][1];
    expect(stats.request.retainedImages).toBe(2); // user.jpg + r3 keep.jpg
  });

  it('keepTurns >= 总轮数：no-op（不写事件、不写 anchor、不广播）', async () => {
    const { service, context } = createHarness();
    const result = await service.prune(context as any, 99);
    expect(result).toEqual({ keptTurns: 3, prunedImages: 0, prunedBytes: 0 });
    expect(context.appendToolImagePrune).not.toHaveBeenCalled();
    expect(context.recordContextAnchor).not.toHaveBeenCalled();
    expect(context.appendContextStats).not.toHaveBeenCalled();
    expect(context.publishStream).not.toHaveBeenCalled();
  });
});
