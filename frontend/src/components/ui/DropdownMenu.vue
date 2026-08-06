<template>
  <div ref="dropdownRef" class="inline-flex" @click.stop="toggleDropdown">
    <!-- 触发区域 -->
    <div class="inline-flex">
      <slot></slot>
    </div>
  </div>
  <!-- 下拉菜单使用 Teleport 避免被父元素裁剪 -->
  <Teleport to="body">
    <Transition name="dropdown-fade">
      <div v-if="visible" ref="menuRef" class="fixed z-50 bg-(--color-surface) rounded-(--size-dialog-rounded-radius) shadow-lg border border-(--color-surface-border) py-1 min-w-30 overflow-clip" :style="menuStyle" @click.stop>
        <slot name="dropdown"></slot>
      </div>
    </Transition>
  </Teleport>
</template>

<script lang="ts">
export const dropdownKey = Symbol('dropdown');
</script>

<script setup lang="ts">
import { ref, nextTick, onBeforeUnmount, provide } from 'vue';

const emit = defineEmits<{
  command: [command: string];
}>();

const visible = ref(false);

const dropdownRef = ref<HTMLElement | null>(null);
const menuRef = ref<HTMLElement | null>(null);
const menuStyle = ref<Record<string, string>>({ top: '0px', left: '0px' });



const toggleDropdown = async () => {
  if (visible.value) {
    closeDropdown();
    return;
  }
  visible.value = true;
  await nextTick();
  updatePosition();
  document.addEventListener('click', handleClickOutside, true);
  startScrollTracking();
};

const closeDropdown = () => {
  visible.value = false;
  document.removeEventListener('click', handleClickOutside, true);
  stopScrollTracking();
};

const updatePosition = () => {
  const rect = dropdownRef.value?.getBoundingClientRect();
  if (!rect) return;

  const menuHeight = menuRef.value?.offsetHeight || 160;
  const spaceBelow = window.innerHeight - rect.bottom;
  const spaceAbove = rect.top;
  const MARGIN = 8;

  if (spaceBelow < menuHeight && spaceAbove > spaceBelow) {
    // 下方空间不足且上方空间更大，改为向上弹出
    menuStyle.value = {
      top: `${Math.max(MARGIN, rect.top - menuHeight)}px`,
      left: `${rect.left + rect.width / 2}px`,
      transform: 'translateX(-50%)'
    };
  } else {
    // 默认向下弹出
    menuStyle.value = {
      top: `${rect.bottom + 4}px`,
      left: `${rect.left + rect.width / 2}px`,
      transform: 'translateX(-50%)'
    };
  }
};

let lastScrollY = 0;
let lastScrollX = 0;
let elementScrollPositions = new WeakMap<Element, { top: number; left: number }>();

const startScrollTracking = () => {
  lastScrollY = window.scrollY;
  lastScrollX = window.scrollX;
  elementScrollPositions = new WeakMap();
  window.addEventListener('scroll', handleScrollClose, true);
};

const stopScrollTracking = () => {
  window.removeEventListener('scroll', handleScrollClose, true);
};

const handleScrollClose = (event: Event) => {
  const target = event.target;

  // Document/window scroll
  if (target === document || target === window) {
    if (window.scrollY !== lastScrollY || window.scrollX !== lastScrollX) {
      closeDropdown();
    }
    return;
  }

  // Element scroll
  if (target instanceof Element) {
    const current = { top: target.scrollTop, left: target.scrollLeft };
    const prev = elementScrollPositions.get(target);
    if (!prev) {
      elementScrollPositions.set(target, current);
      return;
    }
    if (prev.top !== current.top || prev.left !== current.left) {
      closeDropdown();
    }
  }
};



const handleClickOutside = (event: MouseEvent) => {
  const target = event.target as HTMLElement;

  // 如果点击在菜单内部，不关闭
  if (menuRef.value && menuRef.value.contains(target)) {
    return;
  }

  // 如果点击在触发器上，不关闭（由 toggleDropdown 处理）
  if (dropdownRef.value && dropdownRef.value.contains(target)) {
    return;
  }

  closeDropdown();
};

// 提供注入给子组件
provide(dropdownKey, {
  handleItemClick: (command: string) => {
    visible.value = false;
    document.removeEventListener('click', handleClickOutside, true);
    stopScrollTracking();
    emit('command', command);
  }
});

onBeforeUnmount(() => {
  document.removeEventListener('click', handleClickOutside, true);
  stopScrollTracking();
});

// 暴露方法给父组件
defineExpose({
  open: () => {
    if (!visible.value) toggleDropdown();
  },
  close: closeDropdown
});
</script>

<style scoped>
.dropdown-fade-enter-active,
.dropdown-fade-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}

.dropdown-fade-enter-from,
.dropdown-fade-leave-to {
  opacity: 0;
  transform: translateX(-50%) scale(0.95);
}
</style>

