/**
 * useRunningProcesses 测试（输入区运行时胶囊的「进程」段数据）
 *
 * 覆盖：REST 基线加载、会话切换重拉、**过期响应不写新会话**（generation 守卫）、
 * process_changed SSE 按会话过滤重拉、kill 成功/失败后的重拉与 toast、时长格式化。
 *
 * 无组件实例：用 effectScope 驱动（订阅与心跳都走 watchEffect + cleanup）。
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { effectScope, ref } from "vue";
import { setActivePinia, createPinia } from "pinia";

const apiMocks = vi.hoisted(() => ({
  getSessionProcesses: vi.fn(),
  killSessionProcess: vi.fn(),
  onSessionEvent: vi.fn(),
  // 采集 process_changed 回调
  captured: null as null | ((event: { sessionId: string }) => void),
  unsubscribe: vi.fn(),
}));
vi.mock("@/services/ApiService", () => ({ apiService: apiMocks }));

const messageMocks = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("element-plus", () => ({ ElMessage: messageMocks }));

// 桩掉两个 store：真实模块链会拉起 useTheme（模块加载期读 window.matchMedia，node 环境没有）；
// 本测试只覆盖数据逻辑，openProcessLog 的标签跳转是薄委派
const layoutMocks = vi.hoisted(() => ({ setWorkspaceVisible: vi.fn() }));
vi.mock("@/stores/layout", () => ({ useLayoutStore: () => layoutMocks }));
const tabMocks = vi.hoisted(() => ({ openProcessLogTab: vi.fn() }));
vi.mock("@/stores/tab", () => ({ useTabStore: () => tabMocks }));

import { useRunningProcesses } from "./useRunningProcesses";
import type { UiProcessInfo } from "@/services/ApiService";

const proc = (id: string, command: string, startedAt = new Date().toISOString()): UiProcessInfo =>
  ({ id, command, status: "running", sessionId: "s", isBackgrounded: true, startedAt }) as UiProcessInfo;

/** 让在途 promise 链推进 */
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("useRunningProcesses", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    apiMocks.getSessionProcesses.mockReset();
    apiMocks.killSessionProcess.mockReset();
    apiMocks.onSessionEvent.mockReset();
    apiMocks.unsubscribe.mockReset();
    messageMocks.success.mockReset();
    messageMocks.error.mockReset();
    apiMocks.captured = null;
    apiMocks.onSessionEvent.mockImplementation((_type: string, cb: (e: { sessionId: string }) => void) => {
      apiMocks.captured = cb;
      return apiMocks.unsubscribe;
    });
  });

  it("初始加载基线；会话切换重新拉取", async () => {
    apiMocks.getSessionProcesses.mockResolvedValue({ processes: [proc("p1", "npm run dev")] });
    const sid = ref<string | undefined>("s1");
    const scope = effectScope();
    const api = scope.run(() => useRunningProcesses(sid))!;
    await flush();

    expect(apiMocks.getSessionProcesses).toHaveBeenCalledWith("s1");
    expect(api.processes.value.map((p) => p.id)).toEqual(["p1"]);

    apiMocks.getSessionProcesses.mockResolvedValue({ processes: [proc("p2", "vite")] });
    sid.value = "s2";
    await flush();
    expect(apiMocks.getSessionProcesses).toHaveBeenLastCalledWith("s2");
    expect(api.processes.value.map((p) => p.id)).toEqual(["p2"]);

    scope.stop();
    expect(apiMocks.unsubscribe).toHaveBeenCalled();
  });

  it("会话切换时在途的旧响应被丢弃（generation 守卫，不写进新会话）", async () => {
    let resolveS1: (v: { processes: UiProcessInfo[] }) => void = () => {};
    apiMocks.getSessionProcesses.mockImplementation((s: string) =>
      s === "s1"
        ? new Promise<{ processes: UiProcessInfo[] }>((r) => { resolveS1 = r; })
        : Promise.resolve({ processes: [proc("p2", "vite")] }),
    );
    const sid = ref<string | undefined>("s1");
    const scope = effectScope();
    const api = scope.run(() => useRunningProcesses(sid))!;

    sid.value = "s2";
    await flush();
    expect(api.processes.value.map((p) => p.id)).toEqual(["p2"]);

    // s1 的响应姗姗来迟 → 必须丢弃
    resolveS1({ processes: [proc("p1", "npm run dev")] });
    await flush();
    expect(api.processes.value.map((p) => p.id)).toEqual(["p2"]);

    scope.stop();
  });

  it("process_changed 按 event.sessionId 过滤后重拉（别的会话不触发）", async () => {
    apiMocks.getSessionProcesses.mockResolvedValue({ processes: [] });
    const sid = ref<string | undefined>("s1");
    const scope = effectScope();
    scope.run(() => useRunningProcesses(sid))!;
    await flush();
    expect(apiMocks.getSessionProcesses).toHaveBeenCalledTimes(1);

    apiMocks.captured!({ sessionId: "other" });
    await flush();
    expect(apiMocks.getSessionProcesses).toHaveBeenCalledTimes(1);

    apiMocks.captured!({ sessionId: "s1" });
    await flush();
    expect(apiMocks.getSessionProcesses).toHaveBeenCalledTimes(2);

    scope.stop();
  });

  it("kill 成功 → toast + 重拉；抛错也不冒泡（404 由调用侧静默）", async () => {
    apiMocks.getSessionProcesses.mockResolvedValue({ processes: [proc("p1", "npm run dev")] });
    const sid = ref<string | undefined>("s1");
    const scope = effectScope();
    const api = scope.run(() => useRunningProcesses(sid))!;
    await flush();

    apiMocks.killSessionProcess.mockResolvedValue({ success: true, status: "killed" });
    await api.killProcess(api.processes.value[0]!);
    expect(apiMocks.killSessionProcess).toHaveBeenCalledWith("s1", "p1");
    expect(messageMocks.success).toHaveBeenCalledTimes(1);
    expect(apiMocks.getSessionProcesses).toHaveBeenCalledTimes(2); // 基线 + kill 后兜底重拉

    apiMocks.killSessionProcess.mockRejectedValue(new Error("boom"));
    await expect(api.killProcess(api.processes.value[0]!)).resolves.toBeUndefined();
    expect(messageMocks.error).toHaveBeenCalledTimes(1);

    scope.stop();
  });

  it("elapsedText 按整数秒档格式化（m + 补零秒）", async () => {
    apiMocks.getSessionProcesses.mockResolvedValue({
      processes: [proc("p1", "npm run dev", new Date(Date.now() - 65_400).toISOString())],
    });
    const sid = ref<string | undefined>("s1");
    const scope = effectScope();
    const api = scope.run(() => useRunningProcesses(sid))!;
    await flush();

    expect(api.elapsedText(api.processes.value[0]!.startedAt)).toBe("1m 05s");
    expect(api.elapsedText("not-a-date")).toBe("");

    scope.stop();
  });
});
