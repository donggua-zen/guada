<template>
  <div class="rounded-lg border border-gray-200 dark:border-[#232428] overflow-hidden bg-white dark:bg-[#232428] transition-all hover:border-(--color-primary)"
    :class="{ 'opacity-60': disabled }">
    <div class="p-4 pb-3">
      <div class="flex items-start justify-between gap-2 mb-1">
        <div class="flex items-center gap-2 flex-1 min-w-0">
          <div class="w-8 h-8 shrink-0 rounded-lg flex items-center justify-center text-xl"
            :style="{ backgroundColor: agent.color + '20' || '#f0f0f0' }">
            {{ agent.emoji || '🤖' }}
          </div>
          <h3 class="text-base font-semibold text-gray-900 dark:text-[#e8e9ed] truncate">
            {{ agent.name }}
          </h3>
        </div>
      </div>

      <p class="text-sm text-gray-600 dark:text-[#8b8d95] mb-3 line-clamp-3 min-h-[3.75rem]">
        {{ agent.description || '暂无描述' }}
      </p>

      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2 text-sm text-gray-500">
          <el-switch
            :model-value="agent.visible"
            @update:model-value="(val: any) => $emit('toggle-visibility', agent, !!val)"
            size="small"
            inline-prompt
            active-text=" 可见 "
            inactive-text=" 隐藏 "
          />
        </div>
        <div class="flex gap-2">
          <el-button link size="small" @click="$emit('view-detail', agent)">
            <template #icon>
              <component :is="DescriptionOutlined" class="w-4 h-4" />
            </template>
            查看
          </el-button>
          <el-button link size="small" type="danger" @click="$emit('delete', agent)">
            <template #icon>
              <component :is="DeleteOutlineOutlined" class="w-4 h-4" />
            </template>
            删除
          </el-button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ElButton, ElSwitch } from 'element-plus'
import {
  DescriptionOutlined,
  DeleteOutlineOutlined,
} from '@vicons/material'

defineProps<{
  agent: any
  disabled?: boolean
}>()

defineEmits<{
  'toggle-visibility': [agent: any, visible: boolean]
  'view-detail': [agent: any]
  'delete': [agent: any]
}>()
</script>
