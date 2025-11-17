<template>
  <div v-if="localSidebarVisible"
    class="sessions-panel flex flex-col w-72 min-w-72 h-screen bg-[var(--conversation-bg)] border-r border-[var(--conversation-border-color)]">
    <div class="sessions-header px-5 py-5 text-lg font-semibold flex justify-between items-center">
      <span>会话列表</span>
      <!-- 新增收缩按钮 -->
      <n-button quaternary circle @click="handleToggleSidebar" size="small"
        class="shrink-btn bg-none border-none text-gray-500 cursor-pointer text-sm p-1 rounded" title="收缩侧边栏">
        <template #icon>
          <n-icon size="22">
            <ArrowCircleLeft />
          </n-icon>
        </template>
      </n-button>
    </div>

    <!-- 搜索框 -->
    <div class="search-box px-3 py-3">
      <n-input v-model:value="searchKeyword" placeholder="搜索会话" clearable @update:value="handleSearchInput">
        <template #prefix>
          <n-icon>
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
            {{ searchKeyword ? '尝试调整搜索关键词' : '点击下方按钮创建新的会话' }}
          </div>
        </div>
      </template>
      <template v-else>
        <div v-for="session in filteredSessions" :key="session.id"
          class="session-item group px-3.5 py-3 cursor-pointer flex items-center transition-colors duration-200 rounded-xl mx-2.5 mb-1.5 h-15"
          :class="{
            'bg-[var(--conversation-active-bg)]': session.id === currentSessionId,
            'hover:bg-[var(--conversation-hover-bg)]': session.id !== currentSessionId
          }" @click="selectSession(session.id)">
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

    <div class="sessions-footer p-5">
      <n-button block @click="handleCreateSession" type="primary" size="large">
        <template #icon>
          <n-icon>
            <PlusOutlined />
          </n-icon>
        </template>
        新建会话
      </n-button>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, h } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { store } from '../store/store'
import Avatar from '../components/Avatar.vue'
import { NButton, NDropdown, NIcon, NInput } from 'naive-ui'
import { useDebounceFn } from '@vueuse/core'
import {
  PlusOutlined,
  MoreVertOutlined,
  EditOutlined,
  DeleteOutlineOutlined,
  SearchOutlined,
} from '@vicons/material'

import {
  ArrowCircleLeft
} from './icons'

const route = useRoute()
const router = useRouter()

// 响应式数据
const currentSessionId = ref(null)
const searchKeyword = ref('')
const localSidebarVisible = computed({
  get() {
    return props.sidebarVisible
  },
  set(value) {
    emit('update:sidebarVisible', value)
  }
})

// 事件定义
const emit = defineEmits(['on-select', 'on-update', 'on-create', 'on-delete', 'update:sidebarVisible'])

// Props 定义
const props = defineProps({
  sessions: {
    type: Array,
    default: () => []
  },
  sidebarVisible: {
    type: Boolean,
    default: true
  }
})

// SimpleBar 配置
const simpleBarOptions = {
  autoHide: true,
  clickOnTrack: false
}

// 计算属性
// 排序后的会话列表
const sortedSessions = computed(() => {
  return [...props.sessions].sort((a, b) => {
    const timeA = a.updated_at ? new Date(a.updated_at) : new Date(a.created_at || 0)
    const timeB = b.updated_at ? new Date(b.updated_at) : new Date(b.created_at || 0)
    return timeB - timeA // 降序排列，最新的在前面
  })
})

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
// 格式化时间显示
const formatTime = (dateString) => {
  if (!dateString) return ''

  const date = new Date(dateString)
  const now = new Date()

  // 当天
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  }

  // 昨天
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (date.toDateString() === yesterday.toDateString()) {
    return '昨天'
  }

  // 前天
  const dayBeforeYesterday = new Date(now)
  dayBeforeYesterday.setDate(now.getDate() - 2)
  if (date.toDateString() === dayBeforeYesterday.toDateString()) {
    return '前天'
  }

  // 本周
  const weekStart = new Date(now)
  weekStart.setDate(now.getDate() - now.getDay() + 1)
  weekStart.setHours(0, 0, 0, 0)

  if (date >= weekStart) {
    const weekDays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
    return weekDays[date.getDay()]
  }

  // 上周
  const lastWeekStart = new Date(weekStart)
  lastWeekStart.setDate(weekStart.getDate() - 7)
  if (date >= lastWeekStart) {
    return '上周'
  }

  // 本月
  if (date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear()) {
    return `${date.getMonth() + 1}月${date.getDate()}日`
  }

  // 更早
  // return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`
  return '更早'
}

// 防抖搜索
const debouncedSearch = useDebounceFn(() => {
  // 搜索逻辑已经在计算属性中处理，这里只需要触发更新
}, 200)

// 处理搜索输入
const handleSearchInput = (value) => {
  searchKeyword.value = value
  debouncedSearch()
}

// 选择会话
const selectSession = (sessionId) => {
  router.replace({ name: 'Chat', params: { sessionId } })
}

// 更新选中的会话
const updateSelectedSession = (sessionId) => {
  if (sessionId) {
    const session = sortedSessions.value.find(s => s.id === sessionId)
    if (session) {
      if (session.id !== currentSessionId.value) {
        currentSessionId.value = sessionId
        store.setActiveSessionId(sessionId)
        emit('on-select', session)
      }
      return
    }
  }

  // 如果没有找到会话，选择第一个会话
  const newSessionId = sortedSessions.value.length > 0 ? sortedSessions.value[0].id : null
  if (newSessionId) {
    selectSession(newSessionId)
  }
}

// 处理下拉菜单选择
const handleDropdownSelect = (key, session) => {
  if (key === 'rename') {
    renameSession(session)
  } else if (key === 'delete') {
    deleteSession(session)
  }
}

// 创建新会话
const handleCreateSession = () => {
  emit('on-create')
}

// 重命名会话
const renameSession = (session) => {
  emit('on-update', session)
}

// 删除会话
const deleteSession = (session) => {
  emit('on-delete', session)
}

const handleToggleSidebar = () => {
  localSidebarVisible.value = false;
  // emit('toggle-sidebar')

}

// 监听器
// 监听会话列表变化
watch(() => props.sessions, () => {
  updateSelectedSession(route.params.sessionId)
}, { immediate: true, deep: true })

// 监听路由参数变化
watch(() => route.params.sessionId, (newSessionId) => {
  if (!newSessionId) {
    selectSession(store.activeSessionId)
    return
  }
  updateSelectedSession(newSessionId)
}, { immediate: true })
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