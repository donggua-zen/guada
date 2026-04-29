# 登录错误处理优化说明

## 优化概述

本次优化改进了登录失败时的用户体验，确保用户能够收到清晰、友好的错误提示，而不是技术性的错误信息。

## 主要改进

### 1. 后端优化

#### AuthController (`backend-ts/src/modules/auth/auth.controller.ts`)
- **登录接口** (`POST /auth/login`)
  - 必填字段验证：返回中文提示 "用户名和密码不能为空" (400)
  - 认证失败：统一返回 "用户名或密码错误" (401)，不区分用户不存在或密码错误，避免信息泄露

#### AuthService (`backend-ts/src/modules/auth/auth.service.ts`)
- **validateUserByUsername** 方法
  - 添加详细的日志记录，区分用户不存在和密码错误两种情况
  - 便于问题排查和安全审计

### 2. 前端优化

#### ApiService (`frontend/src/services/ApiService.ts`)
- **响应拦截器增强**
  - 网络错误标记：为连接错误添加 `isNetworkError` 标志
  - 智能错误消息提取：优先使用后端返回的 `message` 字段，兼容多种响应格式
  - 登录接口特殊处理：排除 `/auth/login` 的 401 错误，避免登录失败时跳转到登录页
  - 保留状态码：在 Error 对象上附加 `statusCode` 属性，便于前端分类处理

#### LoginPage (`frontend/src/components/LoginPage.vue`)
- **handleLogin 方法增强**
  - 网络错误：显示 "无法连接到服务器，请检查网络连接或稍后重试"
  - 认证错误 (401)：显示 "用户名或密码错误，请检查后重试"
  - 必填字段缺失 (400)：显示 "请输入用户名和密码"
  - 其他错误：显示后端返回的具体错误消息
  - 默认兜底：显示 "登录失败，请稍后重试"

#### Auth Store (`frontend/src/stores/auth.ts`)
- **login 方法优化**
  - 直接抛出原始错误对象，保留 `statusCode` 等关键信息
  - 避免包装错误导致信息丢失

## 错误响应格式

### 成功响应
```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIs...",
  "user": {
    "id": "xxx",
    "username": "admin",
    "nickname": "管理员",
    "role": "primary"
  }
}
```

### 错误响应（全局异常过滤器）
```json
{
  "statusCode": 401,
  "timestamp": "2026-04-29T12:00:00.000Z",
  "path": "/api/v1/auth/login",
  "message": "用户名或密码错误"
}
```

## 测试场景

### 场景 1：用户名或密码错误
**操作**：输入错误的用户名或密码
**预期结果**：
- 后端返回 401 状态码
- 前端显示："用户名或密码错误，请检查后重试"
- 不会跳转到登录页（因为已经在登录页）

### 场景 2：未填写用户名或密码
**操作**：留空用户名或密码字段并点击登录
**预期结果**：
- 前端表单验证拦截，显示字段级错误提示
- 如果绕过前端验证，后端返回 400 状态码
- 前端显示："请输入用户名和密码"

### 场景 3：后端服务未启动
**操作**：在后端服务关闭时尝试登录
**预期结果**：
- 前端检测到网络连接错误
- 显示：“无法连接到服务器，请检查网络连接或稍后重试”
- 不会跳转到登录页

## 安全性考虑

1. **不区分用户不存在和密码错误**：统一返回 "用户名或密码错误"，防止攻击者枚举有效用户名
2. **详细日志记录**：后端记录具体的失败原因（用户不存在 vs 密码错误），便于安全审计和问题排查
3. **避免信息泄露**：不在前端暴露技术细节（如堆栈跟踪、数据库错误等）

## 兼容性

- ✅ 与现有的全局异常过滤器 (`AllExceptionsFilter`) 完全兼容
- ✅ 保持原有的 JWT 认证流程不变
- ✅ 不影响自动登录功能
- ✅ 支持 Electron 和 Web 环境

## 相关文件

### 后端
- `backend-ts/src/modules/auth/auth.controller.ts`
- `backend-ts/src/modules/auth/auth.service.ts`
- `backend-ts/src/common/filters/all-exceptions.filter.ts`

### 前端
- `frontend/src/components/LoginPage.vue`
- `frontend/src/services/ApiService.ts`
- `frontend/src/stores/auth.ts`

## 后续优化建议

1. **账户锁定机制**：连续多次登录失败后临时锁定账户
2. **验证码**：在多次失败后要求输入验证码
3. **管理员初始化**：提供初始账户创建脚本或工具
4. **邮箱验证**：支持邮箱绑定和验证
5. **双因素认证**：支持 TOTP 或短信验证码
