"""
本地工具提供者实现

负责管理本地工具的注册、查询和执行。
本地工具是指直接在当前进程中执行的 Python 函数。
"""

import logging
from typing import Any, Callable, Dict, List, Optional, Union
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

    @property
    def namespace(self) -> Optional[str]:
        """获取命名空间（本地工具使用 'local'）"""
        return "local"

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

    async def _get_tools_internal(
        self, enabled_ids: Optional[Union[List[str], bool]] = None
    ) -> Dict[str, Dict[str, Any]]:
        if isinstance(enabled_ids, bool) and enabled_ids:
            return self._schemas.copy()
        elif isinstance(enabled_ids, list) and enabled_ids:
            return {
                name: schema
                for name, schema in self._schemas.items()
                if name in enabled_ids
            }
        else:
            return {}

    async def _execute_internal(
        self, 
        request: ToolCallRequest, 
        inject_params: Optional[Dict[str, Any]] = None
    ) -> ToolCallResponse:
        """实际执行本地工具调用（名称已去除前缀）
        
        Args:
            request: 工具调用请求（名称已去除命名空间前缀）
            inject_params: 注入参数字典（如 session_id, user_id 等），本地工具暂不使用
        
        Returns:
            ToolCallResponse: 工具调用结果
        """
        try:
            # 检查工具是否存在
            if request.name not in self._tools:
                return ToolCallResponse(
                    tool_call_id=request.id,
                    name=request.name,
                    content=f"Unknown tool: {request.name}",
                    is_error=True,
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
                is_error=False,
            )

        except Exception as e:
            logger.error(f"Error executing local tool {request.name}: {e}")
            logger.exception(e)
            return ToolCallResponse(
                tool_call_id=request.id,
                name=request.name,
                content=f"Error: {str(e)}",
                is_error=True,
            )

    async def is_available(self, tool_name: str) -> bool:
        """检查工具是否已注册

        Args:
            tool_name: 工具名称

        Returns:
            bool: 工具是否可用
        """
        return tool_name in self._tools
