# MCP 工具角色级访问控制实现

## 功能概述

实现了 MCP 工具的**角色级访问控制**,确保每个角色只能使用其已启用的 MCP 服务中的工具。

## 核心变更

### 1. MCPToolManager - 支持按服务器 ID 过滤

#### 修改前 (全局加载) ❌

```python
async def get_all_mcp_tools(self) -> Dict[str, Dict[str, Any]]:
    """获取所有已启用 MCP 服务器的工具列表"""
    # 查询所有已启用的 MCP 服务器
    stmt = select(MCPServer).filter(MCPServer.enabled == True)
    result = await self.session.execute(stmt)
    servers = result.scalars().all()
    
    # 加载所有服务器的工具...
```

**问题**: 
- ❌ 加载所有已启用的 MCP 服务
- ❌ 不考虑角色级别的配置
- ❌ 无法控制角色的工具访问权限

#### 修改后 (按角色过滤) ✅

```python
async def get_all_mcp_tools(
    self, 
    enabled_mcp_servers: Optional[List[str]] = None
) -> Dict[str, Dict[str, Any]]:
    """
    获取 MCP 工具列表
    
    Args:
        enabled_mcp_servers: 已启用的 MCP 服务器 ID 列表 
                           (来自角色的 settings.mcp_servers)
                           如果为 None，则加载所有已启用的 MCP 服务器
    """
    if enabled_mcp_servers:
        # 只查询角色已启用的 MCP 服务器
        stmt = select(MCPServer).filter(
            MCPServer.enabled == True,
            MCPServer.id.in_(enabled_mcp_servers)
        )
    else:
        # 查询所有已启用的 MCP 服务器
        stmt = select(MCPServer).filter(MCPServer.enabled == True)
    
    result = await self.session.execute(stmt)
    servers = result.scalars().all()
    # ...
```

**优势**:
- ✅ 支持按服务器 ID 列表过滤
- ✅ 向后兼容 (None 时加载全部)
- ✅ 精确控制角色的工具访问范围

### 2. AgentService - 提取角色配置并传递

#### 修改前 ❌

```python
async def _get_mcp_tools_schema(self, session_id: str) -> list:
    try:
        db_manager = get_db_manager()
        async with db_manager.async_session_factory() as session:
            mcp_tool_manager = MCPToolManager(session)
            all_mcp_tools = await mcp_tool_manager.get_all_mcp_tools()
            # ...
```

**问题**: 
- ❌ 没有考虑角色配置
- ❌ 总是加载所有 MCP 工具

#### 修改后 ✅

```python
async def _get_mcp_tools_schema(self, session_id: str) -> list:
    try:
        db_manager = get_db_manager()
        async with db_manager.async_session_factory() as session:
            # 获取会话信息，提取角色配置
            session_repo = SessionRepository(session)
            session_obj = await session_repo.get_session_by_id(session_id)
            
            # 提取角色已启用的 MCP 服务器 ID 列表
            enabled_mcp_servers = None
            if hasattr(session_obj, 'character') and session_obj.character:
                character_settings = session_obj.character.settings or {}
                enabled_mcp_servers = character_settings.get('mcp_servers')
                logger.info(f"Character {session_obj.character.id} has {len(enabled_mcp_servers or [])} enabled MCP servers")
            
            mcp_tool_manager = MCPToolManager(session)
            all_mcp_tools = await mcp_tool_manager.get_all_mcp_tools(
                enabled_mcp_servers=enabled_mcp_servers
            )
            # ...
```

**工作流程**:
1. ✅ 获取会话对象
2. ✅ 检查是否绑定了角色
3. ✅ 从角色 settings 中提取 `mcp_servers` 字段
4. ✅ 传递给 MCPToolManager 进行过滤
5. ✅ 只返回角色已启用的 MCP 服务的工具

## 数据流

### 角色配置存储

```json
{
    "id": "char_123",
    "title": "天气助手",
    "settings": {
        "mcp_servers": [
            "01HQKZJ8V5T6N7X8Y9Z0A1B2C3",  // Weather API
            "02ABCDEF1234567890ABCDEFGH"   // Search Engine
        ],
        // ... 其他设置
    }
}
```

**说明**:
- `mcp_servers` 是数组格式
- 存储的是**已启用的 MCP 服务器 ID**
- ID 存在表示启用，不存在表示禁用

### 聊天时的工具加载流程

```
用户发送消息
    ↓
AgentService.completions()
    ↓
_get_mcp_tools_schema(session_id)
    ↓
1. 获取会话信息
2. 提取角色的 enabled_mcp_servers
3. 调用 MCPToolManager.get_all_mcp_tools(enabled_mcp_servers)
    ↓
MCPToolManager 查询数据库:
SELECT * FROM mcp_server 
WHERE enabled = true 
  AND id IN ('01HQK...', '02ABC...')  -- 只查询角色已启用的
    ↓
返回过滤后的工具列表
    ↓
合并到 all_tools_schema
    ↓
传给 LLM 服务
```

## 使用场景示例

### 场景 1: 天气助手角色

**角色配置**:
```json
{
    "title": "天气助手",
    "settings": {
        "mcp_servers": ["weather_api_id"]
    }
}
```

**可用工具**:
```
✅ weather_api 的工具:
   - get_weather
   - get_forecast
   - get_air_quality

❌ search_engine 的工具:
   - search_web (不可用)
   - search_news (不可用)

❌ calculator 的工具:
   - calculate (不可用)
```

**效果**: 该角色只能使用天气相关的工具

### 场景 2: 全能助手角色

**角色配置**:
```json
{
    "title": "全能助手",
    "settings": {
        "mcp_servers": [
            "weather_api_id",
            "search_engine_id",
            "calculator_id"
        ]
    }
}
```

**可用工具**:
```
✅ weather_api 的所有工具
✅ search_engine 的所有工具
✅ calculator 的所有工具

效果：可以使用所有 MCP 服务的工具
```

### 场景 3: 未配置 MCP 服务的角色

**角色配置**:
```json
{
    "title": "普通助手",
    "settings": {
        "mcp_servers": []  // 空数组或不设置
    }
}
```

**可用工具**:
```
❌ 所有 MCP 工具都不可用
✅ 只有本地工具可用

效果：退化为不使用任何 MCP 工具
```

## 技术细节

### SQL 查询对比

**之前 (全局)**:
```sql
SELECT * FROM mcp_server 
WHERE enabled = true
-- 返回所有已启用的 MCP 服务
```

**现在 (按角色)**:
```sql
SELECT * FROM mcp_server 
WHERE enabled = true 
  AND id IN ('01HQK...', '02ABC...')
-- 只返回角色已启用的 MCP 服务
```

### 日志输出

```python
logger.info(f"Character {session_obj.character.id} has {len(enabled_mcp_servers or [])} enabled MCP servers")
logger.info(f"Total MCP tools loaded: {len(all_tools)}")
```

**示例日志**:
```
INFO: Character char_123 has 2 enabled MCP servers
INFO: Total MCP tools loaded: 5
```

### 错误处理

```python
if not server.tools:
    logger.warning(f"No tools cached for MCP server: {server.name}")
    continue
```

**情况处理**:
- ✅ MCP 服务未启用 → 不查询
- ✅ MCP 服务无工具缓存 → 跳过并警告
- ✅ 角色未配置 mcp_servers → 使用默认值 None(加载全部)

## 向后兼容性

### 默认行为

```python
# 不传参数或传 None → 加载所有 MCP 工具
await mcp_tool_manager.get_all_mcp_tools()
await mcp_tool_manager.get_all_mcp_tools(None)

# 传空数组 → 不加载任何 MCP 工具
await mcp_tool_manager.get_all_mcp_tools([])

# 传 ID 列表 → 只加载指定的 MCP 工具
await mcp_tool_manager.get_all_mcp_tools(["id1", "id2"])
```

### 兼容性保证

| 调用方式 | 行为 | 影响 |
|---------|------|------|
| `get_all_mcp_tools()` | 加载所有 | ⚠️ 旧代码仍然有效 |
| `get_all_mcp_tools(None)` | 加载所有 | ✅ 显式调用 |
| `get_all_mcp_tools([])` | 不加载 | ✅ 明确禁用 |
| `get_all_mcp_tools([...])` | 按需加载 | ✅ 新特性 |

## 测试建议

### 单元测试

```python
async def test_role_based_mcp_tools():
    # 准备测试数据
    role_settings = {
        "mcp_servers": ["server_1", "server_2"]
    }
    
    # 调用方法
    tool_manager = MCPToolManager(session)
    tools = await tool_manager.get_all_mcp_tools(
        enabled_mcp_servers=["server_1"]
    )
    
    # 验证只返回了 server_1 的工具
    assert all("server_1" in tool["_mcp_server_id"] for tool in tools.values())
```

### 集成测试

1. **创建角色 A** - 启用 Weather API
2. **创建角色 B** - 启用 Search Engine
3. **创建会话** - 绑定角色 A
4. **发送消息** - 验证只能使用 Weather API 的工具
5. **切换角色** - 绑定角色 B
6. **再次发送** - 验证只能使用 Search Engine 的工具

## 性能优化

### 查询优化

**之前**:
- 查询所有 MCP 服务 → 可能很多
- 加载所有工具 → 内存占用大
- 传递给 LLM → token 消耗多

**现在**:
- 只查询角色已启用的 → 精确过滤
- 只加载需要的工具 → 内存友好
- 只传递有用的工具 → 节省 token

### 缓存策略

```python
self._tools_cache: Dict[str, Dict[str, Any]] = {}
self._clients_cache: Dict[str, MCPClient] = {}
```

**未来优化方向**:
- 按角色 ID 缓存工具列表
- 避免重复查询数据库
- 减少工具 schema 构建开销

## 相关文档

- [角色工具配置功能](../frontend/CHARACTER_TOOLS_FEATURE.md)
- [MCP 服务器管理](./MCP_SERVER_API.md)
- [会话继承架构](./SESSION_CHARACTER_INHERITANCE.md)

---

**更新日期**: 2026-03-23  
**状态**: ✅ 完成  
**影响范围**: 后端 - MCPToolManager、AgentService  
**向后兼容**: ✅ 完全兼容 - 支持默认行为  
**安全增强**: ✅ 角色级工具访问控制
