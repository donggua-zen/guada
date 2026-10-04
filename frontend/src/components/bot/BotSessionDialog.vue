<template>
  <GdDialog
    v-model="dialogVisible"
    :title="sessionTitle"
    width="80%"
    :style="{ maxWidth: '1200px' }"
    top="12.5vh"
    :close-on-click-modal="false"
    append-to-body
    class="bot-session-dialog"
  >
    <div style="height: 65vh; overflow-y: auto;">
      <!-- 加载状态 -->
      <div v-if="loading" class="flex justify-center items-center py-12">
        <el-icon class="is-loading" :size="32">
          <Loading />
        </el-icon>
        <span class="ml-2 text-gray-500 dark:text-[#8b8d95]">{{ t('bot.sessionDialog.loading') }}</span>
      </div>

      <!-- 消息列表 -->
      <div v-else-if="turns.length > 0" class="message-list">
        <TurnItem
          v-for="(turn, index) in visibleTurns"
          :key="turn.id"
          :turn="turn"
          :agent-name="props.session?.agent?.name"
          :agent-avatar="props.session?.agent?.avatarUrl"
          :is-last="index === visibleTurns.length - 1"
          :allow-generate="false"
          @delete="handleDeleteMessage"
          @edit="handleEditMessage"
          @copy="handleCopyMessage"
        />
      </div>

      <!-- 空状态 -->
      <div v-else class="text-center py-12">
        <el-icon size="48" class="text-gray-300 dark:text-[#3e4046] mb-3">
          <ChatDotRound />
        </el-icon>
        <p class="text-lg text-gray-500 dark:text-[#8b8d95]">{{ t('bot.sessionDialog.empty') }}</p>
      </div>
    </div>
  </GdDialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Loading, ChatDotRound } from '@element-plus/icons-vue'
import { apiService } from '@/services/ApiService'
import { foldEvents, type ProjectorSessionStore } from '@/services/modules/streamProjector'
import { isHiddenBlock } from '@/utils/messageUtils'
import TurnItem from '../chat/TurnItem.vue'
import type { Session } from '@/types/session'
import type { Turn, TurnContent } from '@/types/message'
import GdDialog from '@/components/ui/GdDialog.vue'

const props = defineProps<{
  modelValue: boolean
  session: Session | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()

const { t } = useI18n()

const dialogVisible = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value)
})

const sessionTitle = computed(() => {
  return props.session?.title || t('bot.sessionDialog.title')
})

const loading = ref(false)
const turns = ref<Turn[]>([])

// 从回合中取用户锚点消息束（role=user 且为人类输入，结构：turn → messages → blocks）
// 后端注入的 hidden user 消息同 role 但非用户输入，须排除
const userOfTurn = (turn: Turn): any =>
  turn.messages?.find((m) => m.role === 'user' && !isHiddenBlock(m)) ?? null

// 只保留含 user 锚点块的回合
const visibleTurns = computed(() => turns.value.filter((t) => userOfTurn(t)))

// 监听对话框打开,加载消息
watch(dialogVisible, async (visible) => {
  if (visible && props.session) {
    await loadMessages()
  }
})

// 加载消息列表（前端自折叠：拉事件页 → foldEvents 重建本地回合树）
const loadMessages = async () => {
  if (!props.session) return

  loading.value = true
  try {
    const page = await apiService.fetchSessionEvents(props.session.id, {
      turns: 100,
    })
    // 本地 store 适配器：foldEvents 通过 getTurns/setTurns 操作本地 turns ref
    const localStore = {
      getTurns: () => turns.value,
      setTurns: (_sid: string, t: Turn[]) => {
        turns.value = t
      },
      deleteTurnById: (_sid: string, id: string) => {
        turns.value = turns.value.filter((t) => t.id !== id)
      },
      setSessionIsCompressing: () => {},
      sessionIsCompressing: () => false,
      // 只读回放视图无交互卡：ask/turn_end 路径落空实现（此前缺失该方法是隐雷）
      setSessionPendingAsk: () => {},
      getSessionState: () => ({ loaded: true, turns: turns.value, eventLog: [] }),
    } satisfies ProjectorSessionStore
    foldEvents(localStore, props.session.id, page.events)
  } catch (error) {
    console.error('加载消息失败:', error)
    ElMessage.error(t('bot.sessionDialog.loadFailed'))
  } finally {
    loading.value = false
  }
}

// 删除本轮对话（按回合 id）
const handleDeleteMessage = async (turn: Turn) => {
  try {
    await ElMessageBox.confirm(
      t('bot.sessionDialog.deleteTurnDesc'),
      t('bot.sessionDialog.deleteTitle'),
      {
        confirmButtonText: t('common.ok'),
        cancelButtonText: t('common.cancel'),
        type: 'warning'
      }
    )
    
    if (props.session?.id) {
      // 按回合 id 整轮删除（前端直接消费 Turn 结构）
      await apiService.deleteTurn(props.session.id, turn.id)
    }
    
    // 整轮移除该回合
    turns.value = turns.value.filter((t) => t.id !== turn.id)
    
    ElMessage.success(t('bot.sessionDialog.deleteSuccess'))
  } catch (error) {
    if (error !== 'cancel') {
      console.error('删除本轮对话失败:', error)
      ElMessage.error(t('bot.sessionDialog.deleteFailed'))
    }
  }
}

// 编辑消息
const handleEditMessage = async (block: any) => {
  ElMessage.info(t('bot.sessionDialog.editNotImplemented'))
  // TODO: 实现编辑功能
}

// 复制消息
const handleCopyMessage = (block: any) => {
  // TurnItem 组件内部已经处理了复制逻辑
  // 这里可以添加额外的处理
}
</script>

<style scoped>
.message-list {
  padding: 20px;
  max-width: 900px;
  margin: 0 auto;
}
</style>
