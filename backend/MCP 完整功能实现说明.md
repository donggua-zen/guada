# MCP 完整功能实现说明

## 📋 概述

本文档详细说明 MCP (Model Context Protocol) 服务器的完整功能实现，包括工具自动获取和聊天时的工具调用。

---

## ✅ 已实现的功能

### 1. **MCP 服务器管理增强**

#### 新增字段
- `tools` (JSON): 存储从 MCP 服务器自动获取的工具列表

#### 自动化流程
- ✅ 创建/保存 MCP 服务器时，自动调用 `/tools` 接口获取工具列表
- ✅ 更新 URL 或 Headers 时，自动重新获取工具列表
- ✅ 提供手动刷新工具的 API 接口

### 2. **聊天时 MCP 工具集成**

#### 工具注入
- ✅ 每次聊天请求自动加载所有已启用的 MCP 服务器工具
- ✅ 工具名称添加 `mcp__` 前缀以区分本地工具
- ✅ 合并本地工具和 MCP 工具，统一发送给 LLM

#### 工具调用
- ✅ 自动识别 `mcp__` 前缀的工具调用
- ✅ 通过 HTTP 请求调用对应的 MCP 服务器
- ✅ 返回结果给 LLM 继续生成回复

---

## 📁 新增文件结构

```
backend/app/services/mcp/
├── __init__.py              # MCP 服务包初始化
├── mcp_client.py            # MCP 客户端（连接、获取工具、调用工具）
└── tool_manager.py          # MCP 工具管理器（工具注入、调用路由）
```

---

## 🔧 核心组件说明

### 1. **MCPServer 模型** (`app/models/mcp_server.py`)

```python
class MCPServer(ModelBase):
    id = Column(String(26), primary_key=True)
    name = Column(String(255), nullable=False)
    url = Column(String(500), nullable=False)
    description = Column(String(1000), nullable=True)
    headers = Column(JSON, nullable=True)  # HTTP 请求头
    tools = Column(JSON, nullable=True)    # 工具列表（新增）
    enabled = Column(Boolean, default=True)
```

### 2. **MCPClient** (`app/services/mcp/mcp_client.py`)

负责与 MCP 服务器直接通信：

```python
client = MCPClient(base_url, headers)

# 获取工具列表
tools = await client.list_tools()

# 调用单个工具
result = await client.call_tool("tool_name", {"arg1": "value1"})
```

**主要方法：**
- `list_tools()`: GET `/tools` - 获取工具列表
- `call_tool(name, args)`: POST `/tools/{name}` - 调用工具
- `health_check()`: GET `/health` - 健康检查

### 3. **MCPServerService** (`app/services/mcp_server_service.py`)

增强功能：
- `_fetch_tools_from_server()`: 从 MCP 服务器获取工具
- `create_server()`: 创建时自动获取工具
- `update_server()`: URL/Headers 变化时自动刷新工具
- `refresh_tools()`: 手动刷新工具 API

### 4. **MCPToolManager** (`app/services/mcp/tool_manager.py`)

聊天时的工具管理：

```python
manager = MCPToolManager(session)

# 获取所有 MCP 工具（带前缀）
all_tools = await manager.get_all_mcp_tools()
# 返回：{"mcp__search": {...schema...}, "mcp__translate": {...}}

# 执行工具调用
result = await manager.execute_tool("mcp__search", {"query": "xxx"})
```

**主要方法：**
- `get_all_mcp_tools()`: 获取所有已启用服务器的工具（带 `mcp__` 前缀）
- `execute_tool(name, args)`: 执行工具调用（自动判断 MCP 工具）
- `parse_tool_name(name)`: 解析工具名，判断是否为 MCP 工具

### 5. **AgentService** (`app/services/agent_service.py`)

聊天流程集成：

```python
# 1. 获取本地工具 + MCP 工具
local_tools = get_tools_schema()
mcp_tools = await self._get_mcp_tools_schema(session_id)
all_tools = local_tools + mcp_tools

# 2. 调用 LLM（传入合并后的工具列表）
generator = llm_service.completions(..., tools=all_tools)

# 3. 处理工具调用
if chunk.finish_reason == "tool_calls":
    response = await self._handle_all_tool_calls(tool_calls)
```

**新增方法：**
- `_get_mcp_tools_schema()`: 获取 MCP 工具 schema
- `_execute_mcp_tool()`: 执行单个 MCP 工具
- `_handle_all_tool_calls()`: 处理所有工具调用（本地+MCP）

---

## 🚀 使用流程

### 步骤 1: 数据库迁移

```bash
cd backend
.venv\Scripts\activate
alembic upgrade head
```

这会执行两个迁移：
1. `175ed05a2735_add_mcp_server_table.py` - 创建表
2. `3daf0aa18f73_add_tools_column_to_mcp_server.py` - 添加 tools 字段

### 步骤 2: 添加 MCP 服务器

通过前端界面或 API 添加 MCP 服务器：

```json
POST /api/v1/mcp-servers
{
  "name": "阿里云百炼_联网搜索",
  "url": "https://dashscope.aliyuncs.com/api/v1/mcps/WebSearch/mcp",
  "description": "联网搜索服务",
  "headers": {
    "Authorization": "Bearer sk-xxx"
  },
  "enabled": true
}
```

**后端自动执行：**
1. 创建服务器记录
2. 调用 `GET {url}/tools` 获取工具列表
3. 将工具列表保存到 `tools` 字段

### 步骤 3: 聊天时自动使用 MCP 工具

用户发送消息 → 后端处理流程：

```
1. AgentService.completions()
   ↓
2. 加载 MCP 工具：_get_mcp_tools_schema()
   - 查询所有 enabled=true 的 MCP 服务器
   - 从 database.tools 字段读取工具
   - 添加 mcp__前缀
   ↓
3. 合并工具列表：local_tools + mcp_tools
   ↓
4. 调用 LLM（传入完整工具列表）
   ↓
5. LLM 返回 tool_calls
   ↓
6. _handle_all_tool_calls()
   - 判断工具名前缀
   - mcp__开头 → 调用 MCP 服务器
   - 否则 → 调用本地工具
   ↓
7. 返回工具结果给 LLM
   ↓
8. LLM 生成最终回复
```

---

## 📊 数据流转示例

### 工具获取流程

```
创建 MCP 服务器
    ↓
MCPServerService.create_server()
    ↓
调用 MCPClient.list_tools()
    ↓
GET https://example.com/mcp/tools
    ↓
响应：{
  "tools": [
    {
      "name": "web_search",
      "description": "搜索互联网信息",
      "inputSchema": {
        "type": "object",
        "properties": {
          "query": {"type": "string"}
        }
      }
    }
  ]
}
    ↓
转换为字典格式：
{
  "web_search": {
    "name": "web_search",
    "description": "...",
    "inputSchema": {...}
  }
}
    ↓
保存到 MCPServer.tools 字段
```

### 聊天工具调用流程

```
用户："帮我搜索一下最新的 AI 新闻"
    ↓
AgentService 加载工具：
- get_current_weather (本地)
- get_stock_price (本地)
- mcp__web_search (MCP)
- mcp__translate (MCP)
    ↓
LLM 决定调用：mcp__web_search
参数：{"query": "最新 AI 新闻 2026"}
    ↓
_handle_all_tool_calls()
  ↓
识别 mcp__前缀
  ↓
_execute_mcp_tool("mcp__web_search", {...})
  ↓
MCPToolManager.execute_tool()
  ↓
解析工具名："web_search" (移除前缀)
  ↓
查询数据库找到 MCP 服务器
  ↓
MCPClient.call_tool("web_search", {...})
  ↓
POST https://example.com/mcp/tools/web_search
Body: {"arguments": {"query": "最新 AI 新闻 2026"}}
    ↓
MCP 服务器返回搜索结果
    ↓
格式化结果返回给 LLM
    ↓
LLM 生成自然语言回复
```

---

## 🔑 关键设计点

### 1. **工具命名空间隔离**

- 本地工具：直接使用函数名（如 `get_current_weather`）
- MCP 工具：添加 `mcp__` 前缀（如 `mcp__web_search`）

**好处：**
- 避免命名冲突
- 清晰区分工具来源
- 便于日志和调试

### 2. **工具 Schema 增强**

MCP 工具会添加元数据：

```python
{
  "name": "web_search",
  "description": "...",
  "inputSchema": {...},
  "_mcp_server_id": "01KMAWP...",     # 服务器 ID
  "_mcp_server_url": "https://...",    # 服务器 URL
  "_mcp_original_name": "web_search",  # 原始工具名
  "_mcp_headers": {...}                # 请求头
}
```

**用途：**
- 调用时快速定位服务器
- 无需重复查询数据库

### 3. **懒加载策略**

- 工具列表在创建/更新时获取（缓存到 DB）
- 聊天时直接从 DB 读取，不实时调用 MCP 服务器
- 提供手动刷新 API

**优势：**
- 减少网络延迟
- 提高聊天响应速度
- 降低 MCP 服务器压力

### 4. **错误容错**

- 工具获取失败不影响服务器创建
- 单个工具调用失败不影响其他工具
- 所有异常都有日志记录和友好提示

---

## 📝 API 接口

### 新增接口

#### 手动刷新工具列表

```http
POST /api/v1/mcp-servers/{server_id}/refresh-tools
```

**响应：**
```json
{
  "id": "01KMAWP...",
  "name": "阿里云百炼_联网搜索",
  "tools": {
    "web_search": {...},
    "image_search": {...}
  },
  ...
}
```

**使用场景：**
- MCP 服务器更新了工具
- 工具列表显示不全
- 调试和验证

---

## 🧪 测试建议

### 测试用例 1：创建服务器并获取工具

```bash
curl -X POST http://localhost:8800/api/v1/mcp-servers \
  -H "Content-Type: application/json" \
  -d '{
    "name": "测试 MCP",
    "url": "https://example.com/mcp",
    "headers": {"Authorization": "Bearer xxx"}
  }'
```

**预期：**
- 服务器创建成功
- `tools` 字段包含从服务器获取的工具
- 日志显示 "Fetched X tools for MCP server"

### 测试用例 2：聊天时使用 MCP 工具

1. 确保有一个 enabled=true 的 MCP 服务器
2. 发送聊天消息："搜索一下 Python 教程"
3. 观察日志：
   ```
   Using X tools (including Y MCP tools)
   Calling MCP tool: mcp__web_search
   MCP tool web_search called successfully
   ```

### 测试用例 3：工具调用失败处理

1. 禁用 MCP 服务器
2. 尝试调用该服务器的工具
3. 预期：返回错误信息，聊天继续

---

## ⚠️ 注意事项

### 1. MCP 服务器兼容性

确保 MCP 服务器支持标准端点：
- `GET /tools` - 获取工具列表
- `POST /tools/{name}` - 调用工具

### 2. 超时设置

- 获取工具：30 秒超时
- 调用工具：60 秒超时
- 健康检查：5 秒超时

### 3. 安全考虑

- Headers 中包含敏感信息（API Key）需加密存储
- 仅信任已配置的 MCP 服务器
- 建议添加工具调用权限控制

### 4. 性能优化

- 工具列表缓存在数据库，避免频繁请求
- 可考虑添加 Redis 缓存层
- 定期清理禁用的服务器工具

---

## 🔄 后续优化方向

- [ ] 支持 MCP 服务器的工具订阅（WebSocket 推送更新）
- [ ] 添加工具调用统计和监控
- [ ] 实现工具调用的重试机制
- [ ] 支持更多 MCP 协议特性（如 Prompt、Resource）
- [ ] 添加工具编排和工作流功能
- [ ] 实现工具调用的权限控制
- [ ] 支持工具版本管理

---

## 📚 相关文档

- [MCP 服务器 API 文档](./MCP_SERVER_API.md)
- [快速启动指南](./QUICKSTART.md)
- [前端导入功能说明](../frontend/src/components/settings/导入功能说明.md)

---

## 🎉 总结

现在 MCP 功能已经完全实现并可投入使用！

### 核心能力：
✅ 自动获取工具列表  
✅ 聊天时自动注入 MCP 工具  
✅ 智能工具调用路由  
✅ 完整的错误处理  
✅ 高性能缓存策略  

立即体验强大的 MCP 工具集成吧！🚀