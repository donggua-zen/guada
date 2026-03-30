"""
改进方案 1：工具命名空间自动化

提供三种实现方案供选择：
1. 方案 A：声明式 namespace 属性（推荐）
2. 方案 B：自动推导命名空间
3. 方案 C：配置式命名
"""

# ============================================================================
# 方案 A：声明式 namespace 属性（推荐）⭐
# ============================================================================

"""
修改：app/services/tools/providers/tool_provider_base.py
"""

class IToolProvider(ABC):
    """工具提供者接口"""
    
    # ========== 新增：命名空间支持 ==========
    
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
    
    # ========== 原有抽象方法保持不变 ==========
    
    @abstractmethod
    async def get_tools(self) -> Dict[str, Dict[str, Any]]:
        pass
    
    @abstractmethod
    async def execute(self, request: ToolCallRequest) -> ToolCallResponse:
        pass
    
    @abstractmethod
    async def is_available(self, tool_name: str) -> bool:
        pass


"""
修改：app/services/tools/providers/memory_tool_provider.py
"""

class MemoryToolProvider(IToolProvider):
    """记忆工具提供者"""
    
    # ✅ 声明命名空间
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
            # 自动去掉命名空间前缀
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
        # 支持带前缀和不带前缀的检查
        base_name = tool_name.replace(f"{self.namespace}__", "")
        tools = await self.get_tools()
        return base_name in tools or tool_name in tools


"""
修改：app/services/tools/tool_orchestrator.py
"""

class ToolOrchestrator:
    """工具编排器"""
    
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


# ============================================================================
# 方案 B：自动推导命名空间（备选）
# ============================================================================

"""
基于类名自动推导命名空间，无需手动声明

优点：零配置
缺点：灵活性差，类名必须严格遵循 XxxToolProvider 格式
"""

class IToolProvider(ABC):
    @property
    def namespace(self) -> Optional[str]:
        """从类名自动推导命名空间
        
        MemoryToolProvider -> "memory"
        MCPToolProvider -> "mcp"
        FileToolProvider -> "file"
        """
        class_name = self.__class__.__name__
        
        # 匹配模式：XxxToolProvider -> xxx
        if class_name.endswith('ToolProvider'):
            namespace = class_name[:-12]  # 去掉 "ToolProvider"
            return namespace.lower()
        
        return None


# ============================================================================
# 方案 C：配置式命名（备选）
# ============================================================================

"""
在初始化时传入命名空间配置

优点：最灵活，运行时可配置
缺点：类型不安全，容易出错
"""

class MemoryToolProvider(IToolProvider):
    def __init__(self, session: AsyncSession, namespace: str = "memory"):
        self.session = session
        self.namespace_config = namespace  # 配置式命名
        self.family = MemoryToolFamily(session)
    
    @property
    def namespace(self) -> str:
        return self.namespace_config


# ============================================================================
# 推荐方案总结
# ============================================================================

"""
✅ 推荐方案 A：声明式 namespace 属性

理由：
1. 类型安全：IDE 可以提供自动补全和类型检查
2. 显式声明：代码清晰，易于理解和维护
3. 向后兼容：不影响现有 Provider
4. 灵活性适中：既不是完全固定也不是完全自由
5. 符合 Python 惯例：类似 Flask/Django 的 app_name

实施步骤：
1. 在 IToolProvider 中添加 namespace 属性和 get_tools_namespaced() 方法
2. 修改 MemoryToolProvider 声明 namespace = "memory"
3. 修改 MCPToolProvider 声明 namespace = "mcp"
4. 更新 ToolOrchestrator.get_all_tools() 使用 get_tools_namespaced()
5. 运行测试确保所有工具正常注册
"""
