<template>
  <div class="flex flex-col h-full bg-(--color-sidebar-bg) border-r border-(--color-sidebar-border) overflow-hidden">
    <!-- 导航菜单 -->
    <div class="px-3 py-2 space-y-0.5">
      <div v-for="item in navItems" :key="item.key" @click="handleNavClick(item.key)"
        class="flex items-center gap-3 px-2 py-1.5 rounded-lg cursor-pointer transition-all duration-200 ease-in-out"
        :class="currentActiveTab === item.key
          ? 'bg-(--color-sidebar-bg-active) text-(--color-sidebar-text-active)'
          : 'text-(--color-text) hover:bg-(--color-sidebar-bg-hover) hover:text-(--color-text)'">
        <component :is="item.icon" class="w-4.5 h-4.5 shrink-0" />
        <span class="text-sm font-medium">{{ item.label }}</span>
      </div>
    </div>


    <!-- 会话列表区域 -->
    <div class="px-4 py-1 text-xs font-medium text-gray-500 uppercase tracking-wider">任务列表</div>
    <div class="flex-1 overflow-hidden py-1">
      <ScrollContainer class="h-full max-h-full" @scroll="handleScroll">
        <template v-if="!sortedSessions || sortedSessions.length === 0">
          <div class="empty-state text-center text-gray-500 flex flex-col items-center justify-center h-full py-12">
            <div class="empty-state-title text-sm font-medium mb-1">
              暂无任务
            </div>
          </div>
        </template>
        <template v-else>
          <div v-for="session in sortedSessions" :key="session.id"
            class="session-item flex items-center gap-2.5 py-1 pr-2 pl-4 mx-1 my-[0.2rem] rounded-lg cursor-pointer transition-all duration-200 ease-[cubic-bezier(0.4,0,0.2,1)] group"
            :class="{
              'session-item-active': session.id === currentSessionId,
              'session-item-inactive': session.id !== currentSessionId
            }" @click="selectSession(session)">
            <div class="session-info flex-1 min-w-0 flex items-center">
              <div class="session-title truncate text-sm font-medium w-full text-(--color-conversation-text)">
                {{ session.title }}
              </div>
            </div>
            <div class="session-actions flex items-center opacity-0 group-hover:opacity-100"
              :class="{ 'opacity-100': session.id === currentSessionId }">
              <DropdownMenu @command="(cmd: string) => handleDropdownSelect(cmd, session)">
                <div class="session-action-trigger">
                  <el-icon class="w-4 h-4">
                    <MoreFilled />
                  </el-icon>
                </div>
                <template #dropdown>
                  <DropdownMenuItem command="rename">
                    <EditOutlined class="w-4 h-4 mr-2 inline-block" />
                    重命名
                  </DropdownMenuItem>
                  <DropdownMenuItem command="delete">
                    <DeleteOutlineOutlined class="w-4 h-4 mr-2 inline-block" />
                    删除
                  </DropdownMenuItem>
                </template>
              </DropdownMenu>
            </div>
          </div>

          <!-- 加载更多提示 -->
          <div v-if="sortedSessions.length > 0" class="py-3 px-5 text-center">
            <div v-if="isLoadingMore" class="flex items-center justify-center gap-2 text-sm text-gray-500">
              <el-icon class="animate-spin" size="16">
                <Loading />
              </el-icon>
              <span>加载中...</span>
            </div>
            <div v-else-if="hasMoreSessions"
              class="text-sm text-gray-400 cursor-pointer hover:text-blue-500 transition-colors"
              @click="loadMoreSessions">
              点击加载更多 (剩余 {{ totalSessionsCount - sortedSessions.length }} 个)
            </div>
            <div v-else-if="totalSessionsCount > 0" class="text-sm text-gray-400">
              已加载全部 {{ totalSessionsCount }} 个会话
            </div>
          </div>
        </template>
      </ScrollContainer>
    </div>
    <!-- 底部：主题 + 设置 + 用户 -->
    <div class="px-3 py-1 flex items-center justify-between">
      <div class="flex items-center gap-1">
        <!-- 主题切换 -->
        <div @click="toggleDark"
          class="flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer transition-all duration-200 text-(--color-text-gray) hover:bg-(--color-sidebar-bg-hover) hover:text-(--color-sidebar-text-hover)">
          <WbSunnyTwotone v-if="isDark" class="w-4 h-4" />
          <NightlightRound v-else class="w-4 h-4" />
          <span class="text-xs">{{ isDark ? '亮色' : '暗色' }}</span>
        </div>

        <!-- 设置 -->
        <div @click="handleNavClick('setting')"
          class="flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer transition-all duration-200" :class="currentActiveTab === 'setting'
            ? 'bg-(--color-sidebar-bg-active) text-(--color-sidebar-text-active)'
            : 'text-(--color-text-gray) hover:bg-(--color-sidebar-bg-hover) hover:text-(--color-sidebar-text-hover)'">
          <component :is="SettingsOutlined" class="w-4 h-4" />
          <span class="text-xs">设置</span>
        </div>
      </div>

      <!-- 用户头像下拉 -->
      <el-dropdown trigger="hover" placement="top-end" @command="handleUserMenuCommand">
        <div class="flex items-center p-1.5 rounded-lg cursor-pointer hover:bg-(--color-surface)">
          <Avatar class="w-7 h-7" type="user" :round="true" :src="authStore.user?.avatarUrl"
            :name="authStore.user?.nickname || authStore.user?.username" />
        </div>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item command="profile">
              <PersonOutlined class="w-4 h-4 mr-2" />
              个人中心
            </el-dropdown-item>
            <el-dropdown-item command="logout" divided>
              <LogOutOutlined class="w-4 h-4 mr-2" />
              退出登录
            </el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
    </div>
  </div>

  <!-- 删除会话确认对话框 -->
  <el-dialog v-model="deleteDialogVisible" title="删除会话" width="500px" :close-on-click-modal="false">
    <div class="space-y-4">
      <p class="text-gray-700 dark:text-gray-300">
        确定要删除会话 <strong>"{{ deleteSessionData?.title }}"</strong> 吗？
      </p>
      <div class="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3">
        <p class="text-sm text-red-600 dark:text-red-400">
          <strong>注意：</strong>此操作不可撤销，会话中的所有消息将被永久删除。
        </p>
      </div>
      <el-checkbox v-model="deleteWorkspaceChecked" class="w-full">
        <div class="flex flex-col gap-1" style="white-space: normal; word-wrap: break-word; overflow-wrap: break-word;">
          <span class="font-medium">同时删除默认工作目录</span>
          <span class="text-xs text-gray-500 dark:text-gray-400" style="line-height: 1.5;">
            仅删除系统自动创建的默认工作目录（data/workspace/{sessionId}），自定义工作目录不会被删除。请务必备份重要数据！
          </span>
        </div>
      </el-checkbox>
    </div>
    <template #footer>
      <div class="flex justify-end gap-2">
        <el-button @click="deleteDialogVisible = false">取消</el-button>
        <el-button type="danger" @click="confirmDeleteSession">确定删除</el-button>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { useSessionStore } from '../stores/session'
import { useTheme } from '../composables/useTheme'
import { usePopup } from '../composables/usePopup'
import { Avatar, ScrollContainer } from './ui'
import DropdownMenu from './ui/DropdownMenu.vue'
import DropdownMenuItem from './ui/DropdownMenuItem.vue'
import { apiService } from '@/services/ApiService'
import { ElMessageBox } from 'element-plus'

import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlineOutlined,
  PeopleOutlined,
  PersonOutlined,
  LogOutOutlined,
  CloudOutlined,
  MenuBookOutlined,
  ExtensionOutlined,
  AlarmOutlined,
  SettingsOutlined,
  WbSunnyTwotone,
  NightlightRound
} from '@vicons/material'
import {
  Bot20Regular,
  BookSearch20Regular,
  ContactCard20Regular,
  AddSquare20Regular,
  ClockAlarm20Regular,
  Apps20Regular,
  Cloud20Regular
} from '@vicons/fluent'
import { MoreFilled, Loading } from '@element-plus/icons-vue'

const router = useRouter()
const route = useRoute()
const authStore = useAuthStore()
const sessionStore = useSessionStore()
const { isDark, toggleDark } = useTheme()
const { toast, prompt, confirm } = usePopup()

// 删除会话确认对话框状态
const deleteDialogVisible = ref(false)
const deleteSessionData = ref<any>(null)
const deleteWorkspaceChecked = ref(false)

// 会话列表状态
const isLoadingMore = ref(false)
const totalSessionsCount = ref(0)
const scrollContainer = ref<any>(null)

// 无限滚动相关状态
const scrollThreshold = 50 // 滚动触发阈值(像素)
let scrollTimer: number | null = null // 滚动防抖定时器

// 导航项配置
const navItems = [
  {
    key: 'chat',
    label: '新建任务',
    icon: AddSquare20Regular
  },
  {
    key: 'characters',
    label: '助手',
    icon: ContactCard20Regular
  },
  {
    key: 'bots',
    label: '机器人',
    icon: Bot20Regular
  },
  {
    key: 'knowledge-base',
    label: '知识库',
    icon: BookSearch20Regular
  },
  {
    key: 'plugins',
    label: '插件市场',
    icon: Apps20Regular
  },
  {
    key: 'scheduler',
    label: '定时任务',
    icon: ClockAlarm20Regular
  },
  {
    key: 'models',
    label: '模型管理',
    icon: CloudOutlined
  }
]

// 当前激活的 tab（根据路由）
const currentActiveTab = computed(() => {
  const routeName = route.name as string
  if (routeName === 'Chat') {
    // 仅在新建会话时高亮"新建任务"，查看已有会话时不高亮
    const sessionId = route.params.sessionId
    const sessionIdStr = Array.isArray(sessionId) ? sessionId[0] : sessionId
    return sessionIdStr === 'new-session' ? 'chat' : ''
  }
  if (routeName === 'Characters') return 'characters'
  if (routeName === 'Bots') return 'bots'
  if (routeName === 'AccountCenter') return 'account'
  if (routeName === 'SystemSettings') return 'setting'
  if (routeName === 'KnowledgeBase') return 'knowledge-base'
  if (routeName === 'Plugins') return 'plugins'
  if (routeName === 'Scheduler') return 'scheduler'
  if (routeName === 'Models') return 'models'
  return ''
})

// 当前会话 ID
const currentSessionId = computed(() => {
  const sessionId = route.params.sessionId
  return Array.isArray(sessionId) ? sessionId[0] : sessionId
})

// 排序后的会话列表
const sortedSessions = computed(() => {
  const sessions = [...sessionStore.sessionsList]
  return sessions.sort((a, b) => {
    const timeA = a.lastActiveAt
      ? new Date(a.lastActiveAt).getTime()
      : (a.updatedAt ? new Date(a.updatedAt).getTime() : new Date(a.createdAt || 0).getTime())
    const timeB = b.lastActiveAt
      ? new Date(b.lastActiveAt).getTime()
      : (b.updatedAt ? new Date(b.updatedAt).getTime() : new Date(b.createdAt || 0).getTime())
    return timeB - timeA
  })
})

// 是否还有更多会话
const hasMoreSessions = computed(() => {
  return sortedSessions.value.length < totalSessionsCount.value
})

// 加载会话列表
const loadSessions = async () => {
  try {
    const pageSize = window.innerHeight > 1080 ? 40 : 20
    const data = await apiService.fetchSessions(0, pageSize)
    sessionStore.sessionsList = data.items || []
    totalSessionsCount.value = data.total || 0
  } catch (error) {
    console.error('获取对话列表失败:', error)
  }
}

// 加载更多会话
const loadMoreSessions = async () => {
  if (isLoadingMore.value || !hasMoreSessions.value) return
  isLoadingMore.value = true
  try {
    const skip = sessionStore.sessionsList.length
    const pageSize = window.innerHeight > 1080 ? 40 : 20
    const data = await apiService.fetchSessions(skip, pageSize)
    if (data.items && data.items.length > 0) {
      sessionStore.sessionsList = [...sessionStore.sessionsList, ...data.items]
      totalSessionsCount.value = data.total || 0
    }
  } catch (error) {
    console.error('加载更多会话失败:', error)
  } finally {
    isLoadingMore.value = false
  }
}

// 选择会话
const selectSession = (session: any) => {
  router.replace({ name: 'Chat', params: { sessionId: session.id } })
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

// 处理导航点击
const handleNavClick = (tab: string) => {
  if (tab === 'chat') {
    router.replace({ name: 'Chat', params: { sessionId: 'new-session' } })
  } else if (tab === 'characters') {
    router.replace({ name: 'Characters' })
  } else if (tab === 'bots') {
    router.replace({ name: 'Bots' })
  } else if (tab === 'setting') {
    router.replace({ name: 'SystemSettings' })
  } else if (tab === 'knowledge-base') {
    router.replace({ name: 'KnowledgeBase' })
  } else if (tab === 'plugins') {
    router.replace({ name: 'Plugins' })
  } else if (tab === 'scheduler') {
    router.replace({ name: 'Scheduler' })
  } else if (tab === 'models') {
    router.replace({ name: 'Models' })
  }
}

// 处理下拉菜单选择
const handleDropdownSelect = (command: string, session: any) => {
  if (command === 'rename') {
    handleRenameSession(session)
  } else if (command === 'delete') {
    handleDeleteSession(session)
  }
}

/**
 * 重命名会话
 * 显示输入新名称的提示框，更新会话标题
 */
const handleRenameSession = async (session: any) => {
  try {
    const result = await prompt('重命名对话', {
      placeholder: '请输入对话名称',
      defaultValue: session.title
    })

    if (result) {
      const newTitle = result

      // 更新对话数据
      const updatedSession = {
        title: newTitle
      }

      // 调用 API 更新对话
      await apiService.updateSession(session.id, updatedSession)

      // 更新本地会话列表中的标题
      const localSession = sessionStore.sessionsList.find(s => s.id === session.id)
      if (localSession) {
        localSession.title = newTitle
      }

      toast.success('对话重命名成功')
    }
  } catch (error) {
    console.error('重命名对话失败:', error)
    toast.error('对话重命名失败')
  }
}

/**
 * 删除会话
 * 显示确认删除的提示框，删除会话后从列表中移除
 */
const handleDeleteSession = async (session: any) => {
  // 显示自定义删除确认对话框
  deleteSessionData.value = session
  deleteWorkspaceChecked.value = false
  deleteDialogVisible.value = true
}

/**
 * 确认删除会话
 */
const confirmDeleteSession = async () => {
  try {
    const session = deleteSessionData.value
    if (!session) return

    // 如果勾选了删除工作目录，进行二次确认
    if (deleteWorkspaceChecked.value) {
      const secondConfirm = await ElMessageBox({
        title: '重要警告',
        message: '您选择了同时删除默认工作目录，这将永久删除该会话的所有文件数据，且不可恢复！',
        type: 'error',
        showCancelButton: true,
        confirmButtonText: '确定删除',
        cancelButtonText: '取消',
        distinguishCancelAndClose: true,
        customClass: 'workspace-delete-warning'
      }).then(() => true).catch(() => false)

      if (!secondConfirm) {
        // 用户取消了二次确认，不执行删除
        return
      }
    }

    // 传递 deleteWorkspace 参数
    await apiService.deleteSession(session.id, deleteWorkspaceChecked.value)

    const index = sortedSessions.value.findIndex(s => s.id === session.id)

    // 如果删除的是当前会话
    if (currentSessionId.value === session.id) {
      if (index < sortedSessions.value.length - 1) {
        // 选择下一个会话
        router.replace({ name: 'Chat', params: { sessionId: sortedSessions.value[index + 1].id } })
      } else if (index > 0) {
        // 选择上一个会话
        router.replace({ name: 'Chat', params: { sessionId: sortedSessions.value[index - 1].id } })
      } else {
        // 没有其他会话了
        router.replace({ name: 'Chat', params: { sessionId: 'new-session' } })
      }
    }    
    sessionStore.clearSessionState(session.id)
    sessionStore.sessionsList = sessionStore.sessionsList.filter(s => s.id !== session.id)
    totalSessionsCount.value = Math.max(0, totalSessionsCount.value - 1)
    toast.success('对话删除成功')

    // 关闭对话框
    deleteDialogVisible.value = false
    deleteSessionData.value = null
  } catch (error) {
    console.error('删除对话失败:', error)
    toast.error('对话删除失败')
  }
}

// 处理用户菜单命令
const handleUserMenuCommand = (command: string) => {
  if (command === 'profile') {
    router.replace({ name: 'AccountCenter' })
  } else if (command === 'logout') {
    confirm('提示', '确定要退出登录吗？', {
      type: 'warning',
      confirmText: '确定',
      cancelText: '取消'
    }).then((confirmed) => {
      if (confirmed) {
        authStore.logout()
        router.replace({ name: 'Login' })
      }
    })
  }
}

// 初始化加载会话
watch(() => authStore.isAuthenticated, (isAuth) => {
  if (isAuth) {
    loadSessions()
  }
}, { immediate: true })

/**
 * 初始化 SSE 会话事件监听
 * 用于多窗口同步会话列表和流式状态
 */
function initSessionEventListeners() {
  // 连接 SSE（如果用户已认证）
  // 后端通过 Authorization Header 中的 token 解析 userId，前端无需传递
  if (authStore.isAuthenticated) {
    console.log('[GlobalSidebar] 连接 SSE')
    apiService.connectSessionEvents()
  }

  // 监听会话创建事件
  apiService.onSessionEvent('session_created', (event) => {
    // 忽略自身发起的事件
    if (event.source === apiService.getClientId()) {
      return
    }
    const { payload } = event
    if (payload?.session) {
      // 避免重复添加已存在的会话
      const exists = sessionStore.sessionsList.find(s => s.id === payload.session.id)
      if (!exists) {
        sessionStore.sessionsList.unshift(payload.session)
        totalSessionsCount.value++
      }
    }
  })

  // 监听会话删除事件
  apiService.onSessionEvent('session_deleted', (event) => {
    // 忽略自身发起的事件
    if (event.source === apiService.getClientId()) {
      return
    }
    const { sessionId } = event
    const index = sortedSessions.value.findIndex(s => s.id === sessionId)

    sessionStore.sessionsList = sessionStore.sessionsList.filter(s => s.id !== sessionId)
    totalSessionsCount.value = Math.max(0, totalSessionsCount.value - 1)

    // 如果删除的是当前会话，清理状态并切换到其他会话
    if (currentSessionId.value === sessionId) {
      sessionStore.clearSessionState(sessionId)
      if (index < sortedSessions.value.length - 1) {
        router.replace({ name: 'Chat', params: { sessionId: sortedSessions.value[index + 1].id } })
      } else if (index > 0) {
        router.replace({ name: 'Chat', params: { sessionId: sortedSessions.value[index - 1].id } })
      } else {
        router.replace({ name: 'Chat', params: { sessionId: 'new-session' } })
      }
    }
  })

  // 监听会话更新事件
  apiService.onSessionEvent('session_updated', (event) => {
    // 忽略自身发起的事件
    if (event.source === apiService.getClientId()) {
      return
    }
    const { sessionId, payload } = event
    const session = sessionStore.sessionsList.find(s => s.id === sessionId)
    if (session && payload?.session) {
      Object.assign(session, payload.session)
    }
    // 更新最后活跃时间，触发会话列表重新排序
    sessionStore.updateSessionLastActiveTime(sessionId, event.timestamp)
  })

  // 监听流开始事件（统一处理会话列表排序和会话补全）
  apiService.onSessionEvent('stream_started', (event) => {
    const { sessionId, payload } = event

    // 忽略自身发起的流（通过 source/clientId 判断）
    if (event.source === apiService.getClientId()) {
      console.log('[GlobalSidebar] 忽略自身发起的流事件')
      return
    }

    const session = sessionStore.sessionsList.find(s => s.id === sessionId)

    if (!session && payload?.session) {
      // 会话不在当前列表中（可能是未加载），插入到列表头部
      sessionStore.sessionsList.unshift(payload.session)
      totalSessionsCount.value++
    } else if (session && payload?.session) {
      // 同步会话字段（如 title、lastMessage 等可能已更新）
      Object.assign(session, payload.session)
    }

    // 更新最后活跃时间，触发会话列表重新排序
    sessionStore.updateSessionLastActiveTime(sessionId, event.timestamp)

    // 设置待处理的流会话，通知 ChatPanel 订阅流
    sessionStore.setPendingStreamSession(sessionId, payload?.replaceMessageId)
  })

  // 监听流结束事件
  apiService.onSessionEvent('stream_finished', (event) => {
    const { sessionId } = event
    if (sessionId === currentSessionId.value) {
      sessionStore.clearPendingStreamSession()
      console.log('[GlobalSidebar] 当前会话流已结束')
    }
  })
}

/**
 * 清理 SSE 事件监听
 */
function cleanupSessionEventListeners() {
  apiService.disconnectSessionEvents()
}

onMounted(() => {
  initSessionEventListeners()
})


// 组件卸载时清理
onUnmounted(() => {
  cleanupSessionEventListeners()
})
</script>

<style scoped>
/* 会话项样式 */
.session-item-inactive {
  color: var(--color-text);
}

.session-item-inactive:hover {
  background-color: var(--color-sidebar-bg-hover);
  color: var(--color-text);
}

.session-item-active {
  background-color: var(--color-sidebar-bg-active);
  color: var(--color-sidebar-text-active);
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
  background-color: #383a40;
}

/* 空状态 */
.empty-state-icon {
  display: flex;
  align-items: center;
  justify-content: center;
}

/* 滚动条样式 */
:deep(.el-scrollbar__bar) {
  opacity: 0.6;
  transition: opacity 0.2s;
}

:deep(.el-scrollbar__bar:hover) {
  opacity: 1;
}
</style>
