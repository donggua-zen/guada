<template>
  <div class="flex flex-col gap-2">
    <template v-for="field in visibleFields" :key="field.key">
      <div class="flex flex-col gap-0.5">
        <label class="text-xs font-medium text-(--gd-color-text) dark:text-[#e5e7eb]">
          {{ field.label }}
          <span v-if="field.required" class="text-red-500">*</span>
        </label>

        <!-- text / password -->
        <GdInput
          v-if="field.type === 'text' || field.type === 'password'"
          :type="field.type === 'password' ? 'password' : 'text'"
          :model-value="modelValue[field.key] ?? field.default ?? ''"
          :placeholder="field.placeholder"
          :show-password="field.type === 'password'"
          @update:model-value="updateField(field.key, $event)"
        />

        <!-- number -->
        <GdInputNumber
          v-else-if="field.type === 'number'"
          :model-value="modelValue[field.key] ?? field.default ?? 0"
          :placeholder="field.placeholder"
          class="w-full"
          @update:model-value="updateField(field.key, $event)"
        />

        <!-- select -->
        <GdSelect
          v-else-if="field.type === 'select'"
          :model-value="modelValue[field.key] ?? field.default"
          :placeholder="field.placeholder"
          @update:model-value="updateField(field.key, $event)"
        >
          <GdOption
            v-for="opt in field.options"
            :key="String(opt.value)"
            :label="opt.label"
            :value="(opt.value as string | number)"
          />
        </GdSelect>

        <!-- textarea -->
        <GdInput
          v-else-if="field.type === 'textarea'"
          type="textarea"
          :model-value="modelValue[field.key] ?? field.default ?? ''"
          :placeholder="field.placeholder"
          :rows="4"
          @update:model-value="updateField(field.key, $event)"
        />

        <!-- boolean -->
        <GdSwitch
          v-else-if="field.type === 'boolean'"
          :model-value="Boolean(modelValue[field.key] ?? field.default ?? false)"
          @update:model-value="updateField(field.key, $event)"
        />

        <!-- 字段说明 -->
        <span v-if="field.description" class="text-xs text-gray-400 dark:text-[#8b8d95]">
          {{ field.description }}
        </span>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { ConfigField } from '@/services/modules/plugin.api'
import GdInput from '@/components/ui/GdInput.vue';
import GdInputNumber from '@/components/ui/GdInputNumber.vue';
import GdSelect from '@/components/ui/GdSelect.vue';
import GdOption from '@/components/ui/GdSelectOption';
import GdSwitch from '@/components/ui/GdSwitch.vue';

const props = defineProps<{
  fields: ConfigField[]
  // 插件配置表单值袋：值类型由插件自定义（ConfigField.default/options 均为 unknown），
  // 无法收窄为具体键值类型，且 unknown 会让 el-input/el-select 的 model-value 绑定失配
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- 白名单：动态边界，见上方说明
  modelValue: Record<string, any>
}>()

const emit = defineEmits<{
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- 白名单：动态边界，见上方说明
  'update:modelValue': [value: Record<string, any>]
}>()

const visibleFields = computed(() => {
  return props.fields.filter((field) => {
    if (!field.showIf) return true
    const condition = field.showIf as {
      field?: string
      equals?: unknown
      anyOf?: Array<{ field: string; equals: unknown }>
    }
    if (Array.isArray(condition.anyOf)) {
      return condition.anyOf.some((c) => props.modelValue[c.field] === c.equals)
    }
    return props.modelValue[condition.field as string] === condition.equals
  })
})

function updateField(key: string, value: unknown) {
  emit('update:modelValue', { ...props.modelValue, [key]: value })
}
</script>
