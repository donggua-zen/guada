<template>
  <div
    class="flex flex-col w-full h-full bg-[var(--color-conversation-bg)] border-r border-[var(--color-conversation-border)] transition-all duration-300">
    <!-- 会话头部 -->
    <div class="sessions-header px-4 pt-4.5 pb-3.5 flex justify-between items-center border-b border-[var(--color-conversation-border)]">
      <span class="font-semibold text-base text-[var(--color-text)]">聊天对话</span>
      <el-button type="primary" @click="handleButtonClick('create')" :icon="ChatNew" class="new-chat-btn">
        新建会话
      </el-button>
    </div>

    <!-- 搜索框 -->
    <div class="search-box px-3.5 py-3">
      <el-input v-model="searchKeyword" :prefix-icon="SearchOutlined" placeholder="搜索会话" clearable
        @input="handleSearchInput" class="search-input">
      </el-input>
    </div>

    <!-- 会话列表区域 -->
    <div class="sessions-list flex-1 overflow-hidden py-2">
      <ScrollContainer class="h-full">
        <div class="px-5 py-2.5 text-xs font-medium text-gray-400 uppercase tracking-wider">对话记录</div>
        <template v-if="filteredSessions.length === 0">
          <div class="empty-state text-center text-gray-500 flex flex-col items-center justify-center h-full py-12">
            <div class="empty-state-icon mb-3 text-gray-300">
              <el-icon size="32">
                <PlusOutlined />
              </el-icon>
            </div>
            <div class="empty-state-title text-sm font-medium mb-1">
              {{ searchKeyword ? '未找到匹配的会话' : '没有会话' }}
            </div>
            <div class="empty-state-description text-xs text-gray-400">
              {{ searchKeyword ? '尝试调整搜索关键词' : '点击上方按钮创建新的会话' }}
            </div>
          </div>
        </template>
        <template v-else>
          <div v-for="session in filteredSessions" :key="session.id"
            class="session-item group"
            :class="{
              'session-item-active': session.id === currentSessionId,
              'session-item-inactive': session.id !== currentSessionId
            }" @click="selectSession(session)">
            <div class="session-avatar">
              <Avatar :src="session.character?.avatar_url || session.avatar_url" round />
            </div>
            <div class="session-info flex-1 min-w-0 flex items-center">
              <div class="session-title truncate text-sm font-medium w-full">
                {{ session.title }}
              </div>
            </div>
            <div
              class="session-actions flex items-center opacity-0 group-hover:opacity-100"
              :class="{ 'opacity-100': session.id === currentSessionId }">
              <el-dropdown trigger="click" @command="(command) => handleDropdownSelect(command, session)">
                <template #dropdown>
                  <el-dropdown-menu>
                    <el-dropdown-item command="rename">
                      <EditOutlined class="w-4 h-4 mr-2 inline-block" />
                      重命名
                    </el-dropdown-item>
                    <el-dropdown-item command="delete">
                      <DeleteOutlineOutlined class="w-4 h-4 mr-2 inline-block" />
                      删除
                    </el-dropdown-item>
                  </el-dropdown-menu>
                </template>
                <div @click.stop class="session-action-trigger">
                  <el-icon class="w-4 h-4">
                    <MoreVertOutlined />
                  </el-icon>
                </div>
              </el-dropdown>
            </div>
          </div>
        </template>
      </ScrollContainer>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { ScrollContainer, Avatar } from './ui'
import { useDebounceFn } from '@vueuse/core'
import { useAuthStore } from '../stores/auth'
import {
  PlusOutlined,
  MoreVertOutlined,
  EditOutlined,
  DeleteOutlineOutlined,
  SearchOutlined,
} from '@vicons/material'

import {
  ChatNew
} from '@/components/icons'

// Element Plus 组件导入
import {
  ElInput,
  ElIcon,
  ElDropdown,
  ElDropdownMenu,
  ElDropdownItem
} from 'element-plus'

const authStore = useAuthStore()
const router = useRouter()

// 响应式数据
const currentSessionId = computed(() => props.current?.id)
const searchKeyword = ref('')

// 事件定义
const emit = defineEmits(['select', 'rename', 'delete', 'create'])

// Props 定义
const props = defineProps({
  sessions: {
    type: Array,
    default: () => []
  },
  btnActive: {
    type: String,
    default: ''
  },
  current: {
    type: Object,
    default: () => ({})
  }
})

// 计算属性
// 排序后的会话列表
const sortedSessions = computed(() => props.sessions)

// 过滤后的会话列表
const filteredSessions = computed(() => {
  if (!searchKeyword.value.trim()) {
    return sortedSessions.value
  }

  const keyword = searchKeyword.value.toLowerCase().trim()
  return sortedSessions.value.filter(session =>
    session.title.toLowerCase().includes(keyword)
  )
})

// 方法定义

// 防抖搜索
const debouncedSearch = useDebounceFn(() => {
  // 搜索逻辑已经在计算属性中处理，这里只需要触发更新
}, 200)

// 处理搜索输入
const handleSearchInput = (value) => {
  searchKeyword.value = value
  debouncedSearch()
}


// 处理下拉菜单选择
const handleDropdownSelect = (command, session) => {
  if (command === 'rename') {
    emit('rename', session)
  } else if (command === 'delete') {
    emit('delete', session)
  } else if (command === 'export') {
    emit('export', session)
  }
}

// 创建新会话
const handleButtonClick = (key) => {
  if (key === 'create') {
    emit('create')
  }
}

const selectSession = (session) => {
  emit('select', session.id)  // 修复：传递 session.id 而不是整个 session 对象
}


</script>

<style scoped>
/* 新建会话按钮 */
.new-chat-btn {
  height: 28px;
  padding: 6px 12px;
  font-size: 13px;
  border-radius: 6px;
}

/* 搜索框样式 */
.search-input :deep(.el-input__wrapper) {
  background-color: var(--color-surface);
  border-radius: 8px;
  box-shadow: 0 0 0 1px var(--color-border) inset;
  padding: 6px 12px;
  transition: all 0.2s ease;
}

.search-input :deep(.el-input__wrapper:hover) {
  box-shadow: 0 0 0 1px var(--color-primary-300) inset;
}

.search-input :deep(.el-input__wrapper.is-focus) {
  box-shadow: 0 0 0 1px var(--color-primary) inset;
}

.search-input :deep(.el-input__inner) {
  font-size: 13px;
}

/* 会话项样式 */
.session-item {
  display: flex;
  align-items: center;
  gap: 0.625rem;
  padding: 0.625rem 0.75rem;
  margin: 0.125rem 0.625rem;
  border-radius: 0.5rem;
  cursor: pointer;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}

.session-item-inactive {
  color: var(--color-text);
}

.session-item-inactive:hover {
  background-color: var(--color-conversation-bg-hover);
  color: var(--color-conversation-text-hover);
}

.session-item-active {
  background-color: var(--color-conversation-bg-active);
  color: var(--color-conversation-text-active);
}

.session-avatar {
  width: 1.5rem;
  height: 1.5rem;
  flex-shrink: 0;
}

.session-title {
  line-height: 1.4;
}

.session-actions {
  margin-left: auto;
  opacity: 0;
  transition: opacity 0.2s ease;
}

/* 鼠标悬停时会话项的操作按钮显示 */
.session-item:hover .session-actions {
  opacity: 1;
}

.session-action-trigger {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0.25rem;
  border-radius: 0.25rem;
  cursor: pointer;
  transition: background-color 0.2s ease;
}

.session-action-trigger:hover {
  background-color: rgba(0, 0, 0, 0.05);
}

.dark .session-action-trigger:hover {
  background-color: rgba(255, 255, 255, 0.1);
}

/* 空状态 */
.empty-state-icon {
  display: flex;
  align-items: center;
  justify-content: center;
}

/* 滚动条美化 */
:deep(.el-scrollbar__bar) {
  opacity: 0.6;
  transition: opacity 0.2s;
}

:deep(.el-scrollbar__bar:hover) {
  opacity: 1;
}
</style>
