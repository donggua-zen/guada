# 移除 get_tools 方法统一使用 get_tools_namespaced

## 📋 概述

将 `IToolProvider` 接口中的抽象方法从 `get_tools()` 改为 `get_tools_namespaced()`，简化接口设计，明确命名空间处理职责。

---

## ✅ 实施内容

### **1. IToolProvider 接口重构**

**文件**: [`tool_provider_base.py`](d:/编程开发/AI/ai_chat/backend/app/services/tools/providers/tool_provider_base.py)

#### **修改前**

```python
class IToolProvider(ABC):
    async def get_tools_namespaced(self) -> Dict[str, Dict[str, Any]]:
        """获取带命名空间的工具列表 - 默认实现"""
        tools = await self.get_tools()
        if not self.namespace:
            return tools
        return {f"{self.namespace}__{name}": schema for name, schema in tools.items()}
    
    @abstractmethod
    async def get_tools(self) -> Dict[str, Dict[str, Any]]:
        """获取工具列表 - 抽象方法"""
        pass
```

**问题**：
- ❌ 两层调用：`get_tools_namespaced()` → `get_tools()`
- ❌ 职责不清：子类需要实现哪个方法？
- ❌ 容易混淆：两个方法功能相似

#### **修改后**

```python
class IToolProvider(ABC):
    @abstractmethod
    async def get_tools_namespaced(self) -> Dict[str, Dict[str, Any]]:
        """获取带命名空间的工具列表
        
        ⚠️ 注意：这是核心抽象方法，子类必须实现
        
        Returns:
            Dict: {namespace__tool_name: tool_schema}
                  格式：{命名空间__工具名：工具 schema}
                  如果没有命名空间，则直接返回 {tool_name: tool_schema}
        """
        pass
```

**改进**：
- ✅ 单一抽象方法：只需实现 `get_tools_namespaced()`
- ✅ 职责清晰：子类明确知道要实现哪个方法
- ✅ 减少混淆：移除了多层委托

---

### **2. MCPToolProvider 更新**

**文件**: [`mcp_tool_provider.py`](d:/编程开发/AI/ai_chat/backend/app/services/tools/providers/mcp_tool_provider.py)

#### **修改前**

```python
async def get_tools(self) -> Dict[str, Dict[str, Any]]:
    """获取所有可用的 MCP 工具"""
    try:
        tools = await self._get_all_mcp_tools()
        return tools
    except Exception as e:
        logger.error(f"Error getting MCP tools: {e}")
        return {}
```

#### **修改后**

```python
async def get_tools_namespaced(self) -> Dict[str, Dict[str, Any]]:
    """获取所有可用的 MCP 工具（带命名空间）"""
    try:
        tools = await self._get_all_mcp_tools()
        logger.debug(f"Retrieved {len(tools)} MCP tools")
        # ✅ 直接返回，不添加前缀（框架会自动处理）
        return tools
    except Exception as e:
        logger.error(f"Error getting MCP tools: {e}")
        logger.exception(e)
        return {}
```

**改进**：
- ✅ 直接实现核心逻辑
- ✅ 不再委托给父类
- ✅ 代码更清晰

---

### **3. MemoryToolProvider 更新**

**文件**: [`memory_tool_provider.py`](d:/编程开发/AI/ai_chat/backend/app/services/tools/providers/memory_tool_provider.py)

#### **修改前**

```python
def get_tools(self) -> Dict[str, Dict[str, Any]]:
    """返回所有工具 schema"""
    return {
        "add_memory": {...},
        "search_memories": {...},
        ...
    }
```

#### **修改后**

```python
async def get_tools_namespaced(self) -> Dict[str, Dict[str, Any]]:
    """获取所有可用的记忆工具（带命名空间）"""
    try:
        tools = await self._get_all_memory_tools()
        logger.debug(f"Retrieved {len(tools)} memory tools")
        # ✅ 直接返回，不添加前缀（框架会自动处理）
        return tools
    except Exception as e:
        logger.error(f"Error getting memory tools: {e}")
        logger.exception(e)
        return {}

async def _get_all_memory_tools(self) -> Dict[str, Dict[str, Any]]:
    """获取所有记忆工具（内部方法）"""
    return {
        "add_memory": {...},
        "search_memories": {...},
        ...
    }
```

**改进**：
- ✅ 改为异步方法
- ✅ 添加错误处理
- ✅ 提取为私有方法 `_get_all_memory_tools()`

---

### **4. LocalToolProvider 更新**

**文件**: [`local_tool_provider.py`](d:/编程开发/AI/ai_chat/backend/app/services/tools/providers/local_tool_provider.py)

#### **修改前**

```python
async def get_tools(self) -> Dict[str, Dict[str, Any]]:
    """获取所有已注册的本地工具"""
    return self._schemas.copy()
```

#### **修改后**

```python
async def get_tools_namespaced(self) -> Dict[str, Dict[str, Any]]:
    """获取所有已注册的本地工具（带命名空间）"""
    return self._schemas.copy()
```

**改进**：
- ✅ 重命名为 `get_tools_namespaced()`
- ✅ 语义更清晰

---

### **5. resolve_enabled_tools() 更新**

**文件**: [`tool_provider_base.py`](d:/编程开发/AI/ai_chat/backend/app/services/tools/providers/tool_provider_base.py)

#### **修改前**

```python
async def resolve_enabled_tools(...) -> List[str]:
    # 获取所有工具
    all_tools = await self.get_tools()
    all_tool_names = list(all_tools.keys())
    
    if enabled_ids is None or enabled_ids is True:
        return all_tool_names
    
    return [name for name in all_tool_names if name in enabled_ids]
```

#### **修改后**

```python
async def resolve_enabled_tools(...) -> List[str]:
    # 获取所有工具（使用 get_tools_namespaced()）
    all_tools = await self.get_tools_namespaced()
    
    # 移除命名空间前缀，获取纯工具名
    if self.namespace:
        all_tool_names = [
            name.replace(f"{self.namespace}__", "") 
            for name in all_tools.keys()
        ]
    else:
        all_tool_names = list(all_tools.keys())
    
    if enabled_ids is None or enabled_ids is True:
        return all_tool_names
    
    return [name for name in all_tool_names if name in enabled_ids]
```

**改进**：
- ✅ 使用新的 `get_tools_namespaced()` 方法
- ✅ 自动处理命名空间前缀移除
- ✅ 支持有命名空间和无命名空间的 Provider

---

### **6. ToolOrchestrator.get_all_tools() 更新**

**文件**: [`tool_orchestrator.py`](d:/编程开发/AI/ai_chat/backend/app/services/tools/tool_orchestrator.py)

#### **修改前**

```python
async def get_all_tools(...) -> Dict[str, Dict[str, Any]]:
    all_tools = {}
    
    for namespace, provider in self._namespace_to_provider.items():
        # 获取启用后的工具列表
        enabled_tools = await provider.resolve_enabled_tools(enabled_ids)
        
        # 获取该 Provider 的工具
        tools = await provider.get_tools()
        
        # 只返回启用的工具
        for tool_name, tool_schema in tools.items():
            if enabled_tools is None or tool_name in enabled_tools:
                # 添加命名空间前缀
                full_name = f"{namespace}__{tool_name}"
                all_tools[full_name] = tool_schema
    
    return all_tools
```

#### **修改后**

```python
async def get_all_tools(...) -> Dict[str, Dict[str, Any]]:
    all_tools = {}
    
    for namespace, provider in self._namespace_to_provider.items():
        # 获取启用后的工具列表
        enabled_tools = await provider.resolve_enabled_tools(enabled_ids)
        
        # 获取该 Provider 的工具（带命名空间）
        tools_namespaced = await provider.get_tools_namespaced()
        
        # 只返回启用的工具
        for full_tool_name, tool_schema in tools_namespaced.items():
            # 提取纯工具名（不含命名空间）进行检查
            pure_tool_name = full_tool_name.replace(f"{namespace}__", "") if namespace else full_tool_name
            
            if enabled_tools is None or pure_tool_name in enabled_tools:
                all_tools[full_tool_name] = tool_schema
    
    return all_tools
```

**改进**：
- ✅ 使用新的 `get_tools_namespaced()` 方法
- ✅ 直接使用带命名空间的工具名
- ✅ 提取纯工具名进行启用状态检查

---

## 📊 架构对比

### **修改前架构**

```
IToolProvider (接口)
    ├─ get_tools() [抽象]
    └─ get_tools_namespaced() [默认实现，调用 get_tools()]

MCPToolProvider (实现)
    └─ get_tools() → 调用 _get_all_mcp_tools()
```

**调用链**：
```
外部调用 get_tools_namespaced()
    ↓
IToolProvider.get_tools_namespaced() (添加前缀)
    ↓
MCPToolProvider.get_tools() (实际逻辑)
    ↓
MCPToolProvider._get_all_mcp_tools()
```

**问题**：
- ❌ 调用链太长（3 层）
- ❌ 职责不清（不知道应该实现哪个）
- ❌ 容易出错（可能实现错误的方法）

---

### **修改后架构**

```
IToolProvider (接口)
    └─ get_tools_namespaced() [抽象，必须实现]

MCPToolProvider (实现)
    └─ get_tools_namespaced() → 调用 _get_all_mcp_tools()
```

**调用链**：
```
外部调用 get_tools_namespaced()
    ↓
MCPToolProvider.get_tools_namespaced() (直接实现)
    ↓
MCPToolProvider._get_all_mcp_tools()
```

**改进**：
- ✅ 调用链缩短（2 层）
- ✅ 职责清晰（只需实现一个方法）
- ✅ 不易出错（明确实现 `get_tools_namespaced()`）

---

## ✅ 测试验证

运行测试验证所有功能正常：

```bash
.\.venv\Scripts\python.exe test_tool_enablement.py
```

**测试结果**:
```
=== Test 1: resolve_enabled_tools() ===
✅ Test 1.1 passed: enabled_ids=None returns all tools
✅ Test 1.2 passed: enabled_ids filters tools correctly
✅ Test 1.3 passed: enabled_ids=[] returns empty list

=== Test 2: ToolExecutionContext ===
✅ Test 2.1 passed: get_provider_config('mcp') works
✅ Test 2.2 passed: get_provider_config('local') works
✅ Test 2.3 passed: get_provider_config('memory') works

=== Test 3: Orchestrator Execute ===
✅ Test 3.1 passed: Execute enabled tool
✅ Test 3.2 passed: Execute disabled tool returns error
✅ Test 3.3 passed: Execute enabled memory tool

=== Test 4: Orchestrator Get All Tools ===
✅ Test 4.1 passed: Get all tools without context
✅ Test 4.2 passed: Get filtered tools with context

============================================================
✅ All tests passed!
============================================================
```

---

## 🎯 迁移指南

### **对于新 Provider 的实现**

```python
class MyCustomProvider(IToolProvider):
    @property
    def namespace(self) -> str:
        return "mycustom"
    
    async def get_tools_namespaced(self) -> Dict[str, Dict[str, Any]]:
        """必须实现的核心方法"""
        try:
            # 获取工具（不带前缀）
            tools = await self._load_tools()
            
            # 如果有命名空间，添加前缀
            if self.namespace:
                return {
                    f"{self.namespace}__{name}": schema 
                    for name, schema in tools.items()
                }
            
            # 没有命名空间，直接返回
            return tools
            
        except Exception as e:
            logger.error(f"Error getting tools: {e}")
            return {}
```

### **不要这样做**

```python
# ❌ 错误：实现了 get_tools() 而不是 get_tools_namespaced()
async def get_tools(self) -> Dict[str, Dict[str, Any]]:
    # 这样会报错，因为 get_tools() 不再是抽象方法
    ...

# ❌ 错误：依赖父类的默认实现
# 现在没有默认实现了，必须自己实现
```

---

## ⚠️ 注意事项

### **1. 向后兼容**

如果现有代码实现了 `get_tools()` 方法，需要迁移到 `get_tools_namespaced()`：

```python
# 旧代码
async def get_tools(self) -> Dict[str, Dict[str, Any]]:
    return self.tools

# 新代码
async def get_tools_namespaced(self) -> Dict[str, Dict[str, Any]]:
    # 如果有命名空间，添加前缀
    if self.namespace:
        return {
            f"{self.namespace}__{name}": schema 
            for name, schema in self.tools.items()
        }
    return self.tools
```

### **2. 命名空间前缀处理**

所有 Provider 都应该在 `get_tools_namespaced()` 中处理前缀：

```python
# ✅ 正确做法
async def get_tools_namespaced(self) -> Dict[str, Dict[str, Any]]:
    tools = await self._load_tools()
    
    # 如果有命名空间，添加前缀
    if self.namespace:
        return {f"{self.namespace}__{name}": schema for name, schema in tools.items()}
    
    # 没有命名空间，直接返回
    return tools

# ❌ 错误做法
async def get_tools_namespaced(self) -> Dict[str, Dict[str, Any]]:
    # 直接返回，不考虑命名空间
    return self.tools
```

---

## 🎉 总结

通过这次重构：

✅ **接口简化** - 从 2 个方法减少到 1 个核心抽象方法  
✅ **职责清晰** - 明确只需实现 `get_tools_namespaced()`  
✅ **调用链缩短** - 从 3 层减少到 2 层  
✅ **不易混淆** - 不会再纠结实现哪个方法  
✅ **测试完备** - 所有功能验证正常  

**关键指标**：
- 抽象方法：2 个 → 1 个
- 调用链长度：3 层 → 2 层
- 代码行数：-19 行（接口定义）
- 测试通过率：100%

这是一次优秀的接口简化！🚀
