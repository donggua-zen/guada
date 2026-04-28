<template>
  <div class="h-full flex flex-col md:max-w-260 md:mx-auto">
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

      <!-- 分组筛选标签区域 -->
      <div class="pb-4 border-b border-gray-200 dark:border-gray-700">
        <div class="flex flex-wrap gap-2">
          <!-- 全部助手标签 -->
          <div
            class="filter-tag px-4 py-2 rounded-full cursor-pointer transition-all duration-200 select-none"
            :class="currentGroupId === null ? 'active' : 'inactive'"
            @click="selectGroup(null)">
            全部助手
          </div>
          
          <!-- 分组标签 -->
          <div v-for="group in groups" :key="group.id"
            class="filter-tag group-tag px-4 py-2 rounded-full cursor-pointer transition-all duration-200 select-none flex items-center gap-2"
            :class="currentGroupId === group.id ? 'active' : 'inactive'"
            @click="selectGroup(group.id)"
            @contextmenu.prevent="handleGroupContextMenu($event, group)">
            <span>{{ group.name }}</span>
          </div>
          
          <!-- 新建分组按钮 -->
          <div class="filter-tag new-group-btn px-4 py-2 rounded-full cursor-pointer transition-all duration-200 select-none"
            @click="showCreateGroupDialog">
            <el-icon :size="16" class="mr-1">
              <PlusOutlined />
            </el-icon>
            新建分组
          </div>
        </div>
      </div>
      <!-- 助手列表 -->
      <div class="flex-1 overflow-y-auto pt-4">
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

    <!-- 右键菜单 -->
    <div v-if="contextMenu.visible"
      class="fixed bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 py-1 z-50 min-w-40"
      :style="{ left: contextMenu.x + 'px', top: contextMenu.y + 'px' }" @click.stop>
      <div
        class="px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer flex items-center gap-2"
        @click="handleRenameFromMenu">
        <el-icon>
          <EditOutlined />
        </el-icon>
        重命名
      </div>
      <div
        class="px-4 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer flex items-center gap-2"
        @click="handleDeleteFromMenu">
        <el-icon>
          <DeleteOutlineOutlined />
        </el-icon>
        删除
      </div>
    </div>

    <!-- 助手弹窗 -->
    <CharacterModal v-model:show="showModal" v-model:characterId="currentCharacterId" @saved="handleSaved" />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
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

import { useTitle } from '../../composables/useTitle'
import { Avatar } from '../ui'
import CharacterModal from './CharacterModal.vue'
import { apiService } from '../../services/ApiService'
import { usePopup } from '../../composables/usePopup'
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

// 右键菜单状态
const contextMenu = ref({
  visible: false,
  x: 0,
  y: 0,
  group: null as CharacterGroup | null
})

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

// 处理分组命令（保留用于兼容）
const handleGroupCommand = async (command: string, group: CharacterGroup): Promise<void> => {
  if (command === 'rename') {
    await handleRenameGroup(group)
  } else if (command === 'delete') {
    await handleDeleteGroup(group)
  }
}

// 处理分组右键菜单
const handleGroupContextMenu = (event: MouseEvent, group: CharacterGroup): void => {
  event.preventDefault()
  contextMenu.value = {
    visible: true,
    x: event.clientX,
    y: event.clientY,
    group
  }
}

// 从重命名菜单触发
const handleRenameFromMenu = async (): Promise<void> => {
  if (contextMenu.value.group) {
    await handleRenameGroup(contextMenu.value.group)
  }
  closeContextMenu()
}

// 从删除菜单触发
const handleDeleteFromMenu = async (): Promise<void> => {
  if (contextMenu.value.group) {
    await handleDeleteGroup(contextMenu.value.group)
  }
  closeContextMenu()
}

// 关闭右键菜单
const closeContextMenu = (): void => {
  contextMenu.value.visible = false
  contextMenu.value.group = null
}

// 重命名分组
const handleRenameGroup = async (group: CharacterGroup): Promise<void> => {
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
}

// 删除分组
const handleDeleteGroup = async (group: CharacterGroup): Promise<void> => {
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
const handleSaved = async (characterData: any): Promise<void> => {
  // 刷新分组列表（以防分组有变化）
  await loadGroups()
  // 刷新当前分组的角色列表
  await loadCharacters(currentGroupId.value || undefined)
}

// 生命周期
onMounted(async (): Promise<void> => {
  await loadGroups()
  loadCharacters()
  
  // 点击其他地方关闭菜单
  window.addEventListener('click', closeContextMenu)
})

// 组件卸载时清理事件监听器
onUnmounted(() => {
  window.removeEventListener('click', closeContextMenu)
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

/* 筛选标签样式 */
.filter-tag {
  font-size: 14px;
  border: 1px solid transparent;
  display: inline-flex;
  align-items: center;
}

.filter-tag.inactive {
  background-color: var(--color-surface);
  color: var(--color-text-gray);
  border-color: var(--color-border);
}

.filter-tag.inactive:hover {
  background-color: var(--color-primary-100);
  color: var(--color-primary);
  border-color: var(--color-primary-200);
}

.filter-tag.active {
  background-color: var(--color-primary);
  color: white;
  border-color: var(--color-primary);
  box-shadow: 0 2px 8px rgba(251, 114, 153, 0.3);
}

.filter-tag.active:hover {
  background-color: var(--color-primary-hover);
  border-color: var(--color-primary-hover);
}

/* 新建分组按钮特殊样式 */
.new-group-btn {
  background-color: transparent;
  border: 1px dashed var(--color-border);
  color: var(--color-text-gray);
}

.new-group-btn:hover {
  background-color: var(--color-primary-100);
  border-color: var(--color-primary);
  color: var(--color-primary);
}

/* 分组标签中的操作按钮样式已移除，改为右键菜单 */
</style>
