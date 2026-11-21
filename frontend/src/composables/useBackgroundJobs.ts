import { computed, nextTick, ref, toValue, watch, watchEffect } from "vue";
import type { MaybeRefOrGetter } from "vue";

import { apiService, type UiJobInfo } from "@/services/ApiService";
import { useJobsStore } from "@/stores/jobs";
import { useTabStore } from "@/stores/tab";
import { useLayoutStore } from "@/stores/layout";
import { getApiErrorStatus } from "@/utils/errorMessage";
import { formatProcessDuration } from "@/utils/processDisplay";
import { t } from "@/locales";
import { toast } from '@/components/ui/toastService';

/**
 * 输入区运行时胶囊「后台任务」段的 job 分类。
 *
 * 后端 JobRegistry 把 shell 后台进程（kind: shell/remote-shell/pty）与后台子代理
 * （kind: subagent，background 模式或前台 20 分钟超时转后台）统一托管，快照/停止
 * 协议完全同构；前端只按 kind 拆组展示。workflow/scheduler 有各自的专属 UI 且
 * notify 静默，不进本胶囊——后续要并进来只需扩这两组常量。
 */
export const PROCESS_JOB_KINDS = new Set(["shell", "remote-shell", "pty"]);
export const SUBAGENT_JOB_KINDS = new Set(["subagent"]);

/**
 * 会话运行中的后台任务（输入区运行时胶囊的「后台任务」段）
 *
 * 数据源：jobs store（SSE jobs_snapshot 全量快照 + REST 基线）。
 * 不再监听 process_changed，也不再在每次事件后全量 REST 重拉。
 */
export function useBackgroundJobs(sessionId: MaybeRefOrGetter<string | undefined>) {
  const jobsStore = useJobsStore();
  const tabStore = useTabStore();
  const layoutStore = useLayoutStore();

  /** 终端/远程进程类 job（详情走日志标签） */
  const processJobs = computed<UiJobInfo[]>(() => {
    const sid = toValue(sessionId);
    return jobsStore
      .runningJobs(sid)
      .filter((job) => PROCESS_JOB_KINDS.has(job.kind));
  });

  /** 后台子代理 job（详情走子代理标签；handle = 子会话 id） */
  const subagentJobs = computed<UiJobInfo[]>(() => {
    const sid = toValue(sessionId);
    return jobsStore
      .runningJobs(sid)
      .filter((job) => SUBAGENT_JOB_KINDS.has(job.kind));
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

  /** 停止后台任务（进程与子代理同一条 kill 协议；subagent 的 cancel 钩子 = stopSubAgent） */
  async function killJob(job: UiJobInfo): Promise<void> {
    const sid = toValue(sessionId);
    if (!sid) return;
    try {
      await apiService.killSessionJob(sid, job.id);
      toast.success(t("chat.workspace.processKilledToast"));
    } catch (e) {
      // 404 = 已自然结束；快照会把它移出 running 列表
      if (getApiErrorStatus(e) !== 404) {
        console.error("Failed to kill job:", e);
        toast.error(t("chat.workspace.processKillFailed"));
      }
    }
    void load(true);
  }

  /** 打开进程日志标签（工作区侧边栏）：需先展开工作区并等其挂载完成 */
  function openProcessLog(job: UiJobInfo): void {
    const sid = toValue(sessionId);
    if (!sid) return;
    layoutStore.setWorkspaceVisible(true);
    nextTick(() => tabStore.openProcessLogTab(sid, job.id, job.label));
  }

  watch(
    () => toValue(sessionId),
    () => {
      // 强制基线：快照只应用给当前会话（见下方 jobs_snapshot 过滤），而"切走→作业在后台完成
      // →切回"期间后端不再推快照（active job 归零后 1s ticker 自停）。非 force 会在已有桶时
      // 直接早退，胶囊就会一直显示一个其实已经结束的任务。
      void load(true);
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

  // 秒级心跳：两组都空则不持有定时器（watchEffect 随组件作用域自动清理）
  watchEffect((onCleanup) => {
    if (processJobs.value.length === 0 && subagentJobs.value.length === 0) return;
    nowTick.value = Date.now();
    const timer = setInterval(() => {
      nowTick.value = Date.now();
    }, 1000);
    onCleanup(() => clearInterval(timer));
  });

  return { processJobs, subagentJobs, elapsedText, killJob, openProcessLog };
}
