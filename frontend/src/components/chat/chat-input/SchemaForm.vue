<template>
  <div class="flex flex-col gap-2">
    <template v-for="field in visibleFields" :key="field.key">
      <div class="flex flex-col gap-0.5">
        <label class="text-xs font-medium text-(--color-text) dark:text-[#e5e7eb]">
          {{ field.label }}
          <span v-if="field.required" class="text-red-500">*</span>
        </label>

        <!-- text / password -->
        <el-input
          v-if="field.type === 'text' || field.type === 'password'"
          :type="field.type === 'password' ? 'password' : 'text'"
          :model-value="modelValue[field.key] ?? field.default ?? ''"
          :placeholder="field.placeholder"
          :show-password="field.type === 'password'"
          @update:model-value="updateField(field.key, $event)"
        />

        <!-- number -->
        <el-input-number
          v-else-if="field.type === 'number'"
          :model-value="modelValue[field.key] ?? field.default ?? 0"
          :placeholder="field.placeholder"
          controls-position="right"
          class="w-full"
          @update:model-value="updateField(field.key, $event)"
        />

        <!-- select -->
        <el-select
          v-else-if="field.type === 'select'"
          :model-value="modelValue[field.key] ?? field.default"
          :placeholder="field.placeholder"
          @update:model-value="updateField(field.key, $event)"
        >
          <el-option
            v-for="opt in field.options"
            :key="String(opt.value)"
            :label="opt.label"
            :value="opt.value"
          />
        </el-select>

        <!-- textarea -->
        <el-input
          v-else-if="field.type === 'textarea'"
          type="textarea"
          :model-value="modelValue[field.key] ?? field.default ?? ''"
          :placeholder="field.placeholder"
          :rows="4"
          @update:model-value="updateField(field.key, $event)"
        />
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { ConfigField } from '@/services/modules/plugin.api'

const props = defineProps<{
  fields: ConfigField[]
  modelValue: Record<string, any>
}>()

const emit = defineEmits<{
  'update:modelValue': [value: Record<string, any>]
}>()

const visibleFields = computed(() => {
  return props.fields.filter((field) => {
    if (!field.showIf) return true
    return props.modelValue[field.showIf.field] === field.showIf.equals
  })
})

function updateField(key: string, value: any) {
  emit('update:modelValue', { ...props.modelValue, [key]: value })
}
</script>
