<template>
  <div
    class="sessions-panel flex flex-col  w-full h-full bg-[var(--conversation-bg)] border-r border-[var(--conversation-border-color)]">
    <!-- 修改后的会话头部，包含标题和新建按钮 -->
    <div class="sessions-header px-5 py-5 text-lg font-semibold flex justify-between items-center">
      <span>会话列表</span>
      <!-- 新建会话按钮移动到右侧 -->
      <n-button @click="handleCreateSession" text size="medium">
        <template #icon>
          <n-icon>
            <ChatNew />
          </n-icon>
        </template>
        新建会话
      </n-button>
    </div>

    <!-- 搜索框 -->
    <div class="search-box px-3 py-3">
      <n-input v-model:value="searchKeyword" placeholder="搜索会话" clearable @update:value="handleSearchInput" size="large"
        round>
        <template #prefix>
          <n-icon size="22">
            <SearchOutlined />
          </n-icon>
        </template>
      </n-input>
    </div>

    <!-- 会话列表区域 -->
    <SimpleBar class="sessions-list flex-1 py-2.5" style="height: calc(100vh - 200px)" :options="simpleBarOptions">
      <template v-if="filteredSessions.length === 0">
        <div class="empty-state text-center text-gray-500 flex flex-col items-center justify-center h-full">
          <div class="empty-state-icon">
            <n-icon>
              <PlusOutlined />
            </n-icon>
          </div>
          <div class="empty-state-title">
            {{ searchKeyword ? '未找到匹配的会话' : '没有会话' }}
          </div>
          <div class="empty-state-description">
            {{ searchKeyword ? '尝试调整搜索关键词' : '点击上方按钮创建新的会话' }}
          </div>
        </div>
      </template>
      <template v-else>
        <div v-for="session in filteredSessions" :key="session.id"
          class="session-item group px-3.5 py-3 cursor-pointer flex items-center transition-colors duration-200 rounded-3xl mx-2.5 mb-1.5 h-15"
          :class="{
            'bg-[var(--conversation-active-bg)]': session.id === currentSessionId,
            'hover:bg-[var(--conversation-hover-bg)]': session.id !== currentSessionId
          }" @click="selectSession(session)">
          <div class="session-avatar w-9 h-9 mr-2.5">
            <Avatar :src="session.avatar_url" round />
          </div>
          <div class="session-info flex-1 min-w-0">
            <div class="session-header flex justify-between items-start mb-1">
              <div class="session-title font-medium text-sm truncate text-gray-800">
                {{ session.title }}
              </div>
              <div v-if="session.last_message" class="session-time text-xs text-gray-500 whitespace-nowrap ml-2">
                {{ formatTime(session.last_message.created_at) }}
              </div>
            </div>
            <div class="session-message text-xs truncate text-gray-500">
              {{ session.last_message ? session.last_message.content : '无消息' }}
            </div>
          </div>
          <div class="session-actions flex opacity-0 transition-opacity duration-200 group-hover:opacity-100">
            <n-dropdown trigger="click" :options="dropdownOptions" @select="handleDropdownSelect($event, session)">
              <n-button quaternary circle @click.stop
                class="session-action-btn bg-none border-none text-gray-500 cursor-pointer text-sm p-1 rounded">
                <template #icon>
                  <n-icon size="16">
                    <MoreVertOutlined />
                  </n-icon>
                </template>
              </n-button>
            </n-dropdown>
          </div>
        </div>
      </template>
    </SimpleBar>

    <!-- 移除底部的sessions-footer部分 -->
  </div>
</template>

<script setup>
import { ref, computed, watch, h } from 'vue'
import Avatar from '../components/Avatar.vue'
import { NButton, NDropdown, NIcon, NInput } from 'naive-ui'
import { useDebounceFn } from '@vueuse/core'
import { formatTime } from '@/utils'
import {
  PlusOutlined,
  MoreVertOutlined,
  EditOutlined,
  DeleteOutlineOutlined,
  SearchOutlined
} from '@vicons/material'

import {
  ChatNew
} from '@/components/icons'


// 响应式数据
const currentSessionId = computed(() => props.current?.id)
const searchKeyword = ref('')

// 事件定义
const emit = defineEmits(['select', 'rename', 'create', 'delete'])

// Props 定义
const props = defineProps({
  sessions: {
    type: Array,
    default: () => []
  },
  current: {
    type: Object,
    default: () => ({})
  }
})

// SimpleBar 配置
const simpleBarOptions = {
  autoHide: true,
  clickOnTrack: false
}

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

// 下拉菜单选项
const dropdownOptions = [
  {
    label: '重命名',
    key: 'rename',
    icon: () => h(NIcon, null, { default: () => h(EditOutlined) })
  },
  {
    label: '删除',
    key: 'delete',
    icon: () => h(NIcon, null, { default: () => h(DeleteOutlineOutlined) })
  }
]

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
const handleDropdownSelect = (key, session) => {
  if (key === 'rename') {
    emit('rename', session)
  } else if (key === 'delete') {
    emit('delete', session)
  } else if (key === 'export') {
    emit('export', session)
  }
}

// 创建新会话
const handleCreateSession = () => {
  emit('create')
}
const selectSession = (session) => {
  emit('select', session)
}


</script>

<style scoped>
.session-item {
  height: 60px;
}

.session-action-btn:hover {
  color: #4a90e2;
  background-color: #e6f0fa;
}


/* SimpleBar 滚动条样式 */
:deep(.simplebar-scrollbar::before) {
  background-color: #c1c1c1;
}

:deep(.simplebar-scrollbar.simplebar-visible::before) {
  opacity: 0.6;
}
</style>