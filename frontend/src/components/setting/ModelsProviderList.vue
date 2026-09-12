<template>
  <div class="providers-panel flex flex-col">
    <!-- 已添加的供应商 -->
    <div class="section-title text-sm font-medium text-gray-500 dark:text-[#8b8d95] mb-3">已添加的供应商</div>
    <div class="grid gap-y-4 gap-x-3 mb-8" style="grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));">
      <div v-for="provider in items" :key="provider.id"
        class="provider-card group flex flex-col overflow-hidden p-2.5 rounded-[var(--gd-size-surface-radius)] border border-(--gd-color-surface-border) bg-(--gd-color-surface) transition-all hover:bg-(--gd-color-surface-hover) hover:shadow-sm cursor-pointer"
        :class="{ 'opacity-60 grayscale-[30%]': provider.enabled === false }"
        @click="$emit('item-click', provider)">
        <!-- Header: avatar + name -->
        <div class="flex items-center gap-2.5 mb-3">
          <CardAvatar :src="getProviderIcon(provider)" :name="provider.name" />
          <h3 class="font-semibold text-gray-900 dark:text-[#e8e9ed] truncate flex-1 min-w-0" style="font-size: var(--gd-size-text-sm);"
            :title="provider.name">
            {{ provider.name }}
          </h3>
          <el-switch
            :model-value="provider.enabled !== false"
            size="small"
            @click.stop
            @change="(v) => $emit('item-toggle', provider, v)" />
        </div>

        <!-- Description -->
        <div class="text-gray-400 dark:text-[#6b6d75] line-clamp-2 h-[2.5rem]" style="font-size: calc(var(--gd-size-text-base) - 2px);">
          {{ provider.description || '暂无简介' }}
        </div>

        <!-- Footer: protocol + 编辑/删除（hover 显示；启停用右上角开关，不重复） -->
        <div class="flex items-center justify-between gap-2 mt-3">
          <span class="text-xs text-gray-400 dark:text-[#6b6d75]">{{ getProtocolLabel(provider.protocol) }}</span>
          <div class="flex items-center gap-3">
            <span v-if="provider.enabled === false" class="text-xs text-gray-400 dark:text-[#6b6d75]">已禁用</span>
            <button
              class="edit-btn opacity-0 group-hover:opacity-100 transition-opacity text-xs text-gray-400 hover:text-blue-500"
              @click.stop="$emit('item-edit', provider)">
              编辑
            </button>
            <button
              class="delete-btn opacity-0 group-hover:opacity-100 transition-opacity text-xs text-gray-400 hover:text-red-500"
              @click.stop="$emit('item-delete', provider)">
              删除
            </button>
          </div>
        </div>
      </div>
      <div v-if="items.length === 0" class="col-span-full py-8 text-center text-gray-400 dark:text-[#6b6d75] text-sm">
        暂无数据
      </div>
    </div>

    <!-- 可添加的供应商（模板全量展示：同类型可再建多实例） -->
    <div class="section-title text-sm font-medium text-gray-500 dark:text-[#8b8d95] mb-3">可添加的供应商</div>
    <div class="grid gap-y-4 gap-x-3" style="grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));">
      <div v-for="template in templates" :key="template.id"
        class="provider-card flex flex-col overflow-hidden p-2.5 rounded-[var(--gd-size-surface-radius)] border border-(--gd-color-surface-border) bg-(--gd-color-surface) transition-all hover:bg-(--gd-color-surface-hover) hover:shadow-sm cursor-pointer"
        @click="$emit('template-click', template)">
        <div class="flex items-center gap-2.5 mb-3">
          <CardAvatar :src="getProviderIcon(template)" :name="template.name" />
          <h3 class="font-semibold text-gray-700 dark:text-[#e8e9ed] truncate flex-1 min-w-0" style="font-size: var(--gd-size-text-sm);"
            :title="template.name">
            {{ template.name }}
          </h3>
        </div>
        <div class="text-gray-400 dark:text-[#6b6d75] line-clamp-2 h-[2.5rem]" style="font-size: calc(var(--gd-size-text-base) - 2px);">
          {{ template.description || '点击添加到您的供应商列表' }}
        </div>
        <div class="flex items-center justify-between gap-2 mt-3">
          <span class="text-xs text-gray-400 dark:text-[#6b6d75]">{{ getProtocolLabel(template.protocol) }}</span>
          <span class="text-xs text-gray-400 dark:text-[#6b6d75]">点击添加</span>
        </div>
      </div>
      <div v-if="templates.length === 0" class="col-span-full py-8 text-center text-gray-400 dark:text-[#6b6d75] text-sm">
        暂无数据
      </div>
    </div>
  </div>
</template>

<script setup>
import { ElSwitch } from 'element-plus'
import { fixFrontendAssetUrl } from '@/utils/url'
import CardAvatar from '@/components/ui/CardAvatar.vue'

defineProps({
  items: {
    type: Array,
    default: () => []
  },
  templates: {
    type: Array,
    default: () => []
  }
})

defineEmits(['item-click', 'item-toggle', 'item-edit', 'item-delete', 'template-click'])

const getProviderIcon = (item) => {
  const providerId = (item.provider || item.id || '').toLowerCase();
  if (providerId && providerId !== 'custom') {
    const ext = providerId === 'xqapi' ? 'png' : 'svg';
    return fixFrontendAssetUrl(`/images/providers/${providerId}.${ext}`);
  }
  return null;
}

const getProtocolLabel = (protocol) => {
  const protocolMap = {
    'openai': 'OpenAI',
    'openai-response': 'OpenAI-Response',
    'gemini': 'Gemini',
    'anthropic': 'Anthropic'
  }
  return protocolMap[protocol] || protocol || '未知协议'
}
</script>

<style scoped>
</style>
