<template>
  <div class="sessions-panel">
    <div class="sessions-header">
      <span>会话列表</span>
      <button class="new-session-btn" @click="handleCreateSession">
        <i class="fas fa-plus"></i> 新建会话
      </button>
    </div>
    <div class="sessions-list">
      <div v-for="session in sortedSessions" :key="session.id" class="session-item"
        :class="{ active: session.id === currentSessionId }" @click="selectSession(session.id)">
        <div class="session-avatar">
          <div class="session-img">
            <img v-if="session.avatar_url" :src="session.avatar_url">
            <i v-else class="fas fa-user"></i>
          </div>
        </div>
        <div class="session-info">
          <div class="session-title">{{ session.name }}</div>
        </div>
        <div class="session-actions">
          <button class="session-action-btn" data-action="rename" title="重命名" @click.stop="renameSession(session)">
            <i class="fas fa-edit"></i>
          </button>
          <button class="session-action-btn" data-action="delete" title="删除" @click.stop="deleteSession(session)">
            <i class="fas fa-trash"></i>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, computed, watch } from 'vue'
import { apiService } from '../services/ApiService'
import PopupService from '../services/PopupService'
import { useRouter, useRoute } from 'vue-router'
import { store } from '../stores/store'

const sessions = ref([]);
// const activeSession = ref(null);
const route = useRoute();
const router = useRouter();
const currentSessionId = ref(null);

const emit = defineEmits(['select-session', 'update-sessions'])

// 按照最后更新时间排序会话
const sortedSessions = computed(() => {
  return [...sessions.value].sort((a, b) => {
    const timeA = a.updated_at ? new Date(a.updated_at) : new Date(a.created_at || 0);
    const timeB = b.updated_at ? new Date(b.updated_at) : new Date(b.created_at || 0);
    return timeB - timeA; // 降序排列，最新的在前面
  });
});

// 选择会话
const selectSession = (sessionId) => {
  // activeSession.value = session;
  router.replace({ name: 'Chat', params: { sessionId } });
}

watch(() => route.params.sessionId, async (newSessionId) => {
  if (newSessionId) {
    store.setActiveSessionId(newSessionId);
    selectSession(newSessionId);
    currentSessionId.value = newSessionId;
    emit('select-session', newSessionId)
  }
}, { immediate: true });
// 创建新会话
const handleCreateSession = async () => {
  try {
    const result = await PopupService.prompt("新建会话", "请输入会话名称", "请输入会话名称")

    if (result) {
      const title = result || "新建会话"

      // 创建默认会话数据
      const sessionData = {
        title: title,
        name: "",
        identity: "",
        system_prompt: "",
        avatar_url: ""
      }

      // 调用API创建会话
      const newSession = await apiService.createSession(sessionData)

      // 刷新会话列表
      await loadSessions()

      // 自动选择新创建的会话
      selectSession(newSession)

      PopupService.toast('会话创建成功', 'success')
    }
  } catch (error) {
    console.error('创建会话失败:', error)
    PopupService.toast('会话创建失败', 'error')
  }
}

// 重命名会话
const renameSession = async (session) => {
  try {
    const result = await PopupService.prompt("编辑会话名称", session.name, "请输入会话名称")

    if (result) {
      const newTitle = result

      // 更新会话数据
      const updatedSession = {
        ...session,
        name: newTitle
      }

      // 调用API更新会话
      await apiService.updateSession(session.id, updatedSession)

      // 刷新会话列表
      await loadSessions()

      PopupService.toast('会话名称已更新', 'success')
    }
  } catch (error) {
    console.error('重命名会话失败:', error)
    PopupService.toast('重命名失败', 'error')
  }
}

// 删除会话
const deleteSession = async (session) => {
  try {
    const result = await PopupService.confirm('确认删除', '确定要删除这个会话吗？此操作不可撤销。')

    if (result.isConfirmed) {
      // 调用API删除会话
      const response = await apiService.deleteSession(session.id)
      if (response.success) {
        // 刷新会话列表
        currentSessionId.value = null;
        await loadSessions()

        PopupService.toast('会话删除成功', 'success')
      } else {
        console.error('删除会话失败:', response.error || '未知错误')
        PopupService.toast('删除失败', response.error || '未知错误')
      }
    }
  } catch (error) {
    console.error('删除会话失败:', error)
    PopupService.toast('删除失败', 'error')
  }
}

// 加载会话列表
const loadSessions = async () => {
  try {
    const data = await apiService.fetchSessions()
    sessions.value = data.items;
    console.log('当前会话ID:', store.activeSessionId);
    if (sessions.value.length > 0 && currentSessionId.value === null) {
      const id = store.activeSessionId;
      if (id && sessions.value.find(session => session.id === id)) {
        selectSession(id);
      } else {
        selectSession(sessions.value[0].id);
      }
    }
  } catch (error) {
    console.error('获取会话列表失败:', error)
  }
}
// 更新会话的最后更新时间
const updateSession = async (sessionId) => {
  try {
    console.log('更新会话时间:', sessionId);
    const session = sessions.value.find(session => session.id === sessionId);
    if (session) {
      session.updated_at = new Date().toISOString();
    }
  } catch (error) {
    console.error('更新会话时间失败:', error);
  }
}
// 暴露方法给父组件调用
defineExpose({
  updateSession,
})

// 组件挂载时加载会话列表
onMounted(() => {
  loadSessions()
})
</script>

<style scoped>
.sessions-panel {
  width: 280px;
  min-width: 280px;
  display: flex;
  flex-direction: column;
  height: 100vh;
  background-color: var(--color-conversation-bg);
  border-right: 1px solid var(--color-conversation-border);
}

.sessions-header {
  padding: 20px;
  font-size: 18px;
  font-weight: 600;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.new-session-btn {
  background-color: #4a90e2;
  color: white;
  border: none;
  border-radius: 8px;
  padding: 8px 15px;
  cursor: pointer;
  font-size: 14px;
  transition: background-color 0.2s;
  display: flex;
  align-items: center;
  gap: 5px;
}

.new-session-btn:hover {
  background-color: #3a7bc8;
}

.sessions-list {
  flex: 1;
  overflow-y: auto;
  padding: 10px 0;
}

.session-item {
  padding: 12px 15px;
  cursor: pointer;
  display: flex;
  align-items: center;
  transition: background-color 0.2s;
  border-radius: 12px;
  margin: 0 10px 5px;
  height: 60px;
  /* background: #fafafa; */
  /* border: 1px solid #f0f0f0; */
}

.session-item:hover {
  background-color: var(--color-conversation-bg-hover);
  transition: background-color 0.2s;
  /* border-color: #d0e6ff; */
}

.session-item.active {
  background-color: var(--color-conversation-bg-active);
}

.session-avatar {
  width: 35px;
  height: 35px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-right: 12px;
  flex-shrink: 0;
}

.session-img {
  width: 100%;
  height: 100%;
  border-radius: 50%;
  background: var(--color-primary);
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  font-size: 20px;
  overflow: hidden;
}

.session-img img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.session-info {
  flex: 1;
  min-width: 0;
}

.session-title {
  font-weight: 500;
  font-size: 15px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: #333;
}

.session-actions {
  display: flex;
  gap: 8px;
  opacity: 0;
  transition: opacity 0.2s;
}

.session-item:hover .session-actions {
  opacity: 1;
}

.session-action-btn {
  background: none;
  border: none;
  color: #777;
  cursor: pointer;
  font-size: 14px;
  padding: 4px;
  border-radius: 4px;
}

.session-action-btn:hover {
  color: #4a90e2;
  background-color: #e6f0fa;
}
</style>