import { ref, toValue, watch, watchEffect } from "vue";
import type { MaybeRefOrGetter } from "vue";
import { apiService } from "@/services/ApiService";
import type { GoalStateResponse } from "@/types/session";

/**
 * 会话目标数据（输入区运行时胶囊的「目标」段）
 *
 * 数据契约：REST GET /sessions/:id/goal + goal_updated SSE → 全量重拉。
 * goal_updated 只是通知（SSE 不补发历史事件），重连后必须靠 REST 基线补齐，
 * 因此除事件订阅外还监听 onConnected。lastSeq 单调递增：乱序/重复的响应丢弃。
 */
export function useGoalStatus(sessionId: MaybeRefOrGetter<string | undefined>) {
  const state = ref<GoalStateResponse | null>(null);

  /** 写入前按 lastSeq 防回退（旧响应、切会话前的在途响应都不得覆盖新状态） */
  function apply(res: GoalStateResponse): void {
    if (state.value && res.lastSeq < state.value.lastSeq) return;
    state.value = res;
  }

  async function load(): Promise<void> {
    const sid = toValue(sessionId);
    if (!sid) {
      state.value = null;
      return;
    }
    try {
      const res = await apiService.getSessionGoal(sid);
      // 切会话后旧的在途响应直接丢弃，避免把 A 会话的状态写进 B 会话
      if (toValue(sessionId) !== sid) return;
      apply(res);
    } catch {
      // 基线失败保持已有状态：不把一次网络抖动显示成"目标已清除"
    }
  }

  watch(
    () => toValue(sessionId),
    () => {
      // 换会话即清空：lastSeq 是会话内序号，跨会话比较没有意义
      state.value = null;
      void load();
    },
    { immediate: true },
  );

  // 订阅 goal_updated → 全量重拉（按 event.sessionId 过滤，事件是全局广播）。
  // onConnected → 重连补拉（该事件不补发，断连期间的变更只能靠 REST 追回）。
  // watchEffect + cleanup：随组件作用域自动退订，且可在无组件实例的单测里用 effectScope 驱动。
  watchEffect((onCleanup) => {
    const offUpdated = apiService.onSessionEvent("goal_updated", (event) => {
      if (event.sessionId === toValue(sessionId)) void load();
    });
    const offConnected = apiService.onConnected(() => {
      if (toValue(sessionId)) void load();
    });
    onCleanup(() => {
      offUpdated();
      offConnected();
    });
  });

  return { state, refresh: load };
}
