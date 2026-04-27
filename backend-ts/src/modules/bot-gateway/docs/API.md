# Bot Management API 文档

## 📊 API 优化说明

### 性能优化

为了减少前端请求次数,提升页面加载速度,我们对平台元数据接口进行了优化:

- ✅ **`GET /platforms`**: 现在直接返回包含 `fields` 的完整平台信息
- ⚠️ **`GET /platforms/:platform/fields`**: 保留作为向后兼容,但不推荐使用

**优势对比**:
| 方案 | 请求次数 | 说明 |
|------|---------|------|
| 旧方案 | 2次 | `/platforms` + `/platforms/qq/fields` |
| **新方案** | **1次** | **只需 `/platforms`** |

---

## 基础路径

```
/api/v1/bot-admin
```

**认证**: 所有接口都需要用户登录,需在请求头中携带 JWT Token:
```
Authorization: Bearer <your_jwt_token>
```

---

## 1. 平台元数据接口

### 1.1 获取所有支持的平台列表

**用途**: 前端展示可选的机器人平台(如 QQ、微信、Discord),并直接获取配置字段定义

```
GET /platforms
```

**认证**: 需要登录

**响应示例**:
```json
[
  {
    "platform": "qq",
    "displayName": "QQ 机器人",
    "icon": "qq",
    "description": "接入 QQ 开放平台机器人",
    "fields": [
      {
        "key": "appId",
        "label": "App ID",
        "type": "text",
        "required": true,
        "placeholder": "请输入 QQ 开放平台 App ID",
        "description": "在 QQ 开放平台创建应用后获取"
      },
      {
        "key": "appSecret",
        "label": "App Secret",
        "type": "password",
        "required": true,
        "placeholder": "请输入 App Secret"
      },
      {
        "key": "token",
        "label": "Bot Token",
        "type": "password",
        "required": false,
        "placeholder": "WebSocket 模式可留空"
      },
      {
        "key": "mode",
        "label": "连接模式",
        "type": "select",
        "required": true,
        "options": [
          { "value": "websocket", "label": "WebSocket (推荐)" },
          { "value": "webhook", "label": "Webhook" }
        ],
        "defaultValue": "websocket"
      },
      {
        "key": "sandbox",
        "label": "沙箱环境",
        "type": "boolean",
        "required": false,
        "defaultValue": false
      }
    ]
  },
  {
    "platform": "wechat",
    "displayName": "微信机器人",
    "icon": "wechat",
    "description": "接入企业微信或微信公众号",
    "fields": [
      // ... 微信的配置字段
    ]
  },
  {
    "platform": "discord",
    "displayName": "Discord Bot",
    "icon": "discord",
    "description": "接入 Discord 机器人",
    "fields": [
      // ... Discord 的配置字段
    ]
  }
]
```

**优势**: 
- ✅ **减少请求次数**: 一次请求即可获取所有平台的完整信息
- ✅ **简化前端逻辑**: 无需额外调用 `/platforms/:platform/fields`
- ✅ **更好的用户体验**: 页面加载更快

---

### 1.2 获取指定平台的配置字段定义(可选)

**用途**: 向后兼容,或需要单独获取某个平台的字段定义时使用

```
GET /platforms/:platform/fields
```

**认证**: 需要登录

**参数**:
- `platform`: 平台标识 (qq, wechat, discord)

**说明**: 
- ⚠️ **此接口已不推荐使用**,因为 `GET /platforms` 已经包含所有平台的字段定义
- 保留此接口是为了向后兼容旧版本前端
- 新开发的前端应直接使用 `GET /platforms` 接口

**响应示例** (以 QQ 为例):
```json
[
  {
    "key": "appId",
    "label": "App ID",
    "type": "text",
    "required": true,
    "placeholder": "请输入 QQ 开放平台 App ID",
    "description": "在 QQ 开放平台创建应用后获取"
  },
  // ... 其他字段
]
```

---

## 2. 机器人实例管理接口

### 2.1 获取所有机器人实例列表

**用途**: 展示当前用户创建的所有机器人及其状态

```
GET /instances
```

**认证**: 需要登录 (自动过滤为当前用户的机器人)

**查询参数**:
- `userId` (可选): 管理员可查看指定用户的机器人

**响应示例**:
```json
[
  {
    "id": "cuid-1",
    "userId": "user-cuid-123",
    "platform": "qq",
    "name": "客服机器人A",
    "enabled": true,
    "platformConfig": {
      "appId": "1903907133",
      "appSecret": "***",
      "token": "***",
      "mode": "websocket",
      "sandbox": false
    },
    "reconnectEnabled": true,
    "maxRetries": 5,
    "retryInterval": 5000,
    "defaultCharacterId": "char-cuid-123",
    "defaultModelId": null,
    "status": "running",
    "lastStartedAt": "2026-04-27T15:30:00Z",
    "lastError": null,
    "createdAt": "2026-04-27T10:00:00Z",
    "updatedAt": "2026-04-27T15:30:00Z",
    "runtimeStatus": "CONNECTED"
  }
]
```

**状态说明**:
- `stopped`: 已停止
- `running`: 运行中
- `error`: 错误状态
- `connecting`: 连接中

**runtimeStatus 可能值**:
- `CONNECTED`: 已连接
- `DISCONNECTED`: 已断开
- `CONNECTING`: 连接中
- `ERROR`: 错误

---

### 2.2 获取单个机器人详情

**用途**: 编辑机器人时加载当前配置

```
GET /instances/:id
```

**认证**: 需要登录 (只能查看自己创建的机器人)

**响应示例**:
```json
{
  "id": "cuid-1",
  "userId": "user-cuid-123",
  "platform": "qq",
  "name": "客服机器人A",
  "enabled": true,
  "platformConfig": {
    "appId": "1903907133",
    "appSecret": "***",
    "token": "***",
    "mode": "websocket",
    "sandbox": false
  },
  "reconnectEnabled": true,
  "maxRetries": 5,
  "retryInterval": 5000,
  "defaultCharacterId": "char-cuid-456",
  "defaultModelId": null,
  "status": "running",
  "lastStartedAt": "2026-04-27T15:30:00Z",
  "lastError": null,
  "createdAt": "2026-04-27T10:00:00Z",
  "updatedAt": "2026-04-27T15:30:00Z",
  "runtimeStatus": "CONNECTED"
}
```

**注意**: `platformConfig` 中的敏感字段应脱敏显示(如 `***`),前端编辑时如需修改需重新输入完整值。

---

### 2.3 创建新机器人实例

**用途**: 用户填写表单后提交创建

```
POST /instances
```

**认证**: 需要登录 (自动关联当前用户ID)

**请求体**:
```json
{
  "platform": "qq",
  "name": "我的QQ机器人",
  "platformConfig": {
    "appId": "1903907133",
    "appSecret": "woTv98yay96pKbeS",
    "token": "",
    "mode": "websocket",
    "sandbox": false
  },
  "reconnectConfig": {
    "enabled": true,
    "maxRetries": 5,
    "retryInterval": 5000
  },
  "defaultCharacterId": "char-cuid-123",
  "defaultModelId": "model-cuid-456",
  "autoStart": true
}
```

**字段说明**:
- `platform`: 必填,平台标识
- `name`: 必填,机器人显示名称
- `platformConfig`: 必填,根据平台不同包含不同字段(参考 1.2 接口返回的 fields)
- `reconnectConfig`: 可选,重连配置
- `defaultCharacterId`: **必填**,默认关联的角色ID(用于对话流程)
- `defaultModelId`: 可选,默认关联的模型ID
- `autoStart`: 可选,是否创建后立即启动(默认 false)

**成功响应** (201):
```json
{
  "id": "cuid-new",
  "userId": "user-cuid-123",
  "platform": "qq",
  "name": "我的QQ机器人",
  "enabled": true,
  "status": "running",
  "createdAt": "2026-04-27T16:00:00Z"
}
```

**错误响应** (400):
```json
{
  "statusCode": 400,
  "message": "Missing required fields: appId, appSecret",
  "error": "Bad Request"
}
```

**错误响应** (404):
```json
{
  "statusCode": 404,
  "message": "Unsupported platform: invalid-platform",
  "error": "Not Found"
}
```

---

### 2.4 更新机器人配置

**用途**: 修改机器人名称、凭证等配置

```
PUT /instances/:id
```

**认证**: 需要登录 (只能修改自己创建的机器人)

**请求体**:
```json
{
  "name": "新的机器人名称",
  "platformConfig": {
    "appId": "new-app-id",
    "appSecret": "new-secret",
    "mode": "websocket"
  },
  "enabled": true,
  "defaultCharacterId": "char-cuid-789"
}
```

**说明**:
- 只传递需要更新的字段
- 如果更新了 `platformConfig`,会自动重启机器人
- 如果更新了 `enabled` 从 false → true,会自动启动

**成功响应**:
```json
{
  "id": "cuid-1",
  "userId": "user-cuid-123",
  "platform": "qq",
  "name": "新的机器人名称",
  "enabled": true,
  "updatedAt": "2026-04-27T16:30:00Z"
}
```

**错误响应** (404):
```json
{
  "statusCode": 404,
  "message": "Bot instance cuid-1 not found",
  "error": "Not Found"
}
```

---

### 2.5 启动机器人

**用途**: 手动启动已停止的机器人

```
POST /instances/:id/start
```

**认证**: 需要登录 (只能启动自己创建的机器人)

**成功响应**:
```json
{
  "success": true
}
```

**错误响应** (400):
```json
{
  "statusCode": 400,
  "message": "Bot is disabled",
  "error": "Bad Request"
}
```

**错误响应** (404):
```json
{
  "statusCode": 404,
  "message": "Bot instance cuid-1 not found",
  "error": "Not Found"
}
```

---

### 2.6 停止机器人

**用途**: 停止运行中的机器人

```
POST /instances/:id/stop
```

**认证**: 需要登录 (只能停止自己创建的机器人)

**成功响应**:
```json
{
  "success": true
}
```

---

### 2.7 重启机器人

**用途**: 快速重启(先停止再启动)

```
POST /instances/:id/restart
```

**认证**: 需要登录 (只能重启自己创建的机器人)

**成功响应**:
```json
{
  "success": true
}
```

---

### 2.8 删除机器人

**用途**: 永久删除机器人实例

```
DELETE /instances/:id
```

**认证**: 需要登录 (只能删除自己创建的机器人)

**说明**:
- 删除前会自动停止机器人
- 此操作不可恢复,前端应二次确认

**成功响应**:
```json
{
  "success": true
}
```

**错误响应** (404):
```json
{
  "statusCode": 404,
  "message": "Bot instance cuid-1 not found",
  "error": "Not Found"
}
```

---

## 🔐 权限控制说明

### ✅ 已实现

所有接口都通过 NestJS 的 `@UseGuards(AuthGuard)` 装饰器保护,确保:

1. ✅ **必须登录**: 未登录用户访问会返回 401 Unauthorized
2. ✅ **用户隔离**: 每个用户只能操作自己创建的机器人
3. ✅ **Token 验证**: JWT Token 过期或无效会被拒绝
4. ✅ **自动获取用户ID**: 从 JWT Token 中解析 `req.user.id`

### 实现细节

```typescript
@Controller('api/v1/bot-admin')
@UseGuards(AuthGuard)  // 类级别 Guard,应用于所有路由
export class BotAdminController {
  
  @Get('instances')
  async getInstances(@Request() req) {
    const userId = req.user.id;  // 从 JWT Token 中获取
    return this.botService.getAllInstances(userId);
  }
  
  @Post('instances/:id/start')
  async startInstance(@Param('id') id: string, @Request() req) {
    const userId = req.user.id;
    
    // 验证是否属于当前用户
    const bot = await this.botService.getInstance(id);
    if (bot.userId !== userId) {
      throw new Error('无权操作此机器人');
    }
    
    return this.botService.startInstance(id);
  }
}
```

### AuthGuard 工作流程

1. 提取请求头中的 `Authorization: Bearer <token>`
2. 使用 JwtService 验证 Token 有效性
3. 将 payload 附加到 `req.user`
4. 如果 Token 无效或缺失,抛出 401 Unauthorized

---

## 📋 前端使用流程示例

### 场景1: 新建 QQ 机器人(优化版)

```javascript
// 1. 一次性获取所有平台及其配置字段
const platforms = await fetch('/api/v1/bot-admin/platforms', {
  headers: { 'Authorization': `Bearer ${token}` }
}).then(r => r.json());

// 2. 用户选择 "qq" 后,直接从返回数据中获取 fields
const qqPlatform = platforms.find(p => p.platform === 'qq');
const fields = qqPlatform.fields;  // 无需额外请求!

// 3. 前端根据 fields 动态生成表单
// ... (渲染表单逻辑)

// 4. 用户填写表单后提交
await fetch('/api/v1/bot-admin/instances', {
  method: 'POST',
  headers: { 
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  },
  body: JSON.stringify({
    platform: 'qq',
    name: '我的机器人',
    platformConfig: {
      appId: '1903907133',
      appSecret: 'woTv98yay96pKbeS',
      mode: 'websocket'
    },
    autoStart: true
  })
});

// 5. 刷新列表查看新创建的机器人
const bots = await fetch('/api/v1/bot-admin/instances', {
  headers: { 'Authorization': `Bearer ${token}` }
}).then(r => r.json());
```

**对比优化前**:
- ❌ **旧方案**: 需要 2 次请求 (`/platforms` + `/platforms/qq/fields`)
- ✅ **新方案**: 只需 1 次请求 (`/platforms`)

### 场景2: 启动/停止机器人

```javascript
// 启动
await fetch(`/api/v1/bot-admin/instances/${botId}/start`, { 
  method: 'POST',
  headers: { 'Authorization': `Bearer ${token}` }
});

// 停止
await fetch(`/api/v1/bot-admin/instances/${botId}/stop`, { 
  method: 'POST',
  headers: { 'Authorization': `Bearer ${token}` }
});
```

### 场景3: 编辑机器人

```javascript
// 1. 获取当前配置
const bot = await fetch(`/api/v1/bot-admin/instances/${botId}`, {
  headers: { 'Authorization': `Bearer ${token}` }
}).then(r => r.json());

// 2. 用户修改后提交(只传变更的字段)
await fetch(`/api/v1/bot-admin/instances/${botId}`, {
  method: 'PUT',
  headers: { 
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  },
  body: JSON.stringify({
    name: '新名称',
    platformConfig: {
      appId: bot.platformConfig.appId,  // 保持原值
      appSecret: 'new-secret-value',  // 新值
      mode: bot.platformConfig.mode
    }
  })
});
```

---

## ⚠️ 待办事项

### 高优先级

- [ ] **凭证加密**: 数据库中存储的 `credentials` 应加密(如 AES-256)
- [ ] **敏感信息脱敏**: GET 接口返回的 secret/token 应脱敏为 `***`

### 中优先级

- [ ] **审计日志**: 记录机器人的启动、停止、配置修改等操作
- [ ] **速率限制**: 防止频繁调用启动/停止接口
- [ ] **错误重试**: 启动失败时的自动重试机制

### 低优先级

- [ ] **WebSocket 实时状态**: 推送机器人状态变化到前端
- [ ] **批量操作**: 支持批量启动/停止多个机器人
- [ ] **导入导出**: 支持机器人配置的导入导出
