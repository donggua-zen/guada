/**
 * jobs store 测试（后台作业状态的唯一真相）
 *
 * 覆盖：畸形快照丢弃、同 bootId 旧 revision 不回退、
 * bootId 变化（后端重启，revision 归零）时接受更低 revision、
 * ensureLoaded 的 force / bootId / revision 合并规则。
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { setActivePinia, createPinia } from "pinia";

const apiMocks = vi.hoisted(() => ({ getSessionJobs: vi.fn() }));
vi.mock("@/services/ApiService", () => ({ apiService: apiMocks }));

import { useJobsStore } from "./jobs";
import type { UiJobInfo } from "@/services/ApiService";

const job = (id: string, sessionId = "s1"): UiJobInfo => ({
  id,
  kind: "shell",
  label: id,
  sessionId,
  status: "running",
  startedAt: 0,
});

const snapshot = (
  sessionId: string,
  payload: { bootId?: string; revision?: number; jobs?: UiJobInfo[] },
) => ({ sessionId, payload }) as any;

describe("useJobsStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    apiMocks.getSessionJobs.mockReset();
  });

  it("畸形 payload（缺 revision / jobs 非数组）直接丢弃", () => {
    const store = useJobsStore();
    store.applySnapshot(snapshot("s1", { jobs: [] }));
    store.applySnapshot(snapshot("s1", { revision: 3, jobs: "nope" as any }));

    expect(store.bySession["s1"]).toBeUndefined();
  });

  it("同一 bootId 内旧 revision 不回退列表", () => {
    const store = useJobsStore();
    store.applySnapshot(
      snapshot("s1", { bootId: "b1", revision: 5, jobs: [job("job-a")] }),
    );
    store.applySnapshot(snapshot("s1", { bootId: "b1", revision: 4, jobs: [] }));

    expect(store.bySession["s1"].revision).toBe(5);
    expect(store.bySession["s1"].jobs.map((j) => j.id)).toEqual(["job-a"]);
  });

  it("bootId 变化时接受更低 revision（后端重启，revision 归零）", () => {
    const store = useJobsStore();
    store.applySnapshot(
      snapshot("s1", { bootId: "b1", revision: 9, jobs: [job("job-a")] }),
    );
    store.applySnapshot(snapshot("s1", { bootId: "b2", revision: 1, jobs: [] }));

    expect(store.bySession["s1"]).toMatchObject({ bootId: "b2", revision: 1 });
    expect(store.bySession["s1"].jobs).toEqual([]);
  });

  it("bootId 缺失时退回纯 revision 比较（兼容旧后端）", () => {
    const store = useJobsStore();
    store.applySnapshot(snapshot("s1", { revision: 5, jobs: [job("job-a")] }));
    store.applySnapshot(snapshot("s1", { revision: 4, jobs: [] }));

    expect(store.bySession["s1"].revision).toBe(5);
    expect(store.bySession["s1"].jobs.map((j) => j.id)).toEqual(["job-a"]);
  });

  it("ensureLoaded：force + bootId 变化时覆盖基线（重启后自愈）", async () => {
    const store = useJobsStore();
    store.applySnapshot(
      snapshot("s1", { bootId: "b1", revision: 9, jobs: [job("job-a")] }),
    );
    apiMocks.getSessionJobs.mockResolvedValue({
      bootId: "b2",
      revision: 1,
      jobs: [],
    });

    await store.ensureLoaded("s1", true);

    expect(store.bySession["s1"]).toMatchObject({ bootId: "b2", revision: 1 });
    expect(store.bySession["s1"].jobs).toEqual([]);
  });

  it("ensureLoaded：非 force 且已有桶时不再请求", async () => {
    const store = useJobsStore();
    store.applySnapshot(snapshot("s1", { bootId: "b1", revision: 2, jobs: [] }));

    await store.ensureLoaded("s1");

    expect(apiMocks.getSessionJobs).not.toHaveBeenCalled();
  });

  it("ensureLoaded：同 bootId 的更旧基线不覆盖现有快照", async () => {
    const store = useJobsStore();
    store.applySnapshot(
      snapshot("s1", { bootId: "b1", revision: 5, jobs: [job("job-a")] }),
    );
    apiMocks.getSessionJobs.mockResolvedValue({
      bootId: "b1",
      revision: 3,
      jobs: [],
    });

    await store.ensureLoaded("s1", true);

    expect(store.bySession["s1"].revision).toBe(5);
    expect(store.bySession["s1"].jobs.map((j) => j.id)).toEqual(["job-a"]);
  });
});
