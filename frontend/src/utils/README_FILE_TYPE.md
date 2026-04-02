# 文件类型判断工具

## 📁 位置
`frontend/src/utils/fileType.ts`

---

## 🎯 功能说明

提供统一的文件类型判断和图标映射功能，支持以下场景：
- 根据文件扩展名判断文件类型
- 根据文件类型获取对应的图标名称
- 组合判断（优先使用 fileType，降级到 fileExtension）

---

## 🔧 API

### `getFileTypeFromExtension(extension: string): string`

根据文件扩展名返回文件类型分类。

**参数**:
- `extension`: 文件扩展名（带或不带点号均可）

**返回值**:
- `'text'` - 文本文档
- `'pdf'` - PDF 文件
- `'word'` - Word 文档
- `'excel'` - Excel 表格
- `'ppt'` - PPT 演示文稿
- `'html'` - HTML 文件
- `'code'` - 代码文件
- `'image'` - 图片文件
- `'video'` - 视频文件
- `'audio'` - 音频文件
- `'zip'` - 压缩文件
- `'unknown'` - 未知类型

**示例**:
```typescript
getFileTypeFromExtension('pdf')      // 'pdf'
getFileTypeFromExtension('.docx')    // 'word'
getFileTypeFromExtension('py')       // 'code'
getFileTypeFromExtension('jpg')      // 'image'
```

---

### `getIconByType(fileType: string): string`

根据文件类型返回对应的图标名称（iconfont 类名）。

**参数**:
- `fileType`: 文件类型（如 'pdf', 'word', 'code' 等）

**返回值**:
- 对应的图标类名（如 `'icon-file-pdf'`）

**示例**:
```typescript
getIconByType('pdf')     // 'icon-file-pdf'
getIconByType('code')    // 'icon-file-code'
getIconByType('image')   // 'icon-file-image'
```

---

### `getFileIcon(fileType?: string, fileExtension?: string): string`

组合函数，智能判断并返回图标名称。

**参数**:
- `fileType`: 可选，文件类型（优先使用）
- `fileExtension`: 可选，文件扩展名（降级使用）

**返回值**:
- 对应的图标类名

**优先级**:
1. 如果提供了 `fileType` 且不为 `'unknown'`，直接返回对应图标
2. 否则，如果提供了 `fileExtension`，根据扩展名判断类型并返回图标
3. 最后，返回默认图标 `'icon-file'`

**示例**:
```typescript
// 使用 fileType
getFileIcon('pdf')                    // 'icon-file-pdf'

// 使用 fileExtension
getFileIcon(undefined, '.docx')       // 'icon-file-word'
getFileIcon(undefined, 'py')          // 'icon-file-code'

// fileType 优先
getFileIcon('pdf', '.docx')           // 'icon-file-pdf'

// 默认图标
getFileIcon()                         // 'icon-file'
```

---

## 📊 支持的文件类型

### 文档类
| 扩展名 | 类型 | 图标 |
|--------|------|------|
| `.txt`, `.md`, `.markdown` | text | icon-file-txt |
| `.pdf` | pdf | icon-file-pdf |
| `.doc`, `.docx` | word | icon-file-word |
| `.xls`, `.xlsx`, `.csv` | excel | icon-file-excel |
| `.ppt`, `.pptx` | ppt | icon-file-ppt |
| `.html`, `.htm` | html | icon-file-html |

### 代码类
| 扩展名 | 类型 | 图标 |
|--------|------|------|
| `.py`, `.js`, `.ts`, `.jsx`, `.tsx` | code | icon-file-code |
| `.java`, `.cpp`, `.c`, `.go`, `.rs` | code | icon-file-code |
| `.php`, `.rb` | code | icon-file-code |
| `.json`, `.xml`, `.yaml`, `.yml` | code | icon-file-code |
| `.css`, `.scss`, `.less` | code | icon-file-code |

### 图片类
| 扩展名 | 类型 | 图标 |
|--------|------|------|
| `.jpg`, `.jpeg`, `.png`, `.gif` | image | icon-file-image |
| `.svg`, `.webp`, `.bmp`, `.ico` | image | icon-file-image |

### 视频类
| 扩展名 | 类型 | 图标 |
|--------|------|------|
| `.mp4`, `.avi`, `.mov`, `.wmv` | video | icon-file-video |
| `.flv`, `.mkv` | video | icon-file-video |

### 音频类
| 扩展名 | 类型 | 图标 |
|--------|------|------|
| `.mp3`, `.wav`, `.flac` | audio | icon-file-music |
| `.aac`, `.ogg` | audio | icon-file-music |

### 压缩包类
| 扩展名 | 类型 | 图标 |
|--------|------|------|
| `.zip`, `.rar`, `.7z` | zip | icon-file-zip |
| `.tar`, `.gz` | zip | icon-file-zip |

---

## 💡 使用场景

### 1. **文件列表组件**
```vue
<template>
  <div class="file-item">
    <i :class="getFileIcon(file.file_type, file.file_extension)"></i>
    <span>{{ file.display_name }}</span>
  </div>
</template>

<script setup lang="ts">
import { getFileIcon } from '@/utils/fileType'
</script>
```

### 2. **上传任务显示**
```vue
<template>
  <div class="upload-task">
    <i :class="getFileIcon(undefined, task.fileExtension)"></i>
    <span>{{ task.fileName }}</span>
  </div>
</template>
```

### 3. **文件类型筛选**
```typescript
const files = ref<FileItem[]>([])

const pdfFiles = computed(() => 
  files.value.filter(f => getFileTypeFromExtension(f.extension) === 'pdf')
)
```

---

## 🎨 图标资源

图标基于项目中的 iconfont 图标库，需确保以下图标已定义：

**基础图标**:
- `icon-file` - 默认通用图标

**类型图标**:
- `icon-file-txt` - 文本文件
- `icon-file-pdf` - PDF 文件
- `icon-file-word` - Word 文档
- `icon-file-excel` - Excel 表格
- `icon-file-ppt` - PPT 演示文稿
- `icon-file-code` - 代码文件
- `icon-file-image` - 图片文件
- `icon-file-video` - 视频文件
- `icon-file-music` - 音频文件
- `icon-file-zip` - 压缩文件
- `icon-file-html` - HTML 文件

---

## 📝 注意事项

1. **大小写不敏感**: 扩展名会自动转换为小写处理
2. **点号处理**: 支持带点号（`.pdf`）和不带点号（`pdf`）的输入
3. **降级策略**: 优先使用 `fileType`，不存在时降级到 `fileExtension`
4. **未知类型**: 无法识别时返回默认的 `icon-file` 图标

---

## 🔄 扩展维护

如需添加新的文件类型支持：

1. 在 `getFileTypeFromExtension` 中添加扩展名映射
2. 在 `getIconByType` 中添加类型到图标的映射
3. 更新本文档的表格

**示例：添加 `.apk` 支持**
```typescript
// 1. 添加到 getTypeFromExtension
if (['apk'].includes(ext)) return 'application'

// 2. 添加到 getIconByType
'application': 'icon-file-application'

// 3. 准备对应的 SVG 图标文件 src/assets/file_application.svg
```

---

**更新时间**: 2026-04-01  
**版本**: v1.0
