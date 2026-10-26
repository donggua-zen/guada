import { defineStore } from "pinia";
import { ref } from "vue";
import { apiService, type UiJobInfo } from "@/services/ApiService";

interface SessionJobsState {
  /** 后端进程启动标识；变化即 revision 语义重置（可选：兼容未升级的后端/旧快照） */
  bootId?: string;
  revision: number;
  jobs: UiJobInfo[];
}

interface JobsSnapshotEventLike {
  sessionId: string;
  payload?: {
    bootId?: string;
    revision?: number;
    jobs?: UiJobInfo[];
  };
}

/**
 * 会话级后台作业快照。
 *
 * 数据源：
 * - SSE `jobs_snapshot` 全量快照（同一 bootId 内 revision 单调，旧快照直接丢弃）；
 * - 首屏/重连/切换会话 `GET /sessions/:id/jobs` 基线（断线补齐）。
 *
 * bootId：后端进程启动标识（与会话流事件的 streamBootId 同一真相）。revision 只在
 * 同一 bootId 内单调，后端重启后归零——若只按 revision 比较，重启后的低 revision
 * 快照会被当成过期快照永久丢弃，UI 就卡在一个其实已不存在的 running 作业上。
 * 故 bootId 变化时忽略 revision 直接采用。
 *
 * 与旧 useRunningProcesses 的区别：不再在收到事件后 REST 全量重拉，
 * 也不再依赖 process_changed。
 */
export const useJobsStore = defineStore("jobs", () => {
  const bySession = ref<Record<string, SessionJobsState>>({});
  const loading = new Set<string>();

  /** bootId 缺失视为同代（兼容旧后端 / 测试替身），此时退回纯 revision 比较 */
  function sameBoot(current?: SessionJobsState, bootId?: string): boolean {
    if (!bootId || !current?.bootId) return true;
    return bootId === current.bootId;
  }

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
    if (current && sameBoot(current, payload.bootId) && payload.revision <= current.revision) {
      return;
    }
    bySession.value = {
      ...bySession.value,
      [event.sessionId]: {
        bootId: payload.bootId ?? current?.bootId,
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
      // bootId 变化（后端重启）时忽略 revision：它已归零，比较没有意义
      if (
        !current ||
        !sameBoot(current, res.bootId) ||
        res.revision >= current.revision
      ) {
        bySession.value = {
          ...bySession.value,
          [sessionId]: {
            bootId: res.bootId ?? current?.bootId,
            revision: res.revision,
            jobs: res.jobs,
          },
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
