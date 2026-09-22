<template>
<!-- 会话待办卡：跟随对话流滚动（独立组件，不挂 turn，与回合数据零耦合）。
     数据契约：REST GET /sessions/:id/todo 基线 + todo_updated SSE 脏标记 → 全量重拉；
     空列表不渲染（后端全部完成即删存储文件 → 自动消失）。
     折叠态（默认）：单行胶囊——不显示标题，整行即当前进行项（无进行中则首个待处理）；
     展开态：完整卡片，标题 + 进度 + 全部条目。整卡可点切换。
     视觉：全部走主题变量（style.css），亮/暗色自动适配；无阴影无边框。 -->
  <div v-if="items.length" class="todo-card mt-2 mb-6 w-full">

    <!-- ── 折叠态：单行胶囊（状态点 + 当前项 + 进度 + 箭头） ── -->
    <div v-if="!expanded" class="todo-pill flex items-center gap-2 px-3 py-2 cursor-pointer select-none"
      @click="expanded = true">
      <span class="flex h-4 w-4 shrink-0 items-center justify-center">
        <el-icon v-if="currentItem?.status === 'in_progress'" size="13" class="todo-icon--active">
          <ArrowRight16Regular />
        </el-icon>
        <el-icon v-else-if="currentItem?.status === 'completed'" size="13" class="todo-icon--done">
          <Check />
        </el-icon>
        <span v-else class="todo-ring"></span>
      </span>
      <span class="min-w-0 flex-1 truncate text-xs todo-text" :title="currentItem?.content">
        {{ currentItem?.content }}
      </span>
      <span v-if="doneCount" class="shrink-0 font-mono text-xs todo-text-faint">
        {{ doneCount }}/{{ items.length }}
      </span>
      <el-icon :size="12" class="todo-chevron shrink-0">
        <ArrowDown />
      </el-icon>
    </div>

    <!-- ── 展开态：完整卡片 ── -->
    <div v-else class="todo-card-body px-4 py-3">
      <!-- 头部：纯文字标题 + 完成进度 + 收起箭头 -->
      <div class="todo-head flex items-center gap-2 cursor-pointer select-none" @click="expanded = false">
        <span class="text-xs font-medium todo-text-faint">
          {{ t('chat.workspace.todoList') }}
        </span>
        <span v-if="doneCount" class="ml-auto shrink-0 font-mono text-xs font-semibold todo-count">
          {{ doneCount }}/{{ items.length }}
        </span>
        <el-icon :size="12" class="todo-chevron shrink-0 is-open" :class="{ 'ml-auto': !doneCount }">
          <ArrowDown />
        </el-icon>
      </div>

      <!-- 全部条目：✓ 完成 / → 进行中 / ○ 待处理 -->
      <div class="mt-2 flex flex-col gap-0.5">
        <div v-for="(item, i) in items" :key="i" class="flex items-start gap-2 rounded px-1 py-0.5">
          <span class="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center">
            <el-icon v-if="item.status === 'completed'" size="13" class="todo-icon--done">
              <Check />
            </el-icon>
            <el-icon v-else-if="item.status === 'in_progress'" size="13" class="todo-icon--active">
              <ArrowRight16Regular />
            </el-icon>
            <span v-else class="todo-ring"></span>
          </span>
          <span class="min-w-0 flex-1 text-xs leading-relaxed break-words" :title="item.content"
            :class="item.status === 'completed'
              ? 'line-through todo-text-done'
              : item.status === 'in_progress'
                ? 'todo-text-strong'
                : 'todo-text'">
            {{ item.content }}
          </span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from "vue";
import { useI18n } from "vue-i18n";
import { Check, ArrowDown } from "@element-plus/icons-vue";
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
/** 展开态（默认折叠：单行胶囊显示当前项，展开才显示标题 + 全部条目） */
const expanded = ref(false);
const doneCount = computed(() => items.value.filter((it) => it.status === "completed").length);

/** 当前项：优先进行中，其次首个待处理，最后兜底首条（异常/全完成场景） */
const currentItem = computed<TodoItem | null>(() => {
  const list = items.value;
  return (
    list.find((it) => it.status === "in_progress") ??
    list.find((it) => it.status === "pending") ??
    list[0] ??
    null
  );
});

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

// 会话切换：重置为折叠态 + 重拉数据
watch(() => props.sessionId, () => {
  expanded.value = false;
  void loadTodo();
}, { immediate: true });

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

<style scoped>
/* 配色/圆角全部走主题变量（style.css），亮暗色自动适配、主题可统一控制 */
.todo-pill {
  background: var(--gd-color-sidebar-bg);
  border-radius: 9999px;
  transition: background 0.15s ease;
}
.todo-pill:hover {
  background: var(--gd-color-sidebar-bg-hover);
}

.todo-card-body {
  background: var(--gd-color-sidebar-bg);
  border-radius: var(--gd-size-surface-radius);
}

.todo-chevron {
  color: var(--gd-color-text-disabled);
  transition: transform 0.15s ease;
}
.todo-chevron.is-open {
  transform: rotate(180deg);
}

/* 文本层级：统一走主题文字色 */
.todo-text {
  color: var(--gd-color-text-gray);
}
.todo-text-strong {
  color: var(--gd-color-text);
}
.todo-text-done {
  color: var(--gd-color-text-disabled);
}
.todo-text-faint {
  color: var(--gd-color-text-gray);
}
.todo-count {
  color: var(--gd-color-success);
}
.todo-icon--active {
  color: var(--gd-color-text);
}
.todo-icon--done {
  color: var(--gd-color-success);
}
.todo-ring {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  border: 1.5px solid var(--gd-color-text-disabled);
}

.todo-head:hover span:first-child {
  color: var(--gd-color-text);
}
</style>
