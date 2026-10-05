/// <reference types="jest" />

import { SessionsController } from '../../src/modules/chat/sessions.controller';

const WORKSPACE = 'C:/ws';

function buildController(opts?: { session?: any; plans?: any[] }) {
  const sessionService = {
    getSessionById: jest.fn(async () =>
      opts && 'session' in opts ? opts.session : { id: 's1' },
    ),
  };
  const workspaceService = {
    resolveSessionWorkspaceDir: jest.fn(async () => WORKSPACE),
  };
  const planHistoryService = {
    listPlans: jest.fn(async () => opts?.plans ?? []),
  };
  const controller = new SessionsController(
    sessionService as any,
    workspaceService as any,
    {} as any, // eventBus
    {} as any, // jwtService
    planHistoryService as any,
  );
  return { controller, sessionService, workspaceService, planHistoryService };
}

describe('SessionsController - 计划历史（GET sessions/:id/plans）', () => {
  it('无计划时返回空列表', async () => {
    const { controller } = buildController();
    await expect(controller.getSessionPlans('s1')).resolves.toEqual({ plans: [] });
  });

  it('返回转录扫描的计划列表（含状态与相对路径）', async () => {
    const plans = [
      {
        planId: 'tc2',
        turnId: 't2',
        title: '第二个计划',
        content: '# 第二个计划',
        status: 'pending',
        createdAt: 2,
        path: '.guada/plans/s1/tc2.md',
      },
      {
        planId: 'tc1',
        turnId: 't1',
        title: '第一个计划',
        content: '# 第一个计划',
        status: 'approved',
        createdAt: 1,
        path: null,
      },
    ];
    const { controller, planHistoryService } = buildController({ plans });

    await expect(controller.getSessionPlans('s1')).resolves.toEqual({ plans });
    expect(planHistoryService.listPlans).toHaveBeenCalledWith('s1', WORKSPACE);
  });

  it('会话不存在时抛错（不泄露其它会话计划）', async () => {
    const { controller, planHistoryService } = buildController({ session: null });
    await expect(controller.getSessionPlans('missing')).rejects.toThrow(
      'Session not found or unauthorized',
    );
    expect(planHistoryService.listPlans).not.toHaveBeenCalled();
  });
});
