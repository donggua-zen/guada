<template>
  <CustomPopover :show="visible" @update:show="$emit('update:visible', $event)" :width="320" :max-height="400" :anchor-el="anchorEl"
    popper-class="kb-popover compact-popover">
    <div class="popover-content">
      <div class="mb-3">
        <el-input v-model="searchText" placeholder="搜索知识库..." clearable size="small">
          <template #prefix>
            <el-icon>
              <Search12Regular />
            </el-icon>
          </template>
        </el-input>
      </div>
      <div class="kb-list-container min-h-0 overflow-hidden">
        <ScrollContainer class="w-full h-full min-h-0" style="max-height: 256px;">
          <div class="space-y-1 pb-4 w-full">
            <div v-if="filteredKnowledgeBases.length === 0" class="text-center py-6 text-gray-400">
              <el-icon size="32" class="mb-1">
                <Search12Regular />
              </el-icon>
              <p class="text-xs">未找到匹配的知识库</p>
            </div>
            <div v-else class="space-y-1">
              <div v-for="kb in filteredKnowledgeBases" :key="kb.id"
                class="kb-item-compact p-2 rounded cursor-pointer transition-all flex items-center gap-2" :class="{
                  'bg-pink-50 dark:bg-pink-900/20': selectedIds.includes(kb.id),
                  'hover:bg-gray-50 dark:hover:bg-gray-800/50': !selectedIds.includes(kb.id)
                }" @click="handleToggle(kb.id)">
                <el-checkbox :model-value="selectedIds.includes(kb.id)" @click.stop
                  @change="handleToggle(kb.id)" size="small" />
                <div class="flex-1 min-w-0 flex items-center gap-2">
                  <div class="font-medium text-sm truncate shrink">{{ kb.name }}</div>
                  <div v-if="kb.description" class="text-xs text-gray-500 dark:text-gray-400 truncate flex-1">
                    {{ kb.description }}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </ScrollContainer>
      </div>
    </div>
  </CustomPopover>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElInput, ElCheckbox, ElIcon } from 'element-plus'
import { Search12Regular } from '@vicons/fluent'
import ScrollContainer from '../../ui/ScrollContainer.vue'
import CustomPopover from '../../ui/CustomPopover.vue'

interface KnowledgeBase {
  id: string
  name: string
  description?: string
}

const props = defineProps<{
  visible: boolean
  anchorEl: HTMLElement | null
  knowledgeBases: KnowledgeBase[]
  selectedIds: string[]
}>()

const emit = defineEmits<{
  'update:visible': [value: boolean]
  'toggle': [kbId: string]
}>()

const searchText = ref('')

// 过滤后的知识库列表（支持搜索）
const filteredKnowledgeBases = computed(() => {
  if (!searchText.value) return props.knowledgeBases
  const searchTextLower = searchText.value.toLowerCase()
  return props.knowledgeBases.filter(kb =>
    kb.name?.toLowerCase().includes(searchTextLower) ||
    kb.description?.toLowerCase().includes(searchTextLower)
  )
})

// 处理切换选择
const handleToggle = (kbId: string) => {
  emit('toggle', kbId)
}

// 监听 visible 变化，重置搜索文本
watch(() => props.visible, (newVal) => {
  if (newVal) {
    searchText.value = ''
  }
})
</script>

<style scoped>
/* 知识库列表项 - 无边框紧凑样式 */
.kb-item-compact {
  transition: all 0.15s ease;
}

.kb-item-compact:hover {
  background-color: var(--el-fill-color-light, #f5f7fa);
}

.dark .kb-item-compact:hover {
  background-color: oklch(30% 0.03 250);
}

.kb-list-container {
  padding: 0 2px;
}
</style>
