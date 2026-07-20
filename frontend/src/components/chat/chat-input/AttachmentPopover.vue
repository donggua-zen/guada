<template>
  <CustomPopover :show="visible" @update:show="$emit('update:visible', $event)" :width="280" :max-height="400"
    :anchor-el="anchorEl">
    <div class="att-popover">
      <!-- 上传图片 -->
      <div class="att-item" @click="$emit('select-image')">
        <el-icon size="16" class="att-item-icon shrink-0">
          <Image24Regular />
        </el-icon>
        <span class="att-item-name">上传图片</span>
      </div>

      <!-- 上传文件 -->
      <div class="att-item" @click="$emit('select-file')">
        <el-icon size="16" class="att-item-icon shrink-0">
          <Attach24Regular />
        </el-icon>
        <span class="att-item-name">上传文件</span>
      </div>

      <!-- 知识库 -->
      <div class="att-divider"></div>
      <div class="att-section-header">知识库</div>
      <div class="att-kb-list">
        <div v-if="knowledgeBases.length === 0" class="text-center py-3 text-gray-400 dark:text-[#6b6d75] text-xs">
          暂无知识库
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
    </div>
  </CustomPopover>
</template>

<script setup lang="ts">
import { ElIcon, ElCheckbox } from 'element-plus';
import { Image24Regular, Attach24Regular } from '@vicons/fluent';
import CustomPopover from '../../ui/CustomPopover.vue';

interface KnowledgeBase {
  id: string;
  name: string;
  description?: string;
}

defineProps<{
  visible: boolean;
  anchorEl: HTMLElement | null;
  knowledgeBases: KnowledgeBase[];
  selectedIds: string[];
}>();

defineEmits<{
  'update:visible': [value: boolean];
  'select-image': [];
  'select-file': [];
  'toggle-kb': [kbId: string];
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
  border-radius: 6px;
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
  border-radius: 6px;
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
