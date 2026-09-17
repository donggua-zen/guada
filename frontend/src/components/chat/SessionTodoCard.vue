<template>
<!-- 会话待办卡：跟随对话流滚动（独立组件，不挂 turn，与回合数据零耦合）。
     数据契约：REST GET /sessions/:id/todo 基线 + todo_updated SSE 脏标记 → 全量重拉；
     空列表不渲染（后端全部完成即删存储文件 → 自动消失）。
     视觉：浅灰填充（无阴影）+ surface-border + rounded，badge 标题提亮一档保持层级。 -->
  <div v-if="items.length"
    class="todo-card my-2 w-full bg-gray-100 dark:bg-[#2a2c30] border border-(--gd-color-surface-border) rounded-(--gd-size-dialog-rounded-radius) px-4 py-3">
    <!-- 头部：badge 标题 + 完成进度（绿色计数；badge 在浅灰卡面上提亮一档保持层级） -->
    <div class="flex items-center gap-2">
      <span
        class="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium bg-white dark:bg-[#33363b] text-gray-600 dark:text-[#c5c7cc]">
        {{ t('chat.workspace.todoList') }}
      </span>
      <span v-if="doneCount" class="ml-auto font-mono text-xs font-semibold text-green-600 dark:text-green-500">
        {{ doneCount }}/{{ items.length }}
      </span>
    </div>

    <!-- 条目列表：✓ 完成 / → 进行中 / ○ 待处理 -->
    <div class="mt-2 flex flex-col gap-0.5">
      <div v-for="(item, i) in items" :key="i" class="flex items-start gap-2 rounded px-1 py-0.5">
        <span class="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center">
          <el-icon v-if="item.status === 'completed'" size="13" class="text-green-500">
            <Check />
          </el-icon>
          <el-icon v-else-if="item.status === 'in_progress'" size="13" class="text-blue-500">
            <ArrowRight16Regular />
          </el-icon>
          <span v-else class="h-2 w-2 rounded-full border border-gray-300 dark:border-gray-600"></span>
        </span>
        <span class="min-w-0 flex-1 text-xs leading-relaxed break-words" :title="item.content"
          :class="item.status === 'completed'
            ? 'line-through text-gray-400 dark:text-[#6b6d73]'
            : item.status === 'in_progress'
              ? 'text-gray-800 dark:text-[#e5e7eb]'
              : 'text-gray-500 dark:text-[#8b8d95]'">
          {{ item.content }}
        </span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from "vue";
import { useI18n } from "vue-i18n";
import { Check } from "@element-plus/icons-vue";
import { ArrowRight16Regular } from "@vicons/fluent";
import { apiService } from "@/services/ApiService";

interface TodoItem {
  content: string;
  status: string;
}

const { t } = useI18n();

const props = defineProps<{
  sessionId?: string;
}>();

const items = ref<TodoItem[]>([]);
const doneCount = computed(() => items.value.filter((it) => it.status === "completed").length);

/** 全量重拉（todo_updated SSE 仅脏标记不带数据）；空/失败置空 → 卡片隐藏 */
async function loadTodo(): Promise<void> {
  if (!props.sessionId) {
    items.value = [];
    return;
  }
  try {
    const res = await apiService.getSessionTodo(props.sessionId);
    items.value = res.items || [];
  } catch {
    items.value = [];
  }
}

let unsubscribeTodoUpdated: (() => void) | null = null;

watch(() => props.sessionId, () => loadTodo(), { immediate: true });

onMounted(() => {
  unsubscribeTodoUpdated = apiService.onSessionEvent("todo_updated", (event) => {
    if (event.sessionId === props.sessionId) loadTodo();
  });
});

onUnmounted(() => {
  unsubscribeTodoUpdated?.();
  unsubscribeTodoUpdated = null;
});
</script>
