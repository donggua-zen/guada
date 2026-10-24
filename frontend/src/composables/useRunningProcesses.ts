import { computed, nextTick, ref, toValue, watch, watchEffect } from "vue";
import type { MaybeRefOrGetter } from "vue";
import { ElMessage } from "element-plus";
import { apiService, type UiJobInfo } from "@/services/ApiService";
import { useJobsStore } from "@/stores/jobs";
import { useTabStore } from "@/stores/tab";
import { useLayoutStore } from "@/stores/layout";
import { getApiErrorStatus } from "@/utils/errorMessage";
import { formatProcessDuration } from "@/utils/processDisplay";
import { t } from "@/locales";

/** 运行时胶囊只展示有日志面板的进程类 job；子 Agent/Workflow 有各自的 UI。 */
const PROCESS_KINDS = new Set(["shell", "remote-shell", "pty"]);

/**
 * 会话运行中的后台 job（输入区运行时胶囊的「进程」段）
 *
 * 数据源：jobs store（SSE jobs_snapshot 全量快照 + REST 基线）。
 * 不再监听 process_changed，也不再在每次事件后全量 REST 重拉。
 */
export function useRunningProcesses(sessionId: MaybeRefOrGetter<string | undefined>) {
  const jobsStore = useJobsStore();
  const tabStore = useTabStore();
  const layoutStore = useLayoutStore();

  const processes = computed<UiJobInfo[]>(() => {
    const sid = toValue(sessionId);
    return jobsStore
      .runningJobs(sid)
      .filter((job) => PROCESS_KINDS.has(job.kind));
  });

  /** 时长显示的秒级心跳（仅在列表非空时持有定时器，驱动 elapsedText 重算） */
  const nowTick = ref(Date.now());

  async function load(force = false): Promise<void> {
    const sid = toValue(sessionId);
    if (!sid) return;
    await jobsStore.ensureLoaded(sid, force);
  }

  function elapsedText(startedAt: number): string {
    if (!Number.isFinite(startedAt)) return "";
    return formatProcessDuration(nowTick.value - startedAt);
  }

  async function killProcess(job: UiJobInfo): Promise<void> {
    const sid = toValue(sessionId);
    if (!sid) return;
    try {
      await apiService.killSessionJob(sid, job.id);
      ElMessage.success(t("chat.workspace.processKilledToast"));
    } catch (e) {
      // 404 = 已自然结束；快照会把它移出 running 列表
      if (getApiErrorStatus(e) !== 404) {
        console.error("Failed to kill job:", e);
        ElMessage.error(t("chat.workspace.processKillFailed"));
      }
    }
    void load(true);
  }

  /** 打开日志标签（工作区侧边栏）：需先展开工作区并等其挂载完成 */
  function openProcessLog(job: UiJobInfo): void {
    const sid = toValue(sessionId);
    if (!sid) return;
    layoutStore.setWorkspaceVisible(true);
    nextTick(() => tabStore.openProcessLogTab(sid, job.id, job.label));
  }

  watch(
    () => toValue(sessionId),
    () => {
      void load();
    },
    { immediate: true },
  );

  // jobs 快照 + 重连基线。用 watchEffect + cleanup 随组件作用域自动清理。
  watchEffect((onCleanup) => {
    const offSnapshot = apiService.onSessionEvent("jobs_snapshot", (event) => {
      if (event.sessionId === toValue(sessionId)) {
        jobsStore.applySnapshot(event);
      }
    });
    const offConnected = apiService.onConnected(() => {
      const sid = toValue(sessionId);
      if (sid) void jobsStore.ensureLoaded(sid, true);
    });
    onCleanup(() => {
      offSnapshot();
      offConnected();
    });
  });

  // 秒级心跳：列表空则不持有定时器（watchEffect 随组件作用域自动清理）
  watchEffect((onCleanup) => {
    if (processes.value.length === 0) return;
    nowTick.value = Date.now();
    const timer = setInterval(() => {
      nowTick.value = Date.now();
    }, 1000);
    onCleanup(() => clearInterval(timer));
  });

  return { processes, elapsedText, killProcess, openProcessLog };
}
