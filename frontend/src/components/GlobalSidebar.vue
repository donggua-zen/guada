<template>
  <div class="global-sidebar flex flex-col h-full sidebar-transparent-bg overflow-hidden">
    <!-- 标题栏左侧面板 -->
    <!-- macOS：为系统红绿灯按钮预留左侧空间，避免遮挡 logo/菜单 -->
    <!-- Windows(Electron)：隐藏——logo/图标按钮已移入 MainLayout 的独立标题栏行 -->
    <div v-if="!isElectron || isMac" :class="{ 'mac-sidebar-title-padding': isMac && !isFullscreen }">
      <TitlebarLeftPanel />
    </div>
    <!-- 导航菜单 -->
    <div class="px-2 py-2 space-y-0.5">
      <div v-for="item in navItems" :key="item.key" @click="handleNavClick(item.key)"
        class="nav-item flex items-center gap-1.5 px-2 py-1.5 rounded-lg cursor-pointer transition-all duration-200 ease-in-out"
        :class="currentActiveTab === item.key
          ? 'nav-item-active bg-(--gd-color-sidebar-bg-active) text-(--gd-color-sidebar-text-active)'
          : 'text-(--gd-color-text) hover:bg-(--gd-color-sidebar-bg-hover) hover:text-(--gd-color-sidebar-text-hover)'">
        <component :is="item.icon" class="w-4.5 h-4.5 shrink-0" />
        <span class="text-sm font-medium flex-1 truncate">{{ item.label }}</span>
        <span v-if="item.shortcut"
          class="text-[10px] leading-none font-mono text-gray-400 dark:text-gray-500 select-none">
          {{ item.shortcut }}
        </span>
      </div>
    </div>


    <!-- 分组模式切换：普通分组 / 按工作目录；右侧快捷操作默认隐藏，hover 本行时显示 -->
    <div class="px-2 pb-1 flex items-center gap-1 group/mode-row">
      <SegmentedToggle :model-value="sessionGroupStore.groupingMode" :options="groupingModeOptions"
        variant="ghost" class="flex-1" @update:model-value="handleGroupingModeChange" />
      <div
        class="flex items-center gap-1 shrink-0 opacity-0 pointer-events-none transition-opacity duration-200 group-hover/mode-row:opacity-100 group-hover/mode-row:pointer-events-auto">
        <!-- 全部展开 / 全部收起 -->
        <GdTooltip :content="toggleAllGroupsTooltip" placement="bottom">
          <div class="session-action-trigger hover:bg-(--gd-color-sidebar-bg-hover)" @click="toggleAllGroups">
            <el-icon class="w-4 h-4">
              <ArrowMinimize16Regular v-if="allGroupsExpanded" />
              <ArrowMaximize16Regular v-else />
            </el-icon>
          </div>
        </GdTooltip>
        <!-- 新建分组 / 项目 -->
        <GdTooltip :content="createGroupTooltip" placement="bottom">
          <div class="session-action-trigger hover:bg-(--gd-color-sidebar-bg-hover)"
            @click="handleCreateGroupShortcut">
            <el-icon class="w-4 h-4">
              <FolderAdd16Regular />
            </el-icon>
          </div>
        </GdTooltip>
      </div>
    </div>

    <!-- 会话列表区域 -->
    <div class="flex-1 overflow-hidden py-1">
      <ScrollContainer ref="scrollContainer" class="h-full max-h-full">
        <!-- 按分组展示会话 -->
        <div v-for="group in displayGroups" :key="group.id" class="mb-1">
          <!-- 分组标题栏 -->
          <div
            class="group-header flex items-center justify-between pl-1.5 pr-1 py-1 ml-0 mr-0.5 rounded-md cursor-pointer transition-colors duration-200 select-none group"
            :draggable="isGroupDraggable(group)"
            @dragstart="onGroupDragStart($event, group)" @dragover.prevent="onGroupDragOver($event, group)"
            @drop.prevent="onGroupDrop($event, group)" @dragend="onGroupDragEnd"
            @click="toggleGroupExpand(group.id)">
            <div class="flex items-center gap-1">
              <span class="relative w-4 h-4 shrink-0 flex items-center justify-center">
                <!-- 置顶分区与普通分组同一套"图标 ↔ 箭头"hover 互换约定：
                     图标常显、hover 淡出，箭头只在 hover 时出现（两者都是 absolute inset-0，
                     同时可见就会重叠） -->
                <Pin20Regular v-if="group.id === PINNED_GROUP_ID"
                  class="absolute inset-0 w-4 h-4 transition-opacity duration-200 group-hover:opacity-0 text-(--gd-color-primary)" />
                <GroupIcon v-else :icon="group.icon"
                  class="absolute inset-0 w-4 h-4 transition-opacity duration-200 group-hover:opacity-0 text-(--gd-color-primary)" />
                <!-- <svg class="w-3.5 h-3.5 absolute inset-0 transition-opacity duration-200 group-hover:opacity-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/>
                </svg> -->
                <ChevronDown12Regular class="absolute inset-0 w-4 h-4 transition-all duration-200 opacity-0 group-hover:opacity-100"
                  :class="isGroupExpanded(group.id) ? '' : '-rotate-90'" />
              </span>
              <GdTooltip v-if="group.kind === 'workspace' && group.path" :content="group.path" placement="bottom">
                <span class="text-sm font-medium">{{ group.name }}</span>
              </GdTooltip>
              <span v-else class="text-sm font-medium">{{ getGroupDisplayName(group) }}</span>
            </div>
            <div
              class="flex items-center gap-1 opacity-0 pointer-events-none transition-opacity duration-200 group-hover:opacity-100 group-hover:pointer-events-auto">
              <!-- 分组操作（hover 显示省略号；置顶 / 未分组 / 虚拟「通用」桶无分组级操作） -->
              <DropdownMenu v-if="hasGroupActions(group)"
                @command="(cmd: string) => handleGroupMenuSelect(cmd, group)">
                <div class="session-action-trigger">
                  <el-icon class="w-4 h-4">
                    <MoreHorizontal20Filled />
                  </el-icon>
                </div>
                <template #dropdown>
                  <!-- 目录模式：项目的编辑 / 归档 / 删除 -->
                  <template v-if="sessionGroupStore.groupingMode === 'workspace'">
                    <DropdownMenuItem command="edit-project">
                      <Edit16Regular class="w-4 h-4 mr-2 inline-block" />
                      {{ t('ui.sidebar.editProject') }}
                    </DropdownMenuItem>
                    <DropdownMenuItem command="archive-project">
                      <Archive20Regular class="w-4 h-4 mr-2 inline-block" />
                      {{ t('ui.sidebar.archiveProject') }}
                    </DropdownMenuItem>
                    <DropdownMenuItem command="delete-project">
                      <Delete20Regular class="w-4 h-4 mr-2 inline-block" />
                      {{ t('ui.sidebar.deleteProject') }}
                    </DropdownMenuItem>
                  </template>
                  <!-- 手工分组：重命名 / 归档本分组 / 删除 -->
                  <template v-else>
                    <DropdownMenuItem command="edit-group">
                      <Edit16Regular class="w-4 h-4 mr-2 inline-block" />
                      {{ t('ui.sidebar.editGroup') }}
                    </DropdownMenuItem>
                    <DropdownMenuItem command="archive-group">
                      <Archive20Regular class="w-4 h-4 mr-2 inline-block" />
                      {{ t('ui.sidebar.archiveGroup') }}
                    </DropdownMenuItem>
                    <DropdownMenuItem command="delete">
                      <Delete20Regular class="w-4 h-4 mr-2 inline-block" />
                      {{ t('ui.sidebar.delete') }}
                    </DropdownMenuItem>
                  </template>
                </template>
              </DropdownMenu>

              <!-- 新建会话按钮（hover 显示，与省略号同一套无边框/无底色样式；置顶分区无此操作） -->
              <GdTooltip v-if="group.id !== PINNED_GROUP_ID"
                :content="t('ui.sidebar.newSessionInGroup', { name: getGroupDisplayName(group) })" placement="bottom">
                <div class="session-action-trigger" @click.stop="openNewSession(group)">
                  <el-icon class="w-4 h-4">
                    <CommentAdd16Regular />
                  </el-icon>
                </div>
              </GdTooltip>
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
                class="session-item relative flex items-center gap-[5px] py-1.5 pr-1 pl-2 ml-0 mr-0.5  rounded-md cursor-pointer transition-all duration-200 ease-in-out group"
                :class="{
                  'session-item-active': session.id === currentSessionId,
                  'session-item-inactive': session.id !== currentSessionId
                }" @click="selectSession(session)"
                @mouseenter="hoveredSessionId = session.id"
                @mouseleave="hoveredSessionId = null">
                <!-- 状态指示器：列宽 13px + gap 5px = 18px，标题起点与分组头同为 26px；
                     13px 同时是点阵盒尺寸（ThinkingStatus），保证点阵落在整数像素上 -->
                <div class="status-indicator w-[13px] h-[13px] shrink-0 flex items-center justify-center">
                  <!-- 工作中：TurnItem 同款点阵动画（currentColor 着色，沿用蓝色语义） -->
                  <ThinkingStatus v-if="getSessionWorking(session.id)" :show-text="false" class="text-blue-500" />
                  <div v-else-if="getSessionUnread(session.id) && (session.id !== currentSessionId || windowHidden)"
                    class="w-1 h-1 rounded-full bg-red-500" />
                  <div v-else class="w-1 h-1 rounded-full bg-gray-400 opacity-50" />
                </div>

                <div class="session-info flex-1 min-w-0 flex items-center">
                  <!-- 标题：渐变遮罩 + 整个 item hover 时滚动显示全文（含 more 按钮区） -->
                  <SessionTitle :title="session.title"
                    :actions-visible="session.id === currentSessionId || hoveredSessionId === session.id"
                    :scroll-active="hoveredSessionId === session.id" />
                </div>
                <!-- 状态胶囊：排队数 + 待批。当前会话且窗口可见时卡片/抽屉已在输入区，不重复提醒。
                     mr-6 为右侧「更多」按钮预留（icon 16px + padding 8px + right 2px）→ hover 无跳动 -->
                <div
                  v-if="(getSessionQueuedCount(session.id) > 0 || getSessionAwaiting(session.id)) && (session.id !== currentSessionId || windowHidden)"
                  class="shrink-0 mr-6 flex items-center gap-1">
                  <GdTooltip v-if="getSessionQueuedCount(session.id) > 0"
                    :content="t('ui.sidebar.queuedTooltip', { n: getSessionQueuedCount(session.id) })" placement="right">
                    <span
                      class="inline-flex items-center rounded-full border border-blue-500/35 bg-blue-500/15 px-1.5 text-[11px] leading-4 text-blue-600 dark:text-blue-400">
                      {{ t('ui.sidebar.queuedCount', { n: getSessionQueuedCount(session.id) }) }}
                    </span>
                  </GdTooltip>
                  <GdTooltip v-if="getSessionAwaiting(session.id)" :content="getSessionAwaitingTooltip(session.id)"
                    placement="right">
                    <span
                      class="inline-flex items-center rounded-full border border-amber-500/35 bg-amber-500/15 px-1.5 text-[11px] leading-4 text-amber-600 dark:text-amber-400">
                      {{ getSessionAwaitingLabel(session.id) }}
                    </span>
                  </GdTooltip>
                </div>
                <!-- 操作菜单：绝对定位悬浮于右缘，不占 flex 空间，标题可占满整行 -->
                <div class="session-actions absolute right-0.5 top-1/2 -translate-y-1/2 flex items-center"
                  :class="session.id === currentSessionId
                    ? 'opacity-100 pointer-events-auto'
                    : 'opacity-0 group-hover:opacity-100 group-hover:pointer-events-auto pointer-events-none'">
                  <DropdownMenu @command="(cmd: string) => handleDropdownSelect(cmd, session)">
                    <div class="session-action-trigger">
                      <el-icon class="w-4 h-4">
                        <MoreHorizontal20Filled />
                      </el-icon>
                    </div>
                      <template #dropdown>
                        <DropdownMenuItem command="pin">
                          <Pin20Regular v-if="!session.pinned" class="w-4 h-4 mr-2 inline-block" />
                          <PinOff20Regular v-else class="w-4 h-4 mr-2 inline-block" />
                          {{ session.pinned ? t('ui.sidebar.unpin') : t('ui.sidebar.pin') }}
                        </DropdownMenuItem>
                        <DropdownMenuItem command="rename">
                          <Edit16Regular class="w-4 h-4 mr-2 inline-block" />
                          {{ t('ui.sidebar.rename') }}
                        </DropdownMenuItem>
                        <DropdownMenuItem v-if="sessionGroupStore.groupingMode === 'group'" command="move">
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

              <!-- 分组内加载更多 -->
              <div v-if="groupHasMoreSessions(group.id) || sessionGroupStore.loadingMoreGroupId === group.id"
                class="py-1 px-5 text-left">
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
          class="flex items-center gap-2 p-1.5 rounded-lg cursor-pointer min-w-0 w-full hover:bg-(--gd-color-sidebar-bg-hover) transition-all duration-200">
          <Avatar class="w-7 h-7 shrink-0" type="user" :round="true" :src="authStore.user?.avatarUrl"
            :name="authStore.user?.nickname || authStore.user?.username" />
          <span class="text-sm font-medium text-(--gd-color-text) truncate min-w-0">
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
              <div class="flex items-center gap-0.5 p-0.5 rounded-md bg-(--gd-color-sidebar-bg-active) dark:bg-[#1a1b1e]">
                <button v-for="option in themeOptions" :key="option.value" @click="setTheme(option.value)"
                  class="px-2 py-1 rounded text-xs font-medium transition-all duration-200 flex items-center gap-1"
                  :class="themeMode === option.value
                    ? 'bg-(--gd-color-surface) dark:bg-[#3a3b3f] text-gray-900 dark:text-[#e8e9ed] shadow-sm'
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
            <el-dropdown-item v-if="authStore.passwordSet" command="logout" divided>
              <LogOutOutlined class="w-4 h-4 mr-2" />
              {{ t('ui.sidebar.logout') }}
            </el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>

      <!-- 设置 -->
      <GdTooltip :content="t('ui.sidebar.settings')" placement="bottom">
        <div @click="handleNavClick('setting')"
          class="flex items-center justify-center px-2.5 py-2 rounded-lg cursor-pointer transition-all duration-200 shrink-0"
          :class="currentActiveTab === 'setting'
            ? 'bg-(--gd-color-sidebar-bg-active) text-(--gd-color-sidebar-text-active)'
            : 'text-(--gd-color-text-gray) hover:bg-(--gd-color-sidebar-bg-hover) hover:text-(--gd-color-sidebar-text-hover)'">
          <component :is="Settings16Filled" class="w-4 h-4" />
        </div>
      </GdTooltip>
    </div>
  </div>

  <!-- 删除会话确认对话框 -->
  <GdDialog v-model="deleteDialogVisible" :title="t('ui.sidebar.deleteSessionTitle')" size="sm" :close-on-click-modal="false">
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
  </GdDialog>

  <!-- 移动会话到分组弹窗 -->
  <GdDialog v-model="moveGroupDialogVisible" :title="t('ui.sidebar.selectGroup')" size="xs" :close-on-click-modal="false">
    <div class="space-y-1 py-2">
      <div v-for="(g) in moveGroupOptions" :key="g.value"
        class="flex items-center gap-2 px-3 py-2.5 rounded-lg cursor-pointer transition-all duration-200 text-sm"
        :class="moveSelectedGroupId === g.value ? 'bg-(--gd-color-sidebar-bg-active) text-(--gd-color-sidebar-text-active)' : 'text-(--gd-color-text-gray) hover:bg-(--gd-color-sidebar-bg-hover) hover:text-(--gd-color-sidebar-text-hover)'"
        @click="moveSelectedGroupId = g.value">
        <GroupIcon :icon="g.icon" class="w-4 h-4 shrink-0" />
        <span>{{ g.label }}</span>
      </div>
    </div>
    <template #footer>
      <div class="flex justify-end gap-2">
        <el-button @click="moveGroupDialogVisible = false">{{ t('common.cancel') }}</el-button>
        <el-button type="primary" @click="confirmMoveSession">{{ t('common.ok') }}</el-button>
      </div>
    </template>
  </GdDialog>

  <!-- 分组 / 项目编辑弹窗（名称 + 图标；项目额外展示只读工作目录） -->
  <GroupEditDialog v-model="groupEditDialogVisible" :kind="groupEditKind" :group="groupEditGroup"
    @saved="handleGroupSaved" />

  <!-- Web 模式：新建项目的目录浏览器（Electron 走原生对话框，不渲染） -->
  <DirectoryBrowserDialog v-if="!isElectronEnv" v-model="projectBrowserVisible"
    :title="t('ui.sidebar.createProjectTitle')" @select="handleProjectBrowserSelect" />
</template>

<script setup lang="ts">
import { getApiErrorStatus, getErrorMessage } from '@/utils/errorMessage'
import { NEW_SESSION_ID } from '@/constants'
import { ref, computed, watch, onMounted, markRaw } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter, useRoute } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { useLayoutStore } from '../stores/layout'
import { useSessionStore } from '../stores/session'
import { useWorkflowRunsStore } from '../stores/workflowRuns'
import { useSessionGroupStore, GENERAL_PROJECT_GROUP_ID } from '../stores/sessionGroup'
import { UNGROUPED_ID } from '../stores/session'
import { useTheme, type ThemeMode } from '../composables/useTheme'
import { isMobileDevice } from '../composables/useDevice'
import { usePopup } from '../composables/usePopup'
import { useFullscreen } from '../composables/useFullscreen'
import { Avatar, ScrollContainer, SegmentedToggle } from './ui'
import SessionTitle from './SessionTitle.vue'
import ThinkingStatus from './chat/ThinkingStatus.vue'
import DropdownMenu from './ui/DropdownMenu.vue'
import DropdownMenuItem from './ui/DropdownMenuItem.vue'
import GdTooltip from './ui/GdTooltip.vue'
import GroupEditDialog from './session/GroupEditDialog.vue'
import GroupIcon from './session/GroupIcon.vue'
import GdDialog from '@/components/ui/GdDialog.vue'
import DirectoryBrowserDialog from '@/components/DirectoryBrowserDialog.vue'
import { apiService } from '@/services/ApiService'
import type { Session, SessionGroup, ProjectGroup, SidebarSessionsResponse, SidebarProjectSessionsResponse } from '@/types/session'

import {
  PersonOutlined,
  LogOutOutlined,
} from '@vicons/material'

import {
  Bot20Regular,
  BookSearch20Regular,
  ContactCard20Regular,
  AddSquare20Regular,
  CommentAdd16Regular,
  FolderAdd16Regular,
  ArrowMaximize16Regular,
  ArrowMinimize16Regular,
  ClockAlarm20Regular,
  Apps20Regular,
  Edit16Regular,
  Delete20Regular,
  Folder20Regular,
  Archive20Regular,
  Pin20Regular,
  PinOff20Regular,
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
const isMac = isElectron && window.electronAPI?.platform === 'darwin'

// 全屏（macOS 隐藏红绿灯）时取消为其预留的左侧留白
const { isFullscreen } = useFullscreen()

const router = useRouter()
const route = useRoute()
const authStore = useAuthStore()
const layoutStore = useLayoutStore()
const sessionStore = useSessionStore()
const sessionGroupStore = useSessionGroupStore()
// 工作流 run 缓存（内联卡片/审阅标签共用）：会话删除时按会话释放
const workflowRunsStore = useWorkflowRunsStore()
const { themeMode, setTheme } = useTheme()

const { t } = useI18n()

/**
 * 置顶分区虚拟分组 ID（不对应后端实体，仅用于侧边栏顶部「已置顶」分区渲染）。
 * 会话数据由 sessionStore.getPinnedSessions() 提供，与真实分组区互斥。
 */
const PINNED_GROUP_ID = '__pinned__'
/** 置顶分区折叠态（本地，不落分组 store） */
const pinnedExpanded = ref(true)

/**
 * 侧栏分组渲染项：手工分组、目录分组与虚拟分区共用同一套模板。
 * `kind` 只在目录模式出现（'general' = 虚拟「通用」桶）。
 */
interface SidebarGroupItem {
  id: string
  name: string
  sortOrder: number
  kind?: 'workspace' | 'general'
  path?: string | null
  pathKey?: string | null
  isOverridden?: boolean
  /** 自定义图标 key；虚拟分区为空 */
  icon?: string | null
}

/** 分组模式切换选项（默认保持「普通分组」） */
const groupingModeOptions = computed(() => [
  { label: t('ui.sidebar.groupingByGroup'), value: 'group' },
  { label: t('ui.sidebar.groupingByProject'), value: 'workspace' },
])

/** 新建快捷入口的提示文案随模式变化 */
const createGroupTooltip = computed(() =>
  sessionGroupStore.groupingMode === 'workspace'
    ? t('ui.sidebar.newProject')
    : t('ui.sidebar.newGroup'),
)

/** 是否所有分组都已展开（决定快捷按钮图标：全展开时提供「收起全部」） */
const allGroupsExpanded = computed(() =>
  displayGroups.value.every((group) => isGroupExpanded(group.id)),
)

/** 全部展开 / 全部收起快捷入口的提示文案 */
const toggleAllGroupsTooltip = computed(() =>
  allGroupsExpanded.value
    ? t('ui.sidebar.collapseAllGroups')
    : t('ui.sidebar.expandAllGroups'),
)

/**
 * 全部展开 / 全部收起：与单组折叠保持一致，
 * 收起时丢弃「加载更多」结果并把可见数量缩回首屏数量。
 */
const toggleAllGroups = (): void => {
  const expand = !allGroupsExpanded.value
  for (const group of displayGroups.value) {
    if (group.id === PINNED_GROUP_ID) {
      pinnedExpanded.value = expand
      continue
    }
    if (isGroupExpanded(group.id) === expand) continue
    sessionGroupStore.setExpand(group.id, expand)
    if (!expand) {
      groupCollapseEpoch.set(group.id, (groupCollapseEpoch.get(group.id) ?? 0) + 1)
      sessionStore.resetGroupPagination(group.id, initialPageSize.value)
    }
  }
}

/**
 * 新建分组/项目快捷入口：
 * - 普通分组模式 → 输入名称后创建手工分组
 * - 目录模式 → 选择目录并注册为项目（Web 用目录浏览器对话框，Electron 用原生选择框）
 */
const handleCreateGroupShortcut = async () => {
  if (sessionGroupStore.groupingMode === 'workspace') {
    await handleCreateProject()
  } else {
    await handleCreateManualGroup()
  }
}

const handleCreateManualGroup = async () => {
  openGroupEditDialog('group', null)
}

const isElectronEnv = typeof window !== 'undefined' && !!window.electronAPI
const projectBrowserVisible = ref(false)

const handleCreateProject = async () => {
  if (!(isElectronEnv && window.electronAPI?.selectFolder)) {
    // Web 模式：打开目录浏览器，选择结果经 handleProjectBrowserSelect 完成注册
    projectBrowserVisible.value = true
    return
  }
  let selectedPath: string | null = null
  try {
    selectedPath = await window.electronAPI.selectFolder()
  } catch (error) {
    console.error('选择目录失败:', error)
    toast.error(t('ui.sidebar.createProjectFailed'))
    return
  }
  if (!selectedPath) return
  await registerProjectGroup(selectedPath)
}

async function handleProjectBrowserSelect(path: string) {
  await registerProjectGroup(path)
}

async function registerProjectGroup(selectedPath: string) {
  const result = await sessionGroupStore.createProjectGroup(selectedPath)
  if (!result.success) {
    toast.error(getErrorMessage(result.error) || t('ui.sidebar.createProjectFailed'))
    return
  }
  toast.success(t('ui.sidebar.projectCreated'))
  await loadSessions()
}

/** 切换模式后重新拉取（两种模式的桶 id 不重叠，共享数据源无需清空） */
const handleGroupingModeChange = async (value: string | number | boolean) => {
  const mode = value === 'workspace' ? 'workspace' : 'group'
  if (mode === sessionGroupStore.groupingMode) return
  sessionGroupStore.groupingMode = mode
  await loadSessions()
}

/** 目录模式拖拽状态（原生 HTML5 DnD，与工作区 tab 一致） */
let dragSourceGroupId: string | null = null

const themeOptions = computed(() => [
  { label: t('ui.sidebar.themeLight'), value: 'light' as ThemeMode, icon: markRaw(WeatherSunny20Regular) },
  { label: t('ui.sidebar.themeDark'), value: 'dark' as ThemeMode, icon: markRaw(WeatherMoon20Filled) },
  { label: t('ui.sidebar.themeSystem'), value: 'system' as ThemeMode, icon: markRaw(Desktop16Regular) },
])
const { toast, prompt, confirm } = usePopup()

// 删除会话确认对话框状态
const deleteDialogVisible = ref(false)
const deleteSessionData = ref<Session | null>(null)
const deleteWorkspaceChecked = ref(false)

// 移动会话到分组弹窗状态
const moveGroupDialogVisible = ref(false)
const moveGroupOptions = ref<{ label: string; value: string; icon: string | null }[]>([])
const moveSelectedGroupId = ref('')
const moveTargetSession = ref<Session | null>(null)

// 是否正在初始化加载
const isInitializing = ref(false)

/** 首屏每组加载条数（折叠分组时把可见数量重置回该值） */
const initialPageSize = ref(window.innerHeight > 1080 ? 15 : 10)

/** 分组折叠代数：用于丢弃请求期间被折叠的「加载更多」结果 */
const groupCollapseEpoch = new Map<string, number>()

/** 分组是否有分组级操作（置顶 / 未分组 / 虚拟「通用」桶没有） */
const hasGroupActions = (group: SidebarGroupItem): boolean =>
  group.id !== PINNED_GROUP_ID &&
  group.id !== UNGROUPED_ID &&
  group.kind !== 'general'

/** 分组省略号菜单（手工分组：重命名/删除；目录分组：编辑/归档/删除） */
const handleGroupMenuSelect = (command: string, group: SidebarGroupItem): void => {
  if (sessionGroupStore.groupingMode === 'workspace') {
    if (command === 'edit-project') void handleEditProjectGroup(group)
    else if (command === 'archive-project') void handleArchiveProjectGroup(group)
    else if (command === 'delete-project') void handleDeleteProjectGroup(group)
    return
  }
  if (command === 'edit-group') void handleEditManualGroup(group)
  else if (command === 'archive-group') void handleArchiveGroup(group)
  else if (command === 'delete') void handleDeleteGroup(group)
}

// 打开新建会话面板，指定分组
const openNewSession = (group: SidebarGroupItem) => {
  const query: Record<string, string> = {}
  if (sessionGroupStore.groupingMode === 'workspace') {
    // 目录模式：在该目录下建会话；「通用」桶不指定目录（走后端自动生成）
    if (group.kind === 'workspace' && group.path) {
      query.workspacePath = group.path
    }
  } else if (group.id !== UNGROUPED_ID) {
    query.groupId = group.id
  }
  // 已在新会话页面时只更新 query 参数，不重新导航
  router.replace({ name: 'Chat', params: { sessionId: NEW_SESSION_ID }, query })
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
    key: 'agents',
    label: t('ui.sidebar.navAgents'),
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
  }
])

// 当前激活的 tab（根据路由）
const currentActiveTab = computed(() => {
  const routeName = route.name as string
  if (routeName === 'Chat') {
    // 仅在新建会话时高亮"新建任务"，查看已有会话时不高亮
    const sessionId = route.params.sessionId
    const sessionIdStr = Array.isArray(sessionId) ? sessionId[0] : sessionId
    return sessionIdStr === NEW_SESSION_ID ? 'chat' : ''
  }
  if (routeName === 'Agents') return 'agents'
  if (routeName === 'Bots') return 'bots'
  if (routeName === 'SystemSettings') return 'setting'
  if (routeName === 'KnowledgeBase') return 'knowledge-base'
  if (routeName === 'Plugins') return 'plugins'
  if (routeName === 'Scheduler') return 'scheduler'
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

/** 分组显示名：虚拟「通用」桶走 i18n，其余用实体名 */
const getGroupDisplayName = (group: SidebarGroupItem): string => {
  if (group.kind === 'general') return t('ui.sidebar.projectGeneral')
  return group.name
}

// 展示的分组列表（手工分组 / 目录分组 + 虚拟置顶与通用桶）
const displayGroups = computed((): SidebarGroupItem[] => {
  const workspaceMode = sessionGroupStore.groupingMode === 'workspace'
  const groups: SidebarGroupItem[] = workspaceMode
    ? [...sessionGroupStore.sortedProjectGroups]
    : [...sessionGroupStore.sortedGroups]

  // 置顶分区：跨分组聚合，固定在最顶部；无置顶会话时整段不渲染
  if (sessionStore.getPinnedSessions().length > 0) {
    groups.unshift({
      id: PINNED_GROUP_ID,
      name: t('ui.sidebar.pinnedSection'),
      sortOrder: -1
    })
  }

  if (workspaceMode) {
    // 「通用」桶已由 store 追加在末尾（sortOrder 为最大值）
    return groups
  }

  // 手工分组模式：始终在最后添加未分组
  groups.push({
    id: UNGROUPED_ID,
    name: t('ui.sidebar.taskList'),
    sortOrder: groups.length
  })
  return groups
})

// 获取分组内的会话（从 sessionStore 统一数据源获取，受分页可见窗口截断）
const getGroupSessions = (groupId: string): Session[] => {
  if (groupId === PINNED_GROUP_ID) return sessionStore.getPinnedSessions()
  if (sessionGroupStore.groupingMode === 'workspace') {
    return sessionStore.getVisibleSessionsByProjectGroup(
      groupId,
      sessionGroupStore.projectGroups,
    )
  }
  const groupIdParam = groupId === UNGROUPED_ID ? null : groupId
  return sessionStore.getVisibleSessionsByGroup(groupIdParam)
}

// ===== 目录分组拖拽排序（原生 HTML5 DnD；只有真实目录分组可拖） =====
const isGroupDraggable = (group: SidebarGroupItem): boolean =>
  sessionGroupStore.groupingMode === 'workspace' && group.kind === 'workspace'

const onGroupDragStart = (event: DragEvent, group: SidebarGroupItem): void => {
  if (!isGroupDraggable(group)) return
  dragSourceGroupId = group.id
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', group.id)
  }
}

const onGroupDragOver = (event: DragEvent, group: SidebarGroupItem): void => {
  if (!dragSourceGroupId || !isGroupDraggable(group) || group.id === dragSourceGroupId) return
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
}

const onGroupDrop = async (event: DragEvent, target: SidebarGroupItem): Promise<void> => {
  const sourceId = dragSourceGroupId
  dragSourceGroupId = null
  if (!sourceId || !isGroupDraggable(target) || sourceId === target.id) return
  event.preventDefault()

  const orderedIds = sessionGroupStore.sortedProjectGroups
    .filter((g) => g.kind === 'workspace')
    .map((g) => g.id)
  const from = orderedIds.indexOf(sourceId)
  const to = orderedIds.indexOf(target.id)
  if (from === -1 || to === -1) return
  orderedIds.splice(to, 0, orderedIds.splice(from, 1)[0])
  await sessionGroupStore.reorderProjectGroups(orderedIds)
}

const onGroupDragEnd = (): void => {
  dragSourceGroupId = null
}

// 分组是否展开（置顶分区用独立本地折叠态，不落分组 store）
const isGroupExpanded = (groupId: string): boolean => {
  if (groupId === PINNED_GROUP_ID) return pinnedExpanded.value
  if (groupId === UNGROUPED_ID) {
    return sessionGroupStore.isExpanded(UNGROUPED_ID)
  }
  return sessionGroupStore.isExpanded(groupId)
}

// 切换分组展开/折叠
const toggleGroupExpand = (groupId: string): void => {
  if (groupId === PINNED_GROUP_ID) {
    pinnedExpanded.value = !pinnedExpanded.value
    return
  }
  const wasExpanded = isGroupExpanded(groupId)
  sessionGroupStore.toggleExpand(groupId)
  if (wasExpanded) {
    // 折叠即丢弃「加载更多」出来的会话：可见数量缩回首屏数量
    groupCollapseEpoch.set(groupId, (groupCollapseEpoch.get(groupId) ?? 0) + 1)
    sessionStore.resetGroupPagination(groupId, initialPageSize.value)
  }
}

// 分组是否还有更多会话（置顶分区不分页）
const groupHasMoreSessions = (groupId: string): boolean => {
  if (groupId === PINNED_GROUP_ID) return false
  return sessionStore.groupHasMore(groupId)
}

// 初始化加载所有分组的前N个会话（单次请求获取分组+各分组会话）
const loadSessions = async () => {
  isInitializing.value = true
  try {
    const pageSize = window.innerHeight > 1080 ? 15 : 10
    initialPageSize.value = pageSize
    const workspaceMode = sessionGroupStore.groupingMode === 'workspace'
    // 分组区与置顶区并行拉取（置顶失败不拖垮主列表）
    const [data, pinnedData] = await Promise.all([
      workspaceMode
        ? apiService.fetchSidebarSessions(pageSize, 'workspace')
        : apiService.fetchSidebarSessions(pageSize),
      apiService
        .fetchPinnedSessions()
        .catch(() => ({ items: [] as Session[] })),
    ])

    // 设置分组列表（两种模式的实体互不干扰）
    if (workspaceMode) {
      sessionGroupStore.setProjectGroups(
        (data as SidebarProjectSessionsResponse).groups || [],
      )
    } else {
      sessionGroupStore.setGroups((data as SidebarSessionsResponse).groups || [])
    }

    // 置顶会话写入统一数据源（「已置顶」分区由 sessionsMap 派生）
    for (const session of pinnedData?.items || []) {
      sessionStore.setSession(session)
      if (session.isStreaming) {
        sessionStore.syncStreamingState(session.id, true)
      }
    }

    // 处理各分组的会话
    for (const gs of data.groupSessions || []) {
      const storeGroupId = workspaceMode
        ? (gs.groupId ?? GENERAL_PROJECT_GROUP_ID)
        : (gs.groupId === null ? UNGROUPED_ID : gs.groupId)
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

  const workspaceMode = sessionGroupStore.groupingMode === 'workspace'
  const currentSessions = getGroupSessions(groupId)
  const collapseEpoch = groupCollapseEpoch.get(groupId) ?? 0

  sessionGroupStore.setLoadingMore(groupId)
  try {
    const data = workspaceMode
      ? await apiService.fetchSessions(
          currentSessions.length,
          15,
          undefined,
          undefined,
          false,
          groupId,
        )
      : await apiService.fetchSessions(
          currentSessions.length,
          15,
          groupId === UNGROUPED_ID ? null : groupId,
        )

    // 请求期间分组被折叠：本页按丢弃处理，展开后仍只保留首屏数量
    if ((groupCollapseEpoch.get(groupId) ?? 0) !== collapseEpoch) {
      sessionStore.setHasMore(groupId, (data.items?.length || 0) > 0)
      return
    }

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

// 侧边栏状态辅助方法
// 当前 hover 的会话 id（用于控制标题渐隐区扩大，给更多按钮腾空间）
const hoveredSessionId = ref<string | null>(null)

const getSessionUnread = (sessionId: string): boolean => {
  return sessionStore.getSidebarFlag(sessionId, 'unread')
}

const getSessionWorking = (sessionId: string): boolean => {
  return sessionStore.getSidebarFlag(sessionId, 'working')
}

/** 该会话是否有未应答的交互卡（审批/询问）。渲染路径必须走 peek（不建缓存，见 store 注释） */
const getSessionAwaiting = (sessionId: string): boolean => {
  return sessionStore.peekSessionPendingAskQueue(sessionId).length > 0
}

/** 排队消息数（渲染路径走 peek，不创建缓存） */
const getSessionQueuedCount = (sessionId: string): number => {
  return sessionStore.peekQueueCount(sessionId)
}

/** 待答数量（>1 时胶囊提示还有几个在排队） */
const getSessionAwaitingCount = (sessionId: string): number => {
  return sessionStore.peekSessionPendingAskQueue(sessionId).length
}

/** 胶囊文案：审批 → 待批准；询问 → 待回复 */
const getSessionAwaitingLabel = (sessionId: string): string => {
  return sessionStore.peekSessionPendingAsk(sessionId)?.kind === 'ask'
    ? t('ui.sidebar.awaitingReply')
    : t('ui.sidebar.awaitingApproval')
}

/** 胶囊提示：优先显示卡片标题（「计划审批」「命令需要批准」…）；排队多个时显示数量 */
const getSessionAwaitingTooltip = (sessionId: string): string => {
  const count = getSessionAwaitingCount(sessionId)
  if (count > 1) return t('ui.sidebar.awaitingTooltipCount', { n: count })
  const ask = sessionStore.peekSessionPendingAsk(sessionId)
  return ask?.title
    ? t('ui.sidebar.awaitingTooltipWithTitle', { title: ask.title })
    : t('ui.sidebar.awaitingTooltip')
}

// 选择会话
const selectSession = (session: Session) => {
  // 进入会话时标记为已读
  sessionStore.setSidebarFlag(session.id, 'unread', false)
  router.replace({ name: 'Chat', params: { sessionId: session.id } })
  // 移动端抽屉：选择会话后自动收起侧栏（桌面并排布局不受影响）
  if (isMobileDevice) layoutStore.setSidebarVisible(false)
}

// 处理导航点击
const handleNavClick = (tab: string) => {
  // 移动端抽屉：导航跳转后自动收起侧栏
  if (isMobileDevice) layoutStore.setSidebarVisible(false)
  if (tab === 'chat') {
    router.replace({ name: 'Chat', params: { sessionId: NEW_SESSION_ID } })
  } else if (tab === 'agents') {
    router.replace({ name: 'Agents' })
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
  }
}

// 处理会话下拉菜单选择
const handleDropdownSelect = (command: string, session: Session) => {
  if (command === 'pin') {
    handlePinSession(session)
  } else if (command === 'rename') {
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
 * 置顶 / 取消置顶会话
 *
 * 乐观更新：先本地改（侧边栏「已置顶」分区立即响应），再落后端；失败回滚 + 报错。
 * 本窗口自己发起的变更不会被自身 SSE 回环覆盖（useSessionEvents 过滤 source===self），
 * 因此本地更新是必需的而非可选优化。
 * 无二次确认——与 zcode 的 pin 语义一致（归档才有确认）。
 */
const handlePinSession = async (session: Session) => {
  const next = !session.pinned
  sessionStore.setSessionPinned(session.id, next)
  try {
    await apiService.updateSession(session.id, { pinned: next })
    toast.success(next ? t('ui.sidebar.pinned') : t('ui.sidebar.unpinned'))
  } catch (error) {
    // 回滚到原状态
    sessionStore.setSessionPinned(session.id, !next)
    console.error('置顶会话失败:', error)
    toast.error(t('ui.sidebar.pinFailed'))
  }
}

/**
 * 归档会话
 */
const handleArchiveSession = async (session: Session) => {
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
        router.replace({ name: 'Chat', params: { sessionId: NEW_SESSION_ID } })
      }
      toast.success(t('ui.sidebar.archived'))
    }
  } catch (error) {
    console.error('归档失败:', error)
    toast.error(getErrorMessage(error) || t('ui.sidebar.archiveFailed'))
  }
}

/**
 * 移动会话到分组
 */
const handleMoveSession = (session: Session) => {
  // 构建分组选项，顺序与侧边栏一致
  const groupOptions = sessionGroupStore.groups.map(g => ({
    label: g.name,
    value: g.id,
    icon: g.icon ?? null,
  }))
  groupOptions.push({ label: t('ui.sidebar.ungrouped'), value: UNGROUPED_ID, icon: null })

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
 * 编辑手工分组：打开弹窗（名称 + 图标）
 */
const handleEditManualGroup = (group: SidebarGroupItem) => {
  const target = sessionGroupStore.groups.find((g) => g.id === group.id)
  if (!target) return
  openGroupEditDialog('group', target)
}

/**
 * 删除分组
 */
const handleDeleteGroup = async (group: SidebarGroupItem) => {
  try {
    const confirmed = await confirm(t('ui.sidebar.deleteGroupTitle'), t('ui.sidebar.deleteGroupConfirm', { name: group.name }), {
      type: 'warning',
      confirmText: t('common.delete'),
      cancelText: t('common.cancel')
    })

    if (confirmed) {
      // 将该分组下的所有会话移到未分组（统一数据源中批量更新）。
      // 注意：不能只遍历 getSessionsByGroup（它排除了置顶项）——置顶会话同样属于该分组，
      // 后端 deleteGroup 会一并解绑，本地必须同步，否则取消置顶后会"消失"。
      for (const s of sessionStore.sessionsMap.values()) {
        if (s.groupId === group.id) s.groupId = null
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
 * 归档本分组：归档组内全部对话（流式输出中的跳过），分组行保留。
 * 归档后分组仍显示在侧栏（暂无任务），与目录分组的「归档项目」不同。
 */
const handleArchiveGroup = async (group: SidebarGroupItem) => {
  let total = 0
  try {
    total = (await apiService.fetchSessionGroupStats(group.id)).total
  } catch (error) {
    console.warn('获取分组统计失败:', error)
  }

  const confirmed = await confirm(
    t('ui.sidebar.archiveGroupTitle'),
    t('ui.sidebar.archiveGroupConfirm', { name: group.name, count: total }),
    {
      type: 'warning',
      confirmText: t('ui.sidebar.archiveGroup'),
      cancelText: t('common.cancel')
    }
  )
  if (!confirmed) return

  const result = await sessionGroupStore.archiveGroup(group.id)
  if (!result.success) {
    toast.error(t('ui.sidebar.archiveGroupFailed'))
    return
  }

  // 归档是服务端状态变更：按返回的 id 清理本地缓存，避免它们继续以活跃态展示
  const archivedIds = new Set(result.sessionIds)
  for (const id of archivedIds) {
    sessionStore.removeSession(id)
    sessionStore.clearSidebarState(id)
  }
  if (currentSessionId.value && archivedIds.has(currentSessionId.value)) {
    router.replace({ name: 'Chat', params: { sessionId: NEW_SESSION_ID } })
  }

  await loadSessions()
  toast.success(t('ui.sidebar.groupArchived', { count: result.archived }))
  if (result.skipped > 0) {
    toast.warning(t('ui.sidebar.groupArchiveSkipped', { count: result.skipped }))
  }
}

/** 分组 / 项目编辑弹窗状态（group = null 表示新建手工分组） */
const groupEditDialogVisible = ref(false)
const groupEditKind = ref<'group' | 'project'>('group')
const groupEditGroup = ref<SessionGroup | ProjectGroup | null>(null)

const openGroupEditDialog = (
  kind: 'group' | 'project',
  group: SessionGroup | ProjectGroup | null,
) => {
  groupEditKind.value = kind
  groupEditGroup.value = group
  groupEditDialogVisible.value = true
}

/**
 * 编辑项目：打开弹窗（名称 + 图标，工作目录只读展示）
 */
const handleEditProjectGroup = (group: SidebarGroupItem) => {
  const target = sessionGroupStore.projectGroups.find((g) => g.id === group.id)
  if (!target) return
  openGroupEditDialog('project', target)
}

const handleGroupSaved = async () => {
  await loadSessions()
}

/**
 * 归档项目：确认后归档其下全部对话（流式输出中的跳过，分组随后从侧栏消失）
 */
const handleArchiveProjectGroup = async (group: SidebarGroupItem) => {
  let total = 0
  try {
    total = (await apiService.fetchProjectGroupStats(group.id)).total
  } catch (error) {
    // 统计失败不阻断操作，确认文案退化为「其下全部对话」
    console.warn('获取项目统计失败:', error)
  }

  const confirmed = await confirm(
    t('ui.sidebar.archiveProjectTitle'),
    t('ui.sidebar.archiveProjectConfirm', { name: getGroupDisplayName(group), count: total }),
    {
      type: 'warning',
      confirmText: t('ui.sidebar.archiveProject'),
      cancelText: t('common.cancel')
    }
  )
  if (!confirmed) return

  const result = await sessionGroupStore.archiveProjectGroup(group.id)
  if (!result.success) {
    toast.error(t('ui.sidebar.archiveProjectFailed'))
    return
  }

  // 归档是服务端状态变更：本地缓存不会自动变成 archived，必须按返回的 id
  // 移除，否则在取消归档前它们仍会以「活跃」状态留在分组里。
  const archivedIds = new Set(result.sessionIds)
  for (const id of archivedIds) {
    sessionStore.removeSession(id)
    sessionStore.clearSidebarState(id)
  }
  if (currentSessionId.value && archivedIds.has(currentSessionId.value)) {
    router.replace({ name: 'Chat', params: { sessionId: NEW_SESSION_ID } })
  }

  sessionStore.resetGroupPagination(group.id, initialPageSize.value)
  await loadSessions()
  toast.success(t('ui.sidebar.projectArchived', { count: result.archived }))
  if (result.skipped > 0) {
    toast.warning(t('ui.sidebar.projectArchiveSkipped', { count: result.skipped }))
  }
}

/**
 * 删除项目：永久删除其下全部对话，再移除分组行。
 * 工作目录与文件保留；任一会话流式输出时整体拒绝（409），不做部分删除。
 */
const handleDeleteProjectGroup = async (group: SidebarGroupItem) => {
  let total = 0
  try {
    total = (await apiService.fetchProjectGroupStats(group.id)).total
  } catch (error) {
    console.warn('获取项目统计失败:', error)
  }

  const confirmed = await confirm(
    t('ui.sidebar.deleteProjectTitle'),
    t('ui.sidebar.deleteProjectConfirm', { name: getGroupDisplayName(group), count: total }),
    {
      type: 'error',
      danger: true,
      confirmText: t('ui.sidebar.deleteProject'),
      cancelText: t('common.cancel')
    }
  )
  if (!confirmed) return

  const result = await sessionGroupStore.deleteProjectGroup(group.id)
  if (!result.success) {
    toast.error(
      getApiErrorStatus(result.error) === 409
        ? t('ui.sidebar.projectDeleteStreaming')
        : t('ui.sidebar.deleteProjectFailed')
    )
    return
  }

  // 精确清理本地缓存：后端返回的顶层会话 + 同目录下的其它已加载会话（置顶/子会话）
  const affectedIds = new Set(result.sessionIds)
  if (group.pathKey) {
    for (const [id, session] of sessionStore.sessionsMap) {
      if (session.workspaceKey === group.pathKey) affectedIds.add(id)
    }
  }
  for (const id of affectedIds) {
    sessionStore.removeSession(id)
    sessionStore.clearSidebarState(id)
    workflowRunsStore.clearSession(id)
  }
  if (currentSessionId.value && affectedIds.has(currentSessionId.value)) {
    router.replace({ name: 'Chat', params: { sessionId: NEW_SESSION_ID } })
  }

  sessionStore.resetGroupPagination(group.id, initialPageSize.value)
  await loadSessions()
  toast.success(t('ui.sidebar.projectDeleted', { count: result.deleted }))
}

/**
 * 重命名会话
 * 显示输入新名称的提示框，更新会话标题
 */
const handleRenameSession = async (session: Session) => {
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
const handleDeleteSession = async (session: Session) => {
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
      const secondConfirm = await confirm(
        t('ui.sidebar.importantWarning'),
        t('ui.sidebar.workspaceDeleteWarning'),
        {
          type: 'error',
          confirmText: t('ui.sidebar.confirmDelete'),
          cancelText: t('common.cancel'),
          danger: true,
        }
      )

      if (!secondConfirm) {
        // 用户取消了二次确认，不执行删除
        return
      }
    }

    // 传递 deleteWorkspace 参数
    await apiService.deleteSession(session.id, deleteWorkspaceChecked.value)

    // 如果删除的是当前会话，自动切换到相邻会话
    if (currentSessionId.value === session.id) {
      router.replace({ name: 'Chat', params: { sessionId: NEW_SESSION_ID } })
    }
    sessionStore.removeSession(session.id)
    sessionStore.clearSidebarState(session.id)
    // 工作流 run 缓存随会话删除释放（内联卡片/审阅标签共用 store）
    workflowRunsStore.clearSession(session.id)
    toast.success(t('ui.sidebar.sessionDeleted'))

    // 关闭对话框
    deleteDialogVisible.value = false
    deleteSessionData.value = null
  } catch (error) {
    console.error('删除对话失败:', error)
    // 运行中禁止删除（后端 409 SESSION_STREAMING）：给出可操作的专用提示，而非笼统失败
    // 探测原生 AxiosError 形态（拦截器产物 ApiError/AuthError 无 response 字段），此处用类型化形状断言，运行时行为不变
    const axiosLike = error as { response?: { status?: number; data?: { code?: string } } } | undefined
    const status = axiosLike?.response?.status
    const code = axiosLike?.response?.data?.code
    if (status === 409 || code === 'SESSION_STREAMING') {
      toast.error(t('ui.sidebar.deleteSessionStreaming'))
    } else {
      toast.error(t('ui.sidebar.deleteSessionFailed'))
    }
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
</script>

<style scoped>
/* 分组头与子项共用同一套 hover 语义（色值与 .session-item-inactive:hover 一致） */
.group-header {
  color: var(--gd-color-text);
}

.group-header:hover {
  background-color: var(--gd-color-sidebar-bg-hover);
  color: var(--gd-color-sidebar-text-hover);
}

/* 会话项样式 */
.session-item-inactive {
  color: var(--gd-color-text);
}

.session-item-inactive:hover {
  background-color: var(--gd-color-sidebar-bg-hover);
  color: var(--gd-color-sidebar-text-hover);
}

.session-item-active {
  background-color: var(--gd-color-sidebar-bg-active);
  color: var(--gd-color-sidebar-text-active);
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

/* macOS：红绿灯按钮占左上角约 70px，标题行左侧留白避免遮挡 */
.mac-sidebar-title-padding {
  padding-left: 78px;
}
</style>
