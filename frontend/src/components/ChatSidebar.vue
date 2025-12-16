<template>
  <div
    class="sessions-panel flex flex-col  w-full h-full bg-[var(--color-conversation-bg)] border-r border-[var(--color-conversation-border)]">
    <!-- 修改后的会话头部，包含标题和新建按钮 -->
    <div class="sessions-header px-5 pt-5 pb-3 text-lg font-semibold flex justify-between items-center">
      <span>聊天对话</span>
      <!-- 新建会话按钮移动到右侧 -->
      <UiButton type="default" :border="false" @click="handleButtonClick('create')" class="text-sm">
        <template #icon>
          <ChatNew />
        </template>
        新建会话
      </UiButton>
    </div>

    <!-- 搜索框 -->
    <div class="search-box px-3 py-2">
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
    <div class="sessions-list flex-1 overflow-hidden py-1">
      <ScrollContainer class="">
        <div @click="handleButtonClick('characters')" :class="{
          'hover:bg-[var(--color-conversation-bg-hover)] text-[var(--color-conversation-text)]': btnActive !== 'characters',
          'bg-[var(--color-conversation-bg-active)] font-bold text-[var(--color-conversation-text-active)]': btnActive === 'characters',
        }" class="px-3 py-2 cursor-pointer flex items-center transition-colors duration-200 rounded-lg mx-2.5 mb-1.5">
          <div class="session-avatar w-4.5 h-4.5 mr-1.5 text-[var(--color-primary)]">
            <AlternateEmailTwotone />
          </div>
          <span class="flex-1">角色提示词模板</span>
          <div class="session-avatar w-3 h-3 ml-1.5 text-gray-400">
            <ArrowRightTwotone />
          </div>
        </div>
        <div class="px-6 py-3 text-gray-400">对话记录</div>
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
            class="group px-3 py-1.5 cursor-pointer flex items-center transition-colors duration-200 rounded-lg mx-2.5 mb-1"
            :class="{
              'bg-[var(--color-conversation-bg-active)] text-[var(--color-conversation-text-active)]': session.id === currentSessionId,
              'hover:bg-[var(--color-conversation-bg-hover)] hover:text-[var(--color-conversation-text-hover)] text-[var(--color-conversation-text)]': session.id !== currentSessionId
            }" @click="selectSession(session)">
            <div class="session-avatar w-6 h-6 mr-1.5">
              <Avatar :src="session.avatar_url" round />
            </div>
            <div class="session-info flex-1 min-w-0 flex">
              <div class="session-header flex flex-1 flex-col justify-between items-start min-w-0">
                <div class="session-title truncate text-[14px] w-full">
                  {{ session.title }}
                </div>
              </div>

              <!-- <div class="session-message text-xs truncate text-gray-500" style="display: none;">
                  {{ session.last_message ? session.last_message.content : '无消息' }}
                </div> -->
              <div
                class="session-actions flex items-center opacity-0 transition-opacity duration-200 group-hover:opacity-100"
                :class="{ 'opacity-100': session.id === currentSessionId }">
                <n-dropdown trigger="click" :options="dropdownOptions" @select="handleDropdownSelect($event, session)">
                  <div @click.stop class="cursor-pointer flex items-center">
                    <n-icon size="16">
                      <MoreVertOutlined />
                    </n-icon>
                  </div>
                </n-dropdown>
              </div>


            </div>

          </div>
        </template>
      </ScrollContainer>

    </div>

    <!-- 部的footer部分 -->
    <div class="flex items-center justify-between px-3">
      <div @click="handleButtonClick('profile')"
        class="cursor-pointer p-2 rounded-lg flex items-center hover:bg-[var(--color-conversation-bg-hover)] transition-colors duration-200">
        <div class="w-7 h-7 ">
          <Avatar type="user" :round="true" :src="authStore.user.avatar_url" />
        </div>
        <span class="ml-3">{{ authStore.user.nickname }}</span>
      </div>
      <div v-if="authStore.user.role == 'primary'" @click="handleButtonClick('models')"
        class="cursor-pointer h-6.5 px-2 rounded-lg flex justify-center items-center hover:bg-[var(--color-conversation-bg-hover)] transition-colors duration-200">
        <SettingsOutlined class="w-4.5 h-4.5 text-gray-500" />
        <span class="ml-1 text-base text-gray-500">管理模型</span>
      </div>

    </div>

  </div>
</template>

<script setup>
import { ref, computed, h } from 'vue'
import { ScrollContainer, UiButton, Avatar } from './ui'
import { NDropdown, NIcon, NInput } from 'naive-ui'
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

const authStore = useAuthStore()

// 响应式数据
const currentSessionId = computed(() => props.current?.id)
const searchKeyword = ref('')

// 事件定义
const emit = defineEmits(['select', 'rename', 'btn-click', 'delete'])

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
const handleButtonClick = (key) => {
  emit('btn-click', key)
}

const selectSession = (session) => {
  emit('select', session)
}


</script>

<style scoped>
.session-action-btn:hover {
  color: #4a90e2;
  background-color: #e6f0fa;
}
</style>