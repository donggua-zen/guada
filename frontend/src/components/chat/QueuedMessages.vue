<template>
  <TransitionGroup name="queue" tag="div" class="queued-messages">
    <div v-for="item in queue" :key="item.id" class="queue-item"
      :class="{ 'is-sending': item.status === 'sending' }">
      <div class="queue-item-files" v-if="item.files?.length > 0">
        <el-icon size="12"><Attach24Regular /></el-icon>
        <span>{{ item.files.length }}</span>
      </div>
      <div class="queue-content" @click="item.status === 'queued' && emit('edit', item)">
        <span class="queue-text">{{ item.content }}</span>
      </div>
      <div class="queue-status">
        <el-icon v-if="item.status === 'sending'" class="is-loading" size="12">
          <Loading />
        </el-icon>
        <span class="queue-label">
          {{ item.status === 'sending' ? t('chat.queue.sending') : t('chat.queue.queued') }}
        </span>
      </div>
      <div class="queue-actions" v-if="item.status === 'queued'">
        <button class="queue-action-btn" @click="emit('edit', item)" :title="t('chat.queue.edit')">
          <el-icon size="14"><Edit24Regular /></el-icon>
        </button>
        <button class="queue-action-btn" @click="emit('remove', item.id)" :title="t('chat.queue.withdraw')">
          <el-icon size="14"><Dismiss24Regular /></el-icon>
        </button>
      </div>
    </div>
  </TransitionGroup>
</template>

<script setup lang="ts">
import { Loading } from '@element-plus/icons-vue'
import { Edit24Regular, Dismiss24Regular, Attach24Regular } from '@vicons/fluent'
import { useI18n } from 'vue-i18n'
import type { QueuedMessage } from '@/types/session'

const { t } = useI18n()

defineProps<{
  queue: QueuedMessage[]
}>()

const emit = defineEmits<{
  edit: [item: QueuedMessage]
  remove: [id: string]
}>()
</script>

<style scoped>
.queued-messages {
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 100%;
}

.queue-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  border-radius: var(--size-dialog-rounded-radius);
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

.queue-item-files {
  display: flex;
  align-items: center;
  gap: 2px;
  color: var(--color-text-gray, #999);
  flex-shrink: 0;
  font-size: 11px;
}

.queue-content {
  flex: 1;
  min-width: 0;
  cursor: pointer;
}

.queue-text {
  display: block;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--color-text, #333);
  line-height: 1.5;
}

.queue-status {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
  color: var(--color-text-gray, #999);
  font-size: 11px;
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
  color: var(--color-text-gray, #999);
  cursor: pointer;
  transition: all 0.15s;
}

.queue-action-btn:hover {
  background: var(--color-sidebar-bg-hover, rgba(0, 0, 0, 0.06));
  color: var(--color-text, #333);
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
