"""
MCP 工具提供者实现

负责通过 JSON-RPC 2.0 协议调用远程 MCP 服务器的工具。
自动处理服务器查找、客户端缓存和错误转换。
"""

import logging
from typing import Any, Dict, Optional
from sqlalchemy.ext.asyncio import AsyncSession
from .tool_provider_base import IToolProvider, ToolCallRequest, ToolCallResponse

logger = logging.getLogger(__name__)


class MCPToolProvider(IToolProvider):
    """MCP 工具提供者
    
    使用示例:
        provider = MCPToolProvider(session)
        
        # 获取所有 MCP 工具
        tools = await provider.get_tools()
        
        # 执行工具调用
        response = await provider.execute(
            ToolCallRequest(id="1", name="mcp__search", arguments={"q": "..."})
        )
    """
    
    def __init__(self, session: AsyncSession):
        """初始化 MCP 工具提供者
        
        Args:
            session: 数据库会话，用于查询 MCP 服务器信息
        """
        from app.services.mcp.tool_manager import MCPToolManager
        self.session = session
        self._manager = MCPToolManager(session)
    
    async def get_tools(self) -> Dict[str, Dict[str, Any]]:
        """获取所有可用的 MCP 工具
        
        Returns:
            Dict: {tool_name: tool_schema}
                  工具名称已添加 "mcp__" 前缀
        """
        try:
            tools = await self._manager.get_all_mcp_tools()
            logger.debug(f"Retrieved {len(tools)} MCP tools")
            return tools
        except Exception as e:
            logger.error(f"Error getting MCP tools: {e}")
            logger.exception(e)
            return {}
    
    async def execute(self, request: ToolCallRequest) -> ToolCallResponse:
        """执行 MCP 工具调用
        
        Args:
            request: 工具调用请求
            
        Returns:
            ToolCallResponse: 工具调用结果
            
        处理流程:
            1. 解析工具名称（移除 "mcp__" 前缀）
            2. 使用 MCPToolManager 执行工具调用
            3. 格式化结果为 ToolCallResponse
            
        注意:
            - 如果工具名不包含 "mcp__" 前缀，会自动添加
            - 服务器查找在 MCPToolManager 内部完成
            - 所有异常都会转换为 is_error=True 的响应
        """
        try:
            # 解析工具名称
            original_name = request.name
            if request.name.startswith("mcp__"):
                original_name = request.name[5:]  # 移除 "mcp__" 前缀
            
            # 使用 MCPToolManager 执行工具调用
            # 注意：execute_tool 会自动查找服务器
            result = await self._manager.execute_tool(
                full_tool_name=request.name,
                arguments=request.arguments
            )
            
            # 判断是否为错误响应
            is_error = result["content"].startswith("Error:") if result.get("content") else True
            
            logger.info(f"MCP tool executed: {request.name}, error={is_error}")
            
            return ToolCallResponse(
                tool_call_id=request.id,
                name=result["name"],
                content=result["content"],
                is_error=is_error
            )
            
        except ValueError as e:
            # 工具未找到
            logger.warning(f"MCP tool not found: {request.name}")
            return ToolCallResponse(
                tool_call_id=request.id,
                name=request.name,
                content=str(e),
                is_error=True
            )
            
        except Exception as e:
            # 其他异常
            logger.error(f"Error executing MCP tool {request.name}: {e}")
            logger.exception(e)
            
            return ToolCallResponse(
                tool_call_id=request.id,
                name=request.name,
                content=f"Error: {str(e)}",
                is_error=True
            )
    
    async def is_available(self, tool_name: str) -> bool:
        """检查 MCP 工具是否可用
        
        Args:
            tool_name: 工具名称（可能包含或不包含 "mcp__" 前缀）
            
        Returns:
            bool: 工具是否可用
        """
        try:
            # 添加前缀进行检查
            prefixed_name = tool_name
            if not tool_name.startswith("mcp__"):
                prefixed_name = f"mcp__{tool_name}"
            
            tools = await self.get_tools()
            return prefixed_name in tools
        except Exception:
            return False
