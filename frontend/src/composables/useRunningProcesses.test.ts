/**
 * useRunningProcesses 测试（输入区运行时胶囊的「进程」段数据）
 *
 * 覆盖：jobs REST 基线、会话切换、迟到响应不污染新会话、
 * jobs_snapshot 快照应用、kill 成功/失败、时长格式化。
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { effectScope, ref } from "vue";
import { setActivePinia, createPinia } from "pinia";

const apiMocks = vi.hoisted(() => ({
  getSessionJobs: vi.fn(),
  killSessionJob: vi.fn(),
  onSessionEvent: vi.fn(),
  onConnected: vi.fn(),
  capturedSnapshot: null as null | ((event: any) => void),
  capturedConnected: null as null | (() => void),
  unsubscribe: vi.fn(),
}));
vi.mock("@/services/ApiService", () => ({ apiService: apiMocks }));

const messageMocks = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("element-plus", () => ({ ElMessage: messageMocks }));

const layoutMocks = vi.hoisted(() => ({ setWorkspaceVisible: vi.fn() }));
vi.mock("@/stores/layout", () => ({ useLayoutStore: () => layoutMocks }));
const tabMocks = vi.hoisted(() => ({ openProcessLogTab: vi.fn() }));
vi.mock("@/stores/tab", () => ({ useTabStore: () => tabMocks }));

import { useRunningProcesses } from "./useRunningProcesses";
import type { UiJobInfo } from "@/services/ApiService";

const job = (
  id: string,
  label: string,
  startedAt = Date.now(),
  kind: UiJobInfo["kind"] = "shell",
): UiJobInfo => ({
  id,
  kind,
  label,
  sessionId: "s",
  status: "running",
  startedAt,
});

const snapshot = (sessionId: string, revision: number, jobs: UiJobInfo[]) => ({
  sessionId,
  payload: { revision, jobs },
});

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("useRunningProcesses", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    apiMocks.getSessionJobs.mockReset();
    apiMocks.killSessionJob.mockReset();
    apiMocks.onSessionEvent.mockReset();
    apiMocks.onConnected.mockReset();
    apiMocks.unsubscribe.mockReset();
    messageMocks.success.mockReset();
    messageMocks.error.mockReset();
    apiMocks.capturedSnapshot = null;
    apiMocks.capturedConnected = null;
    apiMocks.onSessionEvent.mockImplementation(
      (_type: string, cb: (e: any) => void) => {
        apiMocks.capturedSnapshot = cb;
        return apiMocks.unsubscribe;
      },
    );
    apiMocks.onConnected.mockImplementation((cb: () => void) => {
      apiMocks.capturedConnected = cb;
      return apiMocks.unsubscribe;
    });
  });

  it("初始加载 jobs 基线；会话切换重新拉取", async () => {
    apiMocks.getSessionJobs.mockResolvedValue({
      revision: 1,
      jobs: [job("job-1", "npm run dev")],
    });
    const sid = ref<string | undefined>("s1");
    const scope = effectScope();
    const api = scope.run(() => useRunningProcesses(sid))!;
    await flush();

    expect(apiMocks.getSessionJobs).toHaveBeenCalledWith("s1");
    expect(api.processes.value.map((p) => p.id)).toEqual(["job-1"]);

    apiMocks.getSessionJobs.mockResolvedValue({
      revision: 1,
      jobs: [job("job-2", "vite")],
    });
    sid.value = "s2";
    await flush();
    expect(apiMocks.getSessionJobs).toHaveBeenLastCalledWith("s2");
    expect(api.processes.value.map((p) => p.id)).toEqual(["job-2"]);

    scope.stop();
    expect(apiMocks.unsubscribe).toHaveBeenCalled();
  });

  it("会话切换时在途的旧响应只写旧会话，不污染新会话", async () => {
    let resolveS1: (v: { revision: number; jobs: UiJobInfo[] }) => void = () => {};
    apiMocks.getSessionJobs.mockImplementation((s: string) =>
      s === "s1"
        ? new Promise<{ revision: number; jobs: UiJobInfo[] }>((r) => {
            resolveS1 = r;
          })
        : Promise.resolve({ revision: 1, jobs: [job("job-2", "vite")] }),
    );
    const sid = ref<string | undefined>("s1");
    const scope = effectScope();
    const api = scope.run(() => useRunningProcesses(sid))!;

    sid.value = "s2";
    await flush();
    expect(api.processes.value.map((p) => p.id)).toEqual(["job-2"]);

    resolveS1({ revision: 1, jobs: [job("job-1", "npm run dev")] });
    await flush();
    expect(api.processes.value.map((p) => p.id)).toEqual(["job-2"]);

    scope.stop();
  });

  it("jobs_snapshot 直接应用快照，不再 REST 重拉；revision 旧快照被丢弃", async () => {
    apiMocks.getSessionJobs.mockResolvedValue({ revision: 1, jobs: [] });
    const sid = ref<string | undefined>("s1");
    const scope = effectScope();
    const api = scope.run(() => useRunningProcesses(sid))!;
    await flush();
    expect(apiMocks.getSessionJobs).toHaveBeenCalledTimes(1);

    apiMocks.capturedSnapshot!(snapshot("s1", 2, [job("job-1", "npm run dev")]));
    await flush();
    expect(api.processes.value.map((p) => p.id)).toEqual(["job-1"]);

    // 旧 revision 不能回退列表
    apiMocks.capturedSnapshot!(snapshot("s1", 1, []));
    await flush();
    expect(api.processes.value.map((p) => p.id)).toEqual(["job-1"]);
    expect(apiMocks.getSessionJobs).toHaveBeenCalledTimes(1);

    scope.stop();
  });

  it("非进程类 job（subagent/workflow）不进入进程胶囊", async () => {
    apiMocks.getSessionJobs.mockResolvedValue({
      revision: 1,
      jobs: [
        job("job-shell", "npm run dev", Date.now(), "shell"),
        job("job-sub", "researcher", Date.now(), "subagent"),
      ],
    });
    const sid = ref<string | undefined>("s1");
    const scope = effectScope();
    const api = scope.run(() => useRunningProcesses(sid))!;
    await flush();

    expect(api.processes.value.map((p) => p.kind)).toEqual(["shell"]);
    scope.stop();
  });

  it("kill 成功 → toast + 强制基线；抛错也不冒泡", async () => {
    apiMocks.getSessionJobs.mockResolvedValue({
      revision: 1,
      jobs: [job("job-1", "npm run dev")],
    });
    const sid = ref<string | undefined>("s1");
    const scope = effectScope();
    const api = scope.run(() => useRunningProcesses(sid))!;
    await flush();

    apiMocks.killSessionJob.mockResolvedValue({ success: true, status: "killed" });
    await api.killProcess(api.processes.value[0]!);
    expect(apiMocks.killSessionJob).toHaveBeenCalledWith("s1", "job-1");
    expect(messageMocks.success).toHaveBeenCalledTimes(1);
    expect(apiMocks.getSessionJobs).toHaveBeenCalledTimes(2);

    apiMocks.killSessionJob.mockRejectedValue(new Error("boom"));
    await expect(api.killProcess(api.processes.value[0]!)).resolves.toBeUndefined();
    expect(messageMocks.error).toHaveBeenCalledTimes(1);

    scope.stop();
  });

  it("onConnected 触发强制基线", async () => {
    apiMocks.getSessionJobs.mockResolvedValue({ revision: 1, jobs: [] });
    const sid = ref<string | undefined>("s1");
    const scope = effectScope();
    scope.run(() => useRunningProcesses(sid))!;
    await flush();
    expect(apiMocks.getSessionJobs).toHaveBeenCalledTimes(1);

    apiMocks.capturedConnected!();
    await flush();
    expect(apiMocks.getSessionJobs).toHaveBeenCalledTimes(2);

    scope.stop();
  });

  it("elapsedText 按整数秒档格式化（m + 补零秒）", async () => {
    const startedAt = Date.now() - 65_400;
    apiMocks.getSessionJobs.mockResolvedValue({
      revision: 1,
      jobs: [job("job-1", "npm run dev", startedAt)],
    });
    const sid = ref<string | undefined>("s1");
    const scope = effectScope();
    const api = scope.run(() => useRunningProcesses(sid))!;
    await flush();

    expect(api.elapsedText(startedAt)).toBe("1m 05s");
    expect(api.elapsedText(Number.NaN)).toBe("");

    scope.stop();
  });
});
