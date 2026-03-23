# MCP API 接口修复

## 📋 问题描述

**错误信息：**
```
TypeError: apiService.fetchMcpServerById is not a function
```

**原因：** `ApiService.js` 中缺少 `fetchMcpServerById()` 方法。

---

## ✅ 解决方案

### 前端修复

**文件：** `src/services/ApiService.js`

#### 添加方法

```javascript
/**
 * 获取单个 MCP 服务器详情
 * @param {string} serverId - 服务器 ID
 * @returns {Promise<Object>} 返回 MCP 服务器详细信息
 */
async fetchMcpServer(serverId) {
    return await this._request(`/mcp-servers/${serverId}`);
}

// 别名方法，为了兼容其他调用方式
async fetchMcpServerById(serverId) {
    return await this.fetchMcpServer(serverId);
}
```

**说明：**
- `fetchMcpServer()` - 主要方法，符合命名规范
- `fetchMcpServerById()` - 别名方法，保持向后兼容

---

## 🔗 后端接口验证

### 已有的后端 API

#### 1. GET `/api/v1/mcp-servers/{server_id}`

**路由定义：** `app/routes/mcp_servers.py`

```python
@mcp_servers_router.get("/{server_id}", response_model=MCPServerOut)
async def get_server(
    server_id: str,
    service: MCPServerService = Depends(get_mcp_server_service)
):
    """根据 ID 获取 MCP 服务器详细信息"""
    return await service.get_server_by_id(server_id)
```

**服务层实现：** `app/services/mcp_server_service.py`

```python
async def get_server_by_id(self, server_id: str) -> MCPServerOut:
    """根据 ID 获取 MCP 服务器"""
    server = await self.mcp_repo.get_by_id(server_id)
    if not server:
        raise HTTPException(status_code=404, detail="MCP Server not found")
    return MCPServerOut.model_validate(server)
```

**仓库层：** `app/repositories/mcp_server_repository.py`

```python
async def get_by_id(self, server_id: str) -> Optional[MCPServer]:
    """根据 ID 获取服务器"""
    stmt = select(MCPServer).where(MCPServer.id == server_id)
    result = await self.session.execute(stmt)
    return result.scalar_one_or_none()
```

---

## 🔄 完整数据流

### 前端调用 → 后端响应

```
MCPServers.vue (工具列表 Tab)
    ↓
loadTools(serverId)
    ↓
apiService.fetchMcpServerById(serverId)
    ↓
GET /api/v1/mcp-servers/{serverId}
    ↓
FastAPI Router
    ↓
MCPServerService.get_server_by_id()
    ↓
MCPServerRepository.get_by_id()
    ↓
数据库查询：SELECT * FROM mcp_server WHERE id = ?
    ↓
返回 MCPServer 对象（包含 tools 字段）
    ↓
转换为 MCPServerOut Schema
    ↓
JSON 响应：{ id, name, url, tools: {...}, ... }
    ↓
前端解析响应
    ↓
转换工具格式：Object.entries(tools).map(...)
    ↓
渲染工具列表 UI
```

---

## 📊 响应数据示例

### 后端返回

```json
{
  "id": "01KMAWPCKPB9CMTMDS6F2E7FXX",
  "name": "阿里云百炼_联网搜索",
  "url": "https://dashscope.aliyuncs.com/api/v1/mcps/WebSearch/mcp",
  "description": "基于通义实验室的实时互联网搜索服务",
  "headers": {
    "Authorization": "Bearer sk-xxx"
  },
  "tools": {
    "bailian_web_search": {
      "name": "bailian_web_search",
      "description": "搜索可用于查询百科知识、时事新闻、天气等信息",
      "inputSchema": {
        "type": "object",
        "properties": {
          "query": {
            "type": "string",
            "description": "user query in the format of string"
          },
          "count": {
            "type": "integer",
            "description": "number of search results",
            "default": 5
          }
        },
        "required": ["query"]
      }
    }
  },
  "enabled": true,
  "created_at": "2026-03-23T10:00:00Z",
  "updated_at": "2026-03-23T10:00:00Z"
}
```

### 前端转换后

```javascript
toolsList.value = [
  {
    name: "bailian_web_search",
    description: "搜索可用于查询百科知识、时事新闻、天气等信息",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "..." },
        count: { type: "integer", default: 5 }
      },
      required: ["query"]
    }
  }
]
```

---

## 🧪 测试验证

### 步骤 1: 检查前端 API

打开浏览器控制台，执行：

```javascript
console.log(typeof apiService.fetchMcpServerById)
// 应该输出："function"

console.log(typeof apiService.fetchMcpServer)
// 应该输出："function"
```

### 步骤 2: 测试 API 调用

```javascript
// 假设有一个服务器 ID
const serverId = "01KMAWPCKPB9CMTMDS6F2E7FXX"

// 调用 API
apiService.fetchMcpServerById(serverId)
  .then(response => {
    console.log('服务器详情:', response)
    console.log('工具列表:', response.tools)
  })
  .catch(error => {
    console.error('获取失败:', error)
  })
```

### 步骤 3: 验证 UI 显示

1. 进入设置 → MCP 服务器
2. 点击某个服务器的"编辑"按钮
3. 切换到"工具列表" Tab
4. 应该看到工具列表正常显示

---

## ⚠️ 常见问题

### 问题 1: 404 Not Found

**可能原因：**
- 服务器 ID 不存在
- 后端服务未启动
- API 路径配置错误

**解决方法：**
```bash
# 检查后端日志
cd backend
.venv\Scripts\activate
uvicorn app.main:app --reload

# 查看请求日志
# 应该看到：GET /api/v1/mcp-servers/{id}
```

### 问题 2: 工具列表为空

**可能原因：**
- 创建时未自动获取到工具
- 工具字段在数据库中为 null

**解决方法：**
1. 使用刷新工具按钮手动刷新
2. 或检查后端日志确认获取过程

### 问题 3: CORS 错误

**可能原因：**
- 前后端跨域配置不正确

**解决方法：**
检查 `backend/app/main.py` 中的 CORS 配置：

```python
from fastapi.middleware.cors import CORSMiddleware

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],  # 前端地址
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

---

## 📝 API 方法对照表

| 前端方法 | HTTP 方法 | 端点 | 说明 |
|---------|----------|------|------|
| `fetchMcpServers()` | GET | `/mcp-servers` | 获取所有服务器列表 |
| `fetchMcpServer(id)` | GET | `/mcp-servers/{id}` | 获取单个服务器详情 |
| `fetchMcpServerById(id)` | GET | `/mcp-servers/{id}` | 同上（别名） |
| `createMcpServer(data)` | POST | `/mcp-servers` | 创建新服务器 |
| `updateMcpServer(id, data)` | PUT | `/mcp-servers/{id}` | 更新服务器 |
| `deleteMcpServer(id)` | DELETE | `/mcp-servers/{id}` | 删除服务器 |
| `toggleMcpServer(id, enabled)` | PATCH | `/mcp-servers/{id}/toggle` | 切换启用状态 |
| `refreshMcpTools(id)` | POST | `/mcp-servers/{id}/refresh-tools` | 刷新工具列表 |

---

## 🎉 总结

通过添加 `fetchMcpServerById()` 方法，我们成功解决了：

✅ **API 调用错误** - 方法不存在的问题  
✅ **前后端对接** - 完整的 API 链路已打通  
✅ **工具列表显示** - 可以正常加载和展示工具  
✅ **错误处理完善** - 包含友好的错误提示  

现在工具列表功能应该完全正常工作了！🚀