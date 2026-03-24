<template>
  <div
    class="flex flex-col w-full h-full bg-[var(--color-conversation-bg)] border-r border-[var(--color-conversation-border)] tranistion-all duration-200">
    <!-- 修改后的会话头部，包含标题和新建按钮 -->
    <div class="sessions-header px-4 pt-5 pb-3 flex justify-between items-center">
      <span class="font-semibold text-lg">聊天对话</span>
      <!-- 新建会话按钮移动到右侧 -->
      <el-button type="primary" @click="handleButtonClick('create')" :icon="ChatNew">
        新建会话
      </el-button>
    </div>

    <!-- 搜索框 -->
    <div class="search-box px-3 py-2">
      <el-input v-model="searchKeyword" :prefix-icon="SearchOutlined" placeholder="搜索会话" clearable
        @input="handleSearchInput" class="rounded-full">
      </el-input>
    </div>

    <!-- 会话列表区域 -->
    <div class="sessions-list flex-1 overflow-hidden py-1">
      <ScrollContainer class="">
        <div class="px-6 py-3 text-gray-400 text-sm">对话记录</div>
        <template v-if="filteredSessions.length === 0">
          <div class="empty-state text-center text-gray-500 flex flex-col items-center justify-center h-full">
            <div class="empty-state-icon">
              <el-icon>
                <PlusOutlined />
              </el-icon>
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
            class="group px-3 py-1.5 cursor-pointer flex items-center transition-all duration-200 rounded-lg mx-2.5 mb-1"
            :class="{
              'bg-[var(--color-conversation-bg-active)] font-bold text-[var(--color-conversation-text-active)]': session.id === currentSessionId,
              'hover:bg-[var(--color-conversation-bg-hover)] font-boldhover:text-[var(--color-conversation-text-hover)] text-[var(--color-conversation-text)]': session.id !== currentSessionId
            }" @click="selectSession(session)">
            <div class="session-avatar w-6 h-6 mr-1.5">
              <!-- 优先使用角色的 avatar，如果没有则使用会话的 avatar -->
              <Avatar :src="session.character?.avatar_url || session.avatar_url" round />
            </div>
            <div class="session-info flex-1 min-w-0 flex">
              <div class="session-header flex flex-1 flex-col justify-between items-start min-w-0">
                <div class="session-title truncate text-sm w-full">
                  {{ session.title }}
                </div>
              </div>

              <!-- <div class="session-message text-xs truncate text-gray-500" style="display: none;">
                  {{ session.last_message ? session.last_message.content : '无消息' }}
                </div> -->
              <div
                class="session-actions flex items-center opacity-0 transition-opacity duration-200 group-hover:opacity-100"
                :class="{ 'opacity-100': session.id === currentSessionId }">
                <el-dropdown trigger="click" @command="(command) => handleDropdownSelect(command, session)">
                  <div @click.stop class="cursor-pointer flex items-center">
                    <el-icon>
                      <MoreVertOutlined />
                    </el-icon>
                  </div>
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
                </el-dropdown>
              </div>


            </div>

          </div>
        </template>
      </ScrollContainer>

    </div>

    <!-- 部的footer部分 -->
    <div class="flex items-center justify-between px-3">
      <div @click="handleButtonClick('profile')"
        class="cursor-pointer p-2 rounded-lg flex items-center md:hover:bg-[var(--color-surface)] transition-colors duration-200">
        <div class="w-7 h-7 ">
          <Avatar type="user" :round="true" :src="authStore.user.avatar_url" />
        </div>
        <span class="ml-3">{{ authStore.user.nickname }}</span>
      </div>
      <el-button text v-if="authStore.user.role == 'primary'" :icon="SettingsOutlined"
        @click="handleButtonClick('models')">
        管理模型
      </el-button>

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
  AlternateEmailTwotone,
  ArrowForwardIosTwotone as ArrowRightTwotone,
  SettingsOutlined,
} from '@vicons/material'

import {
  ChatNew
} from '@/components/icons'

// Element Plus 组件导入
import {
  ElButton,
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
  } else if (key === 'profile') {
    router.push({ name: 'Settings', params: { tab: 'profile' } })
  } else if (key === 'models') {
    router.push({ name: 'Settings', params: { tab: 'models' } })
  }
}

const selectSession = (session) => {
  emit('select', session.id)  // 修复：传递 session.id 而不是整个 session 对象
}


</script>

<style scoped>
.session-action-btn:hover {
  color: #4a90e2;
  background-color: #e6f0fa;
}

:deep(.el-input__wrapper) {
  box-shadow: 0 0 0 1px #e5e7eb inset;
}

:deep(.el-input.is-focus .el-input__wrapper) {
  box-shadow: 0 0 0 1px #4f46e5 inset;
}
</style>