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

      <!-- 知识库（内置，未来可迁移为 registerAttachmentType） -->
      <div class="att-divider"></div>
      <div class="att-section-header">{{ t('chat.input.knowledgeBase') }}</div>
      <div class="att-kb-list">
        <div v-if="knowledgeBases.length === 0" class="text-center py-3 text-gray-400 dark:text-[#6b6d75] text-xs">
          {{ t('chat.input.noKnowledgeBase') }}
        </div>
        <div v-for="kb in knowledgeBases" :key="kb.id"
          class="att-kb-item" @click="$emit('toggle-kb', kb.id)">
          <el-checkbox :model-value="selectedKbIds.includes(kb.id)" @click.stop size="small" />
          <div class="flex-1 min-w-0">
            <div class="text-xs font-medium text-gray-700 dark:text-[#c5c7cc] truncate">{{ kb.name }}</div>
            <div v-if="kb.description" class="text-xs text-gray-400 dark:text-[#6b6d75] truncate">{{ kb.description }}</div>
          </div>
        </div>
      </div>

      <!-- 动态附件类型（插件通过 registerAttachmentType 注册） -->
      <template v-for="attType in attachmentTypes" :key="attType.id">
        <div class="att-divider"></div>
        <div class="att-section-header">{{ attType.label }}</div>
        <div class="att-kb-list">
          <div v-if="!attType._items || attType._items.length === 0" class="text-center py-3 text-gray-400 dark:text-[#6b6d75] text-xs">
            {{ t('common.empty') }}
          </div>
          <div v-for="item in (attType._items || [])" :key="item.id"
            class="att-kb-item" @click="toggleAttachment(attType.id, item.id)">
            <el-checkbox :model-value="isAttachmentSelected(attType.id, item.id)" @click.stop size="small" />
            <div class="flex-1 min-w-0">
              <div class="text-xs font-medium text-gray-700 dark:text-[#c5c7cc] truncate">{{ item.name }}</div>
              <div v-if="item.description" class="text-xs text-gray-400 dark:text-[#6b6d75] truncate">{{ item.description }}</div>
            </div>
          </div>
        </div>
      </template>
    </div>
  </CustomPopover>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { ElIcon, ElCheckbox } from 'element-plus';
import { useI18n } from 'vue-i18n'
import { Image24Regular, Attach24Regular } from '@vicons/fluent';
import CustomPopover from '../../ui/CustomPopover.vue';
import { apiService } from '@/services/ApiService';
import type { AttachmentTypeInfo, AttachmentItem } from '@/services/modules/plugin.api';

const { t } = useI18n()

interface KnowledgeBase {
  id: string;
  name: string;
  description?: string;
}

interface DynamicAttachmentType extends AttachmentTypeInfo {
  _items?: AttachmentItem[];
}

const props = defineProps<{
  visible: boolean;
  anchorEl: HTMLElement | null;
  knowledgeBases: KnowledgeBase[];
  selectedKbIds: string[];
  selectedAttachments: Record<string, string[]>;
}>();

const emit = defineEmits<{
  'update:visible': [value: boolean];
  'select-image': [];
  'select-file': [];
  'toggle-kb': [kbId: string];
  'toggle-attachment': [typeId: string, itemId: string];
}>();

const attachmentTypes = ref<DynamicAttachmentType[]>([])

async function loadAttachmentTypes() {
  try {
    const types = await apiService.getAttachmentTypes()
    // Load items for each type
    const pluginGroups = new Map<string, string[]>()
    for (const t of types) {
      let arr = pluginGroups.get(t.pluginId)
      if (!arr) {
        arr = []
        pluginGroups.set(t.pluginId, arr)
      }
      arr.push(t.id)
    }

    const results: DynamicAttachmentType[] = []
    for (const [pluginId] of pluginGroups) {
      try {
        const lists = await apiService.getPluginAttachments(pluginId)
        for (const t of types.filter(t => t.pluginId === pluginId)) {
          const found = lists.find(l => l.typeId === t.id)
          results.push({ ...t, _items: found?.items || [] })
        }
      } catch {
        for (const t of types.filter(t => t.pluginId === pluginId)) {
          results.push({ ...t, _items: [] })
        }
      }
    }
    attachmentTypes.value = results
  } catch {
    attachmentTypes.value = []
  }
}

watch(() => props.visible, (v) => {
  if (v) loadAttachmentTypes()
}, { immediate: true })

function isAttachmentSelected(typeId: string, itemId: string): boolean {
  return (props.selectedAttachments[typeId] || []).includes(itemId)
}

function toggleAttachment(typeId: string, itemId: string) {
  emit('toggle-attachment', typeId, itemId)
}
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
