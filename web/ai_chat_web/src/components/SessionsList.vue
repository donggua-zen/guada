<template>
  <div class="sessions-panel">
    <div class="sessions-header">
      <span>会话列表</span>
      <button class="new-session-btn" @click="handleCreateSession">
        <i class="fas fa-plus"></i> 新建会话
      </button>
    </div>
    <div class="sessions-list">
      <div v-for="session in sessions" :key="session.id" class="session-item"
        :class="{ active: session.id === activeSession?.id }" @click="selectSession(session)">
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
import { ref, onMounted } from 'vue'
import { apiService } from '../services/llmApi'
import PopupService from '../services/PopupService'

const sessions = ref([]);
const activeSession = ref(null);


const emit = defineEmits(['select-session', 'update-sessions'])

// 选择会话
const selectSession = (session) => {
  activeSession.value = session;
  emit('select-session', session.id)
}

// 创建新会话
const handleCreateSession = async () => {
  try {
    const result = await PopupService.prompt("新建会话", "请输入会话名称", "请输入会话名称")

    if (result.isConfirmed) {
      const title = result.value || "新建会话"

      // 创建默认会话数据
      const sessionData = {
        title: title,
        name: "",
        identity: "",
        detailed_setting: "",
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
    const result = await PopupService.prompt("编辑会话名称", session.title, "请输入会话名称")

    if (result.isConfirmed) {
      const newTitle = result.value

      // 更新会话数据
      const updatedSession = {
        ...session,
        title: newTitle
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
      await apiService.deleteSession(session.id)

      // 刷新会话列表
      await loadSessions()

      PopupService.toast('会话删除成功', 'success')
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
    if (sessions.value.length > 0) {
      selectSession(sessions.value[0]);
    }
  } catch (error) {
    console.error('获取会话列表失败:', error)
  }
}

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
  background-color: #ffffff;
  border-right: 1px solid #eee;
  height: 100vh;
}

.sessions-header {
  padding: 20px;
  font-size: 18px;
  font-weight: 600;
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid #eee;
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
  border-radius: 8px;
  margin: 0 10px 5px;
  background: #fafafa;
  border: 1px solid #f0f0f0;
}

.session-item:hover {
  background-color: #f0f7ff;
  border-color: #d0e6ff;
}

.session-item.active {
  background-color: #e1f0ff;
  border-color: #a0c8f0;
}

.session-avatar {
  width: 40px;
  height: 40px;
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
  background: linear-gradient(135deg, #4a90e2, #3a7bc8);
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