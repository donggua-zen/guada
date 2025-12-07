<template>
  <div class="flex flex-col h-screen bgx-[var(--bg)]">
    <!-- 头部 -->
    <div class="flex justify-between items-center px-6 py-4 bg-white">
      <span class="text-lg font-semibold text-gray-800">角色列表</span>
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
    <div class="flex-1 overflow-y-auto p-6 flex flex-col items-start">
      <div class="mb-4 w-full max-w-80">
        <n-tabs v-model:value="charactersType" type="segment" pane-wrapper-style="display:none"
          pane-style="display:none">
          <n-tab-pane name="private" tab="我的模板"></n-tab-pane>
          <n-tab-pane name="shared" tab="共享模板"></n-tab-pane>
        </n-tabs>
      </div>
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-6 w-full">
        <!-- 骨架屏加载效果 -->
        <template v-if="loading">
          <div v-for="i in skeletonCount" :key="i"
            class="bg-white rounded-xl border border-gray-200 flex flex-col min-h-[180px] animate-pulse">
            <div class="flex p-4 flex-1 flex-col">
              <!-- 头像区域 -->
              <div class="flex flex-rows">
                <div class="flex-shrink-0 mr-4">
                  <div class="w-16 h-16 bg-gray-200"></div>
                </div>

                <!-- 内容区域 -->
                <div class="flex-1 min-w-0 flex flex-col">
                  <!-- 标题 -->
                  <!-- <div class="h-5 bg-gray-200 rounded mb-2 w-full"></div>-->
                  <h3 class="text-lg  bg-gray-200 font-semibold text-gray-800 truncate mb-2">&nbsp;</h3>
                  <!-- 描述 -->
                  <div class="h-15 space-y-2">
                    <div class="h-3 bg-gray-200 rounded"></div>
                    <div class="h-3 bg-gray-200 rounded w-4/5"></div>
                    <div class="h-3 bg-gray-200 rounded w-3/5"></div>
                  </div>
                </div>
              </div>
              <!-- 操作按钮 -->
              <div class="flex justify-between items-center mt-4 pt-3 border-t border-gray-100">
                <div class="h-7 w-20 bg-gray-200 rounded-full"></div>
                <div class="flex gap-1">
                  <div class="w-8 h-8 rounded-full bg-gray-200"></div>
                  <div class="w-8 h-8 rounded-full bg-gray-200"></div>
                </div>
              </div>
            </div>
          </div>
        </template>
        <template v-else>
          <!-- 角色卡片 -->
          <div v-for="character in characters" :key="character.id"
            class="bg-white rounded-xl border border-gray-200 hover:border-gray-300 transition-all duration-300 flex flex-col min-h-[180px]">
            <div class="flex p-4 flex-1 flex-col">
              <!-- 头像区域 -->
              <div class="flex flex-rows">
                <div class="flex-shrink-0 mr-4">
                  <div class="w-16 h-16 overflow-hidden">
                    <Avatar :src="character.avatar_url" />
                  </div>
                </div>

                <!-- 内容区域 -->
                <div class="flex-1 min-w-0 flex flex-col">
                  <!-- 标题和描述 -->
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
              </div>
              <!-- 操作按钮 -->
              <div class="flex justify-between items-center mt-4 pt-3 border-t border-gray-100">
                <n-button secondary type="primary" round size="small" @click="startNewChat(character)"
                  class="flex items-center gap-1">
                  <template #icon>
                    <n-icon size="16">
                      <ChatbubbleEllipses />
                    </n-icon>
                  </template>
                  使用
                </n-button>

                <div v-if="charactersType == 'private'" class="flex gap-1">
                  <n-button size="small" quaternary circle @click="shareCharacter(character)"
                    class="text-gray-500 hover:text-gray-600" :class="{ '!text-yellow-500': character.is_public }">
                    <template #icon>
                      <n-icon :component="ShareTwotone" size="18">
                      </n-icon>
                    </template>
                  </n-button>

                  <!-- 更多按钮下拉菜单 -->
                  <n-dropdown trigger="click" :options="moreOptions" @select="handleMoreAction($event, character)">
                    <n-button size="small" quaternary circle>
                      <n-icon :component="MoreVertOutlined" size="18" />
                    </n-button>
                  </n-dropdown>
                </div>
              </div>

            </div>
          </div>
        </template>
        <!-- 空状态 -->
        <div v-if="!loading && characters.length === 0" class="col-span-full text-center py-12 text-gray-500">
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
import { ref, onMounted, reactive, computed, h } from 'vue'
import { useRouter } from 'vue-router'
import SidebarLayout from '@/components/layout/SidebarLayout.vue'
import {
  NButton,
  NIcon,
  NPopover,
  NTabs,
  NTabPane,
  NDropdown,
} from 'naive-ui'
import {
  ChatbubbleEllipses,
  People
} from '@vicons/ionicons5'

import {
  PlusOutlined,
  EditTwotone,
  ShareTwotone,
  DeleteTwotone,
  MoreVertOutlined,
} from '@vicons/material'

// 组件
import Avatar from './Avatar.vue'
import CharacterModal from './CharacterModal.vue'

// 服务
import { apiService } from '../services/ApiService'

// 弹窗
import { usePopup } from '../composables/usePopup'
import { watch } from 'vue'

const { confirm, toast } = usePopup()

// 响应式数据
const characters = ref([])
const showModal = ref(false)
const currentCharacterId = ref('')
const router = useRouter()
const charactersType = ref('private')
const loading = ref(true)
const skeletonCount = ref(10)

// 更多按钮的选项
const moreOptions = computed(() => {
  const options = [
    {
      label: '编辑模板',
      key: 'edit',
      icon: () => h(NIcon, { component: EditTwotone, size: 15 })
    },
    {
      label: '删除模板',
      key: 'delete',
      icon: () => h(NIcon, { component: DeleteTwotone, size: 15 })
    }
  ];
  return options;
});

const emit = defineEmits(['create-session'])

// 加载角色列表
const loadCharacters = async (type) => {
  loading.value = true
  try {
    // 确保至少显示500ms的加载动画，避免闪烁
    const [data] = await Promise.all([
      apiService.fetchCharacters(type),
      new Promise(resolve => setTimeout(resolve, 500))
    ])
    characters.value = data.items
  } catch (error) {
    console.error('获取角色列表失败:', error)
    toast.error('获取角色列表失败')
  } finally {
    loading.value = false
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

const handleMoreAction = (key, character) => {
  if (key === 'edit') {
    editCharacter(character)
  } else if (key === 'delete') {
    deleteCharacter(character)
  }
};

// 删除角色
const deleteCharacter = async (character) => {
  try {
    const result = await confirm('确认删除', `确定要删除角色「${character.title}」吗？此操作不可撤销。`)
    if (!result) {
      return
    }
    await apiService.deleteCharacter(character.id)
    await loadCharacters(charactersType.value)
    toast.success('角色删除成功')
  } catch (error) {
    toast.error('删除失败')
    console.error('删除角色失败:', error)
  }
}

// 开始对话
const startNewChat = async (character) => {
  emit('create-session', { title: character.title, character_id: character.id })
}

const shareCharacter = async (character) => {
  try {
    await apiService.updateCharacter(character.id, { is_public: !character.is_public })
    character.is_public = !character.is_public
    toast.success(character.is_public ? '角色已公开' : '角色已私密')
  } catch (error) {
    console.error('更新角色失败:', error)
    toast.error('更新角色失败')
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

watch(() => charactersType.value, async () => {
  loadCharacters(charactersType.value)
})

// 生命周期
onMounted(async () => {
  loadCharacters(charactersType.value)
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