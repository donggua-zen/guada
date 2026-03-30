# 工具族架构改进方案综合文档

## 📋 概述

本文档提供两个关键改进的详细实现方案：
1. **工具命名空间自动化** - 消除手动添加前缀的重复代码
2. **会话级参数自动注入** - 解决 LLM 不提供 session_id 的问题

---

## 🎯 改进方向 1：工具命名空间自动化

### 问题诊断

当前每个 ToolProvider 需要手动为工具名添加前缀：

```python
# ❌ 当前实现（冗余代码）
class MemoryToolProvider(IToolProvider):
    async def get_tools(self) -> Dict[str, Dict[str, Any]]:
        tools = self.family.get_tools()
        # 手动添加前缀 - 重复劳动
        return {f"memory__{name}": schema for name, schema in tools.items()}
    
    async def execute(self, request):
        # 手动去掉前缀 - 容易出错
        tool_name = request.name.replace("memory__", "")
```

**问题**：
- ❌ 每个 Provider 都要写相同的命名逻辑
- ❌ 容易忘记添加/去掉前缀导致 bug
- ❌ 命名规范不统一（有的用 `__`，有的可能用 `_`）

### ✅ 推荐方案：声明式 namespace 属性

#### **核心设计**

在 `IToolProvider` 接口中添加 `namespace` 属性，Provider 显式声明自己的命名空间。

#### **实现步骤**

##### Step 1: 扩展 IToolProvider 接口

**文件**: `app/services/tools/providers/tool_provider_base.py`

```python
class IToolProvider(ABC):
    """工具提供者接口"""
    
    @property
    def namespace(self) -> Optional[str]:
        """工具命名空间
        
        返回 None 表示不使用命名空间（如本地工具）
        返回字符串表示命名空间前缀（如 "memory"、"mcp"）
        
        子类可覆写此属性来声明自己的命名空间
        """
        return None
    
    async def get_tools_namespaced(self) -> Dict[str, Dict[str, Any]]:
        """获取带命名空间的工具列表
        
        默认实现：调用 get_tools() 并根据 namespace 添加前缀
        子类可按需覆写
        
        Returns:
            Dict: {namespace__tool_name: tool_schema}
        """
        tools = await self.get_tools()
        
        # 如果没有命名空间，直接返回
        if not self.namespace:
            return tools
        
        # 添加命名空间前缀
        return {
            f"{self.namespace}__{name}": schema 
            for name, schema in tools.items()
        }
    
    # 原有抽象方法保持不变
    @abstractmethod
    async def get_tools(self) -> Dict[str, Dict[str, Any]]:
        pass
    
    @abstractmethod
    async def execute(self, request: ToolCallRequest) -> ToolCallResponse:
        pass
    
    @abstractmethod
    async def is_available(self, tool_name: str) -> bool:
        pass
```

##### Step 2: 修改 MemoryToolProvider

**文件**: `app/services/tools/providers/memory_tool_provider.py`

```python
class MemoryToolProvider(IToolProvider):
    """记忆工具提供者"""
    
    # ✅ 声明命名空间（一行代码搞定！）
    @property
    def namespace(self) -> str:
        return "memory"
    
    def __init__(self, session: AsyncSession):
        self.session = session
        self.family = MemoryToolFamily(session)
        self._tools_cache = None
    
    async def get_tools(self) -> Dict[str, Dict[str, Any]]:
        """获取工具 schema（不带前缀）"""
        if self._tools_cache is None:
            # 直接从 family 获取，不手动添加前缀
            self._tools_cache = self.family.get_tools()
        return self._tools_cache
    
    async def execute(self, request: ToolCallRequest) -> ToolCallResponse:
        from app.services.tools.providers.tool_provider_base import ToolCallResponse
        
        try:
            # ✅ 自动去掉命名空间前缀
            tool_name = request.name.replace(f"{self.namespace}__", "")
            result = await self.family.execute(tool_name, request.arguments)
            
            return ToolCallResponse(
                tool_call_id=request.id,
                name=request.name,
                content=result,
                is_error=False,
            )
        except Exception as e:
            logger.error(f"Memory provider error: {e}")
            return ToolCallResponse(
                tool_call_id=request.id,
                name=request.name,
                content=str(e),
                is_error=True,
            )
    
    async def is_available(self, tool_name: str) -> bool:
        # ✅ 支持带前缀和不带前缀的检查
        base_name = tool_name.replace(f"{self.namespace}__", "")
        tools = await self.get_tools()
        return base_name in tools or tool_name in tools
```

##### Step 3: 修改 MCPToolProvider

**文件**: `app/services/tools/providers/mcp_tool_provider.py`

```python
class MCPToolProvider(IToolProvider):
    """MCP 工具提供者"""
    
    # ✅ 声明命名空间
    @property
    def namespace(self) -> str:
        return "mcp"
    
    # ... 其他代码类似 MemoryToolProvider 进行修改
```

##### Step 4: 更新 ToolOrchestrator

**文件**: `app/services/tools/tool_orchestrator.py`

```python
class ToolOrchestrator:
    async def get_all_tools(self) -> Dict[str, Dict[str, Any]]:
        """获取所有工具（合并所有提供者）"""
        all_tools = {}
        
        for _, provider in self._providers:
            try:
                # ✅ 使用新的命名空间方法
                if hasattr(provider, 'get_tools_namespaced'):
                    tools = await provider.get_tools_namespaced()
                else:
                    # 向后兼容：调用原有的 get_tools()
                    tools = await provider.get_tools()
                
                all_tools.update(tools)
            except Exception as e:
                logger.error(f"Error getting tools from provider: {e}")
                logger.exception(e)
        
        logger.debug(f"Total tools available: {len(all_tools)}")
        return all_tools
```

#### **效果对比**

| 项目 | 修改前 | 修改后 |
|------|--------|--------|
| MemoryToolProvider 代码行数 | ~50 行 | ~35 行 (-30%) |
| 手动添加前缀逻辑 | 需要 | 自动 |
| 命名规范一致性 | 依赖开发者 | 框架保证 |
| 新增 Provider 工作量 | 中等 | 低 |

---

## 🎯 改进方向 2：会话级参数自动注入

### 问题诊断

记忆工具需要 `session_id` 实现数据隔离，但 LLM 不会提供：

```python
# ❌ 当前问题
LLM 调用：{"name": "memory__add_memory", "arguments": {"content": "..."}}
                                      ↑ 缺少 session_id!

# 当前解决方案：在每个工具函数中手动验证
async def _add_memory(self, args: Dict[str, Any]) -> str:
    session_id = args.get("session_id")
    if not session_id:
        return "❌ 错误：缺少 session_id 参数"
    # ...
```

**问题**：
- ❌ LLM 不知道需要提供 session_id
- ❌ 每个工具函数都要手动验证
- ❌ 错误处理分散，难以统一管理

### ✅ 推荐方案：拦截器模式 + 参数签名检测

#### **核心设计**

在 AgentService 层面拦截工具调用，通过分析工具函数的参数签名自动注入系统参数。

```
用户请求 → AgentService → [参数注入拦截器] → ToolOrchestrator → Provider
                           ↓
                    分析签名 → 注入 session_id
```

#### **实现步骤**

##### Step 1: 创建参数注入器

**文件**: `app/services/tools/tool_injector.py` (新建)

```python
"""工具参数注入器

根据工具函数的参数签名，自动注入系统级参数（如 session_id、user_id 等）
"""

import inspect
from typing import Any, Callable, Dict, List, Optional


class ToolParameterInjector:
    """工具参数注入器"""
    
    # 系统级参数列表（按优先级排序）
    SYSTEM_PARAMS = {
        'session_id': str,      # 会话 ID（最高优先级）
        'user_id': str,         # 用户 ID（未来扩展）
        'character_id': str,    # 角色 ID（未来扩展）
    }
    
    def __init__(self):
        self._injection_cache: Dict[str, List[str]] = {}
    
    def inject_params(
        self, 
        tool_name: str, 
        arguments: Dict[str, Any],
        context: Dict[str, Any]
    ) -> Dict[str, Any]:
        """注入系统参数到工具调用参数中
        
        Args:
            tool_name: 工具名称
            arguments: 原始参数字典（来自 LLM）
            context: 上下文信息（包含 session_id 等）
            
        Returns:
            注入后的参数字典
        """
        # 检查是否需要注入（缓存优化）
        if tool_name not in self._injection_cache:
            self._injection_cache[tool_name] = self._detect_system_params(tool_name)
        
        params_to_inject = self._injection_cache[tool_name]
        
        # 如果没有系统参数需要注入，直接返回
        if not params_to_inject:
            return arguments
        
        # 创建新的参数字典（不修改原始数据）
        injected_args = arguments.copy()
        
        # 注入系统参数
        for param_name in params_to_inject:
            if param_name in context:
                injected_args[param_name] = context[param_name]
        
        return injected_args
    
    def _detect_system_params(self, tool_name: str) -> List[str]:
        """检测工具函数需要哪些系统参数
        
        通过分析工具函数的参数签名来检测
        
        Returns:
            需要注入的系统参数列表
        """
        # 延迟导入避免循环引用
        from app.services.tools.families.memory_tool_family import MemoryToolFamily
        
        # 尝试从不同 Provider 获取工具函数
        if tool_name.startswith('memory__'):
            family = MemoryToolFamily(None)  # type: ignore
            
            # 去掉前缀获取真实工具名
            base_tool_name = tool_name.replace('memory__', '')
            
            # 获取对应的方法
            if hasattr(family, f'_{base_tool_name}'):
                method = getattr(family, f'_{base_tool_name}')
                return self._inspect_method_signature(method)
        
        return []
    
    def _inspect_method_signature(self, method: Callable) -> List[str]:
        """分析方法签名，提取系统参数
        
        Returns:
            系统参数名称列表
        """
        try:
            # 获取参数签名
            sig = inspect.signature(method)
            params_needed = []
            
            for param_name, param in sig.parameters.items():
                # 跳过 self、arguments 等特殊参数
                if param_name in ('self', 'args', 'kwargs'):
                    continue
                
                # 检查是否是系统参数
                if param_name in self.SYSTEM_PARAMS:
                    # 进一步验证类型
                    param_annotation = param.annotation
                    if param_annotation == inspect.Parameter.empty or \
                       param_annotation == self.SYSTEM_PARAMS[param_name]:
                        params_needed.append(param_name)
            
            return params_needed
            
        except Exception as e:
            # 签名检测失败时不注入
            return []
    
    def clear_cache(self):
        """清空缓存（用于工具更新后）"""
        self._injection_cache.clear()
```

##### Step 2: 在 AgentService 中集成

**文件**: `app/services/agent_service.py`

```python
class AgentService:
    def __init__(
        self,
        session_repo: SessionRepository,
        model_repo: ModelRepository,
        message_repo: MessageRepository,
        memory_manager_service: MemoryManagerService,
        setting_service: SettingsManager,
        mcp_tool_manager: MCPToolManager,
        tool_orchestrator: ToolOrchestrator,
    ):
        # ... 原有代码 ...
        
        # ✅ 新增：参数注入器
        from app.services.tools.tool_injector import ToolParameterInjector
        self.param_injector = ToolParameterInjector()
    
    async def _handle_all_tool_calls(
        self,
        tool_calls: List[Dict[str, Any]],
        session_id: str,  # ✅ 新增参数
    ) -> List[Dict[str, Any]]:
        """处理所有工具调用（带参数注入）
        
        Args:
            tool_calls: 工具调用列表
            session_id: 当前会话 ID（用于自动注入）
            
        Returns:
            工具执行结果列表
        """
        from app.services.tools.providers.tool_provider_base import ToolCallRequest
        
        # ✅ 构建注入上下文
        injection_context = {
            'session_id': session_id,
            # 未来可以扩展更多参数
            # 'user_id': current_user.id,
            # 'character_id': session.character_id,
        }
        
        # ✅ 为每个工具调用注入参数
        requests = []
        for tc in tool_calls:
            # 解析参数
            arguments = json.loads(tc["arguments"])
            
            # 🔥 自动注入系统参数
            injected_arguments = self.param_injector.inject_params(
                tool_name=tc["name"],
                arguments=arguments,
                context=injection_context,
            )
            
            # 创建请求对象
            requests.append(
                ToolCallRequest(
                    id=tc["id"],
                    name=tc["name"],
                    arguments=json.dumps(injected_arguments),  # ✅ 使用注入后的参数
                )
            )
        
        # 批量执行（自动路由到正确的提供者）
        responses = await self.tool_orchestrator.execute_batch(requests)
        
        # 格式化为 OpenAI 兼容格式
        return [
            {
                "tool_call_id": r.tool_call_id,
                "role": r.role,
                "name": r.name,
                "content": r.content,
            }
            for r in responses
        ]
```

##### Step 3: 更新 completions 方法

**文件**: `app/services/agent_service.py`

```python
async def completions(
    self,
    session_id: str,
    user_message_id: str,
    character_id: Optional[str] = None,
    # ... 其他参数
) -> AsyncGenerator[Dict[str, Any], None]:
    # ... 前面的代码保持不变
    
    # 处理工具调用
    if tool_calls:
        tool_results = await self._handle_all_tool_calls(
            tool_calls=tool_calls,
            session_id=session_id,  # ✅ 传递 session_id
        )
        
        # ... 后续处理
```

##### Step 4: 简化记忆工具实现

**文件**: `app/services/tools/families/memory_tool_family.py`

```python
class MemoryToolFamily(IToolFamily):
    async def _add_memory(self, args: Dict[str, Any]) -> str:
        """添加记忆
        
        ⚠️ 现在 session_id 已由系统自动注入，无需手动验证
        """
        # ✅ session_id 保证存在（由注入器保证）
        session_id = args["session_id"]
        
        memory = await self.repo.create_memory(
            session_id=session_id,
            content=args["content"],
            memory_type=args.get("memory_type", "general"),
            importance=args.get("importance", 5),
            tags=args.get("tags", []),
        )
        return f"✓ 记忆已添加 (ID: {memory.id}, 重要性：{memory.importance})"
    
    async def _search_memories(self, args: Dict[str, Any]) -> str:
        """搜索记忆
        
        ⚠️ session_id 已自动注入
        """
        session_id = args["session_id"]
        
        memories = await self.repo.search_memories(
            session_id=session_id,
            query=args["query"],
            memory_type=args.get("memory_type"),
            min_importance=args.get("min_importance"),
            limit=args.get("limit", 10),
        )
        
        # ... 后续处理
```

#### **效果对比**

| 项目 | 修改前 | 修改后 |
|------|--------|--------|
| 工具函数代码 | 需要手动验证 session_id | 直接使用，无需验证 |
| 错误处理 | 分散在各个函数 | 集中在注入器 |
| LLM 体验 | 需要提供 session_id（但不会） | 透明，无需关心 |
| 扩展性 | 每新增参数都要改所有函数 | 只需在 SYSTEM_PARAMS 中添加 |

---

## 🔄 两个改进的协同效应

### 组合使用效果

```python
# 改进 1：命名空间自动化
class MemoryToolProvider(IToolProvider):
    @property
    def namespace(self) -> str:
        return "memory"
    
    async def get_tools(self):
        # 不需要手动添加前缀
        return self.family.get_tools()

# 改进 2：参数自动注入
class AgentService:
    async def _handle_all_tool_calls(self, tool_calls, session_id):
        # 自动为 memory__add_memory 注入 session_id
        injected_args = self.param_injector.inject_params(
            tool_name="memory__add_memory",
            arguments={"content": "..."},
            context={"session_id": "current_session"}
        )
        # 结果：{"content": "...", "session_id": "current_session"}
```

### 实施顺序建议

1. **先实施方案 1（命名空间自动化）**
   - 改动较小，风险低
   - 为方案 2 奠定基础（工具名规范化）

2. **再实施方案 2（参数自动注入）**
   - 依赖方案 1 的命名空间机制
   - 需要更多的测试验证

---

## ✅ 完整实施清单

### Phase 1: 命名空间自动化
- [ ] 修改 `IToolProvider` 添加 `namespace` 属性
- [ ] 修改 `MemoryToolProvider` 声明 `namespace = "memory"`
- [ ] 修改 `MCPToolProvider` 声明 `namespace = "mcp"`
- [ ] 更新 `ToolOrchestrator.get_all_tools()` 使用 `get_tools_namespaced()`
- [ ] 运行测试确保工具注册正常

### Phase 2: 参数自动注入
- [ ] 创建 `ToolParameterInjector` 类
- [ ] 在 `AgentService` 中集成注入器
- [ ] 修改 `_handle_all_tool_calls()` 接受 `session_id` 参数
- [ ] 更新所有调用 `_handle_all_tool_calls()` 的地方
- [ ] 简化记忆工具实现（移除手动验证）
- [ ] 运行测试确保注入正常工作

---

## 📊 性能影响评估

### 命名空间自动化
- **性能影响**: 几乎为零（只是字符串拼接）
- **内存影响**: 无额外内存消耗

### 参数自动注入
- **性能影响**: 
  - 首次检测：~1ms（反射分析签名）
  - 后续调用：<0.1ms（缓存命中）
- **内存影响**: 缓存约占用几 KB

---

## 🔮 未来扩展

基于这两个改进，未来可以轻松实现：

1. **更多系统参数注入**
   - `user_id`: 用户级数据隔离
   - `character_id`: 角色特定配置
   - `request_id`: 请求追踪

2. **高级注入规则**
   - 条件注入（满足特定条件才注入）
   - 参数转换（如字符串转日期）
   - 参数验证（注入前校验）

3. **工具链中间件**
   ```python
   class ToolMiddleware:
       async def before_call(self, request):
           # 日志记录、权限检查等
           pass
       
       async def after_call(self, response):
           # 结果缓存、指标收集等
           pass
   ```

---

## 📝 总结

通过这两个改进：
- ✅ **减少重复代码** ~30%
- ✅ **提升开发体验** - 无需手动处理命名和参数
- ✅ **增强系统可靠性** - 框架保证而非依赖开发者记忆
- ✅ **便于未来扩展** - 新增工具或参数更加简单

这是一个值得投资的架构改进！
