<template>
    <div class="h-full">
        <PageHeader title="会话管理" />
        <div class="h-full flex flex-col md:max-w-220 md:mx-auto">
            <div class="flex-1 overflow-hidden flex flex-col">
                <div class="p-4">
                    <el-tabs v-model="currentTab" @tab-change="handleTabChange" class="session-mgmt-tabs">
                        <el-tab-pane name="groups">
                            <template #label>
                                <div class="flex items-center gap-2">
                                    <Folder20Regular class="w-[17px] h-[17px]" />
                                    <span class="text-[15px]">分组管理</span>
                                </div>
                            </template>
                        </el-tab-pane>
                        <el-tab-pane name="archived">
                            <template #label>
                                <div class="flex items-center gap-2">
                                    <Archive20Regular class="w-[17px] h-[17px]" />
                                    <span class="text-[15px]">归档管理</span>
                                </div>
                            </template>
                        </el-tab-pane>
                    </el-tabs>
                </div>
                <div class="flex-1 overflow-hidden py-3">
                    <ScrollContainer class="h-full p-4">
                        <SessionGroupManage v-if="currentTab === 'groups'" />
                        <ArchivedSessions v-else-if="currentTab === 'archived'" />
                    </ScrollContainer>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { ElTabs, ElTabPane } from 'element-plus'
import { Folder20Regular, Archive20Regular } from '@vicons/fluent'
import PageHeader from '@/components/PageHeader.vue'
import { ScrollContainer } from '@/components/ui'
import SessionGroupManage from './SessionGroupManage.vue'
import ArchivedSessions from './ArchivedSessions.vue'

const router = useRouter()
const route = useRoute()

const currentTab = ref('groups')

const handleTabChange = (tabName: string | number) => {
    const tabPath = typeof tabName === 'string' ? tabName : String(tabName)
    router.replace({ name: 'SessionsManage', params: { tab: tabPath } })
}

watch(() => route.params.tab, (newPath) => {
    const tabPath = Array.isArray(newPath) ? newPath[0] : (newPath as string)
    if (tabPath && tabPath !== currentTab.value) {
        currentTab.value = tabPath
    }
})

onMounted(() => {
    if (!route.params.tab) {
        router.replace({ name: 'SessionsManage', params: { tab: 'groups' } })
    } else {
        const tabParam = Array.isArray(route.params.tab) ? route.params.tab[0] : (route.params.tab as string)
        currentTab.value = tabParam
    }
})
</script>

<style scoped>
.session-mgmt-tabs :deep(.el-tabs__header) {
    margin-bottom: 0;
}

.session-mgmt-tabs :deep(.el-tabs__nav-wrap::after) {
    height: 1px;
}

.session-mgmt-tabs :deep(.el-tabs__item) {
    padding: 0 18px;
    height: 44px;
    line-height: 44px;
    font-size: 14px;
}
</style>
