<template>
  <div class="h-full flex flex-col md:max-w-295 md:mx-auto">
    <SidebarLayout v-model:sidebar-visible="sidebarVisible" :sidebar-position="'left'" :z-index="50"
      :show-toggle-button="false" :sidebar-width="200">
      <template #sidebar>
        <!-- 左侧二级侧边栏 - 助手分组 -->
        <div class="h-full bg-(--color-conversation-bg) border-r border-(--color-conversation-border) flex flex-col">
          <div class="px-1 py-4">
            <div class="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">助手分组</div>
            <div class="space-y-1">
              <div class="px-2 py-1.5 text-sm rounded cursor-pointer transition-colors duration-200"
                :class="currentGroupId === null ? 'bg-(--color-primary-100) text-(--color-primary)' : 'hover:text-(--color-primary) hover:bg-(--color-primary-100)'"
                @click="selectGroup(null)">
                全部助手
              </div>
              <div v-for="group in groups" :key="group.id"
                class="group-item px-2 py-1.5 text-sm rounded cursor-pointer transition-colors duration-200 flex justify-between items-center group"
                :class="currentGroupId === group.id ? 'bg-(--color-primary-100) text-(--color-primary)' : 'hover:text-(--color-primary) hover:bg-(--color-primary-100)'">
                <span class="truncate flex-1" @click="selectGroup(group.id)">{{ group.name }}</span>
                <el-dropdown trigger="click" @command="(cmd) => handleGroupCommand(cmd, group)" @click.stop>
                  <template #dropdown>
                    <el-dropdown-menu>
                      <el-dropdown-item command="rename">
                        <EditOutlined class="w-4 h-4 mr-2 inline-block" />
                        重命名
                      </el-dropdown-item>
                      <el-dropdown-item command="delete">
                        <DeleteOutlineOutlined class="w-4 h-4 mr-2 inline-block" />
                        <span style="color: red;">删除</span>
                      </el-dropdown-item>
                    </el-dropdown-menu>
                  </template>
                  <div @click.stop class="group-action-trigger">
                    <el-icon class="w-4 h-4">
                      <MoreHorizOutlined />
                    </el-icon>
                  </div>
                </el-dropdown>
              </div>
              <div class="pt-2 mt-2">
                <el-button size="small" class="w-full justify-start group-btn" @click="showCreateGroupDialog">
                  <el-icon class="mr-1">
                    <PlusOutlined />
                  </el-icon>
                  新建分组
                </el-button>
              </div>
            </div>
          </div>
        </div>
      </template>
      <template #content>
        <div class="flex flex-col h-full p-3">
          <!-- 头部 -->
          <div class="flex justify-between items-center py-4">
            <span class="text-lg font-semibold text-gray-800 dark:text-gray-200">助手列表</span>
            <el-button type="primary" @click="createCharacter" class="flex items-center">
              <template #icon>
                <PlusOutlined />
              </template>
              新建助手
            </el-button>
          </div>

          <!-- 助手列表 -->
          <div class="flex-1 overflow-y-auto">
            <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 w-full">
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
                        <el-button link size="small" type="danger"
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
                  <el-button size="small" class="flex-1 shadow-sm" @click.stop="editCharacter(character)">
                    角色设置
                  </el-button>
                </div>
              </div>
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
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, reactive } from 'vue'
import { useRouter } from 'vue-router'
import {
  ElIcon,
  ElTooltip,
  ElDropdown,
  ElDropdownMenu,
  ElDropdownItem,
  ElButton,
  ElMessageBox
} from 'element-plus'
import {
  People
} from '@vicons/ionicons5'

import {
  PlusOutlined,
  DeleteOutlineOutlined,
  EditOutlined
} from '@vicons/material'

import {
  EllipsisHorizontal as MoreHorizOutlined
} from '@vicons/ionicons5'

import { useTitle } from '../composables/useTitle'
import { useStorage } from '@vueuse/core'
import { SidebarLayout } from './ui'
import { Avatar } from './ui'
import CharacterModal from './CharacterModal.vue'
import { apiService } from '../services/ApiService'
import { usePopup } from '../composables/usePopup'
import type { CharacterGroup } from '@/types/character'

const { confirm, toast } = usePopup()
const router = useRouter()
const title = useTitle('助手')

// 响应式数据
const characters = ref<any[]>([])
const groups = ref<CharacterGroup[]>([])
const currentGroupId = ref<string | null>(null)
const showModal = ref(false)
const currentCharacterId = ref('')
const loading = ref(false)
const sidebarVisible = useStorage<boolean>('CharacterSidebarVisible', true)

// 加载分组列表
const loadGroups = async (): Promise<void> => {
  try {
    groups.value = await apiService.fetchCharacterGroups()
  } catch (error: any) {
    console.error('获取分组列表失败:', error)
  }
}

// 加载角色列表
const loadCharacters = async (groupId?: string): Promise<void> => {
  loading.value = true
  try {
    const data = await apiService.fetchCharacters(groupId)
    characters.value = data.items
  } catch (error: any) {
    console.error('获取助手列表失败:', error)
    toast.error('获取助手列表失败')
  } finally {
    loading.value = false
  }
}

// 选择分组
const selectGroup = (groupId: string | null): void => {
  currentGroupId.value = groupId
  loadCharacters(groupId || undefined)
}

// 处理分组命令
const handleGroupCommand = async (command: string, group: CharacterGroup): Promise<void> => {
  if (command === 'rename') {
    try {
      const { value } = await ElMessageBox.prompt('请输入新的分组名称', '重命名分组', {
        inputValue: group.name,
        inputPattern: /\S+/,
        inputErrorMessage: '分组名称不能为空',
        confirmButtonText: '确定',
        cancelButtonText: '取消'
      })
      await apiService.updateCharacterGroup(group.id, { name: value })
      await loadGroups()
      toast.success('重命名成功')
    } catch (e) {
      // 取消操作
    }
  } else if (command === 'delete') {
    try {
      const result = await confirm('确认删除', `确定要删除分组「${group.name}」吗？该分组下的助手将变为未分组状态。`)
      if (result) {
        await apiService.deleteCharacterGroup(group.id)
        if (currentGroupId.value === group.id) {
          currentGroupId.value = null
        }
        await loadGroups()
        await loadCharacters(currentGroupId.value || undefined)
        toast.success('分组删除成功')
      }
    } catch (error: any) {
      console.error('删除分组失败:', error)
      toast.error(error.message || '删除失败')
    }
  }
}

// 显示新建分组对话框
const showCreateGroupDialog = async (): Promise<void> => {
  try {
    const { value } = await ElMessageBox.prompt('请输入分组名称', '新建分组', {
      inputPattern: /\S+/,
      inputErrorMessage: '分组名称不能为空',
      confirmButtonText: '确定',
      cancelButtonText: '取消'
    })
    await apiService.createCharacterGroup({ name: value })
    await loadGroups()
    toast.success('分组创建成功')
  } catch (e) {
    // 取消操作
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
    await loadCharacters(currentGroupId.value || undefined)
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

// 处理保存后的回调
const handleSaved = (characterData: any): void => {
  const index = characters.value.findIndex(c => c.id === characterData.id)
  if (index !== -1) {
    characters.value[index] = reactive(characterData)
  } else {
    characters.value.push(reactive(characterData))
  }
}

// 生命周期
onMounted(async (): Promise<void> => {
  await loadGroups()
  loadCharacters()
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

/* 分组按钮样式 */
.group-btn {
  background-color: #f5f7fa;
  border: none;
  color: #606266;
  transition: all 0.2s ease;
}

.group-btn:hover {
  background-color: #e4e7ed;
}

/* 分组操作按钮样式 */
.group-action-trigger {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0.25rem;
  border-radius: 0.25rem;
  cursor: pointer;
  transition: background-color 0.2s ease;
  opacity: 0;
}

.group-item:hover .group-action-trigger {
  opacity: 1;
}

.group-action-trigger:hover {
  background-color: rgba(0, 0, 0, 0.05);
}

.dark .group-action-trigger:hover {
  background-color: rgba(255, 255, 255, 0.1);
}
</style>
