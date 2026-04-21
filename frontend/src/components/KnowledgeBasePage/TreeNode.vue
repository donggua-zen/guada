<!-- KnowledgeBasePage/TreeNode.vue -->
<template>
    <div class="tree-node">
        <!-- 节点内容 -->
        <div 
            class="node-content flex items-center gap-2 px-2 py-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800 cursor-pointer transition-colors"
            :class="{ 'bg-blue-50 dark:bg-blue-900/20': node.isDirectory && isExpanded }"
            @click="handleNodeClick"
        >
            <!-- 展开/折叠图标 -->
            <el-icon 
                v-if="node.isDirectory" 
                class="text-gray-400 transition-transform duration-200"
                :class="{ 'rotate-90': isExpanded }"
                size="14"
            >
                <ArrowRight />
            </el-icon>
            <div v-else class="w-3.5"></div>
            
            <!-- 文件夹/文件图标 -->
            <el-icon v-if="node.isDirectory" class="text-yellow-500" size="18">
                <Folder />
            </el-icon>
            <img v-else :src="getFileIcon(node)" class="w-5 h-5 object-contain" alt="file icon" />
            
            <!-- 名称 -->
            <span class="text-sm text-gray-700 dark:text-gray-300 truncate flex-1">
                {{ node.displayName }}
            </span>
            
            <!-- 文件信息(仅文件显示) -->
            <span v-if="!node.isDirectory" class="text-xs text-gray-500 dark:text-gray-400 shrink-0">
                {{ formatSize(node.fileSize) }}
            </span>
            
            <!-- 状态标签 -->
            <el-tag v-if="!node.isDirectory" size="small" :type="getStatusType(node.processingStatus)" class="shrink-0">
                {{ getStatusText(node.processingStatus) }}
            </el-tag>
        </div>
        
        <!-- 子节点(递归渲染) -->
        <div v-if="node.isDirectory && isExpanded && node.children.length > 0" 
             class="ml-5 mt-1 space-y-1 border-l-2 border-gray-200 dark:border-gray-700 pl-2">
            <TreeNode
                v-for="child in node.children"
                :key="child.id"
                :node="child"
                :all-nodes="allNodes"
                @view="$emit('view', $event)"
                @retry="$emit('retry', $event)"
                @delete="$emit('delete', $event)"
            />
        </div>
        
        <!-- 空文件夹提示 -->
        <div v-if="node.isDirectory && isExpanded && node.children.length === 0" 
             class="ml-7 py-1 text-xs text-gray-400 dark:text-gray-500 italic">
            (空文件夹)
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { ArrowRight, Folder } from '@element-plus/icons-vue'
import type { KBFile } from '@/stores/fileUpload'

// 导入文件图标
import fileCodeIcon from '@/assets/file_code.svg'
import fileTxtIcon from '@/assets/file_txt.svg'
import fileWordIcon from '@/assets/file_word.svg'
import fileExcelIcon from '@/assets/file_excel.svg'
import filePptIcon from '@/assets/file_ppt.svg'
import filePdfIcon from '@/assets/file_zip.svg' // 临时使用zip图标代替PDF

interface Props {
    node: any
    allNodes: Map<string, any>
}

const props = defineProps<Props>()

const emit = defineEmits<{
    view: [file: KBFile]
    retry: [file: KBFile]
    delete: [file: KBFile]
}>()

/**
 * 展开状态(本地管理)
 */
const isExpanded = ref(props.node.expanded || false)

/**
 * 处理节点点击
 */
function handleNodeClick() {
    if (props.node.isDirectory) {
        // 文件夹: 切换展开/折叠
        isExpanded.value = !isExpanded.value
        // 同步回原对象
        props.node.expanded = isExpanded.value
    } else if (props.node.processingStatus === 'completed') {
        // 文件: 触发查看事件
        emit('view', props.node)
    }
}

/**
 * 获取文件图标
 */
function getFileIcon(file: KBFile): string {
    const ext = file.fileExtension?.toLowerCase() || ''
    
    const iconMap: Record<string, string> = {
        'pdf': filePdfIcon,
        'doc': fileWordIcon,
        'docx': fileWordIcon,
        'xls': fileExcelIcon,
        'xlsx': fileExcelIcon,
        'ppt': filePptIcon,
        'pptx': filePptIcon,
        'txt': fileTxtIcon,
        'md': fileTxtIcon,
        'js': fileCodeIcon,
        'ts': fileCodeIcon,
        'py': fileCodeIcon,
        'java': fileCodeIcon,
    }
    
    return iconMap[ext] || fileTxtIcon
}

/**
 * 格式化文件大小
 */
function formatSize(bytes: number): string {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return (bytes / Math.pow(k, i)).toFixed(1) + ' ' + sizes[i]
}

/**
 * 获取状态类型
 */
function getStatusType(status: string): string {
    const types: Record<string, string> = {
        'pending': 'info',
        'processing': 'warning',
        'completed': 'success',
        'failed': 'danger',
    }
    return types[status] || 'info'
}

/**
 * 获取状态文本
 */
function getStatusText(status: string): string {
    const texts: Record<string, string> = {
        'pending': '等待处理',
        'processing': '处理中',
        'completed': '已完成',
        'failed': '失败',
    }
    return texts[status] || status
}
</script>

<style scoped>
.tree-node {
    user-select: none;
}

.node-content:hover {
    background-color: rgba(0, 0, 0, 0.04);
}

.dark .node-content:hover {
    background-color: rgba(255, 255, 255, 0.04);
}
</style>
