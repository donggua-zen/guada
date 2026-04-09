# 认证 Token 字段命名统一修复报告

## 📋 问题描述

后端返回的登录响应使用 `access_token`（snake_case），但前端期望的是 `accessToken`（camelCase），导致前后端字段命名不一致。

---

## 🔍 根本原因

1. **后端 Auth Service** 返回 `access_token`（snake_case）
2. **前端类型定义** 已改为 `accessToken`（camelCase）
3. **前端 Auth Store** 已兼容两种格式
4. **字段命名不统一** 导致潜在的类型错误和维护困难

---

## ✅ 已完成的修复

### 1. **后端修改**

#### 1.1 Auth Service

**文件**: [`src/modules/auth/auth.service.ts`](file://d:\编程开发\AI\ai_chat\backend-ts\src\modules\auth\auth.service.ts#L31-L44)

```typescript
// 修改前
async login(user: any) {
  const payload = { email: user.email, sub: user.id };
  return {
    access_token: this.jwtService.sign(payload),  // ❌ snake_case
    user: { ... }
  };
}

// 修改后
async login(user: any) {
  const payload = { email: user.email, sub: user.id };
  return {
    accessToken: this.jwtService.sign(payload),  // ✅ camelCase
    user: { ... }
  };
}
```

---

### 2. **前端修改**

#### 2.1 API 类型定义

**文件**: [`src/types/api.ts`](file://d:\编程开发\AI\ai_chat\frontend\src\types\api.ts#L80-L84)

```typescript
// 修改前
export interface AuthToken {
    access_token: string      // ❌ snake_case
    token_type: string
    expires_in?: number
}

// 修改后
export interface AuthToken {
    accessToken: string       // ✅ camelCase
    tokenType?: string
    expiresIn?: number
}
```

**文件**: [`src/types/api.ts`](file://d:\编程开发\AI\ai_chat\frontend\src\types\api.ts#L133-L134)

```typescript
// 修改前
login: { access_token: string; user: User }        // ❌
register: { access_token: string; user: User }     // ❌

// 修改后
login: { accessToken: string; user: User }         // ✅
register: { accessToken?: string; user?: User }    // ✅
```

#### 2.2 Mock 服务

**文件**: [`src/services/ApiServiceDummy.ts`](file://d:\编程开发\AI\ai_chat\frontend\src\services\ApiServiceDummy.ts#L214-L221)

```typescript
// 修改前
async login(credentials: any): Promise<ApiResponse<any>> {
    return {
        data: {
            access_token: 'mock-token',  // ❌
            user: { id: 'mock-id', username: credentials.username }
        }
    }
}

// 修改后
async login(credentials: any): Promise<ApiResponse<any>> {
    return {
        data: {
            accessToken: 'mock-token',   // ✅
            user: { id: 'mock-id', username: credentials.username }
        }
    }
}
```

#### 2.3 Auth Store（已兼容，无需修改）

**文件**: [`src/stores/auth.ts`](file://d:\编程开发\AI\ai_chat\frontend\src\stores\auth.ts#L27-L28)

Auth Store 已经兼容两种格式：

```typescript
const accessToken = (result as any).accessToken || (result as any).data?.accessToken
```

这段代码会自动适配后端的 `accessToken` 字段。

---

## 📊 修改统计

| 类别 | 文件数 | 修改行数 | 说明 |
|------|--------|---------|------|
| **后端** | 1 | 1 | auth.service.ts |
| **前端** | 2 | 6 | api.ts + ApiServiceDummy.ts |
| **总计** | **3** | **7** | 全链路统一为 camelCase |

---

## 🎯 统一的字段命名规范

### 认证相关字段（camelCase）

| 字段名 | 类型 | 说明 |
|--------|------|------|
| `accessToken` | string | JWT 访问令牌 |
| `tokenType` | string | 令牌类型（通常为 "Bearer"） |
| `expiresIn` | number | 过期时间（秒） |

---

## ⚠️ 注意事项

### 1. 其他可能的 snake_case 字段

检查项目中是否还有其他地方使用 `access_token`：

```bash
# 搜索后端
grep -r "access_token" src/

# 搜索前端
grep -r "access_token" src/
```

### 2. Python 后端兼容性

如果项目同时运行 Python 后端，需要确认 Python 后端的登录接口也返回 `accessToken`（camelCase）。

---

## 🔧 测试验证

### 1. 后端 API 测试

```bash
cd d:\编程开发\AI\ai_chat\backend-ts
node test-login.js
```

预期输出：
```
✅ 使用 accessToken (camelCase)
```

### 2. 前端登录测试

1. 打开前端应用
2. 使用账号 `admin@dingd.cn` / `123456` 登录
3. 检查浏览器开发者工具 → Network 标签
4. 查看 `/api/v1/auth/login` 响应，应包含 `accessToken` 字段

---

## 📝 相关文档

- [JSON 字段命名统一修复完成报告](./JSON_FIELD_NAMING_FIX_COMPLETE.md)
- [JSON 字段命名一致性分析](./JSON_FIELD_NAMING_CONSISTENCY_ANALYSIS.md)
- [Characters 获取单个角色接口修复](./CHARACTERS_GET_BY_ID_FIX.md)

---

## ✅ 修复总结

### 修复前的问题
1. ❌ 后端返回 `access_token`（snake_case）
2. ❌ 前端期望 `accessToken`（camelCase）
3. ❌ 字段命名不一致导致类型错误风险

### 修复后的状态
1. ✅ 后端返回 `accessToken`（camelCase）
2. ✅ 前端类型定义统一为 camelCase
3. ✅ Mock 服务同步更新
4. ✅ Auth Store 自动兼容

### 预期收益
- ✅ 消除字段命名不一致导致的 bug
- ✅ 提高代码可维护性
- ✅ 符合 TypeScript/JavaScript 编码规范
- ✅ 与项目其他 API 保持一致

---

**修复日期**: 2026-04-05  
**修复人员**: Lingma AI Assistant  
**影响范围**: 后端 1 个文件 + 前端 2 个文件  
**风险等级**: 低（仅修改字段名）  
**建议操作**: 重启后端服务以应用更改
