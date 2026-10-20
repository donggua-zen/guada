<template>
  <GdDialog v-model="dialogVisible" :title="t('ui.sidebar.editProjectTitle')" size="sm"
    :close-on-click-modal="false">
    <div class="space-y-4">
      <!-- 项目名称 -->
      <div class="space-y-1.5">
        <label class="text-sm font-medium text-(--gd-color-text)">
          {{ t('ui.sidebar.projectNameLabel') }}
        </label>
        <el-input v-model="name" maxlength="50" show-word-limit autofocus clearable
          :placeholder="t('ui.sidebar.inputGroupName')" @keyup.enter="handleSave" />
      </div>

      <!-- 工作目录（本轮只读；后续新增字段直接追加在此表单内） -->
      <div class="space-y-1.5">
        <label class="text-sm font-medium text-(--gd-color-text)">
          {{ t('ui.sidebar.projectPathLabel') }}
        </label>
        <div class="flex items-center gap-2">
          <el-input :model-value="group?.path || ''" readonly class="flex-1" />
          <el-button :disabled="!group?.path" @click="handleCopyPath">
            {{ t('ui.sidebar.copyProjectPath') }}
          </el-button>
        </div>
      </div>
    </div>

    <template #footer>
      <div class="flex justify-end gap-2">
        <el-button @click="dialogVisible = false">{{ t('common.cancel') }}</el-button>
        <el-button type="primary" :disabled="!canSave" :loading="saving" @click="handleSave">
          {{ t('common.save') }}
        </el-button>
      </div>
    </template>
  </GdDialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import GdDialog from '@/components/ui/GdDialog.vue'
import { useSessionGroupStore } from '@/stores/sessionGroup'
import { usePopup } from '@/composables/usePopup'
import { writeTextToClipboard } from '@/utils/clipboard'
import type { ProjectGroup } from '@/types/session'

/**
 * 项目编辑弹窗。
 *
 * 本轮只有「显示名 + 只读工作目录」两项；后续新增字段直接追加到表单区，
 * 不需要调整弹窗骨架。
 */
const props = defineProps<{
  modelValue: boolean
  group: ProjectGroup | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  saved: []
}>()

const { t } = useI18n()
const sessionGroupStore = useSessionGroupStore()
const { toast } = usePopup()

const dialogVisible = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value),
})

const name = ref('')
const saving = ref(false)

// 每次打开时用最新分组名初始化输入框
watch(
  () => [props.modelValue, props.group?.id] as const,
  ([open]) => {
    if (open && props.group) name.value = props.group.name
  },
  { immediate: true },
)

const canSave = computed(() => {
  if (!props.group || saving.value) return false
  const trimmed = name.value.trim()
  return !!trimmed && trimmed !== props.group.name
})

const handleSave = async () => {
  if (!props.group || !canSave.value) return
  saving.value = true
  try {
    const success = await sessionGroupStore.renameProjectGroup(
      props.group.id,
      name.value.trim(),
    )
    if (!success) {
      toast.error(t('ui.sidebar.projectSaveFailed'))
      return
    }
    toast.success(t('ui.sidebar.projectSaved'))
    emit('saved')
    dialogVisible.value = false
  } finally {
    saving.value = false
  }
}

const handleCopyPath = async () => {
  if (!props.group?.path) return
  const ok = await writeTextToClipboard(props.group.path)
  if (ok) toast.success(t('ui.sidebar.projectPathCopied'))
  else toast.error(t('ui.sidebar.projectPathCopyFailed'))
}
</script>
