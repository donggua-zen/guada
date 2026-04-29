<template>
  <div class="bg-(--color-surface) h-full">
    <div class="h-full flex flex-col md:max-w-260 md:mx-auto">
      <div class="flex-1 overflow-hidden flex flex-col">
        <!-- Tab 头部 -->
        <div class="border-gray-200 dark:border-gray-700 p-4">
          <el-tabs v-model="currentTabValue" @tab-change="handleTabChange" class="bot-center-tabs">
            <el-tab-pane v-for="item in tabItems" :key="item.path" :label="item.label" :name="item.path">
              <template #label>
                <div class="flex items-center gap-2">
                  <component :is="item.icon" class="w-[17px] h-[17px]"></component>
                  <span class="text-[15px]">{{ item.label }}</span>
                </div>
              </template>
            </el-tab-pane>
          </el-tabs>
        </div>

        <!-- Tab 内容区 -->
        <div class="flex-1 overflow-hidden py-2 md:py-2">
          <ScrollContainer class="h-full px-4 max-h-full">
            <template v-if="currentTabValue === 'management'">
              <BotManagementPage />
            </template>
            <template v-else-if="currentTabValue === 'sessions'">
              <BotSessionsList />
            </template>
          </ScrollContainer>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed, watch } from 'vue'
import { ElTabs, ElTabPane } from 'element-plus'
import BotManagementPage from './BotManagementPage.vue'
import BotSessionsList from './BotSessionsList.vue'
import ScrollContainer from '../ui/ScrollContainer.vue'

import {
  Bot24Regular,
  Database24Regular,
} from '@vicons/fluent'

import { useRouter, useRoute } from 'vue-router'

const router = useRouter()
const route = useRoute()

// Bot 中心 Tab 菜单
const sidebarItems = [
  {
    label: '机器人管理',
    path: 'management',
    icon: Bot24Regular,
  },
  {
    label: '对话数据',
    path: 'sessions',
    icon: Database24Regular,
  },
]

// Tab 数据（用于模板渲染）
const tabItems = computed(() => sidebarItems)

// 获取默认标签页
const getDefaultTabPath = () => {
  return sidebarItems[0]?.path || 'management'
}

const currentTabValue = ref(getDefaultTabPath())

// Tab 切换处理
const handleTabChange = (tabName: string | number) => {
  const tabPath = typeof tabName === 'string' ? tabName : String(tabName)
  router.replace({ name: 'Bots', params: { tab: tabPath } })
}

// 监听路由参数变化
watch(() => route.params.tab, (newPath) => {
  // 确保 newPath 是字符串类型
  const tabPath = Array.isArray(newPath) ? newPath[0] : (newPath as string)
  if (tabPath && tabPath !== currentTabValue.value) {
    currentTabValue.value = tabPath
  }
})

onMounted(() => {
  // 如果没有路由参数，则跳转到默认标签页
  if (!route.params.tab) {
    const defaultTab = getDefaultTabPath()
    router.replace({ name: 'Bots', params: { tab: defaultTab } })
  } else {
    // 确保 route.params.tab 是字符串类型
    const tabParam = Array.isArray(route.params.tab) ? route.params.tab[0] : (route.params.tab as string)
    currentTabValue.value = tabParam
  }
})
</script>

<style scoped>
.bot-center-tabs :deep(.el-tabs__header) {
  margin-bottom: 0;
}

.bot-center-tabs :deep(.el-tabs__nav-wrap::after) {
  height: 1px;
}

.bot-center-tabs :deep(.el-tabs__item) {
  padding: 0 18px;
  height: 44px;
  line-height: 44px;
  font-size: 14px;
}
</style>
