<template>
  <div class="flex flex-col h-screen bg-gray-50">
    <!-- 头部 -->
    <div class="flex justify-between items-center p-4 bg-white border-b border-gray-200">
      <span class="text-2xl font-semibold text-gray-800">角色列表</span>
      <n-button type="primary" @click="createCharacter" class="flex items-center">
        <template #icon>
          <n-icon>
            <PlusOutlined />
          </n-icon>
        </template>
        新建角色
      </n-button>
    </div>

    <!-- 角色列表 -->
    <div class=" flex-1 overflow-y-auto p-6">
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        <!-- 角色卡片 -->
        <div v-for="character in characters" :key="character.id"
          class="bg-white rounded-xl shadow-sm hover:shadow-md transition-all duration-300 hover:-translate-y-1 flex flex-col h-full min-h-[180px]">
          <div class="flex p-4 flex-1">
            <!-- 头像区域 -->
            <div class="flex-shrink-0 mr-4">
              <div class="w-16 h-16 overflow-hidden">
                <Avatar :src="character.avatar_url" />
              </div>
            </div>

            <!-- 内容区域 -->
            <div class="flex-1 min-w-0 flex flex-col">
              <!-- 标题和描述 -->
              <div class="flex-1">
                <h3 class="text-lg font-semibold text-gray-800 truncate mb-2">{{ character.title }}</h3>
                <div class="h-15 overflow-hidden">
                  <n-popover trigger="hover" placement="top" :show-arrow="false">
                    <template #trigger>
                      <p class="text-sm text-gray-600 line-clamp-3 leading-5 cursor-help">
                        {{ character.description || '暂无描述' }}
                      </p>
                    </template>
                    <div class="max-w-xs p-2">
                      <span class="text-sm whitespace-pre-wrap">{{ character.description || '暂无描述' }}</span>
                    </div>
                  </n-popover>
                </div>
              </div>

              <!-- 操作按钮 -->
              <div class="flex justify-between items-center mt-4 pt-3 border-t border-gray-100">
                <n-button type="primary" size="small" @click="startNewChat(character)" class="flex items-center gap-1">
                  <template #icon>
                    <n-icon>
                      <ChatbubbleEllipses />
                    </n-icon>
                  </template>
                  对话
                </n-button>

                <div class="flex gap-1">
                  <n-button size="small" quaternary circle @click="editCharacter(character)"
                    class="text-blue-500 hover:text-blue-600">
                    <template #icon>
                      <n-icon>
                        <EditOutlined />
                      </n-icon>
                    </template>
                  </n-button>
                  <n-button size="small" quaternary circle @click="deleteCharacter(character)"
                    class="text-red-500 hover:text-red-600">
                    <template #icon>
                      <n-icon>
                        <DeleteOutlineOutlined />
                      </n-icon>
                    </template>
                  </n-button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- 空状态 -->
        <div v-if="characters.length === 0" class="col-span-full text-center py-12 text-gray-500">
          <n-icon size="48" class="text-gray-300 mb-3">
            <People />
          </n-icon>
          <p class="text-lg">暂无角色</p>
          <p class="text-sm mt-1">点击上方按钮创建第一个角色</p>
        </div>
      </div>
    </div>

    <!-- 角色弹窗 -->
    <CharacterModal v-model:show="showModal" v-model:characterId="currentCharacterId" @saved="handleSaved" />
  </div>
</template>

<script setup>
import { ref, onMounted, reactive } from 'vue'
import { useRouter } from 'vue-router'
import {
  NButton,
  NIcon,
  useDialog,
  NPopover
} from 'naive-ui'
import {
  ChatbubbleEllipses,
  People
} from '@vicons/ionicons5'

import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlineOutlined,
} from '@vicons/material'

// 组件
import Avatar from './Avatar.vue'
import CharacterModal from './CharacterModal.vue'

// 服务
import { apiService } from '../services/llmApi'

// 弹窗
import { usePopup } from '@/composables/usePopup'

const { confirm, toast } = usePopup()

// 响应式数据
const characters = ref([])
const showModal = ref(false)
const currentCharacterId = ref('')
const router = useRouter()

// 加载角色列表
const loadCharacters = async () => {
  try {
    const data = await apiService.fetchCharacters()
    characters.value = data.items
  } catch (error) {
    console.error('获取角色列表失败:', error)
    toast.error('获取角色列表失败')
  }
}

// 创建角色
const createCharacter = () => {
  currentCharacterId.value = ''
  showModal.value = true
}

// 编辑角色
const editCharacter = (character) => {
  currentCharacterId.value = character.id
  showModal.value = true
}

// 删除角色
const deleteCharacter = async (character) => {
  try {
    const result = await confirm('确认删除', `确定要删除角色「${character.title}」吗？此操作不可撤销。`)
    if (!result) {
      return
    }
    await apiService.deleteCharacter(character.id)
    await loadCharacters()
    toast.success('角色删除成功')
  } catch (error) {
    toast.error('删除失败')
    console.error('删除角色失败:', error)
  }
}

// 开始对话
const startNewChat = async (character) => {
  try {
    const loading = toast.loading('正在创建会话...', { duration: 0 })

    const response = await apiService.createSession('123', character.id)
    if (!response || !response.success) {
      loading.destroy()
      toast.error('创建会话失败')
      return
    }

    loading.destroy()
    router.replace({ name: 'Chat', params: { sessionId: response.data.id } })
  } catch (error) {
    console.error('创建会话失败:', error)
    toast.error('创建会话失败')
  }
}

// 处理保存后的回调
const handleSaved = (characterData) => {
  console.log('Character saved:', characterData);
  const index = characters.value.findIndex(c => c.id === characterData.id)
  if (index !== -1) {
    characters.value[index] = reactive(characterData)
  } else {
    characters.value.push(reactive(characterData))
  }
}

// 生命周期
onMounted(async () => {
  loadCharacters()
})
</script>

<style scoped>
.line-clamp-3 {
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>