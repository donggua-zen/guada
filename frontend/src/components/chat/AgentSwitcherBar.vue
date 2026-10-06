<template>
  <div
    class="absolute bottom-full left-3 right-3 z-20 w-[calc(100%-24px)] margin-auto flex flex-col rounded-tl-(--gd-size-dialog-rounded-radius) rounded-tr-(--gd-size-dialog-rounded-radius)  bg-(--gd-color-surface) border border-(--gd-color-surface-border) overflow-hidden transition-all duration-300 shadow-lg"
    :class="{ 'max-h-48': isExpanded, 'max-h-12': !isExpanded }">
    <!-- 头部折叠栏 -->
    <div class="flex items-center px-2 py-2 cursor-pointer select-none" @click="toggleExpand">
      <Avatar :src="agent?.avatarUrl" type="assistant" :name="agent?.name || t('chat.agent.smartAssistant')"
        class="w-5 h-5 shrink-0 rounded overflow-hidden mr-2" />
      <span class="text-sm text-gray-700 dark:text-[#c5c7cc] shrink-0">
        {{ agent?.name || t('chat.agent.smartAssistant') }}
      </span>
      <span class="text-xs text-gray-400 dark:text-[#6b6d75] truncate">
        {{ agent?.description || t('chat.agent.defaultDescription') }}
      </span>
    </div>
    <!-- 展开的智能体列表 -->
    <div class="mb-5 space-y-0.5 px-1"
      :class="{ 'overflow-y-auto': isExpanded, 'overflow-y-hidden': !isExpanded }">
      <!-- 加载中 -->
      <div v-if="loading" class="flex items-center justify-center py-4">
        <el-icon class="is-loading text-gray-400" size="16">
          <Loading />
        </el-icon>
      </div>
      <!-- 智能体列表 -->
      <template v-else>
        <div v-for="char in selectableAgents" :key="char.id"
          class="flex items-center gap-2 py-1 px-1 rounded-(--gd-size-dialog-rounded-radius) cursor-pointer transition-colors"
          :class="{
            'text-gray-500 dark:text-[#8b8d95] hover:bg-(--gd-color-surface-hover)': true,
          }"
          @click.stop="handleSelect(char)">
          <Avatar :src="char.avatarUrl" type="assistant" :name="char.name"
            class="w-5 h-5 shrink-0 rounded overflow-hidden" />
          <span class="text-sm shrink-0">{{ char.name }}</span>
          <span class="text-xs text-gray-400 dark:text-[#6b6d75] truncate">{{ char.description || t('chat.agent.noDescription') }}</span>
        </div>
        <div v-if="selectableAgents.length === 0" class="text-center py-4 text-gray-400 dark:text-[#6b6d75]">
          <p class="text-sm">{{ t('chat.agent.noOtherRoles') }}</p>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { Loading } from '@element-plus/icons-vue';
import { useI18n } from 'vue-i18n';
import { apiService } from '@/services/ApiService';
import { Avatar } from '../ui';
import type { Agent } from '@/types/agent';

const { t } = useI18n();

const props = defineProps<{
  agent?: Agent | null;
}>();

const emit = defineEmits<{
  select: [agent: Agent];
}>();

const isExpanded = ref(false);
const loading = ref(false);
const agents = ref<Agent[]>([]);
let loaded = false;

const selectableAgents = computed(() => {
  return agents.value.filter(c => c.id !== props.agent?.id);
});

function toggleExpand() {
  isExpanded.value = !isExpanded.value;
  if (isExpanded.value && !loaded) {
    loadAgents();
  }
}

async function loadAgents() {
  loading.value = true;
  try {
    const res = await apiService.fetchAgents();
    agents.value = res.items || [];
    loaded = true;
  } catch (e) {
    console.error('[AgentSwitcherBar] 加载智能体失败:', e);
  } finally {
    loading.value = false;
  }
}

function handleSelect(char: Agent) {
  emit('select', char);
  isExpanded.value = false;
}
</script>
