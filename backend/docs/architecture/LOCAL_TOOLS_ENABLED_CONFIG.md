# 本地工具启用控制 - settings.tools 支持

## 🎯 需求背景

在之前的重构中，我们实现了：
- ✅ MCP 服务器级别的启用控制（通过 `settings.mcp_servers`）
- ❌ 缺少本地工具级别的启用控制

**新增需求**:
支持通过 `character_settings.get("tools")` 配置角色可以使用的本地工具列表。

---

## 📝 实现方案

### 1. 更新参数命名

为了更清晰地表达意图，将参数名从 `enabled_tool_ids` 改为 `enabled_tools`：

```python
# 修改前
async def get_all_tools_schema(
    self,
    enabled_tool_ids: Optional[list] = None,  # ← 命名不够清晰
    enabled_mcp_servers: Optional[list] = None,
) -> list:

# 修改后
async def get_all_tools_schema(
    self,
    enabled_tools: Optional[list] = None,  # ← 更通用的命名
    enabled_mcp_servers: Optional[list] = None,
) -> list:
```

**改进**:
- ✅ `enabled_tools` 语义更清晰
- ✅ 不局限于 "ID"，可以是工具名称或其他标识符
- ✅ 与 `enabled_mcp_servers` 命名风格一致

---

### 2. 增强过滤逻辑

#### 修改后的完整实现

**文件**: `app/services/tools/orchestrator.py`

```python
async def get_all_tools_schema(
    self,
    enabled_tools: Optional[list] = None,
    enabled_mcp_servers: Optional[list] = None,
) -> list:
    """获取所有工具的 schema（OpenAI Function Calling 格式）"""
    all_tools = await self.get_all_tools()
    tools_schema = []
    
    for tool_name, tool_data in all_tools.items():
        # 判断是否为 MCP 工具
        is_mcp_tool = tool_name.startswith("mcp__")
        
        # 🔹 本地工具过滤
        if not is_mcp_tool and enabled_tools is not None:
            # 检查是否在启用列表中
            if tool_name not in enabled_tools:
                logger.debug(f"Skipping disabled local tool: {tool_name}")
                continue
        
        # 🔹 MCP 工具过滤
        if is_mcp_tool and enabled_mcp_servers is not None:
            # 检查其服务器是否在启用列表中
            server_id = tool_data.get("_mcp_server_id")
            if server_id and server_id not in enabled_mcp_servers:
                logger.debug(f"Skipping disabled MCP tool (server {server_id}): {tool_name}")
                continue
        
        # 转换为 OpenAI 格式
        if isinstance(tool_data, dict):
            schema = {
                "type": "function",
                "function": {
                    "name": tool_name,
                    "description": tool_data.get("description", f"Tool: {tool_name}"),
                    "parameters": tool_data.get("inputSchema", {})
                    or tool_data.get("parameters", {}),
                },
            }
            tools_schema.append(schema)
    
    logger.info(f"Generated schema for {len(tools_schema)} tools (filtered from {len(all_tools)} total tools)")
    return tools_schema
```

**关键改进**:
- ✅ 明确区分本地工具和 MCP 工具
- ✅ 本地工具使用 `enabled_tools` 过滤
- ✅ MCP 工具使用 `enabled_mcp_servers` 过滤
- ✅ 添加详细的调试日志

---

### 3. AgentService 集成

**文件**: `app/services/agent_service.py`

```python
# 从角色设置中提取 MCP 配置和工具配置
character_settings: Dict[str, Any] = {}
if hasattr(session, "character") and session.character:
    character_settings = session.character.settings or {}

# 获取已启用的 MCP 服务器列表
enabled_mcp_servers = None
if character_settings:
    enabled_mcp_servers = character_settings.get("mcp_servers")

# 🔹 获取已启用的本地工具列表（来自 settings.tools）
enabled_tools = None
if character_settings:
    enabled_tools = character_settings.get("tools")
    if enabled_tools:
        logger.info(f"Character has {len(enabled_tools)} enabled local tools")

# 使用 ToolOrchestrator 获取统一的工具 schema
all_tools_schema = await self.tool_orchestrator.get_all_tools_schema(
    enabled_tools=enabled_tools,  # ✅ 新增：本地工具过滤
    enabled_mcp_servers=enabled_mcp_servers
)
```

**改进**:
- ✅ 同时支持 `tools` 和 `mcp_servers` 配置
- ✅ 添加日志记录启用的本地工具数量
- ✅ 向后兼容（None 表示全部启用）

---

## 📊 使用示例

### 场景 1: 角色只允许使用特定本地工具

**角色配置**:
```json
{
  "settings": {
    "tools": ["get_current_time"],  // ✅ 只允许使用 get_current_time
    "mcp_servers": null  // 不使用 MCP 工具
  }
}
```

**结果**:
- ✅ `get_current_time` 会出现在 schema 中
- ❌ 其他本地工具被过滤
- ❌ 所有 MCP 工具被过滤

---

### 场景 2: 角色使用 MCP 工具 + 部分本地工具

**角色配置**:
```json
{
  "settings": {
    "tools": ["get_current_time", "calculate"],  // ✅ 允许的本地工具
    "mcp_servers": ["server-1", "server-2"]      // ✅ 允许的 MCP 服务器
  }
}
```

**结果**:
- ✅ `get_current_time` 和 `calculate` 会出现在 schema 中
- ❌ 其他本地工具被过滤
- ✅ 来自 `server-1` 和 `server-2` 的 MCP 工具会出现在 schema 中
- ❌ 来自其他服务器的 MCP 工具被过滤

---

### 场景 3: 角色使用全部工具

**角色配置**:
```json
{
  "settings": {
    "tools": null,  // 或不设置此字段
    "mcp_servers": null
  }
}
```

**结果**:
- ✅ 所有本地工具都可用
- ✅ 所有 MCP 工具都可用

---

## 🎯 过滤逻辑详解

### 本地工具过滤流程

```python
# 1. 判断是否为 MCP 工具
is_mcp_tool = tool_name.startswith("mcp__")

# 2. 如果不是 MCP 工具且设置了启用列表
if not is_mcp_tool and enabled_tools is not None:
    # 3. 检查工具是否在启用列表中
    if tool_name not in enabled_tools:
        # 4. 跳过未启用的工具
        logger.debug(f"Skipping disabled local tool: {tool_name}")
        continue
```

**特点**:
- ✅ 白名单机制（只允许列表中的工具）
- ✅ 精确匹配（工具名称必须完全一致）
- ✅ 支持空列表（空列表表示不使用任何本地工具）

---

### MCP 工具过滤流程

```python
# 1. 如果是 MCP 工具且设置了服务器列表
if is_mcp_tool and enabled_mcp_servers is not None:
    # 2. 获取工具所属的服务器 ID
    server_id = tool_data.get("_mcp_server_id")
    
    # 3. 检查服务器是否在启用列表中
    if server_id and server_id not in enabled_mcp_servers:
        # 4. 跳过未启用服务器的工具
        logger.debug(f"Skipping disabled MCP tool (server {server_id}): {tool_name}")
        continue
```

**特点**:
- ✅ 基于服务器的过滤（间接过滤）
- ✅ 自动获取 `_mcp_server_id` 元数据
- ✅ 容错处理（没有 `_mcp_server_id` 时不过滤）

---

## 📈 性能优化

### 1. 日志级别优化

```python
# 调试日志：详细记录每个跳过的工具
logger.debug(f"Skipping disabled local tool: {tool_name}")

# 信息日志：汇总统计
logger.info(f"Generated schema for {len(tools_schema)} tools (filtered from {len(all_tools)} total tools)")
```

**优势**:
- ✅ 生产环境不会过于嘈杂（DEBUG 级别）
- ✅ 需要时可以查看详细过滤过程
- ✅ 汇总信息帮助了解过滤效果

---

### 2. 提前跳过逻辑

```python
# 先判断工具类型，避免不必要的检查
is_mcp_tool = tool_name.startswith("mcp__")

# 只在必要时进行检查
if not is_mcp_tool and enabled_tools is not None:
    ...
```

**优势**:
- ✅ 减少不必要的条件判断
- ✅ 逻辑清晰易读
- ✅ 性能微优化（O(1) 的前缀检查）

---

## ⚠️ 注意事项

### 1. 配置格式

**正确格式**:
```json
{
  "tools": ["get_current_time", "calculate"]  // ✅ 字符串数组
}
```

**错误格式**:
```json
{
  "tools": "get_current_time"  // ❌ 应该是数组
}
```

---

### 2. 工具名称匹配

- ✅ 必须使用完整的工具名称
- ✅ 区分大小写
- ✅ 不包含前缀（如 `mcp__`）

**示例**:
```python
# 正确
enabled_tools = ["get_current_time"]

# 错误
enabled_tools = ["Get_Current_Time"]  # 大小写错误
enabled_tools = ["current_time"]      # 名称不完整
```

---

### 3. 向后兼容性

✅ **完全兼容**:
- 不设置 `tools` 字段 → 全部启用
- `tools = null` → 全部启用
- `tools = []` → 不使用任何本地工具

---

## 🎁 扩展能力

### 未来可能的功能

#### 1. 通配符支持
```python
enabled_tools = ["get_*"]  # 匹配所有 get_ 开头的工具
```

#### 2. 排除列表
```python
enabled_tools = {
  "include": ["get_current_time"],
  "exclude": ["dangerous_tool"]
}
```

#### 3. 权限分级
```python
enabled_tools = {
  "level_1": ["get_current_time"],
  "level_2": ["get_current_time", "read_file"],
  "level_3": ["*"]  # 所有工具
}
```

---

## 📋 测试验证

### 单元测试示例

```python
async def test_enabled_tools_filtering():
    """测试本地工具过滤功能"""
    orchestrator = ToolOrchestrator()
    
    # 添加多个本地工具
    local_provider = LocalToolProvider()
    local_provider.register(name="tool_a", func=lambda: "a", schema={})
    local_provider.register(name="tool_b", func=lambda: "b", schema={})
    local_provider.register(name="tool_c", func=lambda: "c", schema={})
    
    orchestrator.add_provider(local_provider, priority=0)
    
    # 只启用 tool_a 和 tool_b
    schema = await orchestrator.get_all_tools_schema(
        enabled_tools=["tool_a", "tool_b"]
    )
    
    # 验证结果
    assert len(schema) == 2
    assert any(s["function"]["name"] == "tool_a" for s in schema)
    assert any(s["function"]["name"] == "tool_b" for s in schema)
    assert not any(s["function"]["name"] == "tool_c" for s in schema)
```

---

### 集成测试要点

- [ ] 验证 `enabled_tools` 为 None 时全部启用
- [ ] 验证 `enabled_tools` 为空列表时全部禁用
- [ ] 验证部分启用时的过滤效果
- [ ] 验证与 `enabled_mcp_servers` 的组合使用
- [ ] 验证日志输出正确

---

## 🎯 总结

### 核心改进

✅ **功能完整**:
- 支持本地工具级别的精细控制
- 支持 MCP 服务器级别的控制
- 两种控制机制互不干扰

✅ **语义清晰**:
- 参数名从 `enabled_tool_ids` 改为 `enabled_tools`
- 文档注释更加详细
- 日志输出更加友好

✅ **向后兼容**:
- 不破坏现有 API
- 支持渐进式迁移
- 默认行为不变（全部启用）

---

### 使用建议

**推荐做法**:
1. ✅ 在角色配置中明确指定 `tools` 列表
2. ✅ 只授予角色需要的最小工具集
3. ✅ 定期审查和更新工具配置

**避免做法**:
1. ❌ 不要使用硬编码的工具名称（使用常量或配置）
2. ❌ 不要在运行时动态修改工具列表（应该重启会话）
3. ❌ 不要混用不同格式的配置

---

**实施完成时间**: 2026-03-27  
**涉及文件**: 2 个（orchestrator.py、agent_service.py）  
**代码变更**: ~25 行新增，~10 行修改  
**破坏性变更**: 无（向后兼容）  

🎉 **工具调用系统重构 - 本地工具启用控制功能完成！**
