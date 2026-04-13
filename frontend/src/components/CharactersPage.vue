<template>
  <SidebarLayout v-model:sidebar-visible="sidebarVisible" :sidebar-position="'left'" :z-index="50"
    :show-toggle-button="false">
    <template #sidebar>
      <!-- 左侧二级侧边栏 - 助手分类 -->
      <div class="h-full w-56 bg-(--color-conversation-bg) border-r border-(--color-conversation-border) flex flex-col">
        <div class="px-4 py-4 border-b border-(--color-conversation-border)">
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
                class="rounded-xl border border-gray-200 dark:border-gray-700 flex flex-col min-h-45 animate-pulse">
                <div class="flex p-4 flex-1 flex-col">
                  <!-- 头像区域 -->
                  <div class="flex flex-rows">
                    <div class="shrink-0 mr-4">
                      <div class="w-16 h-16 bg-surface rounded-full"></div>
                    </div>

                    <!-- 内容区域 -->
                    <div class="flex-1 min-w-0 flex flex-col">
                      <!-- 标题 -->
                      <h3
                        class="text-lg bg-surface rounded font-semibold text-gray-800 dark:text-gray-200 truncate mb-2">
                        &nbsp;
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
                  <div
                    class="flex justify-between items-center mt-4 pt-3 border-t border-gray-100 dark:border-gray-700">
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
                class="provider-card group relative bg-white border border-gray-200 rounded-lg p-4 cursor-default hover:border-(--color-primary) transition-all duration-200 overflow-hidden">
                <!-- 毛玻璃背景层 -->
                <div v-if="character.avatarUrl" class="absolute inset-0 z-0" :style="{
                  backgroundImage: `url(${character.avatarUrl})`,
                  backgroundSize: 'cover',
                  backgroundPosition: 'center',
                  filter: 'blur(30px)',
                  opacity: 0.04,
                  transform: 'scale(1.5)'
                }">
                </div>

                <!-- 内容区域 -->
                <div class="relative z-10 flex flex-col h-full">
                  <div class="flex items-start gap-3">
                    <div
                      class="w-11 h-11 shrink-0 flex items-center justify-center text-(--color-primary) bg-gray-50 rounded-md overflow-hidden">
                      <Avatar :src="character.avatarUrl" :name="character.title" type="assistant" />
                    </div>
                    <div class="flex-1 min-w-0">
                      <div class="flex items-start justify-between">
                        <div class="font-medium text-base text-gray-900 truncate" :title="character.title">{{
                          character.title }}</div>
                        <!-- 删除按钮 - 悬停显示 -->
                        <el-button v-if="charactersType == 'private'" link size="small" type="danger"
                          class="opacity-0 group-hover:opacity-100 transition-all duration-200 delete-btn"
                          @click.stop="deleteCharacter(character)">
                          <el-icon :size="18">
                            <DeleteOutlineOutlined />
                          </el-icon>
                        </el-button>
                      </div>
                      <div class="text-xs text-gray-500 mt-1.5">{{ character.isPublic ? '共享模板' : '我的模板' }}</div>
                    </div>
                  </div>
                  <div class="text-xs text-gray-400 mt-2 line-clamp-2 leading-relaxed">{{ character.description ||
                    '暂无描述' }}
                  </div>
                </div>

                <!-- 悬停显示的渐变遮罩和按钮 -->
                <div
                  class="absolute inset-x-0 bottom-0 h-16 bg-linear-to-t from-white via-white/90 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none rounded-b-lg">
                </div>
                <div
                  class="absolute inset-x-2 bottom-2 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-auto z-20">
                  <el-button type="primary" size="small" class="flex-1 shadow-sm" @click.stop="startNewChat(character)">
                    使用此角色
                  </el-button>
                  <el-button v-if="charactersType == 'private'" size="small" class="flex-1 shadow-sm"
                    @click.stop="editCharacter(character)">
                    角色设置
                  </el-button>
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

<!-- @ts-ignore - UI 组件和 Element Plus 尚未完全迁移到 TypeScript -->
<script setup lang="ts">
import { ref, onMounted, reactive, watch } from 'vue'
import { useRouter } from 'vue-router'
// @ts-ignore - Element Plus 类型缺失
import {
  ElIcon,
  ElTooltip,
  ElSegmented,
  ElDropdown,
  ElDropdownMenu,
  ElDropdownItem,
  ElButton
} from 'element-plus'
// @ts-ignore - icons 类型缺失
import {
  People
} from '@vicons/ionicons5'

import {
  PlusOutlined,
  DeleteOutlineOutlined
} from '@vicons/material'

import { useTitle } from '../composables/useTitle'
import { useStorage } from '@vueuse/core'
// @ts-ignore - UI 组件类型缺失
import { SidebarLayout } from './ui'
// @ts-ignore - UI 组件类型缺失
import { Avatar } from './ui'
import CharacterModal from './CharacterModal.vue'
// @ts-ignore - ApiService 尚未迁移到 TypeScript
import { apiService } from '../services/ApiService'
import { usePopup } from '../composables/usePopup'

const { confirm, toast } = usePopup()
const router = useRouter()
const title = useTitle('助手')

// 响应式数据 - 类型化
const characters = ref<any[]>([])
const showModal = ref(false)
const currentCharacterId = ref('')
const charactersType = useStorage<'private' | 'public'>('charactersType', 'private')
const loading = ref(true)
const skeletonCount = ref(10)
const sidebarVisible = useStorage<boolean>('sidebarVisible', true)

// 加载角色列表 - 类型化
const loadCharacters = async (type: 'private' | 'public'): Promise<void> => {
  loading.value = true
  try {
    // 确保至少显示 500ms 的加载动画，避免闪烁
    const [data] = await Promise.all([
      apiService.fetchCharacters(type),
      new Promise(resolve => setTimeout(resolve, 500))
    ])
    characters.value = data.items
  } catch (error: any) {
    console.error('获取助手列表失败:', error)
    toast.error('获取助手列表失败')
  } finally {
    loading.value = false
  }
}

// 创建助手 - 类型化
const createCharacter = (): void => {
  currentCharacterId.value = ''
  showModal.value = true
}

// 编辑助手 - 类型化
const editCharacter = (character: any): void => {
  currentCharacterId.value = character.id
  showModal.value = true
}

// 删除助手 - 类型化
const deleteCharacter = async (character: any): Promise<void> => {
  try {
    const result = await confirm('确认删除', `确定要删除助手「${character.title}」吗？此操作不可撤销。`)
    if (!result) {
      return
    }
    await apiService.deleteCharacter(character.id)
    await loadCharacters(charactersType.value)
    toast.success('助手删除成功')
  } catch (error: any) {
    toast.error('删除失败')
    console.error('删除助手失败:', error)
  }
}

// 开始对话 - 创建会话并跳转到聊天页面 - 类型化
const startNewChat = async (character: any): Promise<void> => {
  try {
    const session = await apiService.createSession({
      characterId: character.id,
      title: character.title,
    })
    // 刷新路由到聊天页面
    router.replace({ name: 'Chat', params: { sessionId: session.id } })
    toast.success('会话创建成功')
  } catch (error: any) {
    console.error('创建会话失败:', error)
    toast.error('创建会话失败')
  }
}

// 处理保存后的回调 - 类型化
const handleSaved = (characterData: any): void => {
  const index = characters.value.findIndex(c => c.id === characterData.id)
  if (index !== -1) {
    characters.value[index] = reactive(characterData)
  } else {
    characters.value.push(reactive(characterData))
  }
}

// Watch 监听器 - 类型化
watch(() => charactersType.value, async () => {
  loadCharacters(charactersType.value)
})

// 生命周期 - 类型化
onMounted(async (): Promise<void> => {
  loadCharacters(charactersType.value)
})
</script>

<style scoped>
.line-clamp-2 {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.provider-card {
  min-height: 140px;
}

/* 删除按钮悬停底纹效果 */
.delete-btn {
  border-radius: 4px;
}

.delete-btn:hover {
  background-color: rgba(239, 68, 68, 0.1);
}
</style>
