import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { createPinia, setActivePinia } from "pinia";

/**
 * useBotLiveSync 页面级实时同步测试
 *
 * 覆盖：bot 会话事件防抖合并、web 会话事件忽略、bot 状态就地 patch、
 * bot.changed 重拉实例、拖拽挂起/恢复、SSE 重连补拉、cleanup 解绑。
 */

const registeredHandlers = new Map<string, (event: any) => void>();
const connectHandlers: Array<() => void> = [];
const fetchBotInstances = vi.fn(async () => []);

vi.mock("@/services/ApiService", () => ({
  apiService: {
    onSessionEvent: (type: string, handler: (event: any) => void) => {
      registeredHandlers.set(type, handler);
      return () => registeredHandlers.delete(type);
    },
    onConnected: (cb: () => void) => {
      connectHandlers.push(cb);
      return () => {};
    },
    fetchBotInstances: () => fetchBotInstances(),
  },
}));

vi.mock("element-plus", () => ({
  ElMessage: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/locales", () => ({ t: (key: string) => key }));

import { useBotLiveSync } from "./useBotLiveSync";
import { useBotStore } from "@/stores/bot";

function emit(type: string, payload: any, sessionId = "*") {
  const handler = registeredHandlers.get(type);
  if (!handler) throw new Error(`no handler for ${type}`);
  handler({ type, sessionId, timestamp: new Date().toISOString(), payload });
}

describe("useBotLiveSync", () => {
  let onSessionsChanged: Mock<() => void>;
  let onBotStatus: Mock<(payload: any) => void>;
  let suspended: boolean;
  let cleanup: () => void;

  beforeEach(() => {
    vi.useFakeTimers();
    registeredHandlers.clear();
    connectHandlers.length = 0;
    fetchBotInstances.mockClear();
    setActivePinia(createPinia());
    onSessionsChanged = vi.fn<() => void>();
    onBotStatus = vi.fn<(payload: any) => void>();
    suspended = false;
    ({ cleanup } = useBotLiveSync({
      onSessionsChanged,
      onBotStatus,
      isSuspended: () => suspended,
    }));
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("bot 会话创建/流状态合并为一次刷新，web 会话事件被忽略", async () => {
    emit("session_created", { session: { sessionType: "bot", id: "s1" } });
    emit("stream_status_changed", { sessionType: "bot", status: "running" }, "s1");
    emit("session_created", { session: { sessionType: "web", id: "s2" } });
    emit("stream_status_changed", { sessionType: "web", status: "running" }, "s2");

    await vi.advanceTimersByTimeAsync(400);

    expect(onSessionsChanged).toHaveBeenCalledTimes(1);
  });

  it("session_deleted 直接触发一次刷新（协议不带 sessionType）", async () => {
    emit("session_deleted", undefined, "s1");
    await vi.advanceTimersByTimeAsync(400);

    expect(onSessionsChanged).toHaveBeenCalledTimes(1);
  });

  it("bot_status_changed 就地更新实例，不改写事件未携带的 status", async () => {
    const botStore = useBotStore();
    botStore.botInstances = [
      {
        id: "bot-1",
        runtimeStatus: "connected",
        status: "running",
        lastError: "fetch failed",
      },
    ] as any;

    emit("bot_status_changed", {
      botId: "bot-1",
      runtimeStatus: "reconnecting",
      reason: "reconnect",
    });

    expect(onBotStatus).toHaveBeenCalledWith(
      expect.objectContaining({ botId: "bot-1", runtimeStatus: "reconnecting" }),
    );
    expect(botStore.botInstances[0].runtimeStatus).toBe("reconnecting");
    // 重连中不改写落盘 status，避免把 running 写成 connecting
    expect(botStore.botInstances[0].status).toBe("running");

    await vi.advanceTimersByTimeAsync(400);
    expect(onSessionsChanged).toHaveBeenCalledTimes(1);
  });

  it("bot_status_changed 的 error + lastError 会落到实例上", async () => {
    const botStore = useBotStore();
    botStore.botInstances = [
      { id: "bot-1", runtimeStatus: "reconnecting", status: "running", lastError: null },
    ] as any;

    emit("bot_status_changed", {
      botId: "bot-1",
      runtimeStatus: "error",
      status: "error",
      lastError: "fetch failed",
      reason: "exhausted",
    });

    expect(botStore.botInstances[0]).toMatchObject({
      runtimeStatus: "error",
      status: "error",
      lastError: "fetch failed",
    });
  });

  it("bot_changed 重拉实例并刷新分组", async () => {
    emit("bot_changed", { botId: "bot-1", action: "updated" });

    await vi.advanceTimersByTimeAsync(800);
    expect(fetchBotInstances).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(400);
    expect(onSessionsChanged).toHaveBeenCalledTimes(1);
  });

  it("拖拽期间挂起刷新，结束后补一次", async () => {
    suspended = true;
    emit("session_created", { session: { sessionType: "bot", id: "s1" } });

    await vi.advanceTimersByTimeAsync(1500);
    expect(onSessionsChanged).not.toHaveBeenCalled();

    suspended = false;
    await vi.advanceTimersByTimeAsync(1000);
    expect(onSessionsChanged).toHaveBeenCalledTimes(1);
  });

  it("SSE 重连后补拉实例与分组", async () => {
    for (const cb of connectHandlers) cb();

    await vi.advanceTimersByTimeAsync(800);
    expect(fetchBotInstances).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(400);
    expect(onSessionsChanged).toHaveBeenCalledTimes(1);
  });

  it("cleanup 取消订阅与定时器", async () => {
    cleanup();
    expect(registeredHandlers.size).toBe(0);

    await vi.advanceTimersByTimeAsync(2000);
    expect(onSessionsChanged).not.toHaveBeenCalled();
  });
});
