<template>
  <GdDialog
    v-for="entry in modalStack"
    :key="entry.id"
    :model-value="entry.visible.value"
    :title="entry.options.title"
    :size="entry.options.size || 'xs'"
    :close-on-click-modal="entry.options.closeOnClickModal ?? false"
    :close-on-press-escape="entry.options.closeOnPressEscape ?? true"
    append-to-body
    @update:model-value="(value: boolean) => handleModalVisibility(entry, value)"
    @closed="finishModal(entry)"
  >
    <div class="gd-modal-content">
      <el-icon
        v-if="entry.options.icon && entry.options.icon !== 'none'"
        class="gd-modal-icon"
        :class="`gd-modal-icon--${entry.options.icon}`"
      >
        <component :is="getIcon(entry.options.icon)" />
      </el-icon>

      <div class="gd-modal-main">
        <el-input
          v-if="entry.options.input"
          :model-value="entry.inputValue.value"
          :type="entry.options.input.type || 'text'"
          :show-password="entry.options.input.type === 'password'"
          :placeholder="entry.options.input.placeholder || ''"
          autofocus
          @update:model-value="(value: string) => (entry.inputValue.value = value)"
          @keyup.enter="submitModal(entry)"
        />
        <el-input
          v-else-if="entry.options.textarea"
          :model-value="entry.inputValue.value"
          type="textarea"
          :rows="entry.options.textarea.rows || 6"
          :placeholder="entry.options.textarea.placeholder || ''"
          autofocus
          @update:model-value="(value: string) => (entry.inputValue.value = value)"
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
      <el-button
        v-if="entry.options.showCancel !== false"
        @click="cancelModal(entry)"
      >
        {{ entry.options.cancelText || t('common.cancel') }}
      </el-button>
      <el-button
        :type="entry.options.danger ? 'danger' : 'primary'"
        :loading="entry.loading.value"
        @click="submitModal(entry)"
      >
        {{ entry.options.confirmText || t('common.confirm') }}
      </el-button>
    </template>
  </GdDialog>
</template>

<script setup lang="ts">
import { defineComponent, isVNode, type PropType, type VNode } from 'vue'
import {
  CircleCloseFilled,
  InfoFilled,
  SuccessFilled,
  WarningFilled,
} from '@element-plus/icons-vue'
import GdDialog from './GdDialog.vue'
import {
  cancelModal,
  finishModal,
  handleModalVisibility,
  modalStack,
  submitModal,
} from './modalService'
import { t } from '@/locales'

const iconMap = {
  info: InfoFilled,
  success: SuccessFilled,
  warning: WarningFilled,
  error: CircleCloseFilled,
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
