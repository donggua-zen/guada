/**
 * 文件类型判断工具函数
 */

/**
 * 根据文件扩展名获取文件类型
 */
export function getFileTypeFromExtension(extension: string): string {
    const ext = extension.toLowerCase().replace('.', '')
    
    // 文档类
    if (['txt', 'md', 'markdown'].includes(ext)) return 'text'
    if (['pdf'].includes(ext)) return 'pdf'
    if (['doc', 'docx'].includes(ext)) return 'word'
    if (['xls', 'xlsx', 'csv'].includes(ext)) return 'excel'
    if (['ppt', 'pptx'].includes(ext)) return 'ppt'
    if (['html', 'htm'].includes(ext)) return 'html'
    
    // 代码类
    if (['py', 'js', 'ts', 'jsx', 'tsx', 'java', 'cpp', 'c', 'go', 'rs', 'php', 'rb'].includes(ext)) {
        return 'code'
    }
    if (['json', 'xml', 'yaml', 'yml', 'css', 'scss', 'less'].includes(ext)) {
        return 'code'
    }
    
    // 图片类
    if (['jpg', 'jpeg', 'png', 'gif', 'svg', 'webp', 'bmp', 'ico'].includes(ext)) return 'image'
    
    // 视频类
    if (['mp4', 'avi', 'mov', 'wmv', 'flv', 'mkv'].includes(ext)) return 'video'
    
    // 音频类
    if (['mp3', 'wav', 'flac', 'aac', 'ogg'].includes(ext)) return 'audio'
    
    // 压缩包类
    if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return 'zip'
    
    return 'unknown'
}

/**
 * 根据文件类型获取图标名称
 */
export function getIconByType(fileType: string): string {
    const icons: Record<string, string> = {
        'text': 'icon-file-txt',
        'pdf': 'icon-file-pdf',
        'word': 'icon-file-word',
        'excel': 'icon-file-excel',
        'ppt': 'icon-file-ppt',
        'code': 'icon-file-code',
        'image': 'icon-file-image',
        'video': 'icon-file-video',
        'audio': 'icon-file-music',
        'zip': 'icon-file-zip',
        'html': 'icon-file-html',
        'unknown': 'icon-file',
    }
    return icons[fileType] || 'icon-file'
}

/**
 * 根据文件扩展名获取图标名称（组合函数）
 */
export function getFileIcon(fileType?: string, fileExtension?: string): string {
    // 如果提供了 fileType，优先使用
    if (fileType && fileType !== 'unknown') {
        return getIconByType(fileType)
    }
    
    // 根据扩展名判断
    if (fileExtension) {
        const type = getFileTypeFromExtension(fileExtension)
        return getIconByType(type)
    }
    
    return 'icon-file'
}
