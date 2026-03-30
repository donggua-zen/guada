<template>
    <!-- @ts-ignore - fileIcon 类型推断问题 -->
    <div class="file-item flex items-center relative" :class="{ 'cursor-pointer': clickable }"
        @mouseenter="close_button_visible = true" @click="handleClick" @mouseleave="close_button_visible = false">
        <template v-if="type === 'image'">
            <div class="image-preview w-15 h-15 rounded-lg overflow-hidden">
                <img :src="previewUrl" class="w-full h-full object-cover"></img>
            </div>
        </template>
        <template v-else>
            <div
                class="flex items-center px-2 py-1.5  bg-gray-50 border border-gray-200 rounded-lg transition-all duration-200 hover:bg-gray-100 hover:border-gray-300">
                <div class="file-icon mr-2 text-gray-500 flex items-center w-8 h-8">
                    <img :src="fileIcon" class="w-full h-full">
                </div>
                <div class="file-info flex-1 min-w-32 max-w-40 ">
                    <div class="file-name text-sm font-medium text-gray-700 truncate">{{ name }}</div>
                    <div class="file-details text-xs text-gray-500">{{ ext }} · {{
                        formatFileSize(size) }}</div>
                </div>
            </div>
        </template>
        <div v-if="closable"
            class="file-remove absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-500 text-white flex items-center justify-center cursor-pointer transition-all duration-200 hover:bg-red-600 hover:scale-110"
            v-show="close_button_visible" @click="removeFile">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <path
                    d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
            </svg>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'

// 导入所有图标
import fileCodeIcon from '@/assets/file_code.svg'
import fileExcelIcon from '@/assets/file_excel.svg'
import fileHtmlIcon from '@/assets/file_html.svg'
import fileMusicIcon from '@/assets/file_music.svg'
import filePptIcon from '@/assets/file_ppt.svg'
import fileTxtIcon from '@/assets/file_txt.svg'
import fileVideoIcon from '@/assets/file_video.svg'
import fileWordIcon from '@/assets/file_word.svg'
import fileZipIcon from '@/assets/file_zip.svg'

// Props 类型化
const props = defineProps<{
    name?: string;
    type?: string;
    ext?: string;
    size?: number;
    previewUrl?: string;
    closable?: boolean;
    clickable?: boolean;
}>()

// Emits 类型化
const emit = defineEmits<{
    close: []
    click: []
}>()
const close_button_visible = ref(false)

// 文件类型到图标的映射
const fileIconMap = {
    // 代码文件
    'js': fileCodeIcon,
    'ts': fileCodeIcon,
    'vue': fileCodeIcon,
    'py': fileCodeIcon,
    'java': fileCodeIcon,
    'h': fileCodeIcon,
    'hpp': fileCodeIcon,
    'cpp': fileCodeIcon,
    'c': fileCodeIcon,
    'go': fileCodeIcon,
    'rs': fileCodeIcon,
    'php': fileCodeIcon,
    'rb': fileCodeIcon,
    'css': fileCodeIcon,
    'json': fileCodeIcon,
    'xml': fileCodeIcon,
    'sh': fileCodeIcon,

    // html
    'html': fileHtmlIcon,


    // 文档文件
    'doc': fileWordIcon,
    'docx': fileWordIcon,
    'xls': fileExcelIcon,
    'xlsx': fileExcelIcon,
    'ppt': filePptIcon,
    'pptx': filePptIcon,
    'txt': fileTxtIcon,
    'md': fileTxtIcon,

    // 媒体文件
    'mp3': fileMusicIcon,
    'wav': fileMusicIcon,
    'flac': fileMusicIcon,
    'mp4': fileVideoIcon,
    'avi': fileVideoIcon,
    'mkv': fileVideoIcon,
    'mov': fileVideoIcon,

    // 压缩文件
    'zip': fileZipIcon,
    'rar': fileZipIcon,
    '7z': fileZipIcon,
    'tar': fileZipIcon,
    'gz': fileZipIcon,
}

// 计算属性：根据文件类型返回对应的图标 - 类型化
const fileIcon = computed((): any => {
    const lowerType = props.ext?.toLowerCase()
    return (fileIconMap as any)[lowerType || ''] || fileTxtIcon
})

// 格式化文件大小 - 类型化
const formatFileSize = (bytes: number | undefined): string => {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes: string[] = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

// 移除文件 - 类型化
const removeFile = (): void => {
    emit('close')
}

// 处理点击 - 类型化
const handleClick = (): void => {
    if (!props.clickable) return
    emit('click')
}
</script>