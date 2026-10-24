import { defineStore } from "pinia";
import { ref } from "vue";
import { apiService, type UiJobInfo } from "@/services/ApiService";

interface SessionJobsState {
  revision: number;
  jobs: UiJobInfo[];
}

interface JobsSnapshotEventLike {
  sessionId: string;
  payload?: {
    revision?: number;
    jobs?: UiJobInfo[];
  };
}

/**
 * 会话级后台作业快照。
 *
 * 数据源：
 * - SSE `jobs_snapshot` 全量快照（revision 单调递增，旧快照直接丢弃）；
 * - 首屏/重连 `GET /sessions/:id/jobs` 基线（不是旧前端兼容，而是断线补齐）。
 *
 * 与旧 useRunningProcesses 的区别：不再在收到事件后 REST 全量重拉，
 * 也不再依赖 process_changed。
 */
export const useJobsStore = defineStore("jobs", () => {
  const bySession = ref<Record<string, SessionJobsState>>({});
  const loading = new Set<string>();

  function applySnapshot(event: JobsSnapshotEventLike): void {
    const payload = event.payload;
    if (
      !payload ||
      typeof payload.revision !== "number" ||
      !Array.isArray(payload.jobs)
    ) {
      return;
    }
    const current = bySession.value[event.sessionId];
    if (current && payload.revision <= current.revision) return;
    bySession.value = {
      ...bySession.value,
      [event.sessionId]: {
        revision: payload.revision,
        jobs: payload.jobs,
      },
    };
  }

  async function ensureLoaded(
    sessionId: string | undefined,
    force = false,
  ): Promise<void> {
    if (!sessionId) return;
    if (!force && bySession.value[sessionId]) return;
    if (loading.has(sessionId)) return;
    loading.add(sessionId);
    try {
      const res = await apiService.getSessionJobs(sessionId);
      const current = bySession.value[sessionId];
      if (!current || res.revision >= current.revision) {
        bySession.value = {
          ...bySession.value,
          [sessionId]: { revision: res.revision, jobs: res.jobs },
        };
      }
    } catch {
      // 基线失败不打断 UI；后续 SSE 快照仍可恢复。
    } finally {
      loading.delete(sessionId);
    }
  }

  function jobsForSession(sessionId: string | undefined): UiJobInfo[] {
    if (!sessionId) return [];
    return bySession.value[sessionId]?.jobs ?? [];
  }

  function getJob(
    sessionId: string | undefined,
    jobId: string | undefined,
  ): UiJobInfo | undefined {
    if (!sessionId || !jobId) return undefined;
    return jobsForSession(sessionId).find((job) => job.id === jobId);
  }

  function runningJobs(sessionId: string | undefined): UiJobInfo[] {
    return jobsForSession(sessionId).filter(
      (job) => job.status === "running" || job.status === "stopping",
    );
  }

  return {
    bySession,
    applySnapshot,
    ensureLoaded,
    jobsForSession,
    getJob,
    runningJobs,
  };
});
