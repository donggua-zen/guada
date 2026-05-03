<!-- KnowledgeBasePage/KBSidebar.vue -->
<template>
    <div class="kb-sidebar h-full flex flex-col bg-(--color-conversation-bg)">
        <!-- 头部 -->
        <div class="px-4 pt-2.5 pb-2.5 ">
            <div class="flex justify-between items-center">
                <span class="font-semibold text-base text-(--color-text)">知识库</span>
                <el-button type="primary" @click="handleCreate" :icon="Plus">
                    新建
                </el-button>
            </div>
        </div>

        <!-- 搜索框 -->
        <div class="search-box px-3.5 py-3">
            <el-input 
                v-model="searchKeyword"
                placeholder="搜索知识库" 
                clearable 
                class="search-input" 
            />
        </div>

        <!-- 知识库列表 -->
        <div class="flex-1 overflow-y-auto py-2">
            <ScrollContainer class="max-h-full">
                <template v-if="filteredKnowledgeBases.length === 0">
                    <div class="empty-state text-center text-gray-500 flex flex-col items-center justify-center h-full py-12">
                        <div class="empty-state-icon mb-3 text-gray-300">
                            <el-icon size="32">
                                <Plus />
                            </el-icon>
                        </div>
                        <div class="empty-state-title text-sm font-medium mb-1">
                            {{ searchKeyword ? '未找到匹配的知识库' : '没有知识库' }}
                        </div>
                        <div class="empty-state-description text-xs text-gray-400">
                            {{ searchKeyword ? '尝试调整搜索关键词' : '点击上方按钮创建新的知识库' }}
                        </div>
                    </div>
                </template>
                <template v-else>
                    <div 
                        v-for="kb in filteredKnowledgeBases" 
                        :key="kb.id" 
                        class="kb-item group" 
                        :class="{
                            'kb-item-active': activeId === kb.id,
                            'kb-item-inactive': activeId !== kb.id
                        }" 
                        @click="handleSelect(kb)"
                    >
                        <div class="kb-info flex-1 min-w-0 flex items-center">
                            <div class="kb-title truncate text-sm font-medium w-full">
                                {{ kb.name }}
                            </div>
                        </div>
                        <div class="kb-actions flex items-center opacity-0 group-hover:opacity-100">
                            <el-dropdown trigger="click" @command="(command) => handleDropdownCommand(command, kb)">
                                <template #dropdown>
                                    <el-dropdown-menu>
                                        <el-dropdown-item command="edit">
                                            <Edit class="w-4 h-4 mr-2 inline-block" />
                                            编辑
                                        </el-dropdown-item>
                                        <el-dropdown-item command="delete">
                                            <Delete class="w-4 h-4 mr-2 inline-block" />
                                            删除
                                        </el-dropdown-item>
                                    </el-dropdown-menu>
                                </template>
                                <div @click.stop class="kb-action-trigger">
                                    <el-icon class="w-4 h-4">
                                        <MoreFilled />
                                    </el-icon>
                                </div>
                            </el-dropdown>
                        </div>
                    </div>
                </template>
            </ScrollContainer>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { Plus, Edit, Delete, MoreFilled } from '@element-plus/icons-vue'
import { ElDropdown, ElDropdownMenu, ElDropdownItem } from 'element-plus'
import ScrollContainer from '@/components/ui/ScrollContainer.vue'
import type { KnowledgeBase } from '@/stores/knowledgeBase'

interface Props {
    visible?: boolean
    knowledgeBases: KnowledgeBase[]
    activeId: string | null
}

const props = defineProps<Props>()

const emit = defineEmits<{
    select: [kb: KnowledgeBase]
    create: []
    edit: [kb: KnowledgeBase]
    delete: [kb: KnowledgeBase]
}>()

// 内部搜索状态
const searchKeyword = ref('')

/**
 * 过滤后的知识库列表（支持搜索）
 */
const filteredKnowledgeBases = computed(() => {
    if (!searchKeyword.value || !searchKeyword.value.trim()) {
        return props.knowledgeBases
    }
    const keyword = searchKeyword.value.toLowerCase().trim()
    return props.knowledgeBases.filter(kb =>
        kb.name?.toLowerCase().includes(keyword) ||
        kb.description?.toLowerCase().includes(keyword)
    )
})

/**
 * 处理选中知识库
 */
function handleSelect(kb: KnowledgeBase) {
    emit('select', kb)
}

/**
 * 处理新建按钮点击
 */
function handleCreate() {
    emit('create')
}

/**
 * 处理下拉菜单命令
 */
function handleDropdownCommand(command: string, kb: KnowledgeBase) {
    if (command === 'edit') {
        emit('edit', kb)
    } else if (command === 'delete') {
        emit('delete', kb)
    }
}
</script>

<style scoped>
/* 搜索框样式 */
.search-box :deep(.el-input__wrapper) {
    background-color: var(--color-surface);
    border-radius: 8px;
    box-shadow: 0 0 0 1px var(--color-border) inset;
    padding: 6px 12px;
    transition: all 0.2s ease;
}

.search-box :deep(.el-input__wrapper:hover) {
    box-shadow: 0 0 0 1px var(--color-primary-300) inset;
}

.search-box :deep(.el-input__wrapper.is-focus) {
    box-shadow: 0 0 0 1px var(--color-primary) inset;
}

.search-box :deep(.el-input__inner) {
    font-size: 13px;
}

/* 知识库列表项样式 - 参考 ChatSidebar.vue */
.kb-item {
    display: flex;
    align-items: center;
    gap: 0.625rem;
    padding: 0.625rem 0.75rem;
    margin: 0.125rem 0.625rem;
    border-radius: 0.5rem;
    cursor: pointer;
    transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}

.kb-item-inactive {
    color: var(--color-text);
}

.kb-item-inactive:hover {
    background-color: var(--color-conversation-bg-hover);
    color: var(--color-conversation-text-hover);
}

.kb-item-active {
    background-color: var(--color-conversation-bg-active);
    color: var(--color-conversation-text-active);
}

.kb-title {
    line-height: 1.4;
}

.kb-desc {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--color-text-secondary);
    font-size: 0.75rem;
    margin-left: 2rem;
}

.kb-actions {
    margin-left: auto;
    opacity: 0;
    transition: opacity 0.2s ease;
}

/* 鼠标悬停时操作按钮显示 */
.kb-item:hover .kb-actions {
    opacity: 1;
}

/* 选中状态下操作按钮始终显示 */
/* .kb-item-active .kb-actions {
    opacity: 1;
} */

.kb-action-trigger {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0.25rem;
    border-radius: 0.25rem;
    cursor: pointer;
    transition: background-color 0.2s ease;
}

.kb-action-trigger:hover {
    background-color: rgba(0, 0, 0, 0.05);
}

.dark .kb-action-trigger:hover {
    background-color: rgba(255, 255, 255, 0.1);
}

/* 空状态样式 */
.empty-state-icon {
    display: flex;
    align-items: center;
    justify-content: center;
}

/* 滚动条美化 - 参考 ChatSidebar.vue */
.kb-sidebar :deep(.el-scrollbar__bar) {
    opacity: 0.6;
    transition: opacity 0.2s;
}

.kb-sidebar :deep(.el-scrollbar__bar:hover) {
    opacity: 1;
}
</style>
