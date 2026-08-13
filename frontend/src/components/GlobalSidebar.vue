<template>
  <div class="global-sidebar flex flex-col h-full sidebar-transparent-bg overflow-hidden ">
    <!-- 标题栏左侧面板 -->
    <TitlebarLeftPanel />
    <!-- 导航菜单 -->
    <div class="px-2 py-2 space-y-0.5">
      <div v-for="item in navItems" :key="item.key" @click="handleNavClick(item.key)"
        class="nav-item flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer transition-all duration-200 ease-in-out"
        :class="currentActiveTab === item.key
          ? 'nav-item-active bg-(--color-sidebar-bg-active) text-(--color-sidebar-text-active)'
          : 'text-(--color-text) hover:bg-(--color-sidebar-bg-hover) hover:text-(--color-sidebar-text-hover)'">
        <component :is="item.icon" class="w-4.5 h-4.5 shrink-0" />
        <span class="text-sm font-medium flex-1 truncate">{{ item.label }}</span>
        <span v-if="item.shortcut"
          class="text-[10px] leading-none font-mono text-gray-400 dark:text-gray-500 select-none">
          {{ item.shortcut }}
        </span>
      </div>
    </div>


    <!-- 会话列表区域 -->
    <div class="flex-1 overflow-hidden py-1">
      <ScrollContainer ref="scrollContainer" class="h-full max-h-full">
        <!-- 按分组展示会话 -->
        <div v-for="group in displayGroups" :key="group.id" class="mb-1">
          <!-- 分组标题栏 -->
          <div
            class="group-header flex items-center justify-between pl-1 pr-1 py-1 ml-1 mr-0.5 rounded-md cursor-pointer transition-colors duration-200 select-none group text-neutral-600 dark:text-neutral-200"
            @click="toggleGroupExpand(group.id)" @contextmenu.prevent="openGroupContextMenu($event, group)">
            <div class="flex items-center gap-1.5">
              <span class="relative w-4 h-4 shrink-0 flex items-center justify-center">
                <FolderOpen16Regular class="absolute inset-0 w-4 h-4 transition-opacity duration-200 group-hover:opacity-0 text-yellow-600" />
                <!-- <svg class="w-3.5 h-3.5 absolute inset-0 transition-opacity duration-200 group-hover:opacity-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/>
                </svg> -->
                <ChevronDown12Regular class="absolute inset-0 w-4 h-4 transition-all duration-200 opacity-0 group-hover:opacity-100"
                  :class="isGroupExpanded(group.id) ? '' : '-rotate-90'" />
              </span>
              <span class="text-sm font-medium">{{ group.name }}</span>
            </div>
            <div class="flex items-center gap-1">
              <!-- 新建会话按钮（始终显示） -->
              <LTooltip :content="t('ui.sidebar.newSessionInGroup', { name: group.name })" placement="bottom">
                <div @click.stop="openNewSession(group.id)">
                  <div
                    class="session-action-trigger p-0.5 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-700">
                    <Add12Regular class="w-2.5 h-2.5 text-gray-500 dark:text-gray-300" />
                  </div>
                </div>
              </LTooltip>
            </div>
          </div>

          <!-- 分组内的会话列表 -->
          <div v-show="isGroupExpanded(group.id)" class="mt-0.5 space-y-0.5">
            <!-- 分组内无会话时显示空状态 -->
            <template v-if="getGroupSessions(group.id).length === 0 && !isLoadingGroup(group.id)">
              <div class="text-center text-gray-500 py-6 text-xs">
                {{ t('ui.sidebar.noTasks') }}
              </div>
            </template>
            <template v-else>
              <div v-for="session in getGroupSessions(group.id)" :key="session.id"
                class="session-item flex items-center gap-2 py-1.5 pr-1 pl-2 ml-1 mr-0.5  rounded-md cursor-pointer transition-all duration-200 ease-in-out group"
                :class="{
                  'session-item-active': session.id === currentSessionId,
                  'session-item-inactive': session.id !== currentSessionId
                }" @click="selectSession(session)">
                <!-- 状态指示器 -->
                <div class="status-indicator w-3 h-3 shrink-0 flex items-center justify-center">
                  <div v-if="getSessionWorking(session.id)"
                    class="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
                  <div v-else-if="getSessionUnread(session.id) && (session.id !== currentSessionId || windowHidden)"
                    class="w-1 h-1 rounded-full bg-red-500" />
                  <div v-else class="w-1 h-1 rounded-full bg-gray-400 opacity-50" />
                </div>

                <div class="session-info flex-1 min-w-0 flex items-center">
                  <div class="session-title text-sm font-medium w-full">
                    {{ session.title }}
                  </div>
                </div>
                <div class="session-actions shrink-0 relative min-w-5 h-full flex items-center">
                  <!-- 最后活跃时间（非当前会话时显示，hover 时隐藏，右对齐悬浮） -->
                  <span v-if="session.id !== currentSessionId"
                    class="absolute right-0 top-1/2 -translate-y-1/2 text-xs text-gray-400 dark:text-gray-500 group-hover:hidden whitespace-nowrap">
                    {{ formatLastActive(session.lastActiveAt || session.updatedAt) }}
                  </span>
                  <!-- 操作菜单（默认隐藏，hover 时显示） -->
                  <div
                    class="absolute right-0 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 flex items-center"
                    :class="{ 'opacity-100': session.id === currentSessionId }">
                    <DropdownMenu @command="(cmd: string) => handleDropdownSelect(cmd, session)">
                      <div class="session-action-trigger">
                        <el-icon class="w-4 h-4">
                          <MoreHorizontal20Filled />
                        </el-icon>
                      </div>
                      <template #dropdown>
                        <DropdownMenuItem command="rename">
                          <Edit16Regular class="w-4 h-4 mr-2 inline-block" />
                          {{ t('ui.sidebar.rename') }}
                        </DropdownMenuItem>
                        <DropdownMenuItem command="move">
                          <Folder20Regular class="w-4 h-4 mr-2 inline-block" />
                          {{ t('ui.sidebar.moveToGroup') }}
                        </DropdownMenuItem>
                        <DropdownMenuItem command="archive">
                          <Archive20Regular class="w-4 h-4 mr-2 inline-block" />
                          {{ t('ui.sidebar.archive') }}
                        </DropdownMenuItem>
                        <DropdownMenuItem command="delete">
                          <Delete20Regular class="w-4 h-4 mr-2 inline-block" />
                          {{ t('ui.sidebar.delete') }}
                        </DropdownMenuItem>
                      </template>
                    </DropdownMenu>
                  </div>
                </div>
              </div>

              <!-- 分组内加载更多 -->
              <div v-if="groupHasMoreSessions(group.id) || sessionGroupStore.loadingMoreGroupId === group.id"
                class="py-1 px-9 text-left">
                <div v-if="sessionGroupStore.loadingMoreGroupId === group.id"
                  class="flex items-center justify-center gap-2 text-xs text-gray-500">
                  <el-icon class="animate-spin" size="14">
                    <Loading />
                  </el-icon>
                  <span>{{ t('ui.sidebar.loadingMore') }}</span>
                </div>
                <div v-else class="text-xs text-gray-400 cursor-pointer hover:text-blue-500 transition-colors"
                  @click="loadMoreForGroup(group.id)">
                  {{ t('ui.sidebar.loadMore') }}
                </div>
              </div>
            </template>
          </div>
        </div>
      </ScrollContainer>
    </div>
    <!-- 底部：头像 + 设置 -->
    <div class="px-3 py-1.5 flex items-center justify-between gap-2">
      <!-- 用户头像+名字 下拉 -->
      <el-dropdown trigger="hover" placement="top-start" @command="handleUserMenuCommand"
        popper-class="user-menu-dropdown" style="flex: 1 1 0%; min-width: 0;">
        <div
          class="flex items-center gap-2 p-1.5 rounded-lg cursor-pointer min-w-0 w-full hover:bg-(--color-sidebar-bg-hover) transition-all duration-200">
          <Avatar class="w-7 h-7 shrink-0" type="user" :round="true" :src="authStore.user?.avatarUrl"
            :name="authStore.user?.nickname || authStore.user?.username" />
          <span class="text-sm font-medium text-(--color-text) truncate min-w-0">
            {{ authStore.user?.nickname || authStore.user?.username || t('ui.sidebar.defaultUserName') }}
          </span>
        </div>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item command="profile">
              <PersonOutlined class="w-4 h-4 mr-2" />
              {{ t('ui.sidebar.profile') }}
            </el-dropdown-item>
            <!-- 颜色主题：内联三态切换 -->
            <div class="px-5 py-2 flex items-center gap-2">
              <span class="text-sm text-gray-500 dark:text-gray-400 mr-1">{{ t('ui.sidebar.colorTheme') }}</span>
              <div class="flex items-center gap-0.5 p-0.5 rounded-md bg-gray-100 dark:bg-[#1a1b1e]">
                <button v-for="option in themeOptions" :key="option.value" @click="setTheme(option.value)"
                  class="px-2 py-1 rounded text-xs font-medium transition-all duration-200 flex items-center gap-1"
                  :class="themeMode === option.value
                    ? 'bg-white dark:bg-[#3a3b3f] text-gray-900 dark:text-[#e8e9ed] shadow-sm'
                    : 'text-gray-500 dark:text-[#8b8d95] hover:text-gray-700 dark:hover:text-[#c0c1c5]'">
                  <component :is="option.icon" class="w-3.5 h-3.5" />
                  {{ option.label }}
                </button>
              </div>
            </div>
            <el-dropdown-item command="settings">
              <Settings16Filled class="w-4 h-4 mr-2" />
              {{ t('ui.sidebar.settingsCenter') }}
            </el-dropdown-item>
            <el-dropdown-item command="logout" divided>
              <LogOutOutlined class="w-4 h-4 mr-2" />
              {{ t('ui.sidebar.logout') }}
            </el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>

      <!-- 设置 -->
      <LTooltip :content="t('ui.sidebar.settings')" placement="bottom">
        <div @click="handleNavClick('setting')"
          class="flex items-center justify-center px-2.5 py-2 rounded-lg cursor-pointer transition-all duration-200 shrink-0"
          :class="currentActiveTab === 'setting'
            ? 'bg-(--color-sidebar-bg-active) text-(--color-sidebar-text-active)'
            : 'text-(--color-text-gray) hover:bg-(--color-sidebar-bg-hover) hover:text-(--color-sidebar-text-hover)'">
          <component :is="Settings16Filled" class="w-4 h-4" />
        </div>
      </LTooltip>
    </div>
  </div>

  <!-- 删除会话确认对话框 -->
  <LDialog v-model="deleteDialogVisible" :title="t('ui.sidebar.deleteSessionTitle')" width="500px" :close-on-click-modal="false">
    <div class="space-y-4">
      <p class="text-gray-700 dark:text-gray-300">
        {{ t('ui.sidebar.deleteSessionConfirm', { title: deleteSessionData?.title }) }}
      </p>
      <div class="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3">
        <p class="text-sm text-red-600 dark:text-red-400">
          {{ t('ui.sidebar.deleteWarning') }}
        </p>
      </div>
      <el-checkbox v-model="deleteWorkspaceChecked" class="w-full">
        <div class="flex flex-col gap-1" style="white-space: normal; word-wrap: break-word; overflow-wrap: break-word;">
          <span class="font-medium">{{ t('ui.sidebar.deleteWorkspace') }}</span>
          <span class="text-xs text-gray-500 dark:text-gray-400" style="line-height: 1.5;">
            {{ t('ui.sidebar.deleteWorkspaceDesc') }}
          </span>
        </div>
      </el-checkbox>
    </div>
    <template #footer>
      <div class="flex justify-end gap-2">
        <el-button @click="deleteDialogVisible = false">{{ t('common.cancel') }}</el-button>
        <el-button type="danger" @click="confirmDeleteSession">{{ t('ui.sidebar.confirmDelete') }}</el-button>
      </div>
    </template>
  </LDialog>

  <!-- 移动会话到分组弹窗 -->
  <LDialog v-model="moveGroupDialogVisible" :title="t('ui.sidebar.selectGroup')" width="360px" :close-on-click-modal="false">
    <div class="space-y-1 py-2">
      <div v-for="(g) in moveGroupOptions" :key="g.value"
        class="flex items-center gap-2 px-3 py-2.5 rounded-lg cursor-pointer transition-all duration-200 text-sm"
        :class="moveSelectedGroupId === g.value ? 'bg-(--color-sidebar-bg-active) text-(--color-sidebar-text-active)' : 'text-(--color-text-gray) hover:bg-(--color-sidebar-bg-hover) hover:text-(--color-sidebar-text-hover)'"
        @click="moveSelectedGroupId = g.value">
        <el-icon class="w-4 h-4">
          <Folder20Regular />
        </el-icon>
        <span>{{ g.label }}</span>
      </div>
    </div>
    <template #footer>
      <div class="flex justify-end gap-2">
        <el-button @click="moveGroupDialogVisible = false">{{ t('common.cancel') }}</el-button>
        <el-button type="primary" @click="confirmMoveSession">{{ t('common.ok') }}</el-button>
      </div>
    </template>
  </LDialog>

  <!-- 分组右键菜单 -->
  <ContextMenu :visible="groupContextMenu.visible" :x="groupContextMenu.x" :y="groupContextMenu.y"
    :items="groupContextMenuItems" @close="closeGroupContextMenu" />
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, markRaw } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter, useRoute } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { useSessionStore } from '../stores/session'
import { useSessionGroupStore } from '../stores/sessionGroup'
import { UNGROUPED_ID } from '../stores/session'
import { useTheme, type ThemeMode } from '../composables/useTheme'
import { usePopup } from '../composables/usePopup'
import { Avatar, ScrollContainer } from './ui'
import DropdownMenu from './ui/DropdownMenu.vue'
import DropdownMenuItem from './ui/DropdownMenuItem.vue'
import ContextMenu, { type ContextMenuItem } from './ui/ContextMenu.vue'
import LTooltip from './ui/LTooltip.vue'
import LDialog from '@/components/ui/LDialog.vue'
import { apiService } from '@/services/ApiService'
import type { SessionGroup } from '@/types/session'
import { ElMessageBox } from 'element-plus'

import {
  PersonOutlined,
  LogOutOutlined,
} from '@vicons/material'

import {
  Bot20Regular,
  BookSearch20Regular,
  ContactCard20Regular,
  AddSquare20Regular,
  Add12Regular,
  ClockAlarm20Regular,
  Apps20Regular,
  Cloud20Regular,
  Edit16Regular,
  Delete20Regular,
  Folder20Regular,
  FolderOpen16Regular,
  Archive20Regular,
  ChevronDown12Regular,
  WeatherSunny20Regular,
  WeatherMoon20Filled,
  Desktop16Regular,
  Settings16Filled,
} from '@vicons/fluent'
import { MoreHorizontal20Filled } from '@vicons/fluent'
import { Loading } from '@element-plus/icons-vue'
import TitlebarLeftPanel from './TitlebarLeftPanel.vue'

const isElectron = typeof window !== 'undefined' && window.electronAPI !== undefined

const router = useRouter()
const route = useRoute()
const authStore = useAuthStore()
const sessionStore = useSessionStore()
const sessionGroupStore = useSessionGroupStore()
const { themeMode, setTheme } = useTheme()

const { t } = useI18n()

const themeOptions = computed(() => [
  { label: t('ui.sidebar.themeLight'), value: 'light' as ThemeMode, icon: markRaw(WeatherSunny20Regular) },
  { label: t('ui.sidebar.themeDark'), value: 'dark' as ThemeMode, icon: markRaw(WeatherMoon20Filled) },
  { label: t('ui.sidebar.themeSystem'), value: 'system' as ThemeMode, icon: markRaw(Desktop16Regular) },
])
const { toast, prompt, confirm } = usePopup()

// 删除会话确认对话框状态
const deleteDialogVisible = ref(false)
const deleteSessionData = ref<any>(null)
const deleteWorkspaceChecked = ref(false)

// 移动会话到分组弹窗状态
const moveGroupDialogVisible = ref(false)
const moveGroupOptions = ref<{ label: string; value: string }[]>([])
const moveSelectedGroupId = ref('')
const moveTargetSession = ref<any>(null)

// 是否正在初始化加载
const isInitializing = ref(false)

// 分组右键菜单状态
const groupContextMenu = ref({
  visible: false,
  x: 0,
  y: 0,
  group: null as SessionGroup | null,
})

// 分组右键菜单项
const groupContextMenuItems = computed<ContextMenuItem[]>(() => {
  const group = groupContextMenu.value.group
  if (!group || group.id === UNGROUPED_ID) return []
  return [
    {
      label: t('ui.sidebar.rename'),
      icon: markRaw(Edit16Regular),
      onClick: () => handleRenameGroup(group),
    },
    {
      label: t('ui.sidebar.delete'),
      icon: markRaw(Delete20Regular),
      onClick: () => handleDeleteGroup(group),
    },
  ]
})

// 打开分组右键菜单
const openGroupContextMenu = (event: MouseEvent, group: SessionGroup) => {
  // 未分组只做右键菜单不做实际处理（不可重命名/删除）
  if (group.id === UNGROUPED_ID) return
  groupContextMenu.value = {
    visible: true,
    x: event.clientX,
    y: event.clientY,
    group,
  }
}

// 关闭分组右键菜单
const closeGroupContextMenu = () => {
  groupContextMenu.value.visible = false
  groupContextMenu.value.group = null
}

// 打开新建会话面板，指定分组
const openNewSession = (groupId: string) => {
  // 已在新会话页面时只更新 query 参数，不重新导航
  if (currentActiveTab.value === 'chat') {
    if (groupId === UNGROUPED_ID) {
      router.replace({ name: 'Chat', params: { sessionId: 'new-session' } })
    } else {
      router.replace({ name: 'Chat', params: { sessionId: 'new-session' }, query: { groupId } })
    }
    return
  }
  if (groupId === UNGROUPED_ID) {
    router.replace({ name: 'Chat', params: { sessionId: 'new-session' } })
  } else {
    router.replace({ name: 'Chat', params: { sessionId: 'new-session' }, query: { groupId } })
  }
}

// 导航项配置
const navItems = computed(() => [
  {
    key: 'chat',
    label: t('ui.sidebar.navNewTask'),
    icon: AddSquare20Regular,
    shortcut: isElectron ? 'Ctrl N' : 'Ctrl Alt N'
  },
  {
    key: 'characters',
    label: t('ui.sidebar.navCharacters'),
    icon: ContactCard20Regular
  },
  {
    key: 'bots',
    label: t('ui.sidebar.navBots'),
    icon: Bot20Regular
  },
  {
    key: 'knowledge-base',
    label: t('ui.sidebar.navKnowledgeBase'),
    icon: BookSearch20Regular
  },
  {
    key: 'plugins',
    label: t('ui.sidebar.navPlugins'),
    icon: Apps20Regular
  },
  {
    key: 'scheduler',
    label: t('ui.sidebar.navScheduler'),
    icon: ClockAlarm20Regular
  },
  {
    key: 'models',
    label: t('ui.sidebar.navModels'),
    icon: Cloud20Regular
  }
])

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

// 窗口隐藏状态（用于侧边栏未读徽标显示逻辑，SSE 事件由 useSessionEvents composable 统一管理）
const windowHidden = ref(false)

onMounted(() => {
  document.addEventListener('visibilitychange', () => {
    windowHidden.value = document.hidden
  })
})


/**
 * 判断指定分组是否正在加载
 */
const isLoadingGroup = (groupId: string) => {
  return sessionGroupStore.loadingMoreGroupId === groupId || isInitializing.value
}

// 展示的分组列表（包含虚拟的未分组）
const displayGroups = computed(() => {
  const groups = [...sessionGroupStore.sortedGroups]
  // 始终在最后添加未分组
  groups.push({
    id: UNGROUPED_ID,
    name: t('ui.sidebar.taskList'),
    userId: '',
    sortOrder: groups.length,
    createdAt: '',
    updatedAt: ''
  })
  return groups
})

// 获取分组内的会话（从 sessionStore 统一数据源获取）
const getGroupSessions = (groupId: string): any[] => {
  const groupIdParam = groupId === UNGROUPED_ID ? null : groupId
  return sessionStore.getSessionsByGroup(groupIdParam)
}

// 获取分组会话数量（从 sessionStore 统一数据源获取）
const getGroupSessionCount = (groupId: string): number => {
  const groupIdParam = groupId === UNGROUPED_ID ? null : groupId
  return sessionStore.getGroupTotal(groupIdParam)
}

// 分组是否展开
const isGroupExpanded = (groupId: string): boolean => {
  if (groupId === UNGROUPED_ID) {
    return sessionGroupStore.isExpanded(UNGROUPED_ID)
  }
  return sessionGroupStore.isExpanded(groupId)
}

// 切换分组展开/折叠
const toggleGroupExpand = (groupId: string): void => {
  sessionGroupStore.toggleExpand(groupId)
}

// 分组是否还有更多会话
const groupHasMoreSessions = (groupId: string): boolean => {
  return sessionStore.groupHasMore(groupId)
}

// 初始化加载所有分组的前N个会话（单次请求获取分组+各分组会话）
const loadSessions = async () => {
  isInitializing.value = true
  try {
    const pageSize = window.innerHeight > 1080 ? 15 : 10
    const data = await apiService.fetchSidebarSessions(pageSize)

    // 设置分组列表
    sessionGroupStore.setGroups(data.groups || [])

    // 处理各分组的会话
    for (const gs of data.groupSessions || []) {
      const storeGroupId = gs.groupId === null ? UNGROUPED_ID : gs.groupId
      for (const session of gs.items || []) {
        sessionStore.setSession(session)
      }
      sessionStore.setLoadedCount(storeGroupId, gs.items?.length || 0)
      sessionStore.setHasMore(storeGroupId, gs.hasMore)

      // 同步流式状态
      for (const session of gs.items || []) {
        if (session.isStreaming) {
          sessionStore.syncStreamingState(session.id, true)
        }
      }
    }
  } catch (error) {
    console.error('获取对话列表失败:', error)
  } finally {
    isInitializing.value = false
  }
}

// 为指定分组加载更多会话
const loadMoreForGroup = async (groupId: string) => {
  if (sessionGroupStore.loadingMoreGroupId) return

  const currentSessions = getGroupSessions(groupId)
  const groupIdParam = groupId === UNGROUPED_ID ? null : groupId

  sessionGroupStore.setLoadingMore(groupId)
  try {
    const data = await apiService.fetchSessions(currentSessions.length, 15, groupIdParam)

    if (data.items && data.items.length > 0) {
      // 写入统一数据源
      for (const session of data.items) {
        sessionStore.setSession(session)
      }
      sessionStore.setLoadedCount(groupId, currentSessions.length + data.items.length)
      sessionStore.setHasMore(groupId, data.hasMore ?? (currentSessions.length + data.items.length) < (data.total || 0))

      // 同步流式状态
      for (const session of data.items) {
        if (session.isStreaming) {
          sessionStore.syncStreamingState(session.id, true)
        }
      }
    }
  } catch (error) {
    console.error(`加载分组 ${groupId} 更多会话失败:`, error)
  } finally {
    sessionGroupStore.setLoadingMore(null)
  }
}

// 友好格式化最后活跃时间
const updateTick = ref(0)
let tickTimer: ReturnType<typeof setInterval> | null = null

const formatLastActive = (dateStr: string | null | undefined): string => {
  if (!dateStr) return ''
  // 读取 tick 让 Vue 将其视为响应式依赖，实现定时刷新
  void updateTick.value
  const now = Date.now()
  const diff = now - new Date(dateStr).getTime()
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months}m`
  return t('ui.sidebar.earlier')
}

// 侧边栏状态辅助方法
const getSessionUnread = (sessionId: string): boolean => {
  return sessionStore.getSidebarFlag(sessionId, 'unread')
}

const getSessionWorking = (sessionId: string): boolean => {
  return sessionStore.getSidebarFlag(sessionId, 'working')
}

// 选择会话
const selectSession = (session: any) => {
  // 进入会话时标记为已读
  sessionStore.setSidebarFlag(session.id, 'unread', false)
  router.replace({ name: 'Chat', params: { sessionId: session.id } })
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

// 处理会话下拉菜单选择
const handleDropdownSelect = (command: string, session: any) => {
  if (command === 'rename') {
    handleRenameSession(session)
  } else if (command === 'move') {
    handleMoveSession(session)
  } else if (command === 'archive') {
    handleArchiveSession(session)
  } else if (command === 'delete') {
    handleDeleteSession(session)
  }
}

/**
 * 归档会话
 */
const handleArchiveSession = async (session: any) => {
  const confirmed = await confirm(t('ui.sidebar.archiveTitle'), t('ui.sidebar.archiveConfirm', { title: session.title }), {
    type: 'info',
    confirmText: t('ui.sidebar.archive'),
    cancelText: t('common.cancel')
  })
  if (!confirmed) return

  try {
    const result = await apiService.archiveSession(session.id, true)
    if (result.success) {
      // 从 sessionStore 中删除（不再展示在侧边栏）
      sessionStore.removeSession(session.id)
      sessionStore.clearSidebarState(session.id)
      // 如果归档的是当前会话，跳转到新建会话页面
      if (currentSessionId.value === session.id) {
        router.replace({ name: 'Chat', params: { sessionId: 'new-session' } })
      }
      toast.success(t('ui.sidebar.archived'))
    }
  } catch (error: any) {
    console.error('归档失败:', error)
    toast.error(error?.response?.data?.message || t('ui.sidebar.archiveFailed'))
  }
}

/**
 * 移动会话到分组
 */
const handleMoveSession = (session: any) => {
  // 构建分组选项，顺序与侧边栏一致
  const groupOptions = sessionGroupStore.groups.map(g => ({
    label: g.name,
    value: g.id
  }))
  groupOptions.push({ label: t('ui.sidebar.ungrouped'), value: UNGROUPED_ID })

  moveGroupOptions.value = groupOptions
  moveTargetSession.value = session
  moveSelectedGroupId.value = session.groupId || UNGROUPED_ID
  moveGroupDialogVisible.value = true
}

/**
 * 确认移动会话到分组
 */
const confirmMoveSession = async () => {
  try {
    const session = moveTargetSession.value
    if (!session) return

    const targetGroupId = moveSelectedGroupId.value
    const groupIdToSet = targetGroupId === UNGROUPED_ID ? null : targetGroupId

    // 调用API更新
    await apiService.updateSession(session.id, { groupId: groupIdToSet })

    // 更新统一数据源中的分组ID
    sessionStore.moveSession(session.id, groupIdToSet)

    toast.success(t('ui.sidebar.moved'))
    moveGroupDialogVisible.value = false
    moveTargetSession.value = null
  } catch (error) {
    console.error('移动会话失败:', error)
    toast.error(t('ui.sidebar.moveFailed'))
  }
}

/**
 * 重命名分组
 */
const handleRenameGroup = async (group: any) => {
  try {
    const result = await prompt(t('ui.sidebar.renameGroupTitle'), {
      placeholder: t('ui.sidebar.inputGroupName'),
      defaultValue: group.name
    })

    if (result && result !== group.name) {
      const success = await sessionGroupStore.updateGroup(group.id, result)
      if (success) {
        toast.success(t('ui.sidebar.groupRenamed'))
      }
    }
  } catch (error) {
    console.error('重命名分组失败:', error)
    toast.error(t('ui.sidebar.renameGroupFailed'))
  }
}

/**
 * 删除分组
 */
const handleDeleteGroup = async (group: any) => {
  try {
    const confirmed = await confirm(t('ui.sidebar.deleteGroupTitle'), t('ui.sidebar.deleteGroupConfirm', { name: group.name }), {
      type: 'warning',
      confirmText: t('common.delete'),
      cancelText: t('common.cancel')
    })

    if (confirmed) {
      // 将该分组下的所有会话移到未分组（统一数据源中批量更新）
      const sessionsToMove = sessionStore.getSessionsByGroup(group.id)
      for (const s of sessionsToMove) {
        s.groupId = null
      }

      // 删除分组
      const success = await sessionGroupStore.deleteGroup(group.id)
      if (success) {
        toast.success(t('ui.sidebar.groupDeleted'))
      }
    }
  } catch (error) {
    console.error('删除分组失败:', error)
    toast.error(t('ui.sidebar.deleteGroupFailed'))
  }
}

/**
 * 重命名会话
 * 显示输入新名称的提示框，更新会话标题
 */
const handleRenameSession = async (session: any) => {
  try {
    const result = await prompt(t('ui.sidebar.renameSessionTitle'), {
      placeholder: t('ui.sidebar.inputSessionName'),
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

      // 更新统一数据源中的标题
      sessionStore.updateSessionTitle(session.id, newTitle)

      toast.success(t('ui.sidebar.sessionRenamed'))
    }
  } catch (error) {
    console.error('重命名对话失败:', error)
    toast.error(t('ui.sidebar.renameSessionFailed'))
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
        title: t('ui.sidebar.importantWarning'),
        message: t('ui.sidebar.workspaceDeleteWarning'),
        type: 'error',
        showCancelButton: true,
        confirmButtonText: t('ui.sidebar.confirmDelete'),
        cancelButtonText: t('common.cancel'),
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

    // 如果删除的是当前会话，自动切换到相邻会话
    if (currentSessionId.value === session.id) {
      router.replace({ name: 'Chat', params: { sessionId: 'new-session' } })
    }
    sessionStore.removeSession(session.id)
    sessionStore.clearSidebarState(session.id)
    toast.success(t('ui.sidebar.sessionDeleted'))

    // 关闭对话框
    deleteDialogVisible.value = false
    deleteSessionData.value = null
  } catch (error) {
    console.error('删除对话失败:', error)
    toast.error(t('ui.sidebar.deleteSessionFailed'))
  }
}

// 处理用户菜单命令
const handleUserMenuCommand = (command: string) => {
  if (command === 'profile') {
    router.replace({ name: 'SystemSettings', params: { tab: 'profile' } })
  } else if (command === 'settings') {
    router.replace({ name: 'SystemSettings' })
  } else if (command === 'logout') {
    confirm(t('ui.sidebar.logoutTitle'), t('ui.sidebar.logoutConfirm'), {
      type: 'warning',
      confirmText: t('common.ok'),
      cancelText: t('common.cancel')
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

onMounted(() => {
  // 每分钟更新一次最后活跃时间显示（无需SSE事件驱动，自动刷新相对时间）
  tickTimer = setInterval(() => {
    updateTick.value++
  }, 60_000)
})


// 组件卸载时清理
onUnmounted(() => {
  if (tickTimer !== null) {
    clearInterval(tickTimer)
    tickTimer = null
  }
})
</script>

<style scoped>
/* 会话项样式 */
.session-title {
  overflow: hidden;
  white-space: nowrap;
  /* 渐变遮罩自然淡出：fade 宽约半字符，紧贴右侧时间文本/按钮；mask 作用于自身 alpha，不依赖背景色，兼容壁纸/毛玻璃背景 */
  -webkit-mask-image: linear-gradient(to right,
    black 0%,
    black calc(100% - 6px),
    rgba(0, 0, 0, 0.65) calc(100% - 3px),
    transparent 100%);
  mask-image: linear-gradient(to right,
    black 0%,
    black calc(100% - 6px),
    rgba(0, 0, 0, 0.65) calc(100% - 3px),
    transparent 100%);
}

.session-item-inactive {
  color: var(--color-text);
}

.session-item-inactive:hover {
  background-color: var(--color-sidebar-bg-hover);
  color: var(--color-sidebar-text-hover);
}

.session-item-active {
  background-color: var(--color-sidebar-bg-active);
  color: var(--color-sidebar-text-active);
}


.session-actions {
  margin-left: auto;
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

/* 状态指示器样式 */
.status-indicator {
  display: flex;
  align-items: center;
  justify-content: center;
}
</style>