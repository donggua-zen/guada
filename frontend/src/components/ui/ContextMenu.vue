<template>
  <Teleport to="body">
    <!-- 菜单面板 -->
    <div
      v-if="visible"
      ref="menuRef"
      class="fixed z-[1000] bg-(--color-surface) dark:bg-[#232428] rounded-lg shadow-lg border border-(--color-surface-border) py-1 min-w-40"
      :style="{ left: adjustedX + 'px', top: adjustedY + 'px' }"
      @click.stop
      @contextmenu.prevent
    >
      <div
        v-for="(item, index) in items"
        :key="index"
        class="px-4 py-2 text-sm text-gray-700 dark:text-[#e8e9ed] hover:bg-gray-100 dark:hover:bg-[#2a2c30] cursor-pointer flex items-center gap-2"
        :class="{ 'border-t border-gray-100 dark:border-[#2e3035]': item.divider }"
        @click="handleItemClick(item)"
      >
        <el-icon v-if="item.icon" size="16">
          <component :is="item.icon" />
        </el-icon>
        <span>{{ item.label }}</span>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, watch, onUnmounted } from 'vue'
import type { Component } from 'vue'

export interface ContextMenuItem {
  label: string
  icon?: Component
  divider?: boolean
  disabled?: boolean
  onClick: () => void
}

const props = defineProps<{
  visible: boolean
  x: number
  y: number
  items: ContextMenuItem[]
}>()

const emit = defineEmits<{
  close: []
}>()

const menuRef = ref<HTMLElement | null>(null)
const adjustedX = ref(props.x)
const adjustedY = ref(props.y)

function close() {
  emit('close')
}

function handleItemClick(item: ContextMenuItem) {
  if (item.disabled) return
  item.onClick()
  close()
}

// 左键点击文档任意处 → 关闭菜单并消费事件，阻止透传到底层（如输入框聚焦）
function onDocumentMouseDown(e: MouseEvent) {
  if (!menuRef.value) return
  // 点击在菜单内部 → 不拦截
  if (menuRef.value.contains(e.target as Node)) return
  e.stopPropagation()
  e.preventDefault()
  close()
}

// 右键点击文档任意处 → 关闭当前菜单，让原生事件自然透传到底层
function onDocumentContextMenu(e: MouseEvent) {
  if (!menuRef.value) return
  // 点击在菜单内部 → 不关闭
  if (menuRef.value.contains(e.target as Node)) return
  close()
}

watch(() => props.visible, (val) => {
  if (val) {
    adjustedX.value = props.x
    adjustedY.value = props.y
    document.addEventListener('mousedown', onDocumentMouseDown, { capture: true })
    document.addEventListener('contextmenu', onDocumentContextMenu, { capture: true })
    document.addEventListener('keydown', onDocumentKeydown)
    // 超出视口偏移
    requestAnimationFrame(() => {
      if (!menuRef.value) return
      const rect = menuRef.value.getBoundingClientRect()
      const { innerWidth, innerHeight } = window
      if (rect.right > innerWidth) adjustedX.value = props.x - (rect.right - innerWidth) - 4
      if (rect.bottom > innerHeight) adjustedY.value = props.y - (rect.bottom - innerHeight) - 4
    })
  } else {
    document.removeEventListener('mousedown', onDocumentMouseDown, { capture: true })
    document.removeEventListener('contextmenu', onDocumentContextMenu, { capture: true })
    document.removeEventListener('keydown', onDocumentKeydown)
  }
})

function onDocumentKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') close()
}

onUnmounted(() => {
  document.removeEventListener('mousedown', onDocumentMouseDown, { capture: true })
  document.removeEventListener('contextmenu', onDocumentContextMenu, { capture: true })
  document.removeEventListener('keydown', onDocumentKeydown)
})
</script>
