<template>
  <div
    v-if="visible"
    ref="pickerRef"
    class="command-picker"
  >
    <div class="command-picker-list">
      <div
        v-for="(item, index) in filteredCommands"
        :key="item.name + index"
        class="command-picker-item"
        :class="{ active: index === selectedIndex }"
        @click="handleSelect(item)"
        @mouseenter="handleMouseEnter(index)"
      >
        <div class="command-picker-content">
          <span class="command-picker-icon">
            <el-icon size="16">
              <Apps20Regular />
            </el-icon>
          </span>
          <div class="command-picker-info flex items-center gap-2">
            <div class="command-picker-name whitespace-nowrap" :class="{ 'text-primary': index === selectedIndex }">
              {{ (item.providerId || 'skill') + ':' + (item.label || item.name || '') }}
            </div>
            <div class="command-picker-desc truncate">
              {{ item.description || '' }}
            </div>
          </div>
        </div>
      </div>
    </div>
    <div v-if="filteredCommands.length === 0" class="command-picker-empty">
      {{ trigger === 'slash' ? t('chat.input.noMatchCommand') : t('chat.input.noMatchMember') }}
    </div>
    <div class="command-picker-footer">
      <span><kbd>↑</kbd> <kbd>↓</kbd> {{ t('common.select') }}</span>
      <span><kbd>Enter</kbd> {{ t('common.confirm') }}</span>
      <span><kbd>Esc</kbd> {{ t('common.close') }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, nextTick } from 'vue';
import { useI18n } from 'vue-i18n';
import { Apps20Regular } from '@vicons/fluent';

const { t } = useI18n();

const props = defineProps<{
  visible: boolean;
  items: any[];
  query: string;
  selectedIndex: number;
  trigger: 'slash' | 'mention';
}>();

const emit = defineEmits<{
  'update:visible': [value: boolean];
  'update:selected-index': [value: number];
  select: [item: any];
  close: [];
}>();

const pickerRef = ref<HTMLElement | null>(null);
const localSelectedIndex = ref(0);

// 同步外部 selectedIndex → 内部
watch(() => props.selectedIndex, (val) => {
  localSelectedIndex.value = val;
}, { immediate: true });

// 同步内部 → 外部
watch(localSelectedIndex, (val) => {
  emit('update:selected-index', val);
});

// 弹窗打开 / query 变化时重置选中
watch(() => props.visible, (val) => {
  if (val) localSelectedIndex.value = 0;
});
watch(() => props.query, () => {
  localSelectedIndex.value = 0;
});

// 选中项改变时滚动到可见区
watch(localSelectedIndex, () => {
  scrollToSelectedItem();
});

const filteredCommands = computed(() => {
  const q = props.query;
  if (!q) return props.items;
  const lower = q.toLowerCase();
  return props.items.filter((s: any) => {
    const name = s.name || '';
    const desc = s.description || '';
    return name.toLowerCase().includes(lower) || desc.toLowerCase().includes(lower);
  });
});

const scrollToSelectedItem = () => {
  nextTick(() => {
    const listEl = pickerRef.value?.querySelector('.command-picker-list');
    const items = pickerRef.value?.querySelectorAll('.command-picker-item');
    if (!listEl || !items) return;
    const selectedEl = items[localSelectedIndex.value] as HTMLElement | undefined;
    if (!selectedEl) return;

    const listRect = listEl.getBoundingClientRect();
    const selectedRect = selectedEl.getBoundingClientRect();

    if (selectedRect.top < listRect.top) {
      listEl.scrollTop -= listRect.top - selectedRect.top;
    } else if (selectedRect.bottom > listRect.bottom) {
      listEl.scrollTop += selectedRect.bottom - listRect.bottom;
    }
  });
};

const handleSelect = (item: any) => {
  emit('select', item);
};

const handleMouseEnter = (index: number) => {
  localSelectedIndex.value = index;
};

const moveDown = () => {
  if (filteredCommands.value.length === 0) return;
  localSelectedIndex.value = (localSelectedIndex.value + 1) % filteredCommands.value.length;
};

const moveUp = () => {
  if (filteredCommands.value.length === 0) return;
  localSelectedIndex.value = (localSelectedIndex.value - 1 + filteredCommands.value.length) % filteredCommands.value.length;
};

const confirmSelection = () => {
  const item = filteredCommands.value[localSelectedIndex.value];
  if (item) {
    emit('select', item);
  }
};

const close = () => {
  emit('close');
};

defineExpose({
  moveDown,
  moveUp,
  confirmSelection,
  close,
});
</script>

<style scoped>
.command-picker {
  position: absolute;
  bottom: calc(100% + 28px);
  left: 0;
  right: 0;
  z-index: 1000;
  padding: 8px;
  border-radius: 12px;
  background: var(--el-bg-color, #fff);
  border: 1px solid var(--el-border-color, #dcdfe6);
  box-shadow: 0 -4px 24px rgba(0, 0, 0, 0.12);
  overflow: hidden;
}

.dark .command-picker {
  background: #2d2d2d;
  border-color: #3c3c3c;
  box-shadow: 0 -4px 24px rgba(0, 0, 0, 0.4);
}

.command-picker-list {
  max-height: 200px;
  overflow-y: auto;
  padding: 4px;
}

.command-picker-item {
  display: flex;
  align-items: center;
  padding: 4px 8px;
  cursor: pointer;
  transition: background 0.15s;
  border-radius: 8px;
}

.command-picker-item:hover,
.command-picker-item.active {
  background: var(--el-fill-color-light, #f5f7fa);
}

.dark .command-picker-item:hover,
.dark .command-picker-item.active {
  background: #3c3c3c;
}

.command-picker-content {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-width: 0;
  overflow: hidden;
}

.command-picker-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  flex-shrink: 0;
}

.command-picker-info {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
}

.command-picker-name {
  font-size: 14px;
  font-weight: 500;
  line-height: 1.4;
  white-space: nowrap;
  flex-shrink: 0;
}

.command-picker-name.text-primary {
  color: var(--el-color-primary);
}

.command-picker-desc {
  font-size: 12px;
  line-height: 1.4;
  color: var(--el-text-color-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  min-width: 0;
}

.command-picker-empty {
  padding: 16px;
  text-align: center;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

.command-picker-footer {
  display: flex;
  justify-content: flex-start;
  align-items: center;
  gap: 12px;
  padding: 5px 10px;
  border-top: 1px solid var(--el-border-color-light, #e4e7ed);
  font-size: 11px;
  color: var(--el-text-color-secondary);
}

.dark .command-picker-footer {
  border-top-color: var(--el-border-color-light, #3c3c3c);
}

.command-picker-footer kbd {
  display: inline-block;
  padding: 1px 4px;
  border: 1px solid var(--el-border-color, #dcdfe6);
  border-radius: 3px;
  background: var(--el-bg-color, #fff);
  color: var(--el-text-color-regular);
  font-family: inherit;
  font-size: 10px;
  line-height: 1.4;
}
</style>
