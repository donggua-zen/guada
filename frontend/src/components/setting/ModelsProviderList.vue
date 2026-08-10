<template>
  <div class="providers-panel flex flex-col">
    <!-- 已添加的供应商 -->
    <div class="section-title text-sm font-medium text-gray-500 dark:text-[#8b8d95] mb-3">已添加的供应商</div>
    <div class="grid gap-y-4 gap-x-3 mb-8" style="grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));">
      <div v-for="provider in items" :key="provider.id"
        class="provider-card group flex flex-col overflow-hidden p-2.5 rounded-[var(--size-surface-radius)] border border-(--color-surface-border) bg-(--color-surface) transition-all hover:bg-(--color-surface-hover) hover:shadow-sm cursor-pointer"
        @click="$emit('item-click', provider)">
        <!-- Header: avatar + name -->
        <div class="flex items-center gap-2.5 mb-3">
          <CardAvatar :src="getProviderIcon(provider)" :name="provider.name" />
          <h3 class="font-semibold text-gray-900 dark:text-[#e8e9ed] truncate flex-1 min-w-0" style="font-size: var(--size-text-sm);"
            :title="provider.name">
            {{ provider.name }}
          </h3>
        </div>

        <!-- Description -->
        <div class="text-gray-400 dark:text-[#6b6d75] line-clamp-2 h-[2.5rem]" style="font-size: calc(var(--size-text-base) - 2px);">
          {{ provider.description || '暂无简介' }}
        </div>

        <!-- Footer: protocol + actions (hover visible) -->
        <div class="flex items-center justify-between gap-2 mt-3">
          <span class="text-xs text-gray-400 dark:text-[#6b6d75]">{{ getProtocolLabel(provider.protocol) }}</span>
          <div class="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity" @click.stop>
            <el-button link size="small" @click="$emit('item-edit', provider)">配置</el-button>
            <el-button link size="small" type="danger" @click="$emit('item-delete', provider)">删除</el-button>
          </div>
        </div>
      </div>
      <div v-if="items.length === 0" class="col-span-full py-8 text-center text-gray-400 dark:text-[#6b6d75] text-sm">
        暂无数据
      </div>
    </div>

    <!-- 可添加的供应商 -->
    <div class="section-title text-sm font-medium text-gray-500 dark:text-[#8b8d95] mb-3">可添加的供应商</div>
    <div class="grid gap-y-4 gap-x-3" style="grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));">
      <div v-for="template in templates" :key="template.id"
        class="provider-card flex flex-col overflow-hidden p-2.5 rounded-[var(--size-surface-radius)] border border-(--color-surface-border) bg-(--color-surface) transition-all hover:bg-(--color-surface-hover) hover:shadow-sm cursor-pointer"
        @click="$emit('template-click', template)">
        <!-- Header: avatar + name -->
        <div class="flex items-center gap-2.5 mb-3">
          <CardAvatar :src="getProviderIcon(template)" :name="template.name" />
          <h3 class="font-semibold text-gray-700 dark:text-[#e8e9ed] truncate flex-1 min-w-0" style="font-size: var(--size-text-sm);"
            :title="template.name">
            {{ template.name }}
          </h3>
        </div>

        <!-- Description -->
        <div class="text-gray-400 dark:text-[#6b6d75] line-clamp-2 h-[2.5rem]" style="font-size: calc(var(--size-text-base) - 2px);">
          {{ template.description || '点击添加到您的供应商列表' }}
        </div>

        <!-- Footer: protocol -->
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
import { ElButton } from 'element-plus'
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

defineEmits(['item-click', 'item-edit', 'item-delete', 'template-click'])

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
