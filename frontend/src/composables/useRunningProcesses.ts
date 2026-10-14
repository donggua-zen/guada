import { nextTick, ref, toValue, watch, watchEffect } from "vue";
import type { MaybeRefOrGetter } from "vue";
import { ElMessage } from "element-plus";
import { apiService, type UiProcessInfo } from "@/services/ApiService";
import { useTabStore } from "@/stores/tab";
import { useLayoutStore } from "@/stores/layout";
import { getApiErrorStatus } from "@/utils/errorMessage";
import { formatProcessDuration } from "@/utils/processDisplay";
import { t } from "@/locales";

/**
 * 会话运行中的后台进程（输入区运行时胶囊的「进程」段）
 *
 * 数据契约：REST GET /sessions/:id/processes（接口只返回运行中进程，结束即消失）+
 * process_changed SSE → 全量重拉。原概览面板「后台进程」区块的逻辑搬迁，
 * 并补上会话切换 generation 守卫（过期响应不得写进新会话的列表）。
 */
export function useRunningProcesses(sessionId: MaybeRefOrGetter<string | undefined>) {
  const processes = ref<UiProcessInfo[]>([]);
  /** 时长显示的秒级心跳（仅在列表非空时持有定时器，驱动 elapsedText 重算） */
  const nowTick = ref(Date.now());

  const tabStore = useTabStore();
  const layoutStore = useLayoutStore();

  /** 并发加载代际：会话切换时作废旧请求结果（响应到达晚于切换即丢弃） */
  let loadGeneration = 0;

  async function load(): Promise<void> {
    const sid = toValue(sessionId);
    const generation = ++loadGeneration;
    if (!sid) {
      processes.value = [];
      return;
    }
    try {
      const res = await apiService.getSessionProcesses(sid);
      if (generation !== loadGeneration) return;
      processes.value = res.processes || [];
    } catch {
      if (generation === loadGeneration) processes.value = [];
    }
  }

  function elapsedText(startedAt: string): string {
    const start = new Date(startedAt).getTime();
    if (Number.isNaN(start)) return "";
    return formatProcessDuration(nowTick.value - start);
  }

  async function killProcess(p: UiProcessInfo): Promise<void> {
    const sid = toValue(sessionId);
    if (!sid) return;
    try {
      await apiService.killSessionProcess(sid, p.id);
      ElMessage.success(t("chat.workspace.processKilledToast"));
    } catch (e) {
      // 404 = 进程已自然结束（列表马上会刷新掉），不报错
      if (getApiErrorStatus(e) !== 404) {
        console.error("Failed to kill process:", e);
        ElMessage.error(t("chat.workspace.processKillFailed"));
      }
    }
    void load();
  }

  /** 打开进程日志标签（工作区侧边栏）：需先展开工作区并等其挂载完成 */
  function openProcessLog(p: UiProcessInfo): void {
    const sid = toValue(sessionId);
    if (!sid) return;
    layoutStore.setWorkspaceVisible(true);
    nextTick(() => tabStore.openProcessLogTab(sid, p.id, p.command, p.startedAt));
  }

  watch(() => toValue(sessionId), () => { void load(); }, { immediate: true });

  let unsubscribeProcessChanged: (() => void) | null = null;
  // 订阅 process_changed → 全量重拉（按 event.sessionId 过滤，事件是全局广播）。
  // 用 watchEffect + cleanup 而非 onMounted/onUnmounted：随组件作用域自动清理的同时
  // 也能在无组件实例的单测里用 effectScope 驱动（useElapsedTicker 同款范式）。
  watchEffect((onCleanup) => {
    unsubscribeProcessChanged = apiService.onSessionEvent("process_changed", (event) => {
      if (event.sessionId === toValue(sessionId)) void load();
    });
    onCleanup(() => {
      unsubscribeProcessChanged?.();
      unsubscribeProcessChanged = null;
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
