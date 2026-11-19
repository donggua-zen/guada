<template>
  <div class="todo-call-card">
    <!-- 头部：折叠/展开都显示；折叠态无背景，仅展开后的列表卡片带背景 -->
    <div
      class="group todo-header flex items-center text-sm text-(--gd-color-text-subtle) min-w-0"
      :class="{ 'cursor-pointer todo-header--interactive': hasItems }"
      :role="hasItems ? 'button' : undefined"
      :tabindex="hasItems ? 0 : undefined"
      :aria-label="hasItems
        ? (expanded ? t('chat.todo.collapse') : t('chat.todo.expand'))
        : summaryText"
      @click="toggle"
      @keydown.enter.prevent="toggle"
      @keydown.space.prevent="toggle"
    >
      <!-- 与分组标题同一套「图标 ↔ 箭头」hover 互换：图标常显，hover 淡出，
           箭头只在 hover/展开时出现（两者 absolute inset-0，避免重叠） -->
      <span class="relative w-4 h-4 shrink-0 flex items-center justify-center">
        <ToolTodoIcon v-if="!expanded" class="absolute inset-0 w-4 h-4 transition-opacity duration-200"
          :class="[iconClass, hasItems ? 'group-hover:opacity-0' : '']" />
        <ChevronDown12Regular v-if="hasItems" class="absolute inset-0 w-4 h-4 transition-all duration-200"
          :class="expanded ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'"
          :style="expanded ? {} : { transform: 'rotate(-90deg)' }" />
      </span>
      <span class="ml-2 shrink-0">{{ t('chat.todo.label') }}</span>
      <span class="todo-summary ml-2 min-w-0 truncate text-sm text-(--gd-color-text-subtle)">
        {{ summaryText }}
      </span>
      <span v-if="hasItems" class="todo-count ml-2 shrink-0 font-mono text-sm text-(--gd-color-text-subtlest)">
        {{ doneCount }}/{{ items.length }}
      </span>
    </div>

    <!-- 展开态：只有列表卡片带背景 -->
    <div v-if="expanded && hasItems" class="todo-card-body mt-1 px-2 py-2">
      <div class="flex flex-col gap-0.5">
        <div v-for="(item, i) in items" :key="i" class="flex items-start gap-2 rounded px-1 py-0.5">
          <span class="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center">
            <Checkmark16Regular v-if="item.status === 'completed'" class="todo-icon--done w-3.5 h-3.5" />
            <ArrowRight16Regular v-else-if="item.status === 'in_progress'" class="todo-icon--active w-3.5 h-3.5" />
            <span v-else class="todo-ring" />
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
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  ArrowRight16Regular,
  Checkmark16Regular,
  ChevronDown12Regular,
} from '@vicons/fluent'
import { ToolTodoIcon } from '@/components/icons/toolIcons'
import {
  countCompletedTodos,
  isTodoListCompleted,
  parseTodoItemsFromArgs,
  parseTodoItemsFromMeta,
  pickCurrentTodo,
  type TodoCallItem,
} from '@/utils/todoTools'
import type { ToolCall } from '@/utils/toolDisplay'
import type { ToolCallResponseEntry } from '@/types/message'

/**
 * TODO 工具行（独立成组，不并入过程步骤组）。
 *
 * 每次 todo 调用一张卡：头部常显「待办 + 当前事项 + x/y」，折叠态无背景；
 * 点击展开完整列表，列表卡片才带背景。
 * 数据优先取本次调用结果 meta.items（历史锚点准确），结果未到时用
 * create/update 的流式参数预览。
 */
const props = defineProps<{
  tool: ToolCall
  response?: ToolCallResponseEntry
  executing?: boolean
  failed?: boolean
}>()

const { t } = useI18n()

const expanded = ref(false)

const metaItems = computed(() => parseTodoItemsFromMeta(props.response?.meta))
const argItems = computed(() => parseTodoItemsFromArgs(props.tool))

/**
 * 展示列表：
 * - 失败：不展示可能误导的参数预览；
 * - 权威快照非空：用快照；
 * - 快照为空（全部完成）或尚未到达：回退 create/update 参数；
 * - 都没有：空列表，走「整理中 / 全部完成」头部。
 */
const items = computed<TodoCallItem[]>(() => {
  if (props.failed) return []
  if (metaItems.value && metaItems.value.length > 0) return metaItems.value
  if (argItems.value) return argItems.value
  return metaItems.value ?? []
})

const hasItems = computed(() => items.value.length > 0)
const current = computed(() => pickCurrentTodo(items.value))
const doneCount = computed(() => countCompletedTodos(items.value))
const allCompleted = computed(() => isTodoListCompleted(items.value))

const summaryText = computed(() => {
  if (props.failed) return t('chat.todo.failed')
  if (allCompleted.value) return t('chat.todo.allDone')
  if (current.value) return current.value.content
  if (props.executing) return t('chat.todo.managing')
  return t('chat.todo.allDone')
})

const iconClass = computed(() => {
  if (props.failed) return 'todo-icon--error';
  return 'todo-icon--subtle';
})

// 列表变空（例如执行完成后全部完成且无参数回退）时退出展开态，避免空卡片
watch(hasItems, (value) => {
  if (!value) expanded.value = false
})

function toggle(): void {
  if (!hasItems.value) return
  expanded.value = !expanded.value
}
</script>

<style scoped>
.todo-call-card {
  width: 100%;
}

/* 只过渡文字色，hover 提亮更平滑 */
.todo-header--interactive {
  transition: color 0.2s ease;
}

/* 与工具分组头一致：无背景，hover 整行文字提亮；图标 ↔ 箭头互换见模板 */
.todo-header--interactive:hover,
.todo-header--interactive:hover .todo-summary,
.todo-header--interactive:hover .todo-count {
  color: var(--gd-color-text);
}

.todo-card-body {
  /* 与工具展开卡一致：微透明表面底色 + 细边框，亮暗色统一走 surface token */
  background: color-mix(in srgb, var(--gd-color-surface) 80%, transparent);
  border: 1px solid var(--gd-color-border);
  border-radius: var(--gd-size-surface-radius);
}

.todo-text {
  color: var(--gd-color-text-subtle);
}
.todo-text-strong {
  color: var(--gd-color-text);
}
.todo-text-done {
  color: var(--gd-color-text-disabled);
}
.todo-icon--subtle {
  color: var(--gd-color-text-subtle);
}
.todo-icon--active {
  color: var(--gd-color-text);
}
.todo-icon--done {
  color: var(--gd-color-success);
}
.todo-icon--error {
  color: var(--gd-color-danger);
}
.todo-ring {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  border: 1px solid var(--gd-color-text-subtlest);
}
</style>
