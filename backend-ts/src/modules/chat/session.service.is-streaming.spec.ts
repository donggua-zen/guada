/**
 * 单会话详情（GET /sessions/:id → getSessionById）顶层 isStreaming 注入：
 * 前端 SSE 重连后的状态校准（useSessionEvents.resyncStreamingSessions）以此判断
 * "本地自认 running 的会话服务端是否已终态"——详情端点漏注入会让该判断变成
 * undefined === false 恒假，切后台回来后界面永久卡 running（列表端点均注入，
 * 详情端点保持契约一致）。
 */
import { SessionService } from "./session.service";

function createService(hasActiveStream: () => boolean): SessionService {
  const current: any = {
    id: "s1",
    title: "t",
    sessionType: "web",
    agentId: null,
    settings: {},
  };
  return new SessionService(
    {
      get: () => current,
      childrenOf: () => [],
    } as any,
    { findById: async () => null } as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    { toResourceAbsoluteUrl: (u: string) => u } as any,
    {} as any,
    {} as any,
    {} as any,
    { hasActiveStream } as any, // streamManager
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );
}

describe("SessionService.getSessionById 顶层 isStreaming 注入", () => {
  it("有活跃流：顶层 isStreaming=true（与列表端点契约一致）", async () => {
    const service = createService(() => true);
    const session = await service.getSessionById("s1");
    expect(session.isStreaming).toBe(true);
  });

  it("无活跃流（回合已结束）：顶层 isStreaming=false，前端据此复位 running", async () => {
    const service = createService(() => false);
    const session = await service.getSessionById("s1");
    expect(session.isStreaming).toBe(false);
  });
});
