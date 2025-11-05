<template>
  <div
    class="sessions-panel flex flex-col w-72 min-w-72 h-screen bg-[var(--conversation-bg)] border-r border-[var(--conversation-border-color)] ">
    <div class="sessions-header px-5 py-5 text-lg font-semibold flex justify-between items-center">
      <span>会话列表</span>
    </div>
    <div class="sessions-list flex-1 overflow-y-auto py-2.5">
      <template v-if="sortedSessions.length === 0">
        <div class="empty-state text-center text-gray-500 flex flex-col items-center justify-center h-full">
          <div class="empty-state-icon">
            <n-icon>
              <PlusOutlined />
            </n-icon>
          </div>
          <div class="empty-state-title">没有会话</div>
          <div class="empty-state-description">点击下方按钮创建新的会话</div>
        </div>
      </template>
      <template v-else>
        <div v-for="session in sortedSessions" :key="session.id"
          class="session-item group px-3.5 py-3 cursor-pointer flex items-center transition-colors duration-200 rounded-xl mx-2.5 mb-1.5 h-15"
          :class="{
            'bg-[var(--conversation-active-bg)]': session.id === currentSessionId,
            'hover:bg-[var(--conversation-hover-bg)]': session.id !== currentSessionId
          }" @click="selectSession(session.id)">
          <div class="session-avatar w-9 h-9 mr-2.5">
            <Avatar :src="session.avatar_url" round />
          </div>
          <div class="session-info flex-1 min-w-0">
            <div class="session-title font-medium text-sm truncate text-gray-800">{{ session.title }}</div>
          </div>
          <!-- 修改这里：添加 group-hover 类 -->
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
    </div>
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
import { ref, onMounted, computed, watch, reactive, h } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { store } from '../store/store'
import Avatar from '../components/Avatar.vue'
import { NButton, NDropdown, NIcon } from 'naive-ui'
import {
  PlusOutlined,
  MoreVertOutlined,
  EditOutlined,
  DeleteOutlineOutlined,
} from '@vicons/material'

const route = useRoute();
const router = useRouter();
const currentSessionId = ref(null);

const emit = defineEmits(['on-select', 'on-update', 'on-create', 'on-delete'])

const props = defineProps({
  sessions: {
    type: Array,
    default: () => []
  }
})

// 下拉菜单选项（带图标）
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

// 处理下拉菜单选择
const handleDropdownSelect = (key, session) => {
  if (key === 'rename') {
    renameSession(session)
  } else if (key === 'delete') {
    deleteSession(session)
  }
}

// 按照最后更新时间排序会话
const sortedSessions = ref([]);

// 选择会话
const selectSession = (sessionId) => {
  router.replace({ name: 'Chat', params: { sessionId } });
}

const updateSelectedSession = (sessionId) => {
  if (sessionId) {
    const session = sortedSessions.value.find(session => session.id === sessionId);
    if (session) {
      if (session.id !== currentSessionId.value) {
        currentSessionId.value = sessionId;
        store.setActiveSessionId(sessionId);
        emit('on-select', session);
      }
      return;
    };
  }
  const newSessionId = sortedSessions.value.length > 0 ? sortedSessions.value[0].id : null;
  if (newSessionId) {
    selectSession(newSessionId);
  }
}

watch(() => props.sessions, (newSessions) => {
  sortedSessions.value = newSessions.sort((a, b) => {
    const timeA = a.updated_at ? new Date(a.updated_at) : new Date(a.created_at || 0);
    const timeB = b.updated_at ? new Date(b.updated_at) : new Date(b.created_at || 0);
    return timeB - timeA; // 降序排列，最新的在前面
  });
  updateSelectedSession(route.params.sessionId);
}, { immediate: true, deep: true })

watch(() => route.params.sessionId, async (newSessionId) => {
  if (!newSessionId) {
    selectSession(store.activeSessionId);
    return;
  }
  updateSelectedSession(newSessionId);
}, { immediate: true });

// 创建新会话
const handleCreateSession = async () => {
  emit('on-create');
}

// 重命名会话
const renameSession = async (session) => {
  emit('on-update', session)
}

// 删除会话
const deleteSession = async (session) => {
  emit('on-delete', session)
}
</script>

<style scoped>
/* 保留无法用Tailwind完全替代的样式 */
.session-item {
  height: 60px;
  /* 使用h-15替代，但保留原始值确保精确匹配 */
}

.session-action-btn:hover {
  color: #4a90e2;
  background-color: #e6f0fa;
}
</style>