<template>
  <Teleport to="body">
    <!-- 菜单面板 -->
    <div
      v-if="visible"
      ref="menuRef"
      class="fixed z-(--gd-z-context-menu) bg-(--gd-color-surface) dark:bg-[#232428] rounded-lg shadow-lg border border-(--gd-color-surface-border) py-1 min-w-40"
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
/** 菜单打开时刻：用于过滤"打开菜单的同一个手势"顺带产生的 window blur */
let openedAt = 0

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

// 焦点离开本窗口（点进预览 iframe、切到其他应用）→ 菜单失去上下文，直接关闭
function onWindowBlur() {
  // 打开菜单的那次 mousedown 可能同时把焦点移入预览 iframe 并触发 window blur，
  // 而该事件可能晚于 contextmenu 到达；刚打开的一小段时间内忽略，避免菜单刚出现就被关掉
  if (performance.now() - openedAt < 250) return
  close()
}

// 任意容器滚动 → 菜单锚点已失效（捕获阶段监听，可收到内层滚动元素的 scroll）
function onScroll() {
  close()
}

function onWindowResize() {
  close()
}

function onDocumentKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') close()
}

/** 按当前 props 坐标重新定位（含视口越界回推） */
function reposition() {
  adjustedX.value = props.x
  adjustedY.value = props.y
  requestAnimationFrame(() => {
    if (!menuRef.value) return
    const rect = menuRef.value.getBoundingClientRect()
    const { innerWidth, innerHeight } = window
    if (rect.right > innerWidth) adjustedX.value = props.x - (rect.right - innerWidth) - 4
    if (rect.bottom > innerHeight) adjustedY.value = props.y - (rect.bottom - innerHeight) - 4
  })
}

function attachListeners() {
  document.addEventListener('mousedown', onDocumentMouseDown, { capture: true })
  document.addEventListener('contextmenu', onDocumentContextMenu, { capture: true })
  document.addEventListener('scroll', onScroll, { capture: true })
  document.addEventListener('keydown', onDocumentKeydown)
  window.addEventListener('blur', onWindowBlur)
  window.addEventListener('resize', onWindowResize)
}

function detachListeners() {
  document.removeEventListener('mousedown', onDocumentMouseDown, { capture: true })
  document.removeEventListener('contextmenu', onDocumentContextMenu, { capture: true })
  document.removeEventListener('scroll', onScroll, { capture: true })
  document.removeEventListener('keydown', onDocumentKeydown)
  window.removeEventListener('blur', onWindowBlur)
  window.removeEventListener('resize', onWindowResize)
}

watch(() => props.visible, (val) => {
  if (val) {
    openedAt = performance.now()
    reposition()
    attachListeners()
  } else {
    detachListeners()
  }
})

// 菜单已展开时再次右键（visible 未变化）也要跟随新坐标，否则菜单会停在旧位置
watch([() => props.x, () => props.y], () => {
  if (props.visible) reposition()
})

onUnmounted(detachListeners)
</script>
