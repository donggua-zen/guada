# 非标准 MCP 服务器配置指南

## 📋 问题背景

并非所有提供 MCP 功能的服务器都遵循标准的 MCP 协议端点。例如：

- **阿里云百炼**：使用自定义 API 格式，不直接暴露 `/tools` 端点
- **其他云服务商**：可能有自己的工具发现机制

## ✅ 解决方案

### 方案一：手动配置工具列表（推荐）

对于不支持标准 MCP 端点的服务器，可以手动配置工具 Schema。

#### 步骤：

1. **创建服务器（不自动获取工具）**
   ```bash
   POST /api/v1/mcp-servers
   {
     "name": "阿里云百炼_联网搜索",
     "url": "https://dashscope.aliyuncs.com/api/v1/mcps/WebSearch/mcp",
     "headers": {
       "Authorization": "Bearer sk-xxx"
     }
   }
   ```

2. **准备工具 Schema**
   
   查阅阿里云百炼的官方文档，找到可用的工具列表和参数格式。例如：

   ```json
   {
     "web_search": {
       "name": "web_search",
       "description": "基于通义实验室的实时互联网搜索服务",
       "inputSchema": {
         "type": "object",
         "properties": {
           "query": {
             "type": "string",
             "description": "搜索关键词"
           },
           "limit": {
             "type": "integer",
             "description": "返回结果数量",
             "default": 5
           }
         },
         "required": ["query"]
       }
     }
   }
   ```

3. **通过 API 更新工具列表**
   ```bash
   PUT /api/v1/mcp-servers/{server_id}
   {
     "tools": {
       "web_search": {
         "name": "web_search",
         "description": "...",
         "inputSchema": {...}
       }
     }
   }
   ```

### 方案二：使用适配层

为特定云服务商创建适配器，将其 API 转换为标准 MCP 格式。

#### 示例：阿里云百炼适配器

```python
# app/services/mcp/adapters/aliyun_adapter.py
class AliyunMCPAdapter:
    """阿里云百炼 MCP 适配器"""
    
    async def list_tools(self, api_key: str) -> List[Dict]:
        """调用阿里云百炼 API 获取可用工具"""
        # 实际调用阿里云的 API
        # 返回标准 MCP 格式的工具列表
        return [
            {
                "name": "web_search",
                "description": "联网搜索",
                "inputSchema": {...}
            }
        ]
```

## 🔧 当前支持的服务器类型

### ✅ 标准 MCP 服务器

以下服务器类型可以**自动获取工具列表**：

- 遵循标准 MCP 协议的服务器
- 暴露 `/tools` 或兼容端点的服务
- 返回 `{"tools": [...]}` 格式的 API

示例：
```
http://localhost:3000/mcp
https://mcp.example.com/api
```

### ⚠️ 需要手动配置的服务器

以下服务器需要**手动配置工具列表**：

- **阿里云百炼** - 使用自定义 API 格式
- **腾讯云 AI** - 需要特定的 SDK
- **百度智能云** - 自定义工具注册机制

## 📝 阿里云百炼配置示例

### 1. 查找官方文档

访问 [阿里云百炼文档](https://help.aliyun.com/zh/model-studio/) 找到可用的 MCP 工具。

### 2. 准备工具定义

根据文档整理工具 Schema：

```json
{
  "web_search": {
    "name": "web_search",
    "description": "基于通义实验室 Text-Embedding，GTE-reRank，Query 改写等多种检索模型及语义理解，提供实时互联网全栈信息检索",
    "inputSchema": {
      "type": "object",
      "properties": {
        "query": {
          "type": "string",
          "description": "搜索查询词"
        },
        "search_type": {
          "type": "string",
          "description": "搜索类型",
          "enum": ["general", "academic", "news"],
          "default": "general"
        }
      },
      "required": ["query"]
    }
  }
}
```

### 3. 创建并配置服务器

#### 方法 A：通过前端界面

1. 进入设置 → MCP 服务器管理
2. 添加服务器：
   - 名称：阿里云百炼_联网搜索
   - URL：`https://dashscope.aliyuncs.com/api/v1/mcps/WebSearch/mcp`
   - Headers：`Authorization: Bearer sk-xxx`
3. 保存后，系统会尝试自动获取工具（可能失败）
4. 如果失败，可以通过数据库直接更新 tools 字段

#### 方法 B：通过 API + 数据库

```bash
# 1. 创建服务器
curl -X POST http://localhost:8800/api/v1/mcp-servers \
  -H "Content-Type: application/json" \
  -d '{
    "name": "阿里云百炼_联网搜索",
    "url": "https://dashscope.aliyuncs.com/api/v1/mcps/WebSearch/mcp",
    "headers": {"Authorization": "Bearer sk-xxx"}
  }'

# 2. 获取服务器 ID
SERVER_ID=$(curl http://localhost:8800/api/v1/mcp-servers | jq '.data.items[0].id')

# 3. 更新工具列表（需要准备工具 Schema）
curl -X PUT "http://localhost:8800/api/v1/mcp-servers/$SERVER_ID" \
  -H "Content-Type: application/json" \
  -d '{
    "tools": {
      "web_search": {
        "name": "web_search",
        "description": "...",
        "inputSchema": {...}
      }
    }
  }'
```

## 🛠️ 调试技巧

### 测试服务器是否支持标准 MCP

```bash
# 尝试访问标准/tools 端点
curl -X GET "{server_url}/tools" \
  -H "Authorization: Bearer your_token"

# 如果返回 404，说明不支持标准端点
# 如果返回 200 且有工具列表，说明支持
```

### 查看日志确认工具获取状态

```bash
# 成功获取工具
INFO: Successfully fetched 3 tools from https://...

# 未找到工具
WARNING: No tools found at https://...
INFO: Server will be created without tools. You can refresh tools manually later via API.
```

## 📊 工具 Schema 参考格式

```json
{
  "tool_name": {
    "name": "tool_name",
    "description": "工具的描述信息",
    "inputSchema": {
      "type": "object",
      "properties": {
        "param1": {
          "type": "string",
          "description": "参数 1 的描述"
        },
        "param2": {
          "type": "integer",
          "description": "参数 2 的描述",
          "default": 10
        }
      },
      "required": ["param1"]
    }
  }
}
```

## 🎯 最佳实践

1. **优先使用标准 MCP 服务器**
   - 自动发现和更新工具
   - 减少手动配置工作

2. **对于非标准服务器**
   - 详细记录可用的工具和参数
   - 准备工具 Schema JSON 文件
   - 定期检查和更新工具定义

3. **混合使用策略**
   - 可以同时配置多个 MCP 服务器
   - 标准服务器自动获取工具
   - 非标准服务器手动配置工具

## 🔗 相关资源

- [MCP 协议规范](https://modelcontextprotocol.io/)
- [阿里云百炼文档](https://help.aliyun.com/zh/model-studio/)
- [后端 API 文档](./MCP_SERVER_API.md)

---

## 💡 总结

虽然阿里云百炼等云服务不直接支持标准 MCP 协议，但通过手动配置工具 Schema，我们仍然可以将它们集成到系统中，享受 MCP 带来的统一管理体验！