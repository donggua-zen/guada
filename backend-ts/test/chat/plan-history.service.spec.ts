/// <reference types="jest" />

import {
  PlanHistoryService,
  collectPlansFromEvents,
} from '../../src/modules/chat/plan-history.service';
import type { BaseEvent } from '../../src/common/persistence/types';

const SESSION = 's-plan-1';
const WORKSPACE = 'C:/ws';

function event(type: string, seq: number, data: Record<string, unknown>): BaseEvent {
  return { type: type as BaseEvent['type'], seq, time: 1000 + seq, data };
}

function exitCallEvent(
  seq: number,
  toolCallId: string,
  plan: string,
): BaseEvent {
  return event('assistant/message', seq, {
    messageId: `m_${seq}`,
    content: [
      { type: 'text', text: '计划如下' },
      { type: 'tool-call', toolCallId, name: 'ExitPlanMode', arguments: JSON.stringify({ plan }) },
    ],
  });
}

function toolResultEvent(
  seq: number,
  toolCallId: string,
  overrides: Record<string, unknown> = {},
): BaseEvent {
  return event('tool/result', seq, {
    messageId: `m_${seq}`,
    toolCallId,
    name: 'ExitPlanMode',
    content: 'done',
    ...overrides,
  });
}

const PLAN_WITH_TITLE = '# 重构方案\n\n第一步：拆模块。';
const PLAN_PLAIN = '直接把配置抽出来。';

describe('collectPlansFromEvents（转录 → 计划列表）', () => {
  it('提取 ExitPlanMode 调用正文与标题，未配对结果记为待审', () => {
    const items = collectPlansFromEvents([
      event('turn/start', 1, { turnId: 't1', kind: 'turn' }),
      exitCallEvent(2, 'tc1', PLAN_WITH_TITLE),
    ]);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      planId: 'tc1',
      turnId: 't1',
      title: '重构方案',
      content: PLAN_WITH_TITLE,
      status: 'pending',
      path: null,
    });
  });

  it('标题缺省取首个非空行（无 Markdown 标题时）', () => {
    const items = collectPlansFromEvents([exitCallEvent(1, 'tc1', PLAN_PLAIN)]);
    expect(items[0].title).toBe('直接把配置抽出来。');
  });

  it('按 tool/result 判定状态：meta.planApproved 优先，isError 兜底', () => {
    const items = collectPlansFromEvents([
      exitCallEvent(1, 'tc-ok', PLAN_WITH_TITLE),
      toolResultEvent(2, 'tc-ok', { meta: { planApproved: true } }),
      exitCallEvent(3, 'tc-rej', PLAN_WITH_TITLE),
      toolResultEvent(4, 'tc-rej', { isError: true, meta: { planApproved: false } }),
      exitCallEvent(5, 'tc-legacy', PLAN_WITH_TITLE),
      toolResultEvent(6, 'tc-legacy', { isError: true }),
    ]);

    expect(items.map((i) => [i.planId, i.status])).toEqual([
      ['tc-legacy', 'rejected'],
      ['tc-rej', 'rejected'],
      ['tc-ok', 'approved'],
    ]);
  });

  it('最近在前（倒序）', () => {
    const items = collectPlansFromEvents([
      exitCallEvent(1, 'tc1', PLAN_WITH_TITLE),
      event('turn/start', 2, { turnId: 't2', kind: 'turn' }),
      exitCallEvent(3, 'tc2', PLAN_PLAIN),
    ]);
    expect(items.map((i) => i.planId)).toEqual(['tc2', 'tc1']);
    expect(items[0].turnId).toBe('t2');
    expect(items[1].turnId).toBeNull();
  });

  it('忽略非 ExitPlanMode 工具调用与坏 JSON 参数', () => {
    const items = collectPlansFromEvents([
      event('assistant/message', 1, {
        messageId: 'm1',
        content: [{ type: 'tool-call', toolCallId: 'x1', name: 'write', arguments: '{"content":"x"}' }],
      }),
      event('assistant/message', 2, {
        messageId: 'm2',
        content: [{ type: 'tool-call', toolCallId: 'x2', name: 'ExitPlanMode', arguments: '{"plan":' }],
      }),
      event('assistant/message', 3, {
        messageId: 'm3',
        content: [{ type: 'tool-call', toolCallId: 'x3', name: 'ExitPlanMode', arguments: '{"plan":"   "}' }],
      }),
    ]);
    expect(items).toEqual([]);
  });

  it('被删除回合（turn/delete）的计划整体剔除', () => {
    const items = collectPlansFromEvents([
      event('turn/start', 1, { turnId: 't1', kind: 'turn' }),
      exitCallEvent(2, 'tc1', PLAN_WITH_TITLE),
      event('turn/start', 3, { turnId: 't2', kind: 'turn' }),
      exitCallEvent(4, 'tc2', PLAN_PLAIN),
      event('turn/delete', 5, { turnId: 't1' }),
    ]);
    expect(items.map((i) => i.planId)).toEqual(['tc2']);
  });
});

describe('PlanHistoryService.listPlans（转录 + 文件路径回填）', () => {
  function buildService(opts?: { events?: BaseEvent[]; fileExists?: boolean }) {
    const messageStore = {
      getAllEvents: jest.fn(async () => opts?.events ?? []),
    };
    const planFile = {
      planFileExists: jest.fn(async () => opts?.fileExists === true),
      resolveRelativePlanPath: jest.fn(
        (_ws: string, _sid: string, planId: string) => `.guada/plans/${SESSION}/${planId}.md`,
      ),
    };
    const service = new PlanHistoryService(messageStore as any, planFile as any);
    return { service, messageStore, planFile };
  }

  it('文件已落盘时回填工作区相对路径', async () => {
    const { service, planFile } = buildService({
      events: [exitCallEvent(1, 'tc1', PLAN_WITH_TITLE)],
      fileExists: true,
    });

    const items = await service.listPlans(SESSION, WORKSPACE);
    expect(items[0].path).toBe(`.guada/plans/${SESSION}/tc1.md`);
    expect(planFile.planFileExists).toHaveBeenCalledWith(WORKSPACE, SESSION, 'tc1');
  });

  it('文件缺失时 path 保持 null（列表仍由转录提供）', async () => {
    const { service } = buildService({
      events: [exitCallEvent(1, 'tc1', PLAN_WITH_TITLE)],
      fileExists: false,
    });
    const items = await service.listPlans(SESSION, WORKSPACE);
    expect(items[0].path).toBeNull();
  });

  it('事件读取失败返回空列表（不抛错）', async () => {
    const messageStore = { getAllEvents: jest.fn(async () => { throw new Error('io'); }) };
    const planFile = { planFileExists: jest.fn(), resolveRelativePlanPath: jest.fn() };
    const service = new PlanHistoryService(messageStore as any, planFile as any);
    await expect(service.listPlans(SESSION, WORKSPACE)).resolves.toEqual([]);
  });
});
