<template>
  <div class="queued-messages">
    <!-- 表头：数量 + 暂停；暂停后由下方横幅承接"继续发送" -->
    <div class="queue-header">
      <span class="queue-title">{{ t('chat.queue.title', { n: queue.length }) }}</span>
      <button v-if="!pausedReason" class="queue-header-btn" :title="t('chat.queue.pause')" @click="emit('pause')">
        <el-icon size="13"><Pause24Filled /></el-icon>
      </button>
    </div>

    <!-- 暂停横幅：停止/出错/手动暂停后队列保留但不再自动补发，需要用户显式继续 -->
    <div v-if="pausedReason" class="queue-paused">
      <el-icon size="13" class="queue-paused-icon">
        <Warning24Filled />
      </el-icon>
      <span class="queue-paused-text">{{ pauseLabel(pausedReason) }}</span>
      <button class="queue-resume-btn" @click="emit('continue')">
        {{ t('chat.queue.continue') }}
      </button>
    </div>

    <TransitionGroup name="queue" tag="div" class="queue-list">
      <div v-for="item in queue" :key="item.id" class="queue-item" :class="{
        'is-sending': item.status === 'running',
        'is-failed': item.status === 'failed',
        'is-promoting': isPromoting(item),
      }" :title="item.status === 'failed' ? item.error : undefined">
        <div class="queue-item-files" v-if="item.files?.length > 0">
          <el-icon size="12"><Attach24Regular /></el-icon>
          <span>{{ item.files.length }}</span>
        </div>
        <div class="queue-content" @click="item.status === 'queued' && emit('edit', item)">
          <span class="queue-text">{{ item.content }}</span>
        </div>
        <div class="queue-status">
          <el-icon v-if="item.status === 'running' || isPromoting(item)" class="is-loading" size="12">
            <Loading />
          </el-icon>
          <el-icon v-else-if="item.status === 'failed'" size="12" class="queue-failed-icon">
            <Warning24Filled />
          </el-icon>
          <span class="queue-label" :class="{ 'is-failed': item.status === 'failed' }">
            {{ queueLabel(item) }}
          </span>
        </div>
        <div class="queue-actions" v-if="item.status === 'queued' && !isPromoting(item)">
          <button class="queue-action-btn" :disabled="!canMoveUp(item.id)" :title="t('chat.queue.moveUp')"
            @click="emit('move', item.id, -1)">
            <el-icon size="14"><ArrowUp24Regular /></el-icon>
          </button>
          <button class="queue-action-btn" :disabled="!canMoveDown(item.id)" :title="t('chat.queue.moveDown')"
            @click="emit('move', item.id, 1)">
            <el-icon size="14"><ArrowDown24Regular /></el-icon>
          </button>
          <button class="queue-action-btn" :title="t('chat.queue.sendNow')" @click="emit('sendNow', item.id)">
            <el-icon size="14"><Play24Filled /></el-icon>
          </button>
          <button class="queue-action-btn" @click="emit('edit', item)" :title="t('chat.queue.edit')">
            <el-icon size="14"><Edit24Regular /></el-icon>
          </button>
          <button class="queue-action-btn" @click="emit('remove', item.id)" :title="t('chat.queue.withdraw')">
            <el-icon size="14"><Dismiss24Regular /></el-icon>
          </button>
        </div>
        <div class="queue-actions" v-else-if="item.status === 'failed'">
          <button class="queue-action-btn" @click="emit('retry', item.id)" :title="t('chat.queue.retry')">
            <el-icon size="14"><ArrowClockwise24Regular /></el-icon>
          </button>
          <button class="queue-action-btn" @click="emit('remove', item.id)" :title="t('chat.queue.withdraw')">
            <el-icon size="14"><Dismiss24Regular /></el-icon>
          </button>
        </div>
      </div>
    </TransitionGroup>
  </div>
</template>

<script setup lang="ts">
import { Loading } from '@element-plus/icons-vue'
import {
  ArrowClockwise24Regular,
  ArrowDown24Regular,
  ArrowUp24Regular,
  Attach24Regular,
  Dismiss24Regular,
  Edit24Regular,
  Pause24Filled,
  Play24Filled,
  Warning24Filled,
} from '@vicons/fluent'
import { useI18n } from 'vue-i18n'
import type { QueuedMessage, QueuePauseReason } from '@/types/session'

const { t } = useI18n()

const props = withDefaults(defineProps<{
  queue: QueuedMessage[]
  /** 队列暂停原因（停止/出错/手动后不自动补发） */
  pausedReason?: QueuePauseReason | null
  /** 已请求"立即发送"、等待当前回合结束的项 */
  promotingId?: string | null
  /** 上/下移可用态由 ChatPanel 按 store 规则计算 */
  canMoveUp?: (id: string) => boolean
  canMoveDown?: (id: string) => boolean
}>(), {
  pausedReason: null,
  promotingId: null,
  canMoveUp: () => false,
  canMoveDown: () => false,
})

const emit = defineEmits<{
  edit: [item: QueuedMessage]
  remove: [id: string]
  retry: [id: string]
  continue: []
  pause: []
  sendNow: [id: string]
  move: [id: string, direction: -1 | 1]
}>()

function isPromoting(item: QueuedMessage): boolean {
  return !!props.promotingId && props.promotingId === item.id
}

function queueLabel(item: QueuedMessage): string {
  if (isPromoting(item)) return t('chat.queue.promoting')
  if (item.status === 'running') return t('chat.queue.sending')
  if (item.status === 'failed') return t('chat.queue.failed')
  return t('chat.queue.queued')
}

function pauseLabel(reason: QueuePauseReason): string {
  if (reason === 'stopped') return t('chat.queue.pausedStopped')
  if (reason === 'error') return t('chat.queue.pausedError')
  return t('chat.queue.pausedManual')
}
</script>

<style scoped>
.queued-messages {
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 100%;
}

.queue-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 2px 12px;
  font-size: 11px;
  color: var(--gd-color-text-gray, #999);
}

.queue-header-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--gd-color-text-gray, #999);
  cursor: pointer;
  transition: all 0.15s;
}

.queue-header-btn:hover {
  background: var(--gd-color-sidebar-bg-hover, rgba(0, 0, 0, 0.06));
  color: var(--gd-color-text, #333);
}

.queue-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 100%;
}

.queue-paused {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 12px;
  border-radius: var(--gd-size-dialog-rounded-radius);
  font-size: 12px;
  color: var(--el-color-warning-dark-2, #b88230);
  background: var(--el-color-warning-light-9, rgba(230, 162, 60, 0.12));
}

.queue-paused-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.queue-resume-btn {
  flex-shrink: 0;
  border: none;
  border-radius: 6px;
  padding: 2px 8px;
  font-size: 12px;
  cursor: pointer;
  color: var(--el-color-warning-dark-2, #b88230);
  background: transparent;
  transition: background 0.15s;
}

.queue-resume-btn:hover {
  background: var(--el-color-warning-light-8, rgba(230, 162, 60, 0.22));
}

.queue-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  border-radius: var(--gd-size-dialog-rounded-radius);
  font-size: 13px;
  transition: all 0.2s;
}

.queue-item:hover {
  background: var(--el-fill-color, rgba(200, 200, 200, 0.2));
}

.queue-item.is-sending {
  opacity: 0.6;
  pointer-events: none;
}

.queue-item.is-failed {
  background: var(--el-color-danger-light-9, rgba(245, 108, 108, 0.08));
}

.queue-item.is-promoting {
  opacity: 0.75;
}

.queue-item-files {
  display: flex;
  align-items: center;
  gap: 2px;
  color: var(--gd-color-text-gray, #999);
  flex-shrink: 0;
  font-size: 11px;
}

.queue-content {
  flex: 1;
  min-width: 0;
  cursor: pointer;
}

.queue-item.is-failed .queue-content {
  cursor: default;
}

.queue-text {
  display: block;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--gd-color-text, #333);
  /* 整数行高：13 × 1.5 = 19.5px（.queue-item 的字号）会让文字基线落在半像素 */
  line-height: 20px;
}

.queue-status {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
  color: var(--gd-color-text-gray, #999);
  font-size: 11px;
}

.queue-failed-icon,
.queue-label.is-failed {
  color: var(--el-color-danger, #f56c6c);
}

.queue-label {
  white-space: nowrap;
}

.queue-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}

.queue-action-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--gd-color-text-gray, #999);
  cursor: pointer;
  transition: all 0.15s;
}

.queue-action-btn:hover:not(:disabled) {
  background: var(--gd-color-sidebar-bg-hover, rgba(0, 0, 0, 0.06));
  color: var(--gd-color-text, #333);
}

.queue-action-btn:disabled {
  opacity: 0.3;
  cursor: default;
}

.queue-enter-active,
.queue-leave-active {
  transition: all 0.25s ease;
}

.queue-enter-from {
  opacity: 0;
  transform: translateY(8px);
}

.queue-leave-to {
  opacity: 0;
  transform: translateX(20px);
}

.queue-move {
  transition: transform 0.25s ease;
}
</style>
