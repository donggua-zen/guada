"""
本地工具提供者实现

负责管理本地工具的注册、查询和执行。
本地工具是指直接在当前进程中执行的 Python 函数。
"""

import logging
from typing import Any, Callable, Dict
from .tool_provider_base import IToolProvider, ToolCallRequest, ToolCallResponse

logger = logging.getLogger(__name__)


class LocalToolProvider(IToolProvider):
    """本地工具提供者
    
    使用示例:
        provider = LocalToolProvider()
        provider.register(
            name="get_current_time",
            func=get_current_time_func,
            schema={"type": "object", ...}
        )
        
        # 执行工具调用
        response = await provider.execute(
            ToolCallRequest(id="1", name="get_current_time", arguments={})
        )
    """
    
    def __init__(self):
        """初始化工具提供者"""
        self._tools: Dict[str, Callable] = {}
        self._schemas: Dict[str, Dict[str, Any]] = {}
    
    def register(self, name: str, func: Callable, schema: Dict[str, Any]):
        """注册工具
        
        Args:
            name: 工具名称
            func: 工具函数（可以是同步或异步函数）
            schema: 工具的 JSON Schema，用于向 LLM 描述工具
            
        注意:
            - 工具名称不应包含前缀（如 "mcp__"）
            - schema 应符合 OpenAI Function Calling 格式
        """
        self._tools[name] = func
        self._schemas[name] = schema
        logger.info(f"Registered local tool: {name}")
    
    async def get_tools(self) -> Dict[str, Dict[str, Any]]:
        """获取所有已注册的本地工具
        
        Returns:
            Dict: {tool_name: tool_schema}
        """
        return self._schemas.copy()
    
    async def execute(self, request: ToolCallRequest) -> ToolCallResponse:
        """执行本地工具调用
        
        Args:
            request: 工具调用请求
            
        Returns:
            ToolCallResponse: 工具调用结果
            
        处理流程:
            1. 检查工具是否存在
            2. 调用工具函数（支持异步）
            3. 捕获异常并转换为错误响应
        """
        try:
            # 检查工具是否存在
            if request.name not in self._tools:
                return ToolCallResponse(
                    tool_call_id=request.id,
                    name=request.name,
                    content=f"Unknown tool: {request.name}",
                    is_error=True
                )
            
            # 获取工具函数
            func = self._tools[request.name]
            
            # 调用工具函数（支持异步）
            import asyncio
            if asyncio.iscoroutinefunction(func):
                result = await func(**request.arguments)
            else:
                result = func(**request.arguments)
            
            logger.debug(f"Local tool executed: {request.name}")
            
            return ToolCallResponse(
                tool_call_id=request.id,
                name=request.name,
                content=str(result),
                is_error=False
            )
            
        except Exception as e:
            logger.error(f"Error executing local tool {request.name}: {e}")
            logger.exception(e)
            
            return ToolCallResponse(
                tool_call_id=request.id,
                name=request.name,
                content=str(e),
                is_error=True
            )
    
    async def is_available(self, tool_name: str) -> bool:
        """检查工具是否已注册
        
        Args:
            tool_name: 工具名称
            
        Returns:
            bool: 工具是否可用
        """
        return tool_name in self._tools
