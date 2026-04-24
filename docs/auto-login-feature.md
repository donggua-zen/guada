# 免登录功能使用指南

## 功能概述

免登录功能允许用户开启后自动使用主账户（role='primary'）登录系统，无需输入用户名和密码。此功能特别适用于 Electron 桌面应用或个人本地使用场景。

## 使用方法

### 1. 开启免登录模式

1. 正常登录系统
2. 进入 **系统设置** > **通用设置**
3. 找到 **免登录模式** 开关
4. 点击开关开启功能
5. 系统会提示"已开启免登录模式"

### 2. 关闭免登录模式

1. 进入 **系统设置** > **通用设置**
2. 点击 **免登录模式** 开关关闭功能
3. 如果当前没有有效 token，系统会提示重新登录

### 3. 自动登录流程

开启免登录后：
- 刷新页面时会自动尝试登录
- 访问需要认证的页面时会自动使用主账户
- 无需手动输入用户名和密码

## 技术实现

### 后端改造

1. **Settings Service** (`backend-ts/src/modules/settings/settings.service.ts`)
   - `getAutoLoginEnabled()`: 获取免登录配置状态
   - `setAutoLoginEnabled(enabled)`: 设置免登录配置状态

2. **Auth Service** (`backend-ts/src/modules/auth/auth.service.ts`)
   - `autoLogin()`: 执行自动登录，查询 primary 用户并生成 JWT token

3. **User Repository** (`backend-ts/src/common/database/user.repository.ts`)
   - `findPrimaryUser()`: 查找 role='primary' 的用户

4. **Auth Guard** (`backend-ts/src/modules/auth/auth.guard.ts`)
   - 在无 token 时尝试自动登录
   - 保持向后兼容，不影响现有认证流程

5. **Auth Controller** (`backend-ts/src/modules/auth/auth.controller.ts`)
   - `POST /auth/auto-login`: 公开接口，用于前端主动触发自动登录

6. **Settings Controller** (`backend-ts/src/modules/settings/settings.controller.ts`)
   - `GET /settings/auto-login`: 获取免登录状态（公开）
   - `POST /settings/auto-login`: 设置免登录状态（需认证）

### 前端改造

1. **Auth Store** (`frontend/src/stores/auth.ts`)
   - `autoLoginEnabled`: 免登录状态
   - `checkAutoLoginStatus()`: 检查免登录配置
   - `setAutoLoginEnabled(enabled)`: 设置免登录配置
   - `tryAutoLogin()`: 尝试自动登录

2. **API Service** (`frontend/src/services/ApiService.ts`)
   - `getAutoLoginStatus()`: 获取免登录状态
   - `setAutoLoginStatus(enabled)`: 设置免登录状态
   - `autoLogin()`: 执行自动登录

3. **Router Guard** (`frontend/src/main.js`)
   - 在路由守卫中集成自动登录逻辑
   - 优先尝试自动登录，失败后再检查 token

4. **General Settings** (`frontend/src/components/setting/GeneralSettings.vue`)
   - 提供免登录开关 UI
   - 显示安全提示信息

## 注意事项

### 安全性

⚠️ **重要提醒**:
- 开启免登录后，任何访问此应用的人都将自动获得主账户权限
- 建议仅在个人设备或受信任的内网环境中使用
- 不要在公共电脑或共享设备上开启此功能

### 兼容性

- ✅ 完全兼容现有的登录验证流程
- ✅ 支持多用户和子账户体系
- ✅ 不影响现有的权限管理
- ✅ Electron 和 Web 环境均可正常使用

### 数据存储

- 免登录配置存储在 `global_settings` 表中
- key: `autoLoginEnabled`
- value: `"true"` 或 `"false"`
- userId: `null` (全局配置)

## 故障排查

### 问题1: 开启免登录后仍然需要登录

**可能原因**:
- 数据库中没有 role='primary' 的用户
- 自动登录接口调用失败

**解决方法**:
1. 检查数据库中是否存在 primary 用户
2. 查看浏览器控制台错误信息
3. 查看后端日志

### 问题2: 关闭免登录后无法访问系统

**可能原因**:
- 关闭前没有有效的 token
- session 已过期

**解决方法**:
1. 清除浏览器缓存
2. 重新访问 `/login` 页面登录
3. 使用正常的用户名密码登录

### 问题3: 设置保存失败

**可能原因**:
- 网络连接问题
- 后端服务未启动
- 权限不足

**解决方法**:
1. 检查网络连接
2. 确认后端服务正常运行
3. 确保当前用户有管理员权限

## 开发调试

### 后端日志

自动登录相关的关键日志:
```
免登录模式未开启
未找到 primary 用户，无法自动登录
自动登录成功，用户ID: xxx
自动登录失败: [error details]
```

### 前端日志

```
🎭 [Mock] 配置已加载 (如果使用 Mock 模式)
自动登录成功
获取免登录状态失败: [error]
设置免登录状态失败: [error]
```

## API 接口说明

### 获取免登录状态

```http
GET /api/v1/settings/auto-login
Authorization: Bearer <token> (可选)
```

响应:
```json
{
  "enabled": true
}
```

### 设置免登录状态

```http
POST /api/v1/settings/auto-login
Authorization: Bearer <token>
Content-Type: application/json

{
  "enabled": true
}
```

响应:
```json
{
  "success": true
}
```

### 自动登录

```http
POST /api/v1/auth/auto-login
(无需认证)
```

响应:
```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "xxx",
    "email": "admin@example.com",
    "nickname": "Admin",
    "role": "primary",
    ...
  }
}
```

## 版本历史

- v1.0.0 (2026-04-22): 初始版本，实现基本的免登录功能
