<template>
  <CustomPopover :show="visible" @update:show="$emit('update:visible', $event)" :width="280" :max-height="400"
    :anchor-el="anchorEl">
    <div class="att-popover">
      <!-- 上传图片 -->
      <div class="att-item" @click="$emit('select-image')">
        <el-icon size="16" class="att-item-icon shrink-0">
          <Image24Regular />
        </el-icon>
        <span class="att-item-name">{{ t('chat.input.uploadImage') }}</span>
      </div>

      <!-- 上传文件 -->
      <div class="att-item" @click="$emit('select-file')">
        <el-icon size="16" class="att-item-icon shrink-0">
          <Attach24Regular />
        </el-icon>
        <span class="att-item-name">{{ t('chat.input.uploadFile') }}</span>
      </div>

      <!-- 知识库 -->
      <div class="att-divider"></div>
      <div class="att-section-header">{{ t('chat.input.knowledgeBase') }}</div>
      <div class="att-kb-list">
        <div v-if="knowledgeBases.length === 0" class="text-center py-3 text-gray-400 dark:text-[#6b6d75] text-xs">
          {{ t('chat.input.noKnowledgeBase') }}
        </div>
        <div v-for="kb in knowledgeBases" :key="kb.id"
          class="att-kb-item" @click="$emit('toggle-kb', kb.id)">
          <el-checkbox :model-value="selectedIds.includes(kb.id)" @click.stop size="small" />
          <div class="flex-1 min-w-0">
            <div class="text-xs font-medium text-gray-700 dark:text-[#c5c7cc] truncate">{{ kb.name }}</div>
            <div v-if="kb.description" class="text-xs text-gray-400 dark:text-[#6b6d75] truncate">{{ kb.description }}</div>
          </div>
        </div>
      </div>

      <!-- 远程连接 -->
      <div class="att-divider"></div>
      <div class="att-section-header">{{ t('chat.input.remoteConnection') }}</div>
      <div class="att-kb-list">
        <div v-if="connections.length === 0" class="text-center py-3 text-gray-400 dark:text-[#6b6d75] text-xs">
          {{ t('chat.input.noConnection') }}
        </div>
        <div v-for="conn in connections" :key="conn.id"
          class="att-kb-item" @click="$emit('toggle-connection', conn.id)">
          <el-checkbox :model-value="selectedConnectionIds.includes(conn.id)" @click.stop size="small" />
          <div class="flex-1 min-w-0">
            <div class="text-xs font-medium text-gray-700 dark:text-[#c5c7cc] truncate">{{ conn.name }}</div>
            <div class="text-xs text-gray-400 dark:text-[#6b6d75] truncate">{{ conn.config.username }}@{{ conn.config.host }}</div>
          </div>
        </div>
      </div>
    </div>
  </CustomPopover>
</template>

<script setup lang="ts">
import { ElIcon, ElCheckbox } from 'element-plus';
import { useI18n } from 'vue-i18n'
import { Image24Regular, Attach24Regular } from '@vicons/fluent';
import CustomPopover from '../../ui/CustomPopover.vue';

const { t } = useI18n()

interface KnowledgeBase {
  id: string;
  name: string;
  description?: string;
}

interface SavedConnection {
  id: string;
  name: string;
  scheme: string;
  config: Record<string, any>;
}

defineProps<{
  visible: boolean;
  anchorEl: HTMLElement | null;
  knowledgeBases: KnowledgeBase[];
  selectedIds: string[];
  connections: SavedConnection[];
  selectedConnectionIds: string[];
}>();

defineEmits<{
  'update:visible': [value: boolean];
  'select-image': [];
  'select-file': [];
  'toggle-kb': [kbId: string];
  'toggle-connection': [connId: string];
}>();
</script>

<style scoped>
.att-popover {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.att-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 8px;
  border-radius: var(--size-dialog-rounded-radius);
  cursor: pointer;
  transition: all 0.15s;
}

.att-item:hover {
  background: var(--color-sidebar-bg-hover, #f5f5f5);
}

.dark .att-item:hover {
  background: rgba(255, 255, 255, 0.06);
}

.att-item-icon {
  color: #666;
}

.dark .att-item-icon {
  color: #9ca3af;
}

.att-item-name {
  font-size: 13px;
  font-weight: 500;
  color: #333;
}

.dark .att-item-name {
  color: #e5e7eb;
}

.att-section-header {
  font-size: 11px;
  font-weight: 500;
  color: #999;
  padding: 4px 8px;
  user-select: none;
}

.dark .att-section-header {
  color: #6b7280;
}

.att-divider {
  height: 1px;
  background: #eee;
  margin: 6px 8px;
}

.dark .att-divider {
  background: rgba(255, 255, 255, 0.08);
}

.att-kb-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 200px;
  overflow-y: auto;
}

.att-kb-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: var(--size-dialog-rounded-radius);
  cursor: pointer;
  transition: all 0.15s;
}

.att-kb-item:hover {
  background: var(--color-sidebar-bg-hover, #f5f5f5);
}

.dark .att-kb-item:hover {
  background: rgba(255, 255, 255, 0.06);
}
</style>
