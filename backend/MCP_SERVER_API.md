# MCP Server API 文档

## 概述

MCP (Model Context Protocol) Server 功能已添加到后端，提供对 MCP 服务器的完整 CRUD 操作。

## 数据库迁移

在启动服务之前，需要先运行数据库迁移：

```bash
cd d:\编程开发\AI\ai_chat\backend
.venv\Scripts\activate
alembic upgrade head
```

这将创建 `mcp_server` 表，包含以下字段：
- `id`: String(26) - 主键（ULID）
- `name`: String(255) - 服务器名称（必填）
- `url`: String(500) - 服务地址 URL（必填）
- `description`: String(1000) - 描述信息（可选）
- `headers`: JSON - HTTP 请求头配置（可选）
- `enabled`: Boolean - 启用状态（默认 True）
- `created_at`: DateTime - 创建时间
- `updated_at`: DateTime - 更新时间

## API 接口

### 1. 获取所有 MCP 服务器

**请求：**
```http
GET /api/v1/mcp-servers
```

**响应示例：**
```json
{
  "code": 200,
  "message": "success",
  "data": {
    "items": [
      {
        "id": "01JQWERTY1234567890ABCDEF",
        "name": "生产环境 MCP 服务器",
        "url": "https://mcp.production.com/api",
        "description": "用于生产环境的 MCP 服务",
        "headers": {
          "Authorization": "Bearer sk-prod-token",
          "X-API-Key": "prod-key-123"
        },
        "enabled": true,
        "created_at": "2026-03-21T15:00:00Z",
        "updated_at": "2026-03-21T15:00:00Z"
      }
    ],
    "size": 1
  }
}
```

---

### 2. 获取单个 MCP 服务器

**请求：**
```http
GET /api/v1/mcp-servers/{server_id}
```

**参数：**
- `server_id` (path): MCP 服务器 ID

**响应示例：**
```json
{
  "code": 200,
  "message": "success",
  "data": {
    "id": "01JQWERTY1234567890ABCDEF",
    "name": "测试 MCP 服务器",
    "url": "https://mcp.test.com/api",
    "description": "测试用途",
    "headers": {
      "Authorization": "Bearer test-token"
    },
    "enabled": true,
    "created_at": "2026-03-21T15:00:00Z",
    "updated_at": "2026-03-21T15:00:00Z"
  }
}
```

---

### 3. 创建 MCP 服务器

**请求：**
```http
POST /api/v1/mcp-servers
Content-Type: application/json

{
  "name": "新的 MCP 服务器",
  "url": "https://mcp.new.com/api",
  "description": "新创建的测试服务器",
  "headers": {
    "Authorization": "Bearer new-token",
    "X-API-Key": "new-api-key",
    "Content-Type": "application/json"
  },
  "enabled": true
}
```

**请求体字段说明：**
- `name` (必填): 服务器名称，1-255 字符
- `url` (必填): 服务地址 URL，1-500 字符
- `description` (可选): 描述信息，最多 1000 字符
- `headers` (可选): HTTP 请求头字典，一行一个
- `enabled` (可选): 启用状态，默认 true

**响应示例：**
```json
{
  "code": 201,
  "message": "success",
  "data": {
    "id": "01JQWERTY1234567890ABCDEF",
    "name": "新的 MCP 服务器",
    "url": "https://mcp.new.com/api",
    "description": "新创建的测试服务器",
    "headers": {
      "Authorization": "Bearer new-token",
      "X-API-Key": "new-api-key"
    },
    "enabled": true,
    "created_at": "2026-03-21T15:00:00Z",
    "updated_at": "2026-03-21T15:00:00Z"
  }
}
```

---

### 4. 更新 MCP 服务器

**请求：**
```http
PUT /api/v1/mcp-servers/{server_id}
Content-Type: application/json

{
  "name": "更新后的名称",
  "description": "更新后的描述",
  "enabled": false
}
```

**参数：**
- `server_id` (path): MCP 服务器 ID
- 请求体中所有字段均为可选

**响应示例：**
```json
{
  "code": 200,
  "message": "success",
  "data": {
    "id": "01JQWERTY1234567890ABCDEF",
    "name": "更新后的名称",
    "url": "https://mcp.new.com/api",
    "description": "更新后的描述",
    "headers": {
      "Authorization": "Bearer new-token"
    },
    "enabled": false,
    "created_at": "2026-03-21T15:00:00Z",
    "updated_at": "2026-03-21T16:00:00Z"
  }
}
```

---

### 5. 删除 MCP 服务器

**请求：**
```http
DELETE /api/v1/mcp-servers/{server_id}
```

**参数：**
- `server_id` (path): MCP 服务器 ID

**响应：**
- 成功：`204 No Content`
- 失败：`404 Not Found`

---

### 6. 切换 MCP 服务器状态

**请求：**
```http
PATCH /api/v1/mcp-servers/{server_id}/toggle?enabled={true|false}
```

**参数：**
- `server_id` (path): MCP 服务器 ID
- `enabled` (query): 是否启用（true/false）

**响应示例：**
```json
{
  "code": 200,
  "message": "success",
  "data": {
    "id": "01JQWERTY1234567890ABCDEF",
    "name": "测试服务器",
    "url": "https://mcp.test.com/api",
    "enabled": true,
    "created_at": "2026-03-21T15:00:00Z",
    "updated_at": "2026-03-21T16:00:00Z"
  }
}
```

---

## 测试方法

### 方法一：使用测试脚本

```bash
cd d:\编程开发\AI\ai_chat\backend
.venv\Scripts\activate
python test_mcp_api.py
```

测试脚本会自动执行以下操作：
1. ✓ 获取所有服务器列表
2. ✓ 创建新服务器
3. ✓ 获取服务器详情
4. ✓ 更新服务器信息
5. ✓ 切换服务器状态
6. ✓ 删除服务器
7. ✓ 验证删除结果

### 方法二：使用 cURL 命令

```bash
# 获取所有服务器
curl http://localhost:8800/api/v1/mcp-servers

# 创建服务器
curl -X POST http://localhost:8800/api/v1/mcp-servers \
  -H "Content-Type: application/json" \
  -d '{
    "name": "测试服务器",
    "url": "https://mcp.test.com/api",
    "headers": {
      "Authorization": "Bearer test-token"
    }
  }'

# 获取服务器详情
curl http://localhost:8800/api/v1/mcp-servers/{server_id}

# 更新服务器
curl -X PUT http://localhost:8800/api/v1/mcp-servers/{server_id} \
  -H "Content-Type: application/json" \
  -d '{"enabled": false}'

# 删除服务器
curl -X DELETE http://localhost:8800/api/v1/mcp-servers/{server_id}
```

### 方法三：使用前端界面

访问前端设置页面的 MCP 服务器管理界面，可以：
- 查看 MCP 服务器列表
- 添加新服务器（支持自定义 HTTP 请求头）
- 编辑现有服务器
- 删除服务器
- 快速启用/禁用服务器

---

## 错误处理

### 常见错误码

| 状态码 | 说明 |
|--------|------|
| 200 | 成功 |
| 201 | 创建成功 |
| 204 | 删除成功 |
| 400 | 请求参数错误 |
| 404 | 服务器不存在 |
| 500 | 服务器内部错误 |

### 错误响应示例

```json
{
  "detail": "MCP Server not found"
}
```

---

## 数据模型

### MCPServer 模型

```python
class MCPServer(ModelBase):
    __tablename__ = "mcp_server"

    id = Column(String(26), primary_key=True)
    name = Column(String(255), nullable=False)
    url = Column(String(500), nullable=False)
    description = Column(String(1000), nullable=True)
    headers = Column(JSON, nullable=True)  # HTTP 请求头字典
    enabled = Column(Boolean, default=True)
    created_at = Column(DateTime)
    updated_at = Column(DateTime)
```

### Headers 格式说明

`headers` 字段存储为 JSON 对象，支持任意数量的自定义 HTTP 请求头：

```json
{
  "Authorization": "Bearer your_token_here",
  "X-API-Key": "your_api_key",
  "Content-Type": "application/json",
  "Custom-Header": "custom_value"
}
```

---

## 项目结构

```
backend/
├── app/
│   ├── models/
│   │   └── mcp_server.py          # MCP 服务器模型
│   ├── schemas/
│   │   └── mcp_server.py          # MCP 服务器 Schema
│   ├── repositories/
│   │   └── mcp_server_repository.py  # MCP 服务器仓库
│   ├── services/
│   │   └── mcp_server_service.py     # MCP 服务器服务
│   ├── routes/
│   │   └── mcp_servers.py         # MCP 服务器路由
│   ├── dependencies.py            # 依赖注入配置
│   └── __init__.py                # 应用初始化
├── migrations/
│   └── versions/
│       └── 175ed05a2735_add_mcp_server_table.py  # 数据库迁移
├── test_mcp_api.py                # API 测试脚本
└── MCP_SERVER_API.md              # 本文档
```

---

## 注意事项

1. **数据库迁移**：首次使用前必须运行 `alembic upgrade head` 创建表结构
2. **认证方式**：当前 API 未添加认证保护，生产环境建议添加 JWT 验证
3. **Headers 安全**：敏感信息（如 API Key）应妥善保管，避免泄露
4. **URL 验证**：建议在 Service 层添加 URL 格式验证逻辑
5. **并发控制**：高并发场景下建议添加乐观锁或版本控制

---

## 后续优化建议

- [ ] 添加 URL 格式验证
- [ ] 实现连接性检测（ping MCP 服务器）
- [ ] 添加批量操作接口
- [ ] 实现软删除功能
- [ ] 添加审计日志记录
- [ ] 增强错误处理和异常捕获
- [ ] 添加分页和排序功能
- [ ] 实现请求限流保护

---

## 更新日志

### 2026-03-21
- ✅ 初始版本发布
- ✅ 实现完整的 CRUD 操作
- ✅ 添加数据库迁移脚本
- ✅ 集成到 FastAPI 应用
- ✅ 提供测试脚本和文档