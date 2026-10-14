import { computed, ref, toValue, watch, watchEffect } from "vue";
import type { MaybeRefOrGetter } from "vue";
import { apiService } from "@/services/ApiService";

export interface TodoItem {
  content: string;
  status: string;
}

/**
 * 会话待办数据（输入区运行时胶囊的「待办」段）
 *
 * 数据契约：REST GET /sessions/:id/todo + todo_updated SSE → 全量重拉。
 * （原 FloatingTodoBar 自带的组件内逻辑，净搬迁以便胶囊外壳复用它）
 */
export function useTodoStatus(sessionId: MaybeRefOrGetter<string | undefined>) {
  const items = ref<TodoItem[]>([]);

  const doneCount = computed(() => items.value.filter((it) => it.status === "completed").length);

  /** 胶囊文本：进行中 → 待办 → 首项（与旧 FloatingTodoBar 同口径） */
  const currentItem = computed<TodoItem | null>(() => {
    const list = items.value;
    return (
      list.find((it) => it.status === "in_progress") ??
      list.find((it) => it.status === "pending") ??
      list[0] ??
      null
    );
  });

  async function load(): Promise<void> {
    const sid = toValue(sessionId);
    if (!sid) {
      items.value = [];
      return;
    }
    try {
      const res = await apiService.getSessionTodo(sid);
      items.value = res.items || [];
    } catch {
      items.value = [];
    }
  }

  watch(() => toValue(sessionId), () => { void load(); }, { immediate: true });

  // 订阅 todo_updated → 全量重拉（按 event.sessionId 过滤，事件是全局广播）。
  // watchEffect + cleanup：随组件作用域自动清理，且可在无组件实例的单测里用 effectScope 驱动。
  let unsubscribe: (() => void) | null = null;
  watchEffect((onCleanup) => {
    unsubscribe = apiService.onSessionEvent("todo_updated", (event) => {
      if (event.sessionId === toValue(sessionId)) void load();
    });
    onCleanup(() => {
      unsubscribe?.();
      unsubscribe = null;
    });
  });

  return { items, doneCount, currentItem };
}
