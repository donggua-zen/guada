/// <reference types="jest" />

import { AskService } from '../../src/common/services/ask.service';
import { InteractionWaitService } from '../../src/common/services/interaction-wait.service';
import { AskDeniedError } from '../../src/common/types/ask.types';
import type { AskSession } from '../../src/common/types/ask.types';

function makeSession(): AskSession & { appendAskAsked: jest.Mock; appendAskAnswered: jest.Mock; publishStream: jest.Mock } {
  return {
    sessionId: 's1',
    userId: 'u1',
    appendAskAsked: jest.fn(async () => {}),
    appendAskAnswered: jest.fn(async () => {}),
    publishStream: jest.fn(async () => {}),
  };
}

async function flushAsync(times = 8) {
  for (let i = 0; i < times; i++) {
    await new Promise((r) => setImmediate(r));
  }
}

describe('AskService（统一人机交互闭环，无超时）', () => {
  let wait: InteractionWaitService;
  let service: AskService;

  beforeEach(() => {
    wait = new InteractionWaitService();
    service = new AskService(wait);
  });

  it('ask：asked 审计 → ask_requested 帧 → 应答唤醒 → answered 审计 + ask_resolved 帧', async () => {
    const session = makeSession();
    const request = {
      kind: 'ask' as const,
      title: '选择方案',
      questions: [
        { id: 'q1', question: '哪种方案？', options: [{ label: '方案A' }, { label: '方案B' }] },
      ],
    };

    const promise = service.ask(session, request);
    await flushAsync();

    // 审计在前（先入库后发事件），帧随后
    expect(session.appendAskAsked).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: expect.any(String), kind: 'ask', title: '选择方案' }),
    );
    expect(session.publishStream).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'ask_requested', requestId: expect.any(String), questions: request.questions }),
    );

    const requestId = session.publishStream.mock.calls[0][0].requestId;
    const answers = [{ id: 'q1', selected: ['方案A'] }];
    expect(wait.resolveAnswers('s1', requestId, answers)).toBe(true);

    await expect(promise).resolves.toEqual(answers);
    expect(session.appendAskAnswered).toHaveBeenCalledWith({ requestId, answers });
    expect(session.publishStream).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'ask_resolved', requestId, outcome: 'answered' }),
    );
  });

  it('ask：abort 竞速胜出 → 撤表 + cancelled 审计 + ask_resolved(cancelled) + 抛 AskDeniedError(cancelled)', async () => {
    const session = makeSession();
    const abort = new AbortController();
    const promise = service.ask(
      session,
      { kind: 'ask', questions: [{ id: 'q1', question: '?', options: [{ label: 'A' }] }] },
      abort.signal,
    );
    await flushAsync();

    const requestId = session.publishStream.mock.calls[0][0].requestId;
    abort.abort();

    await expect(promise).rejects.toMatchObject({ name: 'AskDeniedError', outcome: 'cancelled' });
    expect(session.appendAskAnswered).toHaveBeenCalledWith({ requestId, cancelled: true });
    expect(session.publishStream).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'ask_resolved', requestId, outcome: 'cancelled' }),
    );
    // 表已清理：迟到的应答投不进
    expect(wait.resolveAnswers('s1', requestId, [])).toBe(false);
  });

  it('ask：空问题单直接抛错（不打扰人）', async () => {
    const session = makeSession();
    await expect(service.ask(session, { kind: 'ask', questions: [] })).rejects.toThrow(
      'at least one question',
    );
    expect(session.publishStream).not.toHaveBeenCalled();
  });

  describe('requestApproval（审批 = ask 特例）', () => {
    function approvalRequest() {
      return {
        type: 'ask_requested' as const,
        requestId: expect.any(String),
        kind: 'approval' as const,
        title: '需要审批',
        toolCallId: 'call_1',
        toolName: 'run_command',
        questions: [
          expect.objectContaining({ id: 'approval', options: [{ label: '同意' }, { label: '拒绝' }] }),
        ],
      };
    }

    it('同意 → 正常返回（预置问题：同意/拒绝，无超时字段）', async () => {
      const session = makeSession();
      const promise = service.requestApproval(session, { toolCallId: 'call_1', toolName: 'run_command', detail: '需要写入' });
      await flushAsync();

      const frame = session.publishStream.mock.calls[0][0];
      expect(frame).toEqual(
        expect.objectContaining({
          type: 'ask_requested',
          kind: 'approval',
          toolCallId: 'call_1',
        }),
      );
      expect(frame).toEqual(approvalRequest());
      // 新架构无超时：任何载荷不得携带 expiresAt
      expect(JSON.stringify(frame)).not.toContain('expiresAt');

      const requestId = frame.requestId;
      wait.resolveAnswers('s1', requestId, [{ id: 'approval', selected: ['同意'] }]);
      await expect(promise).resolves.toBeUndefined();
    });

    it('拒绝 → 抛 AskDeniedError(rejected)', async () => {
      const session = makeSession();
      const promise = service.requestApproval(session, { toolCallId: 'call_1', toolName: 'run_command' });
      await flushAsync();
      const requestId = session.publishStream.mock.calls[0][0].requestId;

      wait.resolveAnswers('s1', requestId, [{ id: 'approval', selected: ['拒绝'] }]);

      await expect(promise).rejects.toMatchObject({
        name: 'AskDeniedError',
        outcome: 'rejected',
        feedback: undefined,
      });
    });

    it('自定义回复 = 拒绝 + 用户文本反馈模型', async () => {
      const session = makeSession();
      const promise = service.requestApproval(session, { toolCallId: 'call_1', toolName: 'run_command' });
      await flushAsync();
      const requestId = session.publishStream.mock.calls[0][0].requestId;

      wait.resolveAnswers('s1', requestId, [
        { id: 'approval', selected: [], custom: '不要动配置文件，换个方式' },
      ]);

      await expect(promise).rejects.toMatchObject({
        name: 'AskDeniedError',
        outcome: 'rejected',
        feedback: '不要动配置文件，换个方式',
      });
      // AskDeniedError 是终局错误类（instanceof 可判）
      await promise.catch((e) => expect(e).toBeInstanceOf(AskDeniedError));
    });
  });
});
