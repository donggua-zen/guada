<template>
  <div class="characters-panel">
    <div class="characters-header">
      <span>角色列表</span>
      <button class="new-character-btn" @click="handleCreateCharacter">
        <i class="fas fa-plus"></i> 新建角色
      </button>
    </div>
    <div class="characters-list">
      <div
        v-for="character in characters"
        :key="character.id"
        class="character-item"
        :class="{ active: character.id === activeCharacter?.id }"
        @click="selectCharacter(character)"
      >
        <div class="character-avatar">
          <div class="avatar-img">
            <img v-if="character.avatar_url" :src="character.avatar_url">
            <i v-else class="fas fa-user"></i>
          </div>
        </div>
        <div class="character-info">
          <div class="character-title">{{ character.title }}</div>
        </div>
        <div class="character-actions">
          <button
            class="character-action-btn"
            data-action="rename"
            title="重命名"
            @click.stop="renameCharacter(character)"
          >
            <i class="fas fa-edit"></i>
          </button>
          <button
            class="character-action-btn"
            data-action="delete"
            title="删除"
            @click.stop="deleteCharacter(character)"
          >
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

const props = defineProps({
  characters: {
    type: Array,
    default: () => []
  },
  activeCharacter: {
    type: Object,
    default: null
  }
})

const emit = defineEmits(['select-character', 'update-characters'])

// 选择角色
const selectCharacter = (character) => {
  emit('select-character', character)
}

// 创建新角色
const handleCreateCharacter = async () => {
  try {
    const result = await PopupService.prompt("新建角色", "请输入角色标题", "请输入角色标题")
    
    if (result.isConfirmed) {
      const title = result.value || "新建角色"
      
      // 创建默认角色数据
      const characterData = {
        title: title,
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
      selectCharacter(newCharacter)
      
      PopupService.toast('角色创建成功', 'success')
    }
  } catch (error) {
    console.error('创建角色失败:', error)
    PopupService.toast('角色创建失败', 'error')
  }
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

// 加载角色列表
const loadCharacters = async () => {
  try {
    const data = await apiService.fetchCharacters()
    emit('update-characters', data.items || [])
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
  width: 280px;
  min-width: 280px;
  display: flex;
  flex-direction: column;
  background-color: #ffffff;
  border-right: 1px solid #eee;
  height: 100vh;
}

.characters-header {
  padding: 20px;
  font-size: 18px;
  font-weight: 600;
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid #eee;
}

.new-character-btn {
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

.new-character-btn:hover {
  background-color: #3a7bc8;
}

.characters-list {
  flex: 1;
  overflow-y: auto;
  padding: 10px 0;
}

.character-item {
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

.character-item:hover {
  background-color: #f0f7ff;
  border-color: #d0e6ff;
}

.character-item.active {
  background-color: #e1f0ff;
  border-color: #a0c8f0;
}

.character-avatar {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-right: 12px;
  flex-shrink: 0;
}

.avatar-img {
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

.avatar-img img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.character-info {
  flex: 1;
  min-width: 0;
}

.character-title {
  font-weight: 500;
  font-size: 15px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: #333;
}

.character-actions {
  display: flex;
  gap: 8px;
  opacity: 0;
  transition: opacity 0.2s;
}

.character-item:hover .character-actions {
  opacity: 1;
}

.character-action-btn {
  background: none;
  border: none;
  color: #777;
  cursor: pointer;
  font-size: 14px;
  padding: 4px;
  border-radius: 4px;
}

.character-action-btn:hover {
  color: #4a90e2;
  background-color: #e6f0fa;
}
</style>