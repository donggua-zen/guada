<template>
  <div class="providers-panel flex flex-col h-full overflow-hidden">
    <!-- 头部：标题和新建按钮 -->
    <div class="sessions-header py-1 text-lg font-semibold flex justify-between items-center">
      <span>供应商列表</span>
      <el-button @click="$emit('create-group')" size="default">
        <template #icon>
          <PlusOutlined />
        </template>
        添加自定义
      </el-button>
    </div>

    <div class="providers-content flex-1 pt-5 overflow-hidden">
      <ScrollContainer>
        <!-- 已添加的供应商 -->
        <div class="section-title text-sm font-medium text-gray-500 mb-3">已添加的供应商</div>
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
          <div v-for="provider in items" :key="provider.id"
            class="provider-card group relative bg-white border border-gray-200 rounded-lg p-4 cursor-default hover:border-[var(--color-primary)] transition-all duration-200">
            <div class="flex items-start gap-3">
              <div
                class="w-11 h-11 flex-shrink-0 flex items-center justify-center text-[var(--color-primary)] bg-gray-50 rounded-md">
                <img v-if="provider.avatarUrl" 
                     :src="provider.avatarUrl" 
                     class="w-6 h-6 object-contain" 
                     alt="icon" />
                <component v-else :is="getTemplateIcon(provider)" :size="22" />
              </div>
              <div class="flex-1 min-w-0">
                <div class="flex items-start justify-between">
                  <div class="font-medium text-base text-gray-900 truncate" :title="provider.name">{{ provider.name }}
                  </div>
                  <!-- 删除按钮 - 悬停显示 -->
                  <el-button link size="small" type="danger"
                    class="opacity-0 group-hover:opacity-100 transition-all duration-200 delete-btn"
                    @click.stop="$emit('item-delete', provider)">
                    <el-icon :size="18">
                      <DeleteOutlineOutlined />
                    </el-icon>
                  </el-button>
                </div>
                <div class="text-xs text-gray-500 mt-1.5">{{ getProviderTypeLabel(provider) }}</div>
              </div>
            </div>
            <div class="text-xs text-gray-400 mt-2 line-clamp-2 leading-relaxed">{{ provider.description || '暂无简介' }}
            </div>

            <!-- 悬停显示的渐变遮罩和按钮 -->
            <div
              class="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-white via-white/90 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none rounded-b-lg">
            </div>
            <div
              class="absolute inset-x-2 bottom-2 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-auto">
              <el-button type="primary" size="small" class="flex-1 shadow-sm"
                @click.stop="$emit('item-click', provider)">
                模型管理
              </el-button>
              <el-button size="small" class="flex-1 shadow-sm" @click.stop="$emit('item-edit', provider)">
                供应商设置
              </el-button>
            </div>
          </div>
          <div v-if="items.length === 0" class="col-span-full py-8 text-center text-gray-400 text-sm">
            暂无数据
          </div>
        </div>

        <!-- 可添加的模板 -->
        <div class="section-title text-sm font-medium text-gray-500 mb-3">可添加的供应商</div>
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <div v-for="template in templates" :key="template.id"
            class="provider-card template-card relative border border-gray-200 bg-transparent rounded-lg p-4 cursor-pointer hover:border-[var(--color-primary)] transition-all duration-200 group">
            <div class="flex items-start gap-3">
              <div class="w-11 h-11 flex-shrink-0 flex items-center justify-center text-gray-400 bg-gray-50 rounded-md">
                <img v-if="typeof getTemplateIcon(template) === 'string'" 
                     :src="getTemplateIcon(template)" 
                     class="w-6 h-6 object-contain" 
                     alt="icon" />
                <component v-else :is="getTemplateIcon(template)" :size="22" />
              </div>
              <div class="flex-1 min-w-0">
                <div class="font-medium text-base text-gray-700 truncate" :title="template.name">{{ template.name }}
                </div>
                <div class="text-xs text-gray-500 mt-1.5">{{ getProtocolLabel(template.protocol) }}</div>
              </div>
            </div>
            <div class="text-xs text-gray-400 mt-2 line-clamp-2 leading-relaxed">{{ template.description ||
              '点击添加到您的分组' }}
            </div>

            <!-- 悬停显示的渐变遮罩和按钮 -->
            <div
              class="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-white via-white/90 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none rounded-b-lg">
            </div>
            <div
              class="absolute inset-x-2 bottom-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-auto">
              <el-button type="primary" size="small" class="w-full shadow-sm"
                @click.stop="$emit('template-click', template)">
                添加此供应商
              </el-button>
            </div>
          </div>
          <div v-if="templates.length === 0" class="col-span-full py-8 text-center text-gray-400 text-sm">
            暂无数据
          </div>
        </div>

      </ScrollContainer>
    </div>
  </div>
</template>

<script setup>
import { OpenAI } from '@/components/icons'
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlineOutlined
} from '@vicons/material'
import { ElButton, ElIcon } from 'element-plus'
import ScrollContainer from '@/components/ui/ScrollContainer.vue'


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

defineEmits(['item-click', 'create-group', 'item-edit', 'item-delete', 'template-click'])

const getTemplateIcon = (item) => {
  // 优先使用自带的 avatarUrl
  if (item.avatarUrl) {
    return item.avatarUrl;
  }
  
  // 根据 protocol 返回对应的图标组件
  const protocol = item.protocol || 'openai';
  switch (protocol) {
    case 'openai':
    case 'openai-response':
      return OpenAI;
    case 'gemini':
      // TODO: 添加 Gemini 图标组件
      return OpenAI;
    case 'anthropic':
      // TODO: 添加 Anthropic 图标组件
      return OpenAI;
    default:
      return OpenAI;
  }
}

const getProviderTypeLabel = (provider) => {
  // 直接使用 provider.name（后端已动态合并模板名称）
  if (provider.provider && provider.provider !== 'custom') {
    return provider.name || provider.protocol;
  }
  return '自定义';
}

const getProtocolLabel = (protocol) => {
  // 根据 protocol 字段显示协议类型标签
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
.provider-card {
  min-height: 140px;
}


.line-clamp-2 {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* 删除按钮悬停底纹效果 */
.delete-btn {
  border-radius: 4px;
}

.delete-btn:hover {
  background-color: rgba(239, 68, 68, 0.1);
  /* red-50 with transparency */
}

:deep(.provider-tabs .el-tabs__header) {
  margin-bottom: 0;
}
</style>