<template>
  <div class="w-full h-full flex">
    <div
      class="flex flex-col w-full rounded-lt-lg bg-(--color-conversation-bg) border-r border-(--color-conversation-border) transition-all duration-300">
      <!-- 会话头部 -->
      <div class="sessions-header px-4 h-13 flex justify-between items-center">
        <span class="font-semibold text-base text-(--color-text)">聊天对话</span>
        <el-button type="primary" @click="handleButtonClick('create')" :icon="ChatNew" class="new-chat-btn">
          新建会话
        </el-button>
      </div>

      <!-- 搜索框 -->
      <div class="search-box px-3.5 pt-3 pb-1">
        <el-input v-model="searchKeyword" :prefix-icon="SearchOutlined" placeholder="搜索会话" clearable
          @input="handleSearchInput" class="search-input">
        </el-input>
      </div>

      <!-- 会话列表区域 -->
      <div class="sessions-list flex-1 overflow-hidden py-2">
        <ScrollContainer class="h-full max-h-full" @scroll="handleScroll">
          <div class="px-5 py-2.5 text-xs font-medium text-gray-400 uppercase tracking-wider">对话记录</div>
          <template v-if="!filteredSessions || filteredSessions.length === 0">
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
            <div v-for="session in filteredSessions" :key="session.id" class="session-item group" :class="{
              'session-item-active': session.id === currentSessionId,
              'session-item-inactive': session.id !== currentSessionId
            }" @click="selectSession(session)">
              <div class="session-avatar">
                <Avatar :src="session.character?.avatarUrl || session.avatarUrl"
                  :name="session.character?.title || session.title" type="assistant" round />
              </div>
              <div class="session-info flex-1 min-w-0 flex items-center">
                <div class="session-title truncate text-sm font-medium w-full">
                  {{ session.title }}
                </div>
              </div>
              <div class="session-actions flex items-center opacity-0 group-hover:opacity-100"
                :class="{ 'opacity-100': session.id === currentSessionId }">
                <el-dropdown trigger="hover" @command="(command) => handleDropdownSelect(command, session)">
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
                      <MoreFilled />
                    </el-icon>
                  </div>
                </el-dropdown>
              </div>
            </div>

            <!-- 加载更多提示 -->
            <div v-if="filteredSessions.length > 0" class="py-3 px-5 text-center">
              <div v-if="isLoadingMore" class="flex items-center justify-center gap-2 text-sm text-gray-500">
                <el-icon class="animate-spin" size="16">
                  <Loading />
                </el-icon>
                <span>加载中...</span>
              </div>
              <div v-else-if="hasMoreSessions"
                class="text-sm text-gray-400 cursor-pointer hover:text-blue-500 transition-colors"
                @click="loadMoreSessions">
                点击加载更多 (剩余 {{ totalSessionsCount - filteredSessions.length }} 个)
              </div>
              <div v-else-if="totalSessionsCount > 0" class="text-sm text-gray-400">
                已加载全部 {{ totalSessionsCount }} 个会话
              </div>
            </div>
          </template>
        </ScrollContainer>
      </div>
    </div>
  </div>
</template>

<!-- @ts-ignore - UI 组件尚未完全迁移到 TypeScript -->
<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useRouter } from 'vue-router'
// @ts-ignore - UI 组件类型缺失
import { ScrollContainer, Avatar } from '../ui'
import { useDebounceFn } from '@vueuse/core'
import { useAuthStore } from '../../stores/auth'
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlineOutlined,
  SearchOutlined,
} from '@vicons/material'

import { MoreFilled, Loading } from '@element-plus/icons-vue'

// @ts-ignore - icons 组件类型缺失
import {
  ChatNew
  // @ts-ignore - ChatNew 图标类型缺失
} from '@/components/icons'

// Element Plus 组件导入
import {
  ElInput,
  ElIcon,
  ElDropdown,
  ElDropdownMenu,
  ElDropdownItem
} from 'element-plus'

// API 服务导入（暂时保留，未来可能需要）
// import { apiService } from '../services/ApiService'

const authStore = useAuthStore()
const router = useRouter()

// 响应式数据 - 类型化
const currentSessionId = computed(() => props.current?.id)
const searchKeyword = ref('')
const scrollContainer = ref<any>(null)

// 无限滚动相关状态
const currentPage = ref(1) // 当前页码
const pageSize = ref(calculatePageSize()) // 每页数量（根据屏幕高度动态计算）
const isLoadingMore = ref(false) // 是否正在加载更多
const scrollThreshold = 50 // 滚动触发阈值(像素)
let scrollTimer: number | null = null // 滚动防抖定时器

/**
 * 根据屏幕高度计算合适的每页加载数量
 * @returns 每页数量
 */
function calculatePageSize(): number {
  const screenHeight = window.innerHeight
  // 大于 1080px 加载 40 个，否则加载 20 个
  return screenHeight > 1080 ? 40 : 20
}

// 事件定义 - 类型化
const emit = defineEmits<{
  select: [sessionId: string]
  rename: [session: any]
  delete: [session: any]
  create: []
  loadMore: [] // 请求加载更多会话
}>()

// Props 定义 - 类型化
const props = defineProps<{
  sessions?: any[];
  totalSessions?: number; // 总会话数（从父组件传入）
  btnActive?: string;
  current?: any;
}>()

// 计算属性 - 类型化
// 排序后的会话列表（使用父组件传入的 sessions）
const sortedSessions = computed((): any[] => props.sessions || [])

// 是否还有更多会话可加载（基于父组件传入的总数）
const hasMoreSessions = computed(() => {
  // 如果父组件传入了 totalSessions，则使用它；否则根据当前加载数量判断
  const total = props.totalSessions || sortedSessions.value.length
  return filteredSessions.value.length < total
})

// 总会话数（从父组件获取）
const totalSessionsCount = computed(() => {
  return props.totalSessions ?? sortedSessions.value.length
})

// 过滤后的会话列表
const filteredSessions = computed((): any[] => {
  if (!searchKeyword.value.trim()) {
    return sortedSessions.value || []
  }

  const keyword = searchKeyword.value.toLowerCase().trim()
  return (sortedSessions.value || []).filter(session =>
    session.title?.toLowerCase().includes(keyword)
  )
})

// 方法定义 - 类型化

// 防抖搜索
const debouncedSearch = useDebounceFn((): void => {
  // 搜索逻辑已经在计算属性中处理，这里只需要触发更新
}, 200)

// 处理搜索输入
const handleSearchInput = (value: string): void => {
  searchKeyword.value = value
  debouncedSearch()
}

// 处理下拉菜单选择
const handleDropdownSelect = (command: string, session: any): void => {
  if (command === 'rename') {
    emit('rename', session)
  } else if (command === 'delete') {
    emit('delete', session)
  } else if (command === 'export') {
    emit('export' as any, session)
  }
}

// 创建新会话
const handleButtonClick = (key: string): void => {
  if (key === 'create') {
    emit('create')
  }
}

const selectSession = (session: any): void => {
  emit('select', session.id)  // 修复：传递 session.id 而不是整个 session 对象
}

/**
 * 处理滚动事件（带防抖）
 */
const handleScroll = (event: Event): void => {
  // 清除之前的定时器
  if (scrollTimer !== null) {
    clearTimeout(scrollTimer)
  }

  // 设置防抖，300ms 后执行
  scrollTimer = window.setTimeout(() => {
    checkScrollPosition()
  }, 300)
}

/**
 * 检查滚动位置，判断是否需要加载更多
 */
const checkScrollPosition = (): void => {
  if (!scrollContainer.value || isLoadingMore.value || !hasMoreSessions.value) {
    return
  }

  const element = scrollContainer.value.getScrollElement?.() || scrollContainer.value
  const { scrollTop, scrollHeight, clientHeight } = element
  const distanceToBottom = scrollHeight - scrollTop - clientHeight

  // 如果距离底部小于阈值，则加载更多
  if (distanceToBottom <= scrollThreshold) {
    loadMoreSessions()
  }
}

/**
 * 加载更多会话（通知父组件）
 */
const loadMoreSessions = async (): Promise<void> => {
  if (isLoadingMore.value || !hasMoreSessions.value) {
    return
  }

  isLoadingMore.value = true

  // 通知父组件加载更多
  emit('loadMore')

  // 等待一段时间后重置加载状态（实际由父组件控制）
  setTimeout(() => {
    isLoadingMore.value = false
  }, 500)
}


</script>

<style scoped>
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
  padding: 0.5rem 0.75rem;
  margin: 0.2rem 0.625rem;
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
  /* box-shadow: 0 0 10px rgba(0, 0, 0, 0.05); */
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
