import { computed } from 'vue'

// 导入 vscode-icons 彩色文件图标
import vscodeJs from '@/assets/vscode_file_type_js.svg'
import vscodeTs from '@/assets/vscode_file_type_typescript.svg'
import vscodeVue from '@/assets/vscode_file_type_vue.svg'
import vscodePython from '@/assets/vscode_file_type_python.svg'
import vscodeJava from '@/assets/vscode_file_type_java.svg'
import vscodeC from '@/assets/vscode_file_type_c.svg'
import vscodeCpp from '@/assets/vscode_file_type_cpp.svg'
import vscodeGo from '@/assets/vscode_file_type_go.svg'
import vscodeRust from '@/assets/vscode_file_type_rust.svg'
import vscodePhp from '@/assets/vscode_file_type_php.svg'
import vscodeRuby from '@/assets/vscode_file_type_ruby.svg'
import vscodeCss from '@/assets/vscode_file_type_css.svg'
import vscodeSass from '@/assets/vscode_file_type_sass.svg'
import vscodeJson from '@/assets/vscode_file_type_json.svg'
import vscodeXml from '@/assets/vscode_file_type_xml.svg'
import vscodeHtml from '@/assets/vscode_file_type_html.svg'
import vscodeText from '@/assets/vscode_file_type_text.svg'
import vscodeMarkdown from '@/assets/vscode_file_type_markdown.svg'
import vscodeWord from '@/assets/vscode_file_type_word.svg'
import vscodeExcel from '@/assets/vscode_file_type_excel2.svg'
import vscodePpt from '@/assets/vscode_file_type_powerpoint.svg'
import vscodePdf from '@/assets/vscode_file_type_pdf.svg'
import vscodeImage from '@/assets/vscode_file_type_image.svg'
import vscodeVideo from '@/assets/vscode_file_type_video.svg'
import vscodeAudio from '@/assets/vscode_file_type_audio.svg'
import vscodeZip from '@/assets/vscode_file_type_zip.svg'
import vscodeShell from '@/assets/vscode_file_type_shell.svg'
import vscodeYaml from '@/assets/vscode_file_type_yaml.svg'

// 文件类型到图标的映射
const fileIconMap: Record<string, string> = {
    // 代码文件
    'js': vscodeJs,
    'mjs': vscodeJs,
    'cjs': vscodeJs,
    'ts': vscodeTs,
    'mts': vscodeTs,
    'cts': vscodeTs,
    'vue': vscodeVue,
    'py': vscodePython,
    'java': vscodeJava,
    'c': vscodeC,
    'cpp': vscodeCpp,
    'cc': vscodeCpp,
    'cxx': vscodeCpp,
    'h': vscodeCpp,
    'hpp': vscodeCpp,
    'go': vscodeGo,
    'rs': vscodeRust,
    'php': vscodePhp,
    'rb': vscodeRuby,
    'css': vscodeCss,
    'scss': vscodeSass,
    'sass': vscodeSass,
    'less': vscodeCss,
    'json': vscodeJson,
    'jsonc': vscodeJson,
    'xml': vscodeXml,
    'svg': vscodeImage,
    'sh': vscodeShell,
    'bash': vscodeShell,
    'zsh': vscodeShell,
    'yaml': vscodeYaml,
    'yml': vscodeYaml,
    'html': vscodeHtml,
    'htm': vscodeHtml,

    // 文档文件
    'txt': vscodeText,
    'md': vscodeMarkdown,
    'markdown': vscodeMarkdown,
    'log': vscodeText,
    'docx': vscodeWord,
    'doc': vscodeWord,
    'xlsx': vscodeExcel,
    'xls': vscodeExcel,
    'csv': vscodeExcel,
    'ppt': vscodePpt,
    'pptx': vscodePpt,
    'pdf': vscodePdf,

    // 图片文件
    'png': vscodeImage,
    'jpg': vscodeImage,
    'jpeg': vscodeImage,
    'gif': vscodeImage,
    'webp': vscodeImage,
    'bmp': vscodeImage,
    'ico': vscodeImage,
    'tiff': vscodeImage,

    // 音频文件
    'mp3': vscodeAudio,
    'wav': vscodeAudio,
    'flac': vscodeAudio,
    'ogg': vscodeAudio,
    'm4a': vscodeAudio,
    'aac': vscodeAudio,

    // 视频文件
    'mp4': vscodeVideo,
    'avi': vscodeVideo,
    'mkv': vscodeVideo,
    'mov': vscodeVideo,
    'webm': vscodeVideo,
    'flv': vscodeVideo,

    // 压缩文件
    'zip': vscodeZip,
    'rar': vscodeZip,
    '7z': vscodeZip,
    'tar': vscodeZip,
    'gz': vscodeZip,
    'bz2': vscodeZip,
    'xz': vscodeZip,
}

/**
 * 根据文件名获取对应的 vscode-icons 图标 URL
 */
export function getFileIcon(fileName: string): string {
    const ext = fileName.split('.').pop()?.toLowerCase() || ''
    return fileIconMap[ext] || vscodeText
}

/**
 * 文件图标 composable
 * @param fileNameGetter 返回文件名的函数或 getter
 */
export function useFileIcon(fileNameGetter: () => string) {
    return computed(() => getFileIcon(fileNameGetter()))
}
