<template>
  <div class="h-full overflow-hidden flex flex-col">
    <PageHeader title="机器人" />
    <div class="flex-1 flex flex-col overflow-hidden">
      <div class="shrink-0 px-4 w-full md:max-w-260 md:mx-auto">
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
      <div class="flex-1 overflow-auto pb-4" style="scrollbar-gutter: stable both-edges;">
        <div class="py-3 px-4 w-full md:max-w-260 md:mx-auto">
          <template v-if="currentTabValue === 'management'">
            <BotManagementPage />
          </template>
          <template v-else-if="currentTabValue === 'sessions'">
            <BotSessionsList />
          </template>
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

import {
  Bot24Regular,
  Database24Regular,
} from '@vicons/fluent'

import PageHeader from '@/components/PageHeader.vue'
import { useRouter, useRoute } from 'vue-router'

const router = useRouter()
const route = useRoute()

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

const tabItems = computed(() => sidebarItems)

const getDefaultTabPath = () => {
  return sidebarItems[0]?.path || 'management'
}

const currentTabValue = ref(getDefaultTabPath())

const handleTabChange = (tabName: string | number) => {
  const tabPath = typeof tabName === 'string' ? tabName : String(tabName)
  router.replace({ name: 'Bots', params: { tab: tabPath } })
}

watch(() => route.params.tab, (newPath) => {
  const tabPath = Array.isArray(newPath) ? newPath[0] : (newPath as string)
  if (tabPath && tabPath !== currentTabValue.value) {
    currentTabValue.value = tabPath
  }
})

onMounted(() => {
  if (!route.params.tab) {
    const defaultTab = getDefaultTabPath()
    router.replace({ name: 'Bots', params: { tab: defaultTab } })
  } else {
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
