<template>
  <div v-if="hasTodo" class="session-todo-list">
    <!-- 头部 -->
    <div class="shrink-0 flex items-center justify-between px-2">
      <h3 class="text-sm font-normal text-gray-500 dark:text-[#8b8d95] whitespace-nowrap mx-2">
        {{ t('chat.workspace.todoList') }}
      </h3>
      <span class="text-xs text-gray-400 dark:text-[#6b6d73]">
        {{ doneCount }}/{{ todoItems.length }}
      </span>
    </div>

    <!-- 待办列表 -->
    <div class="overflow-y-auto py-2 px-1 space-y-0.5" style="max-height: 200px;">
      <div v-for="(item, i) in todoItems" :key="i"
        class="mx-1 px-2 py-1 flex items-center gap-2 rounded hover:bg-gray-100 dark:hover:bg-[#2a2c30] transition-all duration-200">
        <!-- 状态图标 -->
        <span class="shrink-0 w-3.5 h-3.5 flex items-center justify-center">
          <el-icon v-if="item.status === 'completed'" size="14" class="text-green-500">
            <Check />
          </el-icon>
          <el-icon v-else-if="item.status === 'in_progress'" size="14" class="text-blue-500 is-loading">
            <Loading />
          </el-icon>
          <span v-else class="w-3 h-3 rounded-full border border-gray-300 dark:border-gray-600"></span>
        </span>
        <!-- 步骤文本 -->
        <span class="text-xs truncate flex-1"
          :class="item.status === 'completed'
            ? 'line-through text-gray-400 dark:text-[#6b6d73]'
            : 'text-gray-600 dark:text-[#8b8d95]'"
          :title="item.content">
          {{ item.content }}
        </span>
      </div>
    </div>
    <div class="border-b border-gray-100 dark:border-[#2e3035] mx-4 mt-3"></div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { Check, Loading } from '@element-plus/icons-vue';
import { useI18n } from 'vue-i18n';
import { apiService } from '@/services/ApiService';

const { t } = useI18n();

interface TodoItem {
  content: string;
  status: string;
}

const props = defineProps<{
  sessionId: string | null;
}>();

const todoItems = ref<TodoItem[]>([]);

const hasTodo = computed(() => todoItems.value.length > 0 && todoItems.value.some(i => i.status !== 'completed'));
const doneCount = computed(() => todoItems.value.filter(i => i.status === 'completed').length);

async function loadTodo() {
  if (!props.sessionId) {
    todoItems.value = [];
    return;
  }
  try {
    const res = await apiService.getSessionTodo(props.sessionId);
    todoItems.value = res.items || [];
  } catch {
    todoItems.value = [];
  }
}

let unsubscribeTodoUpdated: (() => void) | null = null;

watch(() => props.sessionId, () => loadTodo(), { immediate: true });

onMounted(() => {
  unsubscribeTodoUpdated = apiService.onSessionEvent('todo_updated', (event) => {
    if (event.sessionId === props.sessionId) {
      loadTodo();
    }
  });
});

onUnmounted(() => {
  if (unsubscribeTodoUpdated) unsubscribeTodoUpdated();
});
</script>

<style scoped>
.session-todo-list {
  padding-top: 0.5rem;
}
</style>
