<template>
  <div
    class="providers-panel flex flex-col w-72 min-w-72 h-screen bg-[var(--conversation-bg)] border-r border-[var(--conversation-border-color)]">
    <div class="providers-list flex-1 overflow-y-auto py-2.5">
      <div v-for="provider in items" :key="provider.id"
        class="provider-item px-3.5 py-3 cursor-pointer flex items-center transition-colors duration-200 rounded-xl mx-2.5 mb-1.5 h-15"
        :class="{
          'bg-[var(--conversation-active-bg)]': selectedId === provider.id,
          'hover:bg-[var(--conversation-hover-bg)]': selectedId !== provider.id
        }" @click="selectProvider(provider.id)">
        <div class="provider-avatar w-9 h-9 rounded-full flex items-center justify-center mr-3 flex-shrink-0">
          <div
            class="provider-img w-full h-full rounded-full bg-[var(--primary-color)] flex items-center justify-center text-white text-xl overflow-hidden">
            <!--  -->
            <!-- <i class="fas fa-user"></i> -->
          </div>
        </div>
        <div class="provider-info flex-1 min-w-0">
          <div class="provider-title font-medium text-sm truncate text-gray-800">{{ provider.name }}</div>
        </div>
      </div>
    </div>
    <div class="providers-header p-5 text-lg font-semibold flex justify-between items-center">
      <n-button block @click="handleCreateGroup">
        新建分组
      </n-button>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, computed, watch } from 'vue'
import { NButton } from 'naive-ui'



const emit = defineEmits(['select', 'update-providers', 'create-group'])
defineProps({
  items: {
    type: Array,
    default: () => []
  },
  loading: Boolean,
  selectedId: [String, Number]
})

// 选择会话
const selectProvider = (providerId) => {
  emit('select', providerId);
}

// 创建新会话
const handleCreateGroup = async () => {
  emit('create-group')
}


</script>

<style scoped>
/* 保留无法用Tailwind完全替代的样式 */
.provider-item {
  height: 60px;
  /* 使用h-15替代，但保留原始值确保精确匹配 */
}

.new-provider-btn:hover {
  background-color: #3a7bc8;
}

.provider-img img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
</style>