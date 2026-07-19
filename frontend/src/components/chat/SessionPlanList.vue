<template>
  <div v-if="hasPlan" class="session-plan-list">
    <!-- 头部 -->
    <div class="shrink-0 flex items-center justify-between px-2">
      <h3 class="text-sm font-normal text-gray-500 dark:text-[#8b8d95] whitespace-nowrap mx-2">
        计划事项
      </h3>
      <span class="text-xs text-gray-400 dark:text-[#6b6d73]">
        {{ doneCount }}/{{ planItems.length }}
      </span>
    </div>

    <!-- 计划列表 -->
    <div class="plan-items overflow-y-auto py-2" style="max-height: 200px;">
      <div v-for="(item, i) in planItems" :key="i"
        class="plan-item px-2 py-1.5 flex items-center gap-2">
        <!-- 状态图标 -->
        <span class="plan-status-icon shrink-0 w-3.5 h-3.5 flex items-center justify-center">
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
import { apiService } from '@/services/ApiService';

interface PlanItem {
  content: string;
  status: string;
}

const props = defineProps<{
  sessionId: string | null;
}>();

const planItems = ref<PlanItem[]>([]);

const hasPlan = computed(() => planItems.value.length > 0 && planItems.value.some(i => i.status !== 'completed'));
const doneCount = computed(() => planItems.value.filter(i => i.status === 'completed').length);

async function loadPlan() {
  if (!props.sessionId) {
    planItems.value = [];
    return;
  }
  try {
    const res = await apiService.getSessionPlan(props.sessionId);
    planItems.value = res.items || [];
  } catch {
    planItems.value = [];
  }
}

let unsubscribePlanUpdated: (() => void) | null = null;

watch(() => props.sessionId, () => loadPlan(), { immediate: true });

onMounted(() => {
  unsubscribePlanUpdated = apiService.onSessionEvent('plan_updated', (event) => {
    if (event.sessionId === props.sessionId) {
      loadPlan();
    }
  });
});

onUnmounted(() => {
  if (unsubscribePlanUpdated) unsubscribePlanUpdated();
});
</script>

<style scoped>
.session-plan-list {
  padding-top: 0.5rem;
}

.plan-item {
  transition: background-color 0.15s ease;
  border-radius: 4px;
}

.plan-item:hover {
  background-color: rgba(0, 0, 0, 0.03);
}

.dark .plan-item:hover {
  background-color: rgba(255, 255, 255, 0.05);
}

.plan-status-icon .is-loading {
  animation: rotating 1.5s linear infinite;
}

@keyframes rotating {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}
</style>
