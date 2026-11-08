<template>
  <GdDialog v-model="visible" size="md" :close-on-click-modal="false" destroy-on-close @closed="onClosed">
    <template #header>
      <span>{{ t('plugins.config.title', { name }) }}</span>
    </template>

    <div v-if="fields.length === 0" class="text-sm text-gray-500">
      {{ t('plugins.config.empty') }}
    </div>

    <div v-else class="space-y-1">
      <div class="text-xs text-gray-500 dark:text-[#8b8d95] mb-3">
        {{ t('plugins.config.hint') }}
      </div>
      <SchemaForm v-model="values" :fields="fields" />
    </div>

    <template #footer>
      <GdButton @click="visible = false">{{ t('common.cancel') }}</GdButton>
      <GdButton type="primary" :loading="saving" :disabled="fields.length === 0" @click="save">
        {{ t('common.save') }}
      </GdButton>
    </template>
  </GdDialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import GdDialog from '@/components/ui/GdDialog.vue'
import GdButton from '@/components/ui/GdButton.vue'
import SchemaForm from '@/components/chat/chat-input/SchemaForm.vue'
import { toast } from '@/components/ui/toastService'
import { getErrorMessage } from '@/utils/errorMessage'
import { apiService } from '@/services/ApiService'
import type { ConfigField } from '@/services/modules/plugin.api'

const props = defineProps<{
  /** 控制弹窗显示（v-model:visible） */
  visible: boolean
  pluginId: string
  name: string
  schema?: { fields: ConfigField[] }
  config?: Record<string, unknown>
}>()

const emit = defineEmits<{
  'update:visible': [value: boolean]
  saved: []
}>()

const { t } = useI18n()
const saving = ref(false)
const values = ref<Record<string, any>>({})

const visible = computed({
  get: () => props.visible,
  set: (value: boolean) => emit('update:visible', value),
})

const fields = computed<ConfigField[]>(() => props.schema?.fields ?? [])

function resetValues() {
  const next: Record<string, any> = {}
  for (const field of fields.value) {
    const current = props.config?.[field.key]
    next[field.key] = current !== undefined ? current : field.default
  }
  values.value = next
}

watch(
  () => props.visible,
  (open) => {
    if (open) resetValues()
  },
)

function onClosed() {
  saving.value = false
}

async function save() {
  saving.value = true
  try {
    await apiService.savePluginConfig(props.pluginId, values.value)
    toast.success(t('plugins.config.saved'))
    emit('saved')
    visible.value = false
  } catch (error) {
    toast.error(getErrorMessage(error))
  } finally {
    saving.value = false
  }
}
</script>
