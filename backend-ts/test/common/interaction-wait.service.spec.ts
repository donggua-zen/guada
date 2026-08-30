/// <reference types="jest" />

import { InteractionWaitService } from '../../src/common/services/interaction-wait.service';
import type { AskQuestion } from '../../src/common/types/ask.types';

const questions: AskQuestion[] = [
  { id: 'q1', question: '选一个', options: [{ label: 'A' }, { label: 'B' }] },
  { id: 'q2', question: '可多选', options: [{ label: 'X' }, { label: 'Y' }], multiSelect: true },
];

describe('InteractionWaitService（统一 Ask 等待表，无超时）', () => {
  let svc: InteractionWaitService;

  beforeEach(() => {
    svc = new InteractionWaitService();
  });

  it('waitForAnswers 挂起 → resolveAnswers 投递答案（FIFO 唤醒）', async () => {
    const p = svc.waitForAnswers('s1', 'r1', questions);

    expect(svc.getPendingQuestions('s1', 'r1')).toBe(questions);
    const answers = [{ id: 'q1', selected: ['A'] }, { id: 'q2', selected: ['X', 'Y'] }];
    expect(svc.resolveAnswers('s1', 'r1', answers)).toBe(true);
    await expect(p).resolves.toEqual(answers);
    // 投递后条目删除
    expect(svc.getPendingQuestions('s1', 'r1')).toBeUndefined();
    expect(svc.resolveAnswers('s1', 'r1', answers)).toBe(false);
  });

  it('cancel 仅删表（无 timer 可泄漏）；无等待者投递返回 false', () => {
    const p = svc.waitForAnswers('s1', 'r1', questions);
    svc.cancel('s1', 'r1');
    expect(svc.getPendingQuestions('s1', 'r1')).toBeUndefined();
    expect(svc.resolveAnswers('s1', 'r1', [])).toBe(false);
    void p;
  });

  it('key 按 sessionId:requestId 隔离', () => {
    const p1 = svc.waitForAnswers('s1', 'r1', questions);
    svc.waitForAnswers('s2', 'r1', questions);
    const answers = [{ id: 'q1', selected: ['A'] }, { id: 'q2', selected: [] }];
    expect(svc.resolveAnswers('s2', 'r1', answers)).toBe(true);
    expect(svc.getPendingQuestions('s1', 'r1')).toBe(questions);
    void p1;
  });
});
