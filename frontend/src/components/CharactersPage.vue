<template>
  <SidebarLayout v-model:sidebar-visible="sidebarVisible" :sidebar-position="'left'" :z-index="50" :show-toggle-button="false">
    <template #sidebar>
      <!-- 左侧二级侧边栏 - 助手分类 -->
      <div class="h-full w-56 bg-[var(--color-conversation-bg)] border-r border-[var(--color-conversation-border)] flex flex-col">
        <div class="px-4 py-4 border-b border-[var(--color-conversation-border)]">
          <div class="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">助手分类</div>
          <el-segmented v-model="charactersType" :options="[
            { label: '我的模板', value: 'private' },
            { label: '共享模板', value: 'shared' }
          ]" block class="segmented-control" />
        </div>
      </div>
    </template>
    <template #content>
      <div class="flex flex-col h-full">
        <!-- 头部 -->
        <div class="flex justify-between items-center px-6 py-4 border-b border-gray-100 dark:border-gray-800">
          <span class="text-lg font-semibold text-gray-800 dark:text-gray-200">助手列表</span>
          <el-button type="primary" @click="createCharacter" class="flex items-center">
            <template #icon>
              <PlusOutlined />
            </template>
            新建助手
          </el-button>
        </div>

        <!-- 助手列表 -->
        <div class="flex-1 overflow-y-auto p-6">
          <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-6 w-full">
            <!-- 骨架屏加载效果 -->
            <template v-if="loading">
              <div v-for="i in skeletonCount" :key="i"
                class="rounded-xl border border-gray-200 dark:border-gray-700 flex flex-col min-h-[180px] animate-pulse">
                <div class="flex p-4 flex-1 flex-col">
                  <!-- 头像区域 -->
                  <div class="flex flex-rows">
                    <div class="shrink-0 mr-4">
                      <div class="w-16 h-16 bg-surface rounded-full"></div>
                    </div>

                    <!-- 内容区域 -->
                    <div class="flex-1 min-w-0 flex flex-col">
                      <!-- 标题 -->
                      <h3 class="text-lg bg-surface rounded font-semibold text-gray-800 dark:text-gray-200 truncate mb-2">&nbsp;
                      </h3>
                      <!-- 描述 -->
                      <div class="h-15 space-y-2">
                        <div class="h-3 bg-surface rounded"></div>
                        <div class="h-3 bg-surface rounded w-4/5"></div>
                        <div class="h-3 bg-surface rounded w-3/5"></div>
                      </div>
                    </div>
                  </div>
                  <!-- 操作按钮 -->
                  <div class="flex justify-between items-center mt-4 pt-3 border-t border-gray-100 dark:border-gray-700">
                    <div class="h-7 w-20 bg-surface rounded-full"></div>
                    <div class="flex gap-1">
                      <div class="w-8 h-8 rounded-full bg-surface"></div>
                      <div class="w-8 h-8 rounded-full bg-surface"></div>
                    </div>
                  </div>
                </div>
              </div>
            </template>
            <template v-else>
              <!-- 助手卡片 -->
              <div v-for="character in characters" :key="character.id"
                class="rounded-xl border border-gray-200 dark:border-gray-700 hover:border-gray-300 transition-all duration-300 flex flex-col min-h-[180px]">
                <div class="flex p-4 flex-1 flex-col">
                  <!-- 头像区域 -->
                  <div class="flex flex-rows">
                    <div class="shrink-0 mr-4">
                      <div class="w-16 h-16 overflow-hidden rounded-full">
                        <Avatar :src="character.avatar_url" />
                      </div>
                    </div>

                    <!-- 内容区域 -->
                    <div class="flex-1 min-w-0 flex flex-col">
                      <!-- 标题和描述 -->
                      <h3 class="text-lg font-semibold text-gray-800 dark:text-gray-200 truncate mb-2">{{ character.title }}
                      </h3>
                      <div class="h-15 overflow-hidden">
                        <el-tooltip effect="dark" :content="character.description || '暂无描述'" placement="top">
                          <p class="text-sm text-gray-600 dark:text-gray-400 line-clamp-3 leading-5 cursor-help">
                            {{ character.description || '暂无描述' }}
                          </p>
                        </el-tooltip>
                      </div>
                    </div>
                  </div>
                  <!-- 操作按钮 -->
                  <div class="flex justify-between items-center mt-4 pt-3 border-t border-gray-100 dark:border-gray-700">
                    <el-button type="primary" round size="small" @click="startNewChat(character)"
                      class="flex items-center gap-1">
                      <template #icon>
                        <ChatbubbleEllipses />
                      </template>
                      使用
                    </el-button>

                    <div v-if="charactersType == 'private'" class="flex gap-1">
                      <el-button size="small" link @click="shareCharacter(character)"
                        class="text-gray-500 hover:text-gray-600" :class="{ 'text-yellow-500!': character.is_public }">
                        <template #icon>
                          <ShareTwotone />
                        </template>
                      </el-button>

                      <!-- 更多按钮下拉菜单 -->
                      <el-dropdown trigger="click" @command="handleMoreAction($event, character)">
                        <el-button size="small" link>
                          <el-icon :size="18">
                            <MoreVertOutlined />
                          </el-icon>
                        </el-button>
                        <template #dropdown>
                          <el-dropdown-menu>
                            <el-dropdown-item command="edit">
                              <div class="flex items-center">
                                <el-icon class="mr-2">
                                  <EditTwotone />
                                </el-icon>
                                <span>编辑助手</span>
                              </div>
                            </el-dropdown-item>
                            <el-dropdown-item command="delete" divided>
                              <div class="flex items-center">
                                <el-icon class="mr-2">
                                  <DeleteTwotone />
                                </el-icon>
                                <span>删除助手</span>
                              </div>
                            </el-dropdown-item>
                          </el-dropdown-menu>
                        </template>
                      </el-dropdown>
                    </div>
                  </div>

                </div>
              </div>
            </template>
            <!-- 空状态 -->
            <div v-if="!loading && characters.length === 0" class="col-span-full text-center py-12 text-gray-500">
              <el-icon size="48" class="text-gray-300 mb-3">
                <People />
              </el-icon>
              <p class="text-lg">暂无助手</p>
              <p class="text-sm mt-1">点击上方按钮创建第一个助手</p>
            </div>
          </div>
        </div>
      </div>
    </template>
  </SidebarLayout>

  <!-- 助手弹窗 -->
  <CharacterModal v-model:show="showModal" v-model:characterId="currentCharacterId" @saved="handleSaved" />
</template>

<script setup>
import { ref, onMounted, reactive, watch } from 'vue'
import { useRouter } from 'vue-router'
import {
  ElIcon,
  ElTooltip,
  ElSegmented,
  ElDropdown,
  ElDropdownMenu,
  ElDropdownItem,
  ElButton
} from 'element-plus'
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

import { useTitle } from '../composables/useTitle'
import { useStorage } from '@vueuse/core'
import { SidebarLayout } from './ui'
import { Avatar } from './ui'
import CharacterModal from './CharacterModal.vue'
import { apiService } from '../services/ApiService'
import { usePopup } from '../composables/usePopup'

const { confirm, toast } = usePopup()
const router = useRouter()
const title = useTitle('助手')

// 响应式数据
const characters = ref([])
const showModal = ref(false)
const currentCharacterId = ref('')
const charactersType = useStorage('charactersType', 'private')
const loading = ref(true)
const skeletonCount = ref(10)
const sidebarVisible = useStorage('sidebarVisible', true)

// 加载角色列表
const loadCharacters = async (type) => {
  loading.value = true
  try {
    // 确保至少显示 500ms 的加载动画，避免闪烁
    const [data] = await Promise.all([
      apiService.fetchCharacters(type),
      new Promise(resolve => setTimeout(resolve, 500))
    ])
    characters.value = data.items
  } catch (error) {
    console.error('获取助手列表失败:', error)
    toast.error('获取助手列表失败')
  } finally {
    loading.value = false
  }
}

// 创建助手
const createCharacter = () => {
  currentCharacterId.value = ''
  showModal.value = true
}

// 编辑助手
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

// 删除助手
const deleteCharacter = async (character) => {
  try {
    const result = await confirm('确认删除', `确定要删除助手「${character.title}」吗？此操作不可撤销。`)
    if (!result) {
      return
    }
    await apiService.deleteCharacter(character.id)
    await loadCharacters(charactersType.value)
    toast.success('助手删除成功')
  } catch (error) {
    toast.error('删除失败')
    console.error('删除助手失败:', error)
  }
}

// 开始对话 - 创建会话并跳转到聊天页面
const startNewChat = async (character) => {
  try {
    const session = await apiService.createSession({
      character_id: character.id,
      title: character.title,
    })
    // 刷新路由到聊天页面
    router.replace({ name: 'Chat', params: { sessionId: session.id } })
    toast.success('会话创建成功')
  } catch (error) {
    console.error('创建会话失败:', error)
    toast.error('创建会话失败')
  }
}

const shareCharacter = async (character) => {
  try {
    await apiService.updateCharacter(character.id, { is_public: !character.is_public })
    character.is_public = !character.is_public
    toast.success(character.is_public ? '助手已公开' : '助手已私密')
  } catch (error) {
    console.error('更新助手失败:', error)
    toast.error('更新助手失败')
  }
}

// 处理保存后的回调
const handleSaved = (characterData) => {
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

/* Segmented Control 样式优化 */
:deep(.segmented-control .el-segmented) {
  background-color: var(--color-surface);
  padding: 0.25rem;
  border-radius: 0.5rem;
}

:deep(.segmented-control .el-segmented__item) {
  font-size: 13px;
  font-weight: 500;
  padding: 0.375rem 0.75rem;
  border-radius: 0.375rem;
  transition: all 0.2s ease;
}

:deep(.segmented-control .el-segmented__item--selected) {
  background-color: var(--color-bg);
  color: var(--color-primary);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
}

/* 助手卡片样式优化 */
.rounded-xl {
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.rounded-xl:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 16px rgba(0, 0, 0, 0.08);
}

.dark .rounded-xl:hover {
  box-shadow: 0 8px 16px rgba(0, 0, 0, 0.2);
}
</style>
