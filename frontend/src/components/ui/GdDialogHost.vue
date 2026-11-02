<template>
  <GdDialog
    v-for="entry in modalStack"
    :key="entry.id"
    :model-value="entry.visible.value"
    :title="entry.options.title"
    :size="entry.options.size || 'xs'"
    :close-on-click-modal="entry.options.closeOnClickModal ?? false"
    :close-on-press-escape="entry.options.closeOnPressEscape ?? true"
    :z-index="entry.options.zIndex"
    append-to-body
    @update:model-value="(value: boolean) => handleModalVisibility(entry, value)"
    @closed="finishModal(entry)"
  >
    <div class="gd-modal-content">
      <!-- 弹窗图标：22px 盒内居中 16px 字形（gd-modal-icon 保盒，原 el-icon 语义） -->
      <span v-if="entry.options.icon && entry.options.icon !== 'none'" class="gd-modal-icon"
        :class="`gd-modal-icon--${entry.options.icon}`">
        <component :is="getIcon(entry.options.icon)" class="size-4" />
      </span>

      <div class="gd-modal-main">
        <GdInput
          v-if="entry.options.input"
          :model-value="entry.inputValue.value"
          :type="entry.options.input.type || 'text'"
          :show-password="entry.options.input.type === 'password'"
          :placeholder="entry.options.input.placeholder || ''"
          @update:model-value="(value: string) => (entry.inputValue.value = value)"
          @keyup.enter="submitModal(entry)"
          v-focus
        />
        <GdInput
          v-else-if="entry.options.textarea"
          :model-value="entry.inputValue.value"
          type="textarea"
          :rows="entry.options.textarea.rows || 6"
          :placeholder="entry.options.textarea.placeholder || ''"
          @update:model-value="(value: string) => (entry.inputValue.value = value)"
          v-focus
        />
        <component
          :is="RenderVNode"
          v-else-if="isVNode(entry.options.content)"
          :node="entry.options.content"
        />
        <div
          v-else-if="entry.options.content && entry.options.html"
          class="gd-modal-html"
          v-html="entry.options.content"
        ></div>
        <p v-else-if="entry.options.content" class="gd-modal-text">{{ entry.options.content }}</p>
      </div>
    </div>

    <template #footer>
      <GdButton
        v-if="entry.options.showCancel !== false"
        @click="cancelModal(entry)"
      >
        {{ entry.options.cancelText || t('common.cancel') }}
      </GdButton>
      <GdButton
        :type="entry.options.danger ? 'danger' : 'primary'"
        :loading="entry.loading.value"
        @click="submitModal(entry)"
      >
        {{ entry.options.confirmText || t('common.confirm') }}
      </GdButton>
    </template>
  </GdDialog>
</template>

<script setup lang="ts">
import { defineComponent, isVNode, type PropType, type VNode } from 'vue'
import {
  DismissCircle16Filled,
  Info16Filled,
  CheckmarkCircle16Filled,
  Warning16Filled,
} from '@vicons/fluent'
import GdDialog from './GdDialog.vue'
import GdButton from './GdButton.vue'
import GdInput from './GdInput.vue'
import {
  cancelModal,
  finishModal,
  handleModalVisibility,
  modalStack,
  submitModal,
} from './modalService'
import { t } from '@/locales'

/** el-input 的 autofocus 是弹窗挂载后聚焦；原生 autofocus 在 Teleport 场景不稳定，用指令等价实现 */
const vFocus = {
  mounted: (el: HTMLElement) => (el.querySelector('input, textarea') as HTMLInputElement | null)?.focus(),
}

const iconMap = {
  info: Info16Filled,
  success: CheckmarkCircle16Filled,
  warning: Warning16Filled,
  error: DismissCircle16Filled,
} as const

function getIcon(icon?: keyof typeof iconMap | 'none') {
  return icon && icon !== 'none' ? iconMap[icon] : undefined
}

const RenderVNode = defineComponent({
  name: 'GdRenderVNode',
  props: {
    node: { type: Object as PropType<VNode>, required: true },
  },
  setup(props) {
    return () => props.node
  },
})
</script>

<style scoped>
.gd-modal-content {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.gd-modal-icon {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  margin-top: 1px;
}

.gd-modal-icon--info {
  color: var(--gd-color-info);
}

.gd-modal-icon--success {
  color: var(--gd-color-success);
}

.gd-modal-icon--warning {
  color: var(--gd-color-warning);
}

.gd-modal-icon--error {
  color: var(--gd-color-danger);
}

.gd-modal-main {
  flex: 1;
  min-width: 0;
}

.gd-modal-text,
.gd-modal-html {
  margin: 0;
  font-size: 14px;
  line-height: 1.6;
  color: var(--gd-color-text);
  white-space: pre-wrap;
  word-break: break-word;
}

.gd-modal-html :deep(p) {
  margin: 0;
}

.gd-modal-html :deep(p + p) {
  margin-top: 8px;
}

.gd-modal-html :deep(ul),
.gd-modal-html :deep(ol) {
  margin: 0;
  padding-left: 20px;
}
</style>
