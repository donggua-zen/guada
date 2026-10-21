/// <reference types="jest" />

import { ChatController } from '../../src/modules/chat/chat.controller';
import {
  BadRequestException,
  HttpException,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import { InteractionWaitService } from '../../src/common/services/interaction-wait.service';
import type { AskQuestion } from '../../src/common/types/ask.types';

const questions: AskQuestion[] = [
  { id: 'approval', question: '是否同意？', options: [{ label: '同意' }, { label: '拒绝' }] },
];

function buildController(overrides?: { resolveAnswers?: boolean }) {
  const interactionWait = new InteractionWaitService();
  const controller = new ChatController(
    {} as any, // sessionService
    {} as any, // streamManager
    {} as any, // chatRunner
    {} as any, // tagParserPipeline
    interactionWait,
  );
  // 挂起一个等待者（模拟 AskService.ask 原地阻塞中）
  const delivered = { value: false };
  const pending = interactionWait.waitForAnswers('s1', 'uuid-request-1', questions);
  pending.then(() => (delivered.value = true)).catch(() => {});
  if (overrides?.resolveAnswers !== false) {
    // 投递包装：resolveAnswers 返回值由真实等待表决定
    void delivered;
  }
  return { controller, interactionWait, pending };
}

describe('ChatController - respond（统一交互应答：审批/询问/继续共用）', () => {
  it('有等待者时按 requestId 凭证投递答案并返回成功', async () => {
    const { controller, interactionWait, pending } = buildController();
    const answers = [{ id: 'approval', selected: ['同意'] }];

    const resultPromise = Promise.resolve(controller.respond({
      sessionId: 's1',
      requestId: 'uuid-request-1',
      answers,
    }));
    // 应答先于断言落地：respond 内部同步 resolve 等待者
    const result = await resultPromise;

    expect(result).toEqual({ success: true, requestId: 'uuid-request-1', answersCount: 1 });
    await expect(pending).resolves.toEqual(answers);
    // 表已消费
    expect(interactionWait.resolveAnswers('s1', 'uuid-request-1', answers)).toBe(false);
    void interactionWait;
  });

  it('无等待者（凭证不匹配/已消费/重启丢表）抛 NotFoundException', async () => {
    const { controller } = buildController();
    await expect(
      controller.respond({
        sessionId: 's1',
        requestId: 'uuid-stale',
        answers: [{ id: 'approval', selected: ['同意'] }],
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('缺少 sessionId / requestId 抛 BadRequestException', async () => {
    const { controller } = buildController();
    await expect(
      controller.respond({ sessionId: '', requestId: 'r1', answers: [{ id: 'approval', selected: [] }] }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      controller.respond({ sessionId: 's1', requestId: '', answers: [{ id: 'approval', selected: [] }] }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('answers 为空抛 BadRequestException', async () => {
    const { controller } = buildController();
    await expect(
      controller.respond({ sessionId: 's1', requestId: 'uuid-request-1', answers: [] }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('答案 id 与问题单不匹配抛 BadRequestException', async () => {
    const { controller } = buildController();
    await expect(
      controller.respond({
        sessionId: 's1',
        requestId: 'uuid-request-1',
        answers: [{ id: 'unknown-q', selected: ['同意'] }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('选项 label 不在原题选项内抛 BadRequestException', async () => {
    const { controller } = buildController();
    await expect(
      controller.respond({
        sessionId: 's1',
        requestId: 'uuid-request-1',
        answers: [{ id: 'approval', selected: ['随便选的'] }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('单选题多选抛 BadRequestException', async () => {
    const { controller } = buildController();
    await expect(
      controller.respond({
        sessionId: 's1',
        requestId: 'uuid-request-1',
        answers: [{ id: 'approval', selected: ['同意', '拒绝'] }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('ChatController - streamMessage 本地斜杠命令', () => {
  function createStreamHarness(opts: { compressError?: any } = {}) {
    const res = {
      writableEnded: false,
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    const sessionService = {
      compressSession: opts.compressError
        ? jest.fn(async () => {
            throw opts.compressError;
          })
        : jest.fn(async () => ({ success: true, started: true })),
    };
    const chatRunner = { startStream: jest.fn(async () => () => {}) };
    const tagParserPipeline = {
      parse: jest.fn(async () => ({ injectionBlocks: [] })),
    };
    const controller = new ChatController(
      sessionService as any,
      { hasActiveStream: jest.fn(() => false) } as any,
      chatRunner as any,
      tagParserPipeline as any,
      new InteractionWaitService(),
    );
    return { controller, res, sessionService, chatRunner, tagParserPipeline };
  }

  const call = (
    controller: ChatController,
    res: any,
    userMessage: any,
  ) =>
    controller.streamMessage(
      { sessionId: 's1', userMessage },
      res,
      {} as any,
      'client-1',
    );

  it('/compact 在落库/建流前拦截：转手动压缩，不写用户消息、不解析标签', async () => {
    const { controller, res, sessionService, chatRunner, tagParserPipeline } =
      createStreamHarness();

    await call(controller, res, { content: '/compact 只保留最近 10 轮' });

    expect(sessionService.compressSession).toHaveBeenCalledWith('s1', {
      instructions: '只保留最近 10 轮',
    });
    expect(chatRunner.startStream).not.toHaveBeenCalled();
    expect(tagParserPipeline.parse).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        ok: true,
        localCommand: expect.objectContaining({
          name: 'compact',
          instructions: '只保留最近 10 轮',
          started: true,
        }),
      }),
    );
  });

  it('/compress 别名同样拦截；无参数时不传 instructions', async () => {
    const { controller, res, sessionService, chatRunner } =
      createStreamHarness();

    await call(controller, res, { content: '/compress' });

    expect(sessionService.compressSession).toHaveBeenCalledWith('s1', {});
    expect(chatRunner.startStream).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        localCommand: expect.objectContaining({ name: 'compress' }),
      }),
    );
  });

  it('未知斜杠命令按普通消息处理（仍进入 chatRunner，不触发压缩）', async () => {
    const { controller, res, sessionService, chatRunner } =
      createStreamHarness();

    await call(controller, res, { content: '/help 看看用法' });

    expect(sessionService.compressSession).not.toHaveBeenCalled();
    expect(chatRunner.startStream).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('本地命令带附件 → 400（不静默丢弃附件）', async () => {
    const { controller, res, sessionService } = createStreamHarness();

    await expect(
      call(controller, res, {
        content: '/compact',
        files: [{ mediaType: 'text/plain', bytes: 1, url: 'x' }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(sessionService.compressSession).not.toHaveBeenCalled();
  });

  it('压缩忙（409 SESSION_STREAMING）原样透传，便于前端提示', async () => {
    const busy = new HttpException(
      { error: '当前会话正在流式输出，请等待结束后再压缩', code: 'SESSION_STREAMING' },
      HttpStatus.CONFLICT,
    );
    const { controller, res } = createStreamHarness({ compressError: busy });

    await call(controller, res, { content: '/compact' });

    expect(res.status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
    expect(res.json).toHaveBeenCalledWith({
      error: '当前会话正在流式输出，请等待结束后再压缩',
      code: 'SESSION_STREAMING',
    });
  });
});
