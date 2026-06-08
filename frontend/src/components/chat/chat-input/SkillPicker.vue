<template>
  <div
    v-if="visible"
    ref="pickerRef"
    class="skill-picker"
    :style="pickerStyle"
  >
    <div class="skill-picker-list">
      <div
        v-for="(skill, index) in filteredSkills"
        :key="skill.id"
        class="skill-picker-item"
        :class="{ active: index === selectedIndex }"
        @click="handleSelect(skill)"
        @mouseenter="handleMouseEnter(index)"
      >
        <div class="skill-picker-content">
          <span class="skill-picker-icon">
            <el-icon size="16">
              <Apps20Regular />
            </el-icon>
          </span>
          <div class="skill-picker-info">
            <div class="skill-picker-name" :class="{ 'text-primary': index === selectedIndex }">
              {{ skill.manifest?.name || skill.name || skill.id }}
            </div>
            <div class="skill-picker-desc">
              {{ skill.manifest?.description || skill.description || '' }}
            </div>
          </div>
        </div>
      </div>
    </div>
    <div v-if="filteredSkills.length === 0" class="skill-picker-empty">
      未找到匹配的技能
    </div>
    <div class="skill-picker-footer">
      <span><kbd>↑</kbd> <kbd>↓</kbd> 选择</span>
      <span><kbd>Enter</kbd> 确认</span>
      <span><kbd>Esc</kbd> 关闭</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, nextTick } from 'vue';
import { Apps20Regular } from '@vicons/fluent';

export interface SkillItem {
  id: string;
  name?: string;
  description?: string;
  manifest?: {
    name: string;
    description: string;
    version?: string;
    tags?: string[];
  };
}

const props = defineProps<{
  visible: boolean;
  skills: SkillItem[];
  query: string;
  anchorEl: HTMLElement | null;
}>();

const emit = defineEmits<{
  select: [skill: SkillItem];
  close: [];
}>();

const pickerRef = ref<HTMLElement | null>(null);
const selectedIndex = ref(0);

const filteredSkills = computed(() => {
  if (!props.query) return props.skills;
  const q = props.query.toLowerCase();
  return props.skills.filter((s) => {
    const name = s.manifest?.name || s.name || s.id;
    const desc = s.manifest?.description || s.description || '';
    return name.toLowerCase().includes(q) || desc.toLowerCase().includes(q);
  });
});

const pickerStyle = computed(() => {
  if (!props.anchorEl) return {};
  const rect = props.anchorEl.getBoundingClientRect();
  return {
    position: 'absolute' as const,
    bottom: 'calc(100% + 8px)',
    left: '0',
    right: '0',
  };
});

watch(
  () => props.visible,
  (val) => {
    if (val) selectedIndex.value = 0;
  }
);

watch(
  () => props.query,
  () => {
    selectedIndex.value = 0;
  }
);

watch(selectedIndex, () => {
  scrollToSelectedItem();
});

const scrollToSelectedItem = () => {
  nextTick(() => {
    const listEl = pickerRef.value?.querySelector('.skill-picker-list');
    const selectedEl = pickerRef.value?.querySelectorAll('.skill-picker-item')[selectedIndex.value];
    if (!listEl || !selectedEl) return;

    const listRect = listEl.getBoundingClientRect();
    const selectedRect = selectedEl.getBoundingClientRect();

    if (selectedRect.top < listRect.top) {
      listEl.scrollTop -= listRect.top - selectedRect.top;
    } else if (selectedRect.bottom > listRect.bottom) {
      listEl.scrollTop += selectedRect.bottom - listRect.bottom;
    }
  });
};

const handleSelect = (skill: SkillItem) => {
  emit('select', skill);
};

const handleMouseEnter = (index: number) => {
  selectedIndex.value = index;
};

const moveDown = () => {
  if (filteredSkills.value.length === 0) return;
  selectedIndex.value = (selectedIndex.value + 1) % filteredSkills.value.length;
};

const moveUp = () => {
  if (filteredSkills.value.length === 0) return;
  selectedIndex.value =
    (selectedIndex.value - 1 + filteredSkills.value.length) % filteredSkills.value.length;
};

const confirmSelection = () => {
  const skill = filteredSkills.value[selectedIndex.value];
  if (skill) {
    emit('select', skill);
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
.skill-picker {
  z-index: 1000;
  background: var(--el-bg-color, #fff);
  border: 1px solid var(--el-border-color, #dcdfe6);
  border-radius: 12px;
  box-shadow: 0 -4px 24px rgba(0, 0, 0, 0.12);
  overflow: hidden;
}

.dark .skill-picker {
  box-shadow: 0 -4px 24px rgba(0, 0, 0, 0.4);
}

.skill-picker-list {
  max-height: 200px;
  overflow-y: auto;
  padding: 4px;
}

.skill-picker-item {
  display: flex;
  align-items: center;
  padding: 6px 8px;
  cursor: pointer;
  transition: background 0.15s;
  border-radius: 8px;
}

.skill-picker-item:hover,
.skill-picker-item.active {
  background: var(--el-fill-color-light, #f5f7fa);
}

.dark .skill-picker-item:hover,
.dark .skill-picker-item.active {
  background: var(--el-fill-color-light, #3c3c3c);
}

.skill-picker-content {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
}

.skill-picker-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  flex-shrink: 0;
  color: var(--el-text-color-secondary);
}

.skill-picker-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.skill-picker-name {
  font-size: 14px;
  font-weight: 500;
  line-height: 1.4;
  color: var(--el-text-color-primary);
}

.skill-picker-name.text-primary {
  color: var(--el-color-primary);
}

.skill-picker-desc {
  font-size: 12px;
  line-height: 1.4;
  color: var(--el-text-color-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.skill-picker-empty {
  padding: 16px;
  text-align: center;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

.skill-picker-footer {
  display: flex;
  justify-content: flex-start;
  align-items: center;
  gap: 12px;
  padding: 5px 10px;
  border-top: 1px solid var(--el-border-color-light, #e4e7ed);
  background: var(--el-fill-color-lighter, #fafafa);
  font-size: 11px;
  color: var(--el-text-color-secondary);
}

.dark .skill-picker-footer {
  background: var(--el-fill-color-lighter, #2a2c30);
}

.skill-picker-footer kbd {
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
