<template>
  <div class="characters-panel">
    <div class="characters-header">
      <span>角色列表</span>
      <button class="new-character-btn" id="newCharacterBtn" @click="createCharacter">
        <i class="fas fa-plus"></i> 新建角色
      </button>
    </div>
    <div class="characters-scroll-container">
      <div class="characters-grid" id="charactersGrid">
        <div v-for="character in characters" :key="character.id" class="character-card">
          <div class="character-avatar">
            <div class="avatar-img">
              <img v-if="character.avatar_url" :src="character.avatar_url">
              <i v-else class="fas fa-user"></i>

            </div>
          </div>
          <div class="character-info">
            <div class="character-title">{{ character.title }}</div>
            <div class="character-description">{{ character.description }}</div>
          </div>
          <div class="character-actions">
            <button class="start-chat-btn" @click="startNewChat(character)">
              <i class="fas fa-comment-dots"></i> 开始对话
            </button>
            <div class="card-actions">
              <button class="character-action-btn" data-action="edit" @click="editCharacter(character)"
                data-id="${character.id}" title="编辑">
                <i class="fas fa-edit"></i>
              </button>
              <button class="character-action-btn" data-action="delete" @click="deleteCharacter(character)" title="删除">
                <i class="fas fa-trash"></i>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { apiService } from '../services/llmApi'
import { useRouter } from 'vue-router'
import PopupService from '../services/PopupService'

const characters = ref([])
const router = useRouter()

// 创建新角色
const handleCreateCharacter = async () => {
  try {
    const result = await PopupService.prompt("新建角色", "请输入角色标题", "请输入角色标题")

    if (result.isConfirmed) {
      const title = result.value || "新建角色"

      // 创建默认角色数据
      const characterData = {
        title: title,
        description: "",
        name: "",
        identity: "",
        detailed_setting: "",
        avatar_url: ""
      }

      // 调用API创建角色
      const newCharacter = await apiService.createCharacter(characterData)

      // 刷新角色列表
      await loadCharacters()

      // 自动选择新创建的角色

      PopupService.toast('角色创建成功', 'success')
    }
  } catch (error) {
    console.error('创建角色失败:', error)
    PopupService.toast('角色创建失败', 'error')
  }
}

const editCharacter = async (character) => {
  router.push({ name: 'Character', params: { characterId: character.id } })
}
// 重命名角色
const renameCharacter = async (character) => {
  try {
    const result = await PopupService.prompt("编辑角色标题", character.title, "请输入角色标题")

    if (result.isConfirmed) {
      const newTitle = result.value

      // 更新角色数据
      const updatedCharacter = {
        ...character,
        title: newTitle
      }

      // 调用API更新角色
      await apiService.updateCharacter(character.id, updatedCharacter)

      // 刷新角色列表
      await loadCharacters()

      PopupService.toast('角色标题已更新', 'success')
    }
  } catch (error) {
    console.error('重命名角色失败:', error)
    PopupService.toast('重命名失败', 'error')
  }
}

const createCharacter = () => {
  router.push({ name: 'Character', params: {} })
}

// 删除角色
const deleteCharacter = async (character) => {
  try {
    const result = await PopupService.confirm('确认删除', '确定要删除这个角色吗？此操作不可撤销。')

    if (result.isConfirmed) {
      // 调用API删除角色
      await apiService.deleteCharacter(character.id)

      // 刷新角色列表
      await loadCharacters()

      PopupService.toast('角色删除成功', 'success')
    }
  } catch (error) {
    console.error('删除角色失败:', error)
    PopupService.toast('删除失败', 'error')
  }
}

const startNewChat = async (character) => {
  PopupService.loading('正在创建会话...')
  const response = await apiService.createSession('123', character.id)
  if (!response || !response.success) {
    PopupService.toast('创建会话失败', 'error')
    return
  }
  router.replace({ name: 'Chat', params: { sessionId: response.data.id } })
  PopupService.close()
}

// 加载角色列表
const loadCharacters = async () => {
  try {
    const data = await apiService.fetchCharacters()
    characters.value = data.items;
    // if (data.length > 0) {
    //   selectCharacter(data[0])
    // }
  } catch (error) {
    console.error('获取角色列表失败:', error)
  }
}

// 组件挂载时加载角色列表
onMounted(() => {
  loadCharacters()
})
</script>

<style scoped>
.characters-panel {
  margin: 0 auto;
  height: 100vh;
  /* 新增：充满整个视口高度 */
  display: flex;
  /* 新增：使用flex布局 */
  flex-direction: column;
  /* 新增：垂直方向排列 */
}

.characters-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 15px;
  border-bottom: 1px solid #e0e6ed;
}

.characters-header span {
  font-size: 24px;
  font-weight: 600;
  color: #2c3e50;
}

.new-character-btn {
  background: linear-gradient(135deg, #4a90e2, #3a7bc8);
  color: white;
  border: none;
  border-radius: 8px;
  padding: 10px 20px;
  cursor: pointer;
  font-size: 15px;
  font-weight: 500;
  transition: all 0.3s ease;
  display: flex;
  align-items: center;
  gap: 8px;
  box-shadow: 0 2px 8px rgba(74, 144, 226, 0.3);
}

.new-character-btn:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(74, 144, 226, 0.4);
}

/* 新增滚动容器样式 */
.characters-scroll-container {
  flex: 1;
  /* 新增：占据剩余空间 */
  overflow-y: auto;
  /* 新增：垂直方向滚动 */
  min-height: 0;
  /* 新增：重要！允许flex子项缩小 */
  width: 100%;
  padding: 20px;
}

.characters-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 20px;
  padding-bottom: 20px;
  /* 新增：底部留白 */
}


.character-card {
  background: white;
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
  transition: all 0.3s ease;
  display: flex;
  flex-direction: column;
  height: 100%;
}

.character-card:hover {
  transform: translateY(-5px);
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.12);
}

.character-avatar {
  height: 180px;
  background: linear-gradient(135deg, #4a90e2, #3a7bc8);
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  overflow: hidden;
}

.avatar-img {
  width: 100px;
  height: 100px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.2);
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  font-size: 40px;
  backdrop-filter: blur(10px);
  border: 2px solid rgba(255, 255, 255, 0.3);
}

.avatar-img img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: 50%;
}

.character-info {
  padding: 20px;
  flex-grow: 1;
}

.character-title {
  font-size: 18px;
  font-weight: 600;
  margin-bottom: 8px;
  color: #2c3e50;
}

.character-description {
  color: #7f8c8d;
  font-size: 14px;
  line-height: 1.5;
  margin-bottom: 20px;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.character-actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0 20px 20px;
}

.start-chat-btn {
  background: linear-gradient(135deg, #4a90e2, #3a7bc8);
  color: white;
  border: none;
  border-radius: 6px;
  padding: 8px 16px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  gap: 5px;
}

.start-chat-btn:hover {
  background: linear-gradient(135deg, #3a7bc8, #2a6bb8);
  box-shadow: 0 2px 8px rgba(74, 144, 226, 0.3);
}

.card-actions {
  display: flex;
  gap: 8px;
}

.character-action-btn {
  background: none;
  border: none;
  color: #95a5a6;
  cursor: pointer;
  font-size: 14px;
  padding: 6px;
  border-radius: 4px;
  transition: all 0.2s ease;
}

.character-action-btn:hover {
  color: #4a90e2;
  background-color: #f0f7ff;
}

.empty-state {
  grid-column: 1 / -1;
  text-align: center;
  padding: 60px 20px;
  color: #95a5a6;
}

.empty-state i {
  font-size: 48px;
  margin-bottom: 15px;
  opacity: 0.5;
}

.empty-state p {
  font-size: 16px;
}

/* 响应式设计 */
@media (max-width: 768px) {
  .characters-grid {
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  }

  .characters-header {
    flex-direction: column;
    gap: 15px;
    align-items: flex-start;
  }
}

@media (max-width: 480px) {
  .characters-grid {
    grid-template-columns: 1fr;
  }

  .characters-panel {
    padding: 15px;
  }
}
</style>