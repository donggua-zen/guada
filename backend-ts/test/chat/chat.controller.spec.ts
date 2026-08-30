/// <reference types="jest" />

import { ChatController } from '../../src/modules/chat/chat.controller';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { InteractionWaitService } from '../../src/common/services/interaction-wait.service';
import type { AskQuestion } from '../../src/common/types/ask.types';

const questions: AskQuestion[] = [
  { id: 'approval', question: '是否同意？', options: [{ label: '同意' }, { label: '拒绝' }] },
];

function buildController(overrides?: { resolveAnswers?: boolean }) {
  const interactionWait = new InteractionWaitService();
  const controller = new ChatController(
    {} as any, // sessionService
    {} as any, // messageRepo
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
