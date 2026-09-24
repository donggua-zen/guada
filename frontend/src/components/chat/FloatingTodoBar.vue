<!-- 浮动 TODO 条：悬浮在输入区上方，不跟随消息滚动。
     胶囊态（默认）：单行 pill —— 状态图标 + 当前项 + 进度；
     Hover 展开：上方弹出详情面板，列出全部条目。
     数据契约：REST GET /sessions/:id/todo + todo_updated SSE → 全量重拉。 -->
<template>
  <div v-if="items.length" class="floating-todo-bar" @mouseenter="onMouseEnter" @mouseleave="onMouseLeave">
    <!-- 胶囊态。图标尺寸用偶数：外层容器 16px，13px 会让居中余量成 1.5px（半像素），
         图标就会落在半像素上，随容器位置在两种奇偶相位间跳一个设备像素；
         14px 余量 2px → 1px，稳定落在整像素。横线类元素同理（见 EventCard 的 h-0.5）。 -->
    <div class="todo-capsule">
      <span class="flex h-4 w-4 shrink-0 items-center justify-center">
        <el-icon v-if="currentItem?.status === 'in_progress'" size="14" class="todo-icon--active">
          <ArrowRight16Regular />
        </el-icon>
        <el-icon v-else-if="currentItem?.status === 'completed'" size="14" class="todo-icon--done">
          <Check />
        </el-icon>
        <span v-else class="todo-ring"></span>
      </span>
      <span class="min-w-0 flex-1 truncate text-[13px] todo-text" :title="currentItem?.content">
        {{ currentItem?.content }}
      </span>
      <span class="shrink-0 font-mono text-[13px] todo-count">
        {{ doneCount }}/{{ items.length }}
      </span>
    </div>

    <!-- 详情面板（hover 或 pinned 时展开） -->
    <Transition name="todo-panel">
      <div v-if="panelVisible" class="todo-detail-panel">
        <div class="flex items-center gap-2 px-1 pb-1.5 mb-0.5 border-b border-(--gd-color-surface-border)">
          <span class="text-[11px] font-medium todo-text-faint">
            {{ t('chat.workspace.todoList') }}
          </span>
          <span class="ml-auto shrink-0 font-mono text-[11px] font-semibold todo-count">
            {{ doneCount }}/{{ items.length }}
          </span>
        </div>
        <div class="flex flex-col gap-0.5 overflow-y-auto todo-panel-scroll">
          <div v-for="(item, i) in items" :key="i" class="todo-item">
            <span class="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center">
              <el-icon v-if="item.status === 'completed'" size="14" class="todo-icon--done">
                <Check />
              </el-icon>
              <el-icon v-else-if="item.status === 'in_progress'" size="14" class="todo-icon--active">
                <ArrowRight16Regular />
              </el-icon>
              <span v-else class="todo-ring"></span>
            </span>
            <span class="min-w-0 flex-1 text-[13px] leading-5 break-words"
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
    </Transition>
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
const hovered = ref(false);

const doneCount = computed(() => items.value.filter((it) => it.status === "completed").length);

const currentItem = computed<TodoItem | null>(() => {
  const list = items.value;
  return (
    list.find((it) => it.status === "in_progress") ??
    list.find((it) => it.status === "pending") ??
    list[0] ??
    null
  );
});

const panelVisible = computed(() => hovered.value);

let openTimer: ReturnType<typeof setTimeout> | null = null;
let closeTimer: ReturnType<typeof setTimeout> | null = null;

function onMouseEnter() {
  if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }
  openTimer = setTimeout(() => { hovered.value = true; }, 120);
}

function onMouseLeave() {
  if (openTimer) { clearTimeout(openTimer); openTimer = null; }
  closeTimer = setTimeout(() => { hovered.value = false; }, 80);
}

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

watch(() => props.sessionId, () => {
  hovered.value = false;
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
  if (openTimer) clearTimeout(openTimer);
  if (closeTimer) clearTimeout(closeTimer);
});
</script>

<style scoped>
.floating-todo-bar {
  position: relative;
  display: flex;
  /* 收缩链：行变窄时能一直传到胶囊内部的 truncate，不把同行的回到底部按钮挤出可视区 */
  min-width: 0;
  max-width: 100%;
}

.todo-capsule {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 12px;
  /* 与回到底部按钮同圆角：同一行的两个 chip 必须同形（改这里要同步 ScrollToBottomButton） */
  border-radius: 8px;
  border: 1px solid var(--gd-color-border);
  background: var(--gd-color-surface);
  cursor: pointer;
  user-select: none;
  /* 宽度上限必须是定长：百分比上限在内在尺寸计算阶段不可解析、会被忽略，外层 flex 项
     就会按「未截断的文本宽度」定宽，胶囊右侧留出空档把两个 chip 推远（实测 103px）。
     定长 420px 后外层宽度 = 胶囊实宽，两者之间只剩行的 gap。min-width:0 保证行窄时能收缩。 */
  max-width: 420px;
  min-width: 0;
  /* 悬停底色是半透明 tint，换 background 会连同不透明底色一起换掉（浮层下方的消息文字透出来）。
     改用 inset 阴影叠在 surface 之上，合成恒为实色。 */
  box-shadow: inset 0 0 0 999px transparent;
  transition: box-shadow 0.15s ease, border-color 0.15s ease;
}
.todo-capsule:hover {
  box-shadow: inset 0 0 0 999px var(--gd-color-surface-hover);
}

.todo-detail-panel {
  position: absolute;
  bottom: calc(100% + 6px);
  left: 50%;
  transform: translateX(-50%);
  width: min(360px, calc(100vw - 32px));
  max-height: 288px;
  padding: 8px;
  border-radius: var(--gd-size-surface-radius);
  background: var(--gd-color-surface);
  border: 1px solid var(--gd-color-border);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08);
  z-index: 40;
  display: flex;
  flex-direction: column;
}

.todo-panel-scroll {
  scrollbar-width: thin;
}

.todo-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 4px 6px;
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.1s ease;
}
.todo-item:hover {
  background: var(--gd-color-surface-hover);
}

/* 文字层级 */
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

/* 面板出入动画：只动 transform，不动 opacity。
   opacity 过渡依赖 rAF 推进到不透明终态，而本环境 rAF 不可靠会把面板卡在半透明，
   故改为恒定不透明 + 仅位移滑入，避免残留 enter-from 的 opacity:0。 */
.todo-panel-enter-active,
.todo-panel-leave-active {
  transition: transform 0.12s ease;
}
.todo-panel-enter-from,
.todo-panel-leave-to {
  transform: translateX(-50%) translateY(4px);
}
</style>
