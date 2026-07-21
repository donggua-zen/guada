<template>
  <div class="h-full w-full flex flex-col min-h-0">
    <PageHeader title="助手" />
    <div class="flex flex-1 overflow-scroll w-full">
      <div class="flex-1 flex flex-col w-full md:max-w-260 md:mx-auto">
        <div class="flex-1 px-4 py-2 md:py-2">
          <CharacterListTab :characters="characters" :groups="groups" :currentGroupId="currentGroupId"
            :loading="loading" @create-character="createCharacter" @edit-character="editCharacter"
            @delete-character="deleteCharacter" @start-new-chat="startNewChat" @select-group="selectGroup"
            @create-group="showCreateGroupDialog" @rename-group="handleRenameGroup" @delete-group="handleDeleteGroup"
            @open-docs="openDocs" @imported="handleImported" />
        </div>
      </div>
    </div>
    <!-- 助手弹窗 -->
    <CharacterModal v-model:show="showModal" v-model:characterId="currentCharacterId" @saved="handleSaved" />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElButton, ElMessageBox } from 'element-plus'

import PageHeader from '@/components/PageHeader.vue'
import CharacterListTab from './CharacterListTab.vue'
import CharacterModal from './CharacterModal.vue'
import { apiService } from '../../services/ApiService'
import { usePopup } from '../../composables/usePopup'
import { openExternalLink } from '@/utils/modelUtils'
import type { CharacterGroup } from '@/types/character'
import { useSessionStore } from '@/stores/session'

const { confirm, toast } = usePopup()
const router = useRouter()
const sessionStore = useSessionStore()

// ========== 助手列表逻辑 ==========
const characters = ref<any[]>([])
const groups = ref<CharacterGroup[]>([])
const currentGroupId = ref<string | null>(null)
const showModal = ref(false)
const currentCharacterId = ref('')
const loading = ref(false)

const loadGroups = async (): Promise<void> => {
  try {
    groups.value = await apiService.fetchCharacterGroups()
  } catch (error: any) {
    console.error('获取分组列表失败:', error)
  }
}

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

const selectGroup = (groupId: string | null): void => {
  currentGroupId.value = groupId
  loadCharacters(groupId || undefined)
}

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

const createCharacter = (): void => {
  currentCharacterId.value = ''
  showModal.value = true
}

const editCharacter = (character: any): void => {
  currentCharacterId.value = character.id
  showModal.value = true
}

const deleteCharacter = async (character: any): Promise<void> => {
  try {
    const result = await confirm('确认删除', `确定要删除助手「${character.title}」吗？此操作不可撤销。`)
    if (!result) return
    await apiService.deleteCharacter(character.id)
    await loadCharacters(currentGroupId.value || undefined)
    toast.success('助手删除成功')
  } catch (error: any) {
    toast.error('删除失败')
    console.error('删除助手失败:', error)
  }
}

const startNewChat = async (character: any): Promise<void> => {
  try {
    const session = await apiService.createSession({
      characterId: character.id,
      title: character.title,
    })
    sessionStore.setSession(session)
    router.replace({ name: 'Chat', params: { sessionId: session.id } })
    toast.success('会话创建成功')
  } catch (error: any) {
    console.error('创建会话失败:', error)
    toast.error('创建会话失败')
  }
}

const openDocs = (): void => {
  openExternalLink('https://ai.dingd.cn/docs/assistant')
}

const handleSaved = async (characterData: any): Promise<void> => {
  await loadGroups()
  await loadCharacters(currentGroupId.value || undefined)
}

const handleImported = async (): Promise<void> => {
  await loadCharacters(currentGroupId.value || undefined)
}

// ========== 生命周期 ==========
onMounted(async (): Promise<void> => {
  await loadGroups()
  loadCharacters()
})
</script>
