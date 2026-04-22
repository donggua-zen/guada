# 文件上传进度反馈改进说明

## 改进概述

本次改进为聊天消息中的文件上传添加了实时进度反馈功能,解决了大文件上传时用户等待体验不佳的问题。

## 核心改进点

### 1. 状态管理增强 (fileUpload.ts)

**新增功能:**
- `uploadToSession()`: 专门用于会话文件上传,支持进度回调
- `executeSessionUpload()`: 执行带进度反馈的上传操作
- `uploadMultipleFilesToSession()`: 批量上传会话文件

**关键特性:**
- 使用 axios 的 `onUploadProgress` 钩子获取实时上传进度
- 每个文件独立的进度状态管理
- 上传完成后自动清理任务(延迟2秒以便用户看到完成状态)

### 2. UI 组件优化 (FileItem.vue)

**新增 Props:**
```typescript
uploadProgress?: number;  // 上传进度 0-100
uploadStatus?: 'queued' | 'uploading' | 'completed' | 'failed';
```

**UI 改进:**
- 上传中显示半透明黑色遮罩层 (`bg-black/60`)
- 遮罩层中央显示进度文本和进度条
- 进度条使用平滑过渡动画 (`transition-all duration-300`)
- 上传期间隐藏删除按钮,防止误操作
- 淡入动画效果 (`fadeIn 0.2s`)

**视觉效果:**
```
┌─────────────────────┐
│  [半透明黑色遮罩]    │
│                     │
│   上传中 45%        │
│   ▓▓▓▓░░░░░░       │
│                     │
└─────────────────────┘
```

### 3. 上传流程优化 (ChatInput.vue)

**智能上传策略:**
1. **即时上传**: 选择文件后立即开始上传(如果有 sessionId)
2. **进度跟踪**: 实时更新文件对象的 `uploadProgress` 和 `uploadStatus`
3. **发送前检查**: 点击发送时检查是否有文件正在上传
4. **自动等待**: 如有文件上传中,自动等待最多30秒
5. **超时处理**: 超时后仅发送已完成的文件

**关键函数:**
- `uploadToSessionWithProgress()`: 封装带进度的上传逻辑
- `waitForUploadsAndSend()`: 等待上传完成后发送消息
- `processFiles()`: 修改为立即触发上传而非延迟到发送时

### 4. 消息发送适配 (useMessageOperations.ts)

**智能文件处理:**
- 区分已上传文件和待上传文件
- 已上传文件直接使用其 ID,避免重复上传
- 清理文件对象中的临时字段 (`uploadProgress`, `uploadStatus`, `file`)
- 合并已上传和新上传的文件 ID

## 技术细节

### 上传状态流转

```
queued → uploading → completed
   ↓         ↓
   └────→ failed
```

### 进度更新机制

```typescript
// 在 fileUpload.ts 中
onUploadProgress: (progressEvent) => {
    const percentCompleted = Math.round(
        (progressEvent.loaded * 100) / progressEvent.total
    )
    
    updateUploadStatus(task.id, {
        status: 'uploading',
        progress: percentCompleted,
        currentStep: `上传中... ${percentCompleted}%`
    })
    
    // 回调通知 UI 更新
    onProgressUpdate?.(task)
}
```

### 文件对象结构

```typescript
{
    id: string,              // 临时ID或服务器返回的真实ID
    fileName: string,
    fileSize: number,
    fileType: string,
    fileExtension: string,
    displayName: string,
    file: File,              // 原始文件对象(上传后删除)
    previewUrl: string,      // 图片预览URL
    uploadProgress: number,  // 0-100
    uploadStatus: string     // 'queued' | 'uploading' | 'completed' | 'failed'
}
```

## 用户体验改进

### 改进前
- ❌ 选择大文件后无任何反馈
- ❌ 点击发送后长时间等待,不知道发生了什么
- ❌ 无法判断上传是否卡住或失败
- ❌ 多个文件同时上传,状态混乱

### 改进后
- ✅ 选择文件后立即显示"等待上传..."
- ✅ 实时显示上传进度百分比
- ✅ 可视化进度条提供直观反馈
- ✅ 每个文件独立显示进度,互不干扰
- ✅ 上传期间禁止删除,防止误操作
- ✅ 上传失败清晰提示
- ✅ 发送消息时自动等待上传完成

## 注意事项

### 1. 后端接口差异
- **消息文件上传**: `POST /api/v1/sessions/:sessionId/files`
- **知识库文件上传**: `POST /api/v1/knowledge-bases/:kbId/files/upload`

两者使用不同的 endpoint,本改进仅针对消息文件上传。

### 2. 并发控制
- 知识库上传有并发限制 (MAX_CONCURRENT_UPLOADS = 3)
- 消息文件上传无并发限制,可并行上传所有文件

### 3. 超时处理
- 默认等待时间: 30秒
- 超时后仅发送已成功上传的文件
- 失败的文件会被过滤掉

### 4. 内存管理
- 上传完成后2秒自动清理任务记录
- 文件对象中的 `file` 字段在发送消息后删除
- Blob URL 在移除文件时正确释放

## 测试建议

### 功能测试
1. 单个小文件上传 (< 1MB)
2. 单个大文件上传 (> 10MB)
3. 多个文件同时上传
4. 上传过程中切换会话
5. 上传失败场景(网络断开、文件过大等)
6. 上传过程中点击发送按钮
7. 上传完成后删除文件

### 性能测试
1. 同时上传10+个文件
2. 超大文件上传(100MB+)
3. 快速连续选择/删除文件

### UI 测试
1. 进度条动画流畅性
2. 遮罩层显示/隐藏时机
3. 删除按钮在上传期间的隐藏
4. 不同文件类型的图标显示

## 后续优化方向

1. **断点续传**: 支持大文件上传中断后继续
2. **重试机制**: 上传失败自动重试
3. **速度显示**: 显示上传速度 (KB/s)
4. **剩余时间**: 估算上传完成所需时间
5. **取消上传**: 允许用户手动取消上传
6. **压缩优化**: 上传前自动压缩图片
7. **队列优先级**: 支持用户调整上传顺序

## 相关文件清单

- `frontend/src/stores/fileUpload.ts` - 上传状态管理
- `frontend/src/components/ui/FileItem.vue` - 文件显示组件
- `frontend/src/components/ui/ChatInput.vue` - 输入框组件
- `frontend/src/composables/useMessageOperations.ts` - 消息操作逻辑
- `backend-ts/src/modules/files/files.controller.ts` - 后端文件上传接口

## 版本信息

- 改进日期: 2026-04-14
- 影响范围: 前端文件上传模块
- 向后兼容: 是(不影响现有功能)
