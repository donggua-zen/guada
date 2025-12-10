<template>
  <div
    class="providers-panel flex flex-col h-full bg-[var(--conversation-bg)] border-r border-[var(--conversation-border-color)]">
    <!-- 修改后的会话头部，包含标题和新建按钮 -->
    <div class="sessions-header px-5 py-5 text-lg font-semibold flex justify-between items-center">
      <span>分组列表</span>
      <!-- 新建会话按钮移动到右侧 -->
      <n-button @click="handleCreateGroup" text size="medium">
        <template #icon>
          <n-icon>
            <PlusOutlined />
          </n-icon>
        </template>
        新建分组
      </n-button>
    </div>

    <!-- 搜索框 -->
    <div class="search-box px-3 py-3">
      <n-input v-model:value="searchKeyword" placeholder="搜索分组" clearable size="large" round>
        <template #prefix>
          <n-icon size="22">
            <SearchOutlined />
          </n-icon>
        </template>
      </n-input>
    </div>

    <div class="providers-list flex-1 overflow-hidden py-2.5">
      <scroll-container>
        <div v-for="provider in filteredItems" :key="provider.id"
          class="provider-item px-3.5 cursor-pointer flex items-center transition-colors duration-200 rounded-3xl mx-2.5 mb-1.5 h-10"
          :class="{
            'bg-[var(--conversation-active-bg)]': selectedId === provider.id,
            'hover:bg-[var(--conversation-hover-bg)]': selectedId !== provider.id
          }" @click="selectProvider(provider.id)">
          <div class="provider-avatar w-6 h-6 rounded-full flex items-center justify-center mr-3 flex-shrink-0">
            <div class="provider-img w-full h-full flex items-center justify-center text-white text-xl overflow-hidden">
              <OpenAI :size="16" color="var(--primary)" />
            </div>
          </div>
          <div class="provider-info flex-1 min-w-0">
            <div class="provider-title font-medium text-sm truncate text-gray-800">{{ provider.name }}</div>
          </div>
        </div>
      </scroll-container>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, computed, watch } from 'vue'
import { NButton, NIcon, NInput } from 'naive-ui'
import { OpenAI } from '@/components/icons'
import ScrollContainer from './ui/ScrollContainer.vue'
import {
  PlusOutlined,
  SearchOutlined,
} from '@vicons/material'

const searchKeyword = ref('')

const emit = defineEmits(['select', 'update-providers', 'create-group'])
const props = defineProps({
  items: {
    type: Array,
    default: () => []
  },
  loading: Boolean,
  selectedId: [String, Number]
})

// 过滤后的会话列表
const filteredItems = computed(() => {
  if (!searchKeyword.value.trim()) {
    return props.items
  }

  const keyword = searchKeyword.value.toLowerCase().trim()
  return props.items.filter(provider =>
    provider.name.toLowerCase().includes(keyword)
  )
})

// 选择会话
const selectProvider = (providerId) => {
  emit('select', providerId);
}

// 创建新会话
const handleCreateGroup = async () => {
  emit('create-group')
}
</script>

<style scoped>
.new-provider-btn:hover {
  background-color: #3a7bc8;
}

.provider-img img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
</style>