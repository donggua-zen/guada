<template>
  <div
    class="absolute bottom-full left-0 right-0 z-20 w-full flex flex-col rounded-tl-3xl rounded-tr-3xl bg-gray-200 dark:bg-[#2a2a2a] overflow-hidden transition-all duration-300 shadow-lg"
    :class="{ 'max-h-48': isExpanded, 'max-h-12': !isExpanded }">
    <!-- 头部折叠栏 -->
    <div class="flex items-center px-5 py-2 cursor-pointer select-none" @click="toggleExpand">
    
      <Avatar :src="character?.avatarUrl" type="assistant" :name="character?.title || '智能助手'"
        class="w-5 h-5 shrink-0 rounded overflow-hidden mr-2" />
      <span class="text-sm text-gray-700 dark:text-[#c5c7cc] shrink-0">
        {{ character?.title || '智能助手' }}
      </span>
      <span class="text-xs text-gray-400 dark:text-[#6b6d75] truncate ml-2">
        {{ character?.description || '一个友好、专业的 AI 助手，可以帮你解答各种问题。' }}
      </span>
    </div>
    <!-- 展开的角色列表 -->
    <div class="px-1.5 mb-5 space-y-0.5" style="scrollbar-gutter: stable both-edges"
      :class="{ 'overflow-y-auto': isExpanded, 'overflow-y-hidden': !isExpanded }">
      <!-- 加载中 -->
      <div v-if="loading" class="flex items-center justify-center py-4">
        <el-icon class="is-loading text-gray-400" size="16">
          <Loading />
        </el-icon>
      </div>
      <!-- 角色列表 -->
      <template v-else>
        <div v-for="char in selectableCharacters" :key="char.id"
          class="flex items-center gap-2 py-1 px-2 rounded-lg cursor-pointer transition-colors"
          :class="{
            'text-gray-500 dark:text-[#8b8d95] hover:bg-gray-100 dark:hover:bg-[#25262a]': true,
          }"
          @click.stop="handleSelect(char)">
          <Avatar :src="char.avatarUrl" type="assistant" :name="char.title"
            class="w-5 h-5 shrink-0 rounded overflow-hidden" />
          <span class="text-sm flex-1 truncate">{{ char.title }}</span>
          <span class="text-xs text-gray-400 dark:text-[#6b6d75] truncate">{{ char.description || '暂无描述' }}</span>
        </div>
        <div v-if="selectableCharacters.length === 0" class="text-center py-4 text-gray-400 dark:text-[#6b6d75]">
          <p class="text-sm">暂无其他角色</p>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { ArrowUp, Loading } from '@element-plus/icons-vue';
import { apiService } from '@/services/ApiService';
import { Avatar } from '../ui';
import type { Character } from '@/types/character';

const props = defineProps<{
  character?: Character | null;
}>();

const emit = defineEmits<{
  select: [character: Character];
}>();

const isExpanded = ref(false);
const loading = ref(false);
const characters = ref<Character[]>([]);
let loaded = false;

const selectableCharacters = computed(() => {
  return characters.value.filter(c => c.id !== props.character?.id);
});

function toggleExpand() {
  isExpanded.value = !isExpanded.value;
  if (isExpanded.value && !loaded) {
    loadCharacters();
  }
}

async function loadCharacters() {
  loading.value = true;
  try {
    const res = await apiService.fetchCharacters();
    characters.value = res.items || [];
    loaded = true;
  } catch (e) {
    console.error('[AgentSwitcherBar] 加载角色失败:', e);
  } finally {
    loading.value = false;
  }
}

function handleSelect(char: Character) {
  emit('select', char);
  isExpanded.value = false;
}
</script>
