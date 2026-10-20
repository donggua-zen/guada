<template>
  <GdDialog v-model="dialogVisible" :title="dialogTitle" size="sm"
    :close-on-click-modal="false">
    <div class="space-y-4">
      <!-- 名称 -->
      <div class="space-y-1.5">
        <label class="text-sm font-medium text-(--gd-color-text)">
          {{ t('ui.sidebar.groupNameLabel') }}
        </label>
        <el-input v-model="name" maxlength="50" show-word-limit autofocus clearable
          :placeholder="t('ui.sidebar.inputGroupName')" @keyup.enter="handleSave" />
      </div>

      <!-- 图标 -->
      <div class="space-y-1.5">
        <label class="text-sm font-medium text-(--gd-color-text)">
          {{ t('ui.sidebar.groupIconLabel') }}
        </label>
        <GroupIconPicker v-model="icon" />
      </div>

      <!-- 工作目录（仅项目；只读，后续新增字段直接追加在此表单内） -->
      <div v-if="kind === 'project' && group" class="space-y-1.5">
        <label class="text-sm font-medium text-(--gd-color-text)">
          {{ t('ui.sidebar.projectPathLabel') }}
        </label>
        <div class="flex items-center gap-2">
          <el-input :model-value="projectPath" readonly class="flex-1" />
          <el-button :disabled="!projectPath" @click="handleCopyPath">
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
import GroupIconPicker from '@/components/session/GroupIconPicker.vue'
import { useSessionGroupStore } from '@/stores/sessionGroup'
import { usePopup } from '@/composables/usePopup'
import { writeTextToClipboard } from '@/utils/clipboard'
import type { ProjectGroup, SessionGroup } from '@/types/session'

type EditableGroup = SessionGroup | ProjectGroup

/**
 * 分组 / 项目编辑弹窗。
 *
 * - `kind = 'group'`：手工分组；`group = null` 表示新建；
 * - `kind = 'project'`：目录项目，额外显示只读工作目录。
 * 表单按可扩展结构写，后续新增字段直接追加。
 */
const props = defineProps<{
  modelValue: boolean
  kind: 'group' | 'project'
  group: EditableGroup | null
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
const icon = ref<string | null>(null)
const saving = ref(false)

const isCreating = computed(() => props.group === null)

const dialogTitle = computed(() => {
  if (props.kind === 'project') return t('ui.sidebar.editProjectTitle')
  return isCreating.value
    ? t('ui.sidebar.createGroupTitle')
    : t('ui.sidebar.editGroup')
})

const projectPath = computed(() =>
  props.kind === 'project'
    ? ((props.group as ProjectGroup | null)?.path ?? '')
    : '',
)

// 每次打开时用最新分组数据初始化表单
watch(
  () => [props.modelValue, props.group?.id] as const,
  ([open]) => {
    if (!open) return
    name.value = props.group?.name ?? ''
    icon.value = props.group?.icon ?? null
  },
  { immediate: true },
)

const canSave = computed(() => {
  if (saving.value) return false
  const trimmed = name.value.trim()
  if (!trimmed) return false
  if (!props.group) return true
  return (
    trimmed !== props.group.name ||
    (icon.value ?? null) !== (props.group.icon ?? null)
  )
})

const handleSave = async () => {
  if (!canSave.value) return
  const trimmed = name.value.trim()
  saving.value = true
  try {
    if (props.kind === 'project') {
      const group = props.group as ProjectGroup | null
      if (!group) return
      const updates: { name?: string; icon?: string | null } = {}
      if (trimmed !== group.name) updates.name = trimmed
      if ((icon.value ?? null) !== (group.icon ?? null)) {
        updates.icon = icon.value
      }
      if (Object.keys(updates).length === 0) return
      const success = await sessionGroupStore.updateProjectGroup(group.id, updates)
      if (!success) {
        toast.error(t('ui.sidebar.projectSaveFailed'))
        return
      }
      toast.success(t('ui.sidebar.projectSaved'))
    } else if (!props.group) {
      const created = await sessionGroupStore.createGroup(trimmed, icon.value)
      if (!created) {
        toast.error(t('ui.sidebar.createGroupFailed'))
        return
      }
      toast.success(t('ui.sidebar.groupCreated'))
    } else {
      const updates: { name?: string; icon?: string | null } = {}
      if (trimmed !== props.group.name) updates.name = trimmed
      if ((icon.value ?? null) !== (props.group.icon ?? null)) {
        updates.icon = icon.value
      }
      if (Object.keys(updates).length === 0) return
      const success = await sessionGroupStore.updateGroup(props.group.id, updates)
      if (!success) {
        toast.error(t('ui.sidebar.groupUpdateFailed'))
        return
      }
      toast.success(t('ui.sidebar.groupUpdated'))
    }
    emit('saved')
    dialogVisible.value = false
  } finally {
    saving.value = false
  }
}

const handleCopyPath = async () => {
  if (!projectPath.value) return
  const ok = await writeTextToClipboard(projectPath.value)
  if (ok) toast.success(t('ui.sidebar.projectPathCopied'))
  else toast.error(t('ui.sidebar.projectPathCopyFailed'))
}
</script>
