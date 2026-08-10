<template>
  <div class="h-full w-full flex flex-col min-h-0">
    <PageHeader :title="t('characters.page.title')" />
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
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { ElButton, ElMessageBox } from 'element-plus'

import PageHeader from '@/components/PageHeader.vue'
import CharacterListTab from './CharacterListTab.vue'
import CharacterModal from './CharacterModal.vue'
import { apiService } from '../../services/ApiService'
import { usePopup } from '../../composables/usePopup'
import { openInExternalBrowser } from '@/utils/browserUtils'
import type { CharacterGroup } from '@/types/character'
import { useSelectedCharacter } from '@/composables/useSelectedCharacter'

const { confirm, toast } = usePopup()
const { t } = useI18n()
const router = useRouter()
const { setSelectedCharacter } = useSelectedCharacter()

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
    toast.error(t('characters.page.loadFailed'))
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
    const { value } = await ElMessageBox.prompt(t('characters.page.renameGroupPlaceholder'), t('characters.page.renameGroupTitle'), {
      inputValue: group.name,
      inputPattern: /\S+/,
      inputErrorMessage: t('characters.page.groupNameEmpty'),
      confirmButtonText: t('common.ok'),
      cancelButtonText: t('common.cancel')
    })
    await apiService.updateCharacterGroup(group.id, { name: value })
    await loadGroups()
    toast.success(t('characters.page.renameSuccess'))
  } catch (e) {
    // 取消操作
  }
}

const handleDeleteGroup = async (group: CharacterGroup): Promise<void> => {
  try {
    const result = await confirm(t('characters.page.deleteGroupTitle'), t('characters.page.deleteGroupConfirm', { name: group.name }))
    if (result) {
      await apiService.deleteCharacterGroup(group.id)
      if (currentGroupId.value === group.id) {
        currentGroupId.value = null
      }
      await loadGroups()
      await loadCharacters(currentGroupId.value || undefined)
      toast.success(t('characters.page.groupDeleteSuccess'))
    }
  } catch (error: any) {
    console.error('删除分组失败:', error)
    toast.error(error.message || t('characters.page.groupDeleteFailed'))
  }
}

const showCreateGroupDialog = async (): Promise<void> => {
  try {
    const { value } = await ElMessageBox.prompt(t('characters.page.createGroupPlaceholder'), t('characters.page.createGroupTitle'), {
      inputPattern: /\S+/,
      inputErrorMessage: t('characters.page.groupNameEmpty'),
      confirmButtonText: t('common.ok'),
      cancelButtonText: t('common.cancel')
    })
    await apiService.createCharacterGroup({ name: value })
    await loadGroups()
    toast.success(t('characters.page.groupCreateSuccess'))
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
    const result = await confirm(t('characters.page.deleteCharacterTitle'), t('characters.page.deleteCharacterConfirm', { name: character.title }))
    if (!result) return
    await apiService.deleteCharacter(character.id)
    await loadCharacters(currentGroupId.value || undefined)
    toast.success(t('characters.page.characterDeleteSuccess'))
  } catch (error: any) {
    toast.error(t('characters.page.deleteFailed'))
    console.error('删除助手失败:', error)
  }
}

const startNewChat = (character: any): void => {
  setSelectedCharacter(character.id)
  router.push({ name: 'Chat', params: { sessionId: 'new-session' } })
}

const openDocs = (): void => {
  openInExternalBrowser('https://ai.dingd.cn/docs/assistant')
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
