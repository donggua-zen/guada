<template>
  <div class="providers-panel flex flex-col h-full">
    <!-- 修改后的会话头部，包含标题和新建按钮 -->
    <div class="sessions-header py-1 text-lg font-semibold flex justify-between items-center">
      <span>分组列表</span>
      <!-- 新建会话按钮移动到右侧 -->
      <el-button @click="handleCreateGroup" size="default">
        <template #icon>
          <PlusOutlined />
        </template>
        新建分组
      </el-button>
    </div>

    <!-- 搜索框 -->
    <div class="search-box py-3">
      <el-input v-model="searchKeyword" placeholder="搜索分组" clearable size="large" class="rounded-full">
        <template #prefix>
          <el-icon>
            <SearchOutlined />
          </el-icon>
        </template>
      </el-input>
    </div>

    <div class="providers-list flex-1 overflow-hidden py-2.5">
      <ScrollContainer>
        <div v-for="provider in filteredItems" :key="provider.id"
          class="hover:bg-[var(--color-conversation-bg-hover)] provider-item px-3.5 cursor-pointer flex items-center transition-colors duration-200 rounded-3xl mb-1.5 h-10"
          @click="selectProvider(provider)">
          <div class="provider-avatar w-6 h-6 rounded-full flex items-center justify-center mr-3 flex-shrink-0">
            <div class="provider-img w-full h-full flex items-center justify-center text-white text-xl overflow-hidden">
              <OpenAI :size="16" color="var(--color-primary)" />
            </div>
          </div>
          <div class="provider-info flex-1 min-w-0">
            <div class="provider-title font-medium text-sm truncate">{{ provider.name }}</div>
          </div>
          <div class="provider-actions flex items-center">
            <el-button link @click.stop="handleEditProvider(provider)">
              <el-icon>
                <EditOutlined />
              </el-icon>
            </el-button>
            &nbsp;&nbsp;
            <el-button link @click.stop="handleDeleteProvider(provider)">
              <el-icon>
                <DeleteOutlineOutlined />
              </el-icon>
            </el-button>
          </div>
        </div>
      </ScrollContainer>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import { OpenAI } from '@/components/icons'
import { ScrollContainer } from '../ui/'
import {
  PlusOutlined,
  SearchOutlined,
  EditOutlined,
  DeleteOutlineOutlined
} from '@vicons/material'

// Element Plus 组件导入
import {
  ElIcon,
  ElInput,
  ElButton
} from 'element-plus'

const searchKeyword = ref('')

const emit = defineEmits(['item-click', 'update-providers', 'create-group', 'item-edit', 'item-delete'])
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
const selectProvider = (provider) => {
  emit('item-click', provider);
}

// 创建新会话
const handleCreateGroup = async () => {
  emit('create-group')
}

// 编辑供应商
const handleEditProvider = (provider) => {
  emit('item-edit', provider)
}

// 删除供应商
const handleDeleteProvider = (provider) => {
  emit('item-delete', provider)
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

:deep(.el-input__wrapper) {
  box-shadow: 0 0 0 1px #e5e7eb inset;
}

:deep(.el-input.is-focus .el-input__wrapper) {
  box-shadow: 0 0 0 1px #4f46e5 inset;
}
</style>