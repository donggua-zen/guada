<template>
  <div
    class="sessions-panel flex flex-col  w-full h-full bg-[var(--conversation-bg)] border-r border-[var(--conversation-border-color)]">
    <!-- 修改后的会话头部，包含标题和新建按钮 -->
    <div class="sessions-header px-5 py-5 text-lg font-semibold flex justify-between items-center">
      <span>聊天对话</span>
      <!-- 新建会话按钮移动到右侧 -->
      <n-button @click="handleButtonClick('create')" text size="medium">
        <template #icon>
          <n-icon>
            <ChatNew />
          </n-icon>
        </template>
        新建会话
      </n-button>
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
    <div class="sessions-list flex-1 overflow-hidden py-2.5">
      <scroll-container class="">
        <div @click="handleButtonClick('characters')"
          :class="{ 'bg-[var(--conversation-hover-bg)]': btnActive === 'characters' }"
          class="hover:bg-[var(--conversation-hover-bg)] px-3 py-2 cursor-pointer flex items-center transition-colors duration-200 rounded-2xl mx-2.5 mb-1.5">
          <div class="session-avatar w-4.5 h-4.5 mr-1.5 text-[var(--primary-color)]">
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
            class="group px-3 py-2 cursor-pointer flex items-center transition-colors duration-200 rounded-2xl mx-2.5 mb-1.5"
            :class="{
              'bg-[var(--conversation-active-bg)] font-bold': session.id === currentSessionId,
              'hover:bg-[var(--conversation-hover-bg)]': session.id !== currentSessionId
            }" @click="selectSession(session)">
            <div class="session-avatar w-6 h-6 mr-1.5">
              <Avatar :src="session.avatar_url" round />
            </div>
            <div class="session-info flex-1 min-w-0 flex">
              <div class="session-header flex flex-1 flex-col justify-between items-start min-w-0">
                <div class="session-title truncate text-[15px] text-gray-800 w-full">
                  {{ session.title }}
                </div>
                <div v-if="session.last_message" class="text-xs text-gray-500 whitespace-nowrap" style="display: none;">
                  {{ formatTime(session.last_message.created_at) }}
                </div>
              </div>

              <!-- <div class="session-message text-xs truncate text-gray-500" style="display: none;">
                  {{ session.last_message ? session.last_message.content : '无消息' }}
                </div> -->
              <div
                class="session-actions flex items-center opacity-0 transition-opacity duration-200 group-hover:opacity-100"
                :class="{ 'opacity-100': session.id === currentSessionId }">
                <n-dropdown trigger="click" :options="dropdownOptions" @select="handleDropdownSelect($event, session)">
                  <div @click.stop class="text-gray-500 cursor-pointer flex items-center">
                    <n-icon size="16">
                      <MoreVertOutlined />
                    </n-icon>
                  </div>
                </n-dropdown>
              </div>


            </div>

          </div>
        </template>
      </scroll-container>

    </div>

    <!-- 移除底部的sessions-footer部分 -->
  </div>
</template>

<script setup>
import { ref, computed, h } from 'vue'
import Avatar from './ui/Avatar.vue'
import ScrollContainer from './ui/ScrollContainer.vue'
import { NButton, NDropdown, NIcon, NInput } from 'naive-ui'
import { useDebounceFn } from '@vueuse/core'
import { formatTime } from '@/utils'
import {
  PlusOutlined,
  MoreVertOutlined,
  EditOutlined,
  DeleteOutlineOutlined,
  SearchOutlined,
  AlternateEmailTwotone,
  ArrowForwardIosTwotone as ArrowRightTwotone,
} from '@vicons/material'

import {
  ChatNew
} from '@/components/icons'


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