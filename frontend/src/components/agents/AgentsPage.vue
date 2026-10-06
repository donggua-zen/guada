<template>
  <div class="h-full w-full flex flex-col min-h-0">
    <PageHeader :title="t('agents.page.title')" />
    <div class="flex flex-1 overflow-scroll w-full">
      <div class="flex-1 flex flex-col w-full md:max-w-260 md:mx-auto">
        <div class="flex-1 px-4 py-2 md:py-2">
          <AgentListTab :agents="agents" :loading="loading" @create-agent="createAgent"
            @edit-agent="editAgent" @delete-agent="deleteAgent" @start-new-chat="startNewChat"
            @open-docs="openDocs" @imported="handleImported" />
        </div>
      </div>
    </div>
    <!-- 智能体弹窗 -->
    <AgentModal v-model:show="showModal" v-model:agentId="currentAgentId" @saved="handleSaved" />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

import PageHeader from '@/components/PageHeader.vue'
import AgentListTab from './AgentListTab.vue'
import AgentModal from './AgentModal.vue'
import { apiService } from '../../services/ApiService'
import { usePopup } from '../../composables/usePopup'
import { openInExternalBrowser } from '@/utils/browserUtils'
import { useSelectedAgent } from '../../composables/useSelectedAgent'
import type { Agent } from '@/types/agent'

const { confirm, toast } = usePopup()
const { t } = useI18n()
const router = useRouter()
const { setSelectedAgent } = useSelectedAgent()

// ========== 智能体列表逻辑 ==========
const agents = ref<Agent[]>([])
const showModal = ref(false)
const currentAgentId = ref('')
const loading = ref(false)

const loadAgents = async (): Promise<void> => {
  loading.value = true
  try {
    const data = await apiService.fetchAgents()
    agents.value = data.items
  } catch (error) {
    console.error('获取智能体列表失败:', error)
    toast.error(t('agents.page.loadFailed'))
  } finally {
    loading.value = false
  }
}

const createAgent = (): void => {
  currentAgentId.value = ''
  showModal.value = true
}

const editAgent = (agent: Agent): void => {
  currentAgentId.value = agent.id
  showModal.value = true
}

const deleteAgent = async (agent: Agent): Promise<void> => {
  try {
    const result = await confirm(t('agents.page.deleteAgentTitle'), t('agents.page.deleteAgentConfirm', { name: agent.name }))
    if (!result) return
    await apiService.deleteAgent(agent.id)
    await loadAgents()
    toast.success(t('agents.page.agentDeleteSuccess'))
  } catch (error) {
    toast.error(t('agents.page.deleteFailed'))
    console.error('删除智能体失败:', error)
  }
}

const startNewChat = (agent: Agent): void => {
  setSelectedAgent(agent.id)
  router.push({ name: 'Chat', params: { sessionId: 'new-session' } })
}

const openDocs = (): void => {
  openInExternalBrowser('https://ai.dingd.cn/docs/assistant')
}

const handleSaved = async (): Promise<void> => {
  await loadAgents()
}

const handleImported = async (): Promise<void> => {
  await loadAgents()
}

// ========== 生命周期 ==========
onMounted(async (): Promise<void> => {
  loadAgents()
})
</script>
