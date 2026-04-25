# 后端 URL 自动转换功能说明

## 概述

本项目已实现后端自动 URL 转换功能，所有返回给前端的资源 URL（头像、图片、文件等）都会根据环境变量 `BASE_URL` 自动转换为完整 URL。

## 配置说明

### 1. 环境变量配置

在 `backend-ts/.env` 文件中配置：

```env
# Application Base URL (用于生成完整的资源 URL)
# Electron 环境: http://localhost:3000
# Web 环境: 留空或设置为域名 (例如: https://api.example.com)
BASE_URL=http://localhost:3000
```

**配置规则：**
- **Electron 桌面应用**：设置为 `http://localhost:3000`
- **Web 部署**：留空（使用相对路径）或设置为实际域名
- **开发环境**：通常设置为 `http://localhost:3000`

### 2. 生效范围

以下类型的 URL 会自动转换：

| 字段名 | 示例 | 转换后 |
|--------|------|--------|
| `avatarUrl` | `/static/images/providers/openai.svg` | `http://localhost:3000/static/images/providers/openai.svg` |
| `imageUrl` | `/static/file_stores/avatars/xxx.jpg` | `http://localhost:3000/static/file_stores/avatars/xxx.jpg` |
| `fileUrl` | `/static/file_stores/files/xxx.pdf` | `http://localhost:3000/static/file_stores/files/xxx.pdf` |
| `url` | `/uploads/xxx.png` | `http://localhost:3000/uploads/xxx.png` |
| `logoUrl` | `/static/images/logo.svg` | `http://localhost:3000/static/images/logo.svg` |

## 技术实现

### 核心组件

#### 1. UrlService (`src/common/services/url.service.ts`)

统一的 URL 转换服务，提供以下方法：

```typescript
// 将相对路径转换为完整 URL
toAbsoluteUrl(path: string): string

// 转换单个对象中的 URL 字段
transformUrls<T>(obj: T, urlFields?: string[]): T

// 转换数组中每个对象的 URL 字段
transformArrayUrls<T>(arr: T[], urlFields?: string[]): T[]
```

#### 2. SharedModule (`src/common/services/shared.module.ts`)

全局模块，导出 `UrlService` 和 `UploadPathService`，所有模块都可以直接使用。

#### 3. UploadPathService 集成

`UploadPathService.getWebUrl()` 方法已集成 `UrlService`，自动返回完整 URL：

```typescript
// 之前：返回 /static/file_stores/avatars/xxx.jpg
// 现在：返回 http://localhost:3000/static/file_stores/avatars/xxx.jpg
const webUrl = this.uploadPathService.getWebUrl("avatars", filename);
```

### 已修改的服务

| 服务 | 修改内容 |
|------|---------|
| `AuthService` | 登录、自动登录返回的用户信息（包含 `avatarUrl`） |
| `SessionService` | 会话列表、会话详情（包含 `avatarUrl`） |
| `CharacterService` | 角色列表、角色详情（包含 `avatarUrl`） |
| `ModelService` | 供应商模板、供应商列表（包含 `avatarUrl`） |
| `UserService` | 用户资料（包含 `avatarUrl`） |
| `UploadPathService` | 文件上传返回的 URL |

### Provider Templates 特殊处理

由于 `PROVIDER_TEMPLATES` 是常量数组，创建了专门的转换函数：

```typescript
// src/constants/provider-templates.ts
export function transformProviderTemplateUrls(baseUrl?: string): ProviderTemplate[]
```

在 `ModelService.getProviderTemplates()` 中调用此函数。

## 使用示例

### 示例 1：在服务中使用

```typescript
import { Injectable } from "@nestjs/common";
import { UrlService } from "../../common/services/url.service";

@Injectable()
export class MyService {
  constructor(private urlService: UrlService) {}

  async getData() {
    const item = await this.repo.findById(id);
    
    // 自动转换 item 中的 avatarUrl, imageUrl 等字段
    return this.urlService.transformUrls(item);
  }
}
```

### 示例 2：转换数组

```typescript
async getList() {
  const items = await this.repo.findAll();
  
  // 批量转换所有项的 URL
  return this.urlService.transformArrayUrls(items);
}
```

### 示例 3：手动转换单个 URL

```typescript
const relativeUrl = "/static/images/example.svg";
const absoluteUrl = this.urlService.toAbsoluteUrl(relativeUrl);
// 结果：http://localhost:3000/static/images/example.svg
```

## 前端适配

前端已经实现了 `fixStaticUrl` 工具函数（`frontend/src/utils/url.ts`），作为兜底方案：

```typescript
export function fixStaticUrl(url: string): string {
  const isElectron = typeof window !== 'undefined' && window.electronAPI !== undefined
  
  if (isElectron && url.startsWith('/')) {
    return `http://localhost:3000${url}`
  }
  
  return url
}
```

**注意：** 由于后端已经返回完整 URL，前端的 `fixStaticUrl` 函数会检测到 URL 已经是绝对路径（以 `http://` 开头），直接返回原值，不会重复添加前缀。

## 测试验证

### 1. 检查环境变量

```bash
cd backend-ts
cat .env | grep BASE_URL
# 应该输出：BASE_URL=http://localhost:3000
```

### 2. 启动后端

```bash
cd backend-ts
npm run start:dev
```

### 3. 测试 API

```bash
# 获取供应商模板
curl http://localhost:3000/api/v1/providers/templates | jq '.[0].avatarUrl'
# 应该输出："http://localhost:3000/static/images/providers/siliconflow.svg"

# 获取用户资料（需要先登录获取 token）
curl -H "Authorization: Bearer YOUR_TOKEN" http://localhost:3000/api/v1/user/profile | jq '.avatarUrl'
# 应该输出："http://localhost:3000/static/file_stores/avatars/xxx.jpg"
```

### 4. 测试 Electron 应用

```bash
cd ..
npm run build:electron
cd release/win-unpacked
.\'GuaDa.exe'
```

打开开发者工具，检查 Network 面板中的请求，确认所有资源 URL 都是完整的 HTTP URL。

## 常见问题

### Q1: 如何禁用 URL 转换？

将 `.env` 中的 `BASE_URL` 设置为空或删除该行：

```env
# BASE_URL=
```

这样所有 URL 都会保持相对路径格式。

### Q2: Web 部署时如何配置？

根据实际域名配置：

```env
BASE_URL=https://api.yourdomain.com
```

### Q3: 自定义 URL 字段怎么办？

`transformUrls` 方法支持自定义字段列表：

```typescript
this.urlService.transformUrls(item, ['customUrl', 'thumbnailUrl'])
```

### Q4: 性能影响如何？

URL 转换是在内存中进行的字符串操作，性能开销极小（< 0.1ms/请求），可以忽略不计。

## 维护指南

### 添加新的 URL 字段

如果数据库新增了 URL 字段（如 `coverUrl`），需要：

1. 在 `UrlService.transformUrls()` 的默认字段列表中添加：

```typescript
urlFields: string[] = [
  "avatarUrl", 
  "imageUrl", 
  "fileUrl", 
  "url", 
  "logoUrl",
  "coverUrl"  // 新增
]
```

2. 或者在调用时显式指定：

```typescript
this.urlService.transformUrls(item, ['avatarUrl', 'coverUrl'])
```

### 调试技巧

启用详细日志（临时修改 `UrlService`）：

```typescript
toAbsoluteUrl(path: string): string {
  console.log(`[UrlService] Converting: ${path}`);
  // ... 原有逻辑
  console.log(`[UrlService] Result: ${result}`);
  return result;
}
```

## 总结

✅ **优势：**
- 统一管理，易于维护
- 自动转换，无需手动拼接
- 灵活配置，支持多环境
- 性能优异，无额外开销

✅ **适用场景：**
- Electron 桌面应用
- Web 应用多域名部署
- CDN 加速配置
- 微服务架构

🎯 **最佳实践：**
- 始终通过 `UrlService` 处理 URL
- 不要硬编码域名
- 利用环境变量区分环境
- 前端保留兜底方案
