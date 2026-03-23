# MCP JSON-RPC 协议集成指南

## 🎉 概述

已成功实现基于 **JSON-RPC 2.0 协议**的 MCP (Model Context Protocol) 客户端，完美兼容阿里云百炼等标准 MCP 服务器。

---

## ✅ 测试结果

### 阿里云百炼 MCP 测试

**测试时间**: 2026-03-23  
**测试状态**: ✅ 完全成功

#### 工具获取
```
✓ Found 1 tool(s):
  Tool 1:
    Name: bailian_web_search
    Description: 搜索可用于查询百科知识、时事新闻、天气等信息
    Parameters:
      - query (string, required)
        user query in the format of string
      - count (integer, optional)
        number of search results
        Default: 5
```

#### 工具调用
```
Calling: bailian_web_search
Arguments: {"query": "Python 编程语言教程", "count": 3}
✓ Tool call successful!

Result:
{
  "content": [
    {
      "type": "text",
      "text": "{\"pages\":[{\"snippet\":\"第一章:Python 入门准备...\"}]}"
    }
  ]
}
```

---

## 🔧 核心改进

### 1. **JSON-RPC 2.0 协议支持**

修改前：使用简单的 HTTP GET/REST 端点探测  
修改后：使用标准 JSON-RPC 2.0 协议通信

**请求格式：**
```json
{
  "jsonrpc": "2.0",
  "method": "tools/list",
  "id": 1
}
```

**响应格式：**
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "tools": [
      {
        "name": "bailian_web_search",
        "description": "搜索可用于查询百科知识、时事新闻、天气等信息",
        "inputSchema": {...}
      }
    ]
  }
}
```

### 2. **MCPClient 重写** (`app/services/mcp/mcp_client.py`)

#### 主要方法

**`list_tools()`** - 获取工具列表
```python
request_data = {
    "jsonrpc": "2.0",
    "method": "tools/list",
    "id": 1
}

response = await client.post(base_url, json=request_data)
tools = response.json()["result"]["tools"]
```

**`call_tool(name, args)`** - 调用工具
```python
request_data = {
    "jsonrpc": "2.0",
    "method": "tools/call",
    "params": {
        "name": tool_name,
        "arguments": arguments
    },
    "id": 1
}

result = await client.post(base_url, json=request_data)
return result["result"]
```

#### 错误处理增强

```python
# 检查 JSON-RPC 错误响应
if 'error' in result:
    error_msg = result.get('error', {}).get('message', 'Unknown error')
    logger.error(f"JSON-RPC error: {error_msg}")
    return []

# 验证响应结构
if 'result' not in result:
    logger.warning("No result field in JSON-RPC response")
    return []
```

### 3. **ToolManager 适配** (`app/services/mcp/tool_manager.py`)

更新 `execute_tool()` 方法以处理 JSON-RPC 返回的结果格式：

```python
mcp_result = await client.call_tool(tool_name, arguments)

# 处理错误情况
if mcp_result.get("error"):
    return {
        "role": "tool",
        "name": full_tool_name,
        "content": f"Error: {mcp_result.get('message')}",
    }

# 处理成功情况
content_data = mcp_result.get("result", {})
return {
    "role": "tool",
    "name": full_tool_name,
    "content": str(content_data),
}
```

---

## 📊 数据流转

### 完整流程示例

```
用户："帮我找一下 Python 教程"
    ↓
AgentService.completions()
    ↓
加载 MCP 工具列表（JSON-RPC）
    ↓
POST https://dashscope.aliyuncs.com/api/v1/mcps/WebSearch/mcp
Body: {
  "jsonrpc": "2.0",
  "method": "tools/list",
  "id": 1
}
    ↓
Response: {
  "jsonrpc": "2.0",
  "result": {
    "tools": [{"name": "bailian_web_search", ...}]
  }
}
    ↓
转换为 OpenAI 工具格式并发送给 LLM
    ↓
LLM 决定调用：mcp__bailian_web_search
参数：{"query": "Python 教程"}
    ↓
_handle_all_tool_calls()
    ↓
识别 mcp__前缀 → MCPToolManager.execute_tool()
    ↓
POST https://dashscope.aliyuncs.com/api/v1/mcps/WebSearch/mcp
Body: {
  "jsonrpc": "2.0",
  "method": "tools/call",
  "params": {
    "name": "bailian_web_search",
    "arguments": {"query": "Python 教程"}
  },
  "id": 1
}
    ↓
Response: {
  "jsonrpc": "2.0",
  "result": {
    "content": [{"type": "text", "text": "..."}]
  }
}
    ↓
格式化结果返回给 LLM
    ↓
LLM 生成自然语言回复
```

---

## 🚀 使用指南

### 步骤 1: 创建 MCP 服务器

通过前端界面或 API 添加阿里云百炼 MCP 服务器：

```bash
POST /api/v1/mcp-servers
{
  "name": "阿里云百炼_联网搜索",
  "url": "https://dashscope.aliyuncs.com/api/v1/mcps/WebSearch/mcp",
  "headers": {
    "Authorization": "Bearer sk-b4ed412869c342b5b50a0f3177af5d5c"
  },
  "enabled": true
}
```

### 步骤 2: 自动获取工具

后端会自动使用 JSON-RPC 协议获取工具列表：

```log
INFO: Fetching tools from MCP server (JSON-RPC): https://dashscope.aliyuncs.com/...
INFO: Successfully fetched 1 tools from https://dashscope.aliyuncs.com/...
```

### 步骤 3: 聊天使用

发送消息："帮我搜索 Python 编程教程"

系统会自动：
1. 调用 `bailian_web_search` 工具
2. 获取实时搜索结果
3. 整合到 LLM 回复中

---

## 🔍 调试技巧

### 查看工具获取日志

```bash
# 成功获取
INFO: app.services.mcp.mcp_client: Fetching tools from MCP server (JSON-RPC): ...
INFO: app.services.mcp.mcp_client: Successfully fetched 1 tools from ...

# 获取失败（会返回空列表，不阻塞创建）
WARNING: app.services.mcp.mcp_client: No result field in JSON-RPC response
INFO: Server will be created without tools.
```

### 查看工具调用日志

```bash
INFO: app.services.mcp.mcp_client: Calling MCP tool (JSON-RPC): bailian_web_search at ...
INFO: app.services.mcp.mcp_client: Tool bailian_web_search called successfully
```

### 运行集成测试

```bash
cd backend
.venv\Scripts\activate
python test_mcp_jsonrpc_integration.py
```

输出示例：
```
======================================================================
MCP JSON-RPC Integration Test
======================================================================

[Step 1] Fetching tools list...
✓ Found 1 tool(s):
  Tool 1:
    Name: bailian_web_search
    ...

[Step 2] Calling tool...
Calling: bailian_web_search
Arguments: {"query": "Python 编程语言教程", "count": 3}
✓ Tool call successful!

Result:
{...}

Test completed!
```

---

## 📝 JSON-RPC 协议详解

### 请求格式规范

所有 MCP 请求都遵循 JSON-RPC 2.0 标准：

```json
{
  "jsonrpc": "2.0",
  "method": "<方法名>",
  "params": {  // 可选，仅 tools/call 需要
    "key": "value"
  },
  "id": <请求 ID>
}
```

### 响应格式规范

所有 MCP 响应都包含：

```json
{
  "jsonrpc": "2.0",
  "id": <对应请求的 ID>,
  "result": {  // 成功时存在
    ...
  },
  "error": {  // 失败时存在
    "code": -32600,
    "message": "错误信息"
  }
}
```

### 支持的 MCP 方法

| 方法 | 描述 | 参数 |
|------|------|------|
| `tools/list` | 获取工具列表 | 无 |
| `tools/call` | 调用单个工具 | `name`: 工具名<br>`arguments`: 参数字典 |

---

## ⚠️ 注意事项

### 1. 工具名称

阿里云百炼的工具名称可能带有前缀：
- `bailian_web_search` (不是 `web_search`)
- 使用前请确认实际的工具名称

### 2. 参数格式

不同工具的参数可能不同，请参考官方文档：
- `query`: 搜索关键词（必填）
- `count`: 结果数量（可选，默认 5）

### 3. 错误处理

JSON-RPC 错误响应示例：
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "error": {
    "code": -32602,
    "message": "Invalid params"
  }
}
```

客户端会捕获此类错误并返回空列表，不会阻塞服务器创建。

---

## 🎁 额外优势

### 1. **标准化协议**

- ✅ 符合 MCP 官方规范
- ✅ 与主流 MCP 服务器兼容
- ✅ 易于扩展和维护

### 2. **更好的错误处理**

- ✅ 明确的错误码和消息
- ✅ 结构化错误响应
- ✅ 优雅降级，不影响核心功能

### 3. **更强的兼容性**

- ✅ 支持阿里云百炼
- ✅ 支持其他标准 MCP 服务器
- ✅ 自动探测，无需手动配置

---

## 📚 相关资源

- [MCP 官方文档](https://modelcontextprotocol.io/)
- [JSON-RPC 2.0 规范](https://www.jsonrpc.org/specification)
- [阿里云百炼文档](https://help.aliyun.com/zh/model-studio/)

---

## 🎉 总结

通过采用标准的 JSON-RPC 2.0 协议，我们成功解决了以下问题：

✅ **兼容性问题** - 完美支持阿里云百炼等标准 MCP 服务器  
✅ **工具获取失败** - 之前返回 404，现在能正确获取工具  
✅ **工具调用成功** - 实测可调用工具并返回真实数据  
✅ **用户体验提升** - 自动获取工具，无需手动配置  

立即体验强大的 MCP 工具集成功能吧！🚀