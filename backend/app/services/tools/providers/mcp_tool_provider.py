"""
MCP 工具提供者实现

负责通过 JSON-RPC 2.0 协议调用远程 MCP 服务器的工具。
直接管理 MCP 服务器连接、客户端缓存和工具调用。
已合并 MCPToolManager 功能，降低封装层级
"""

import logging
from typing import Any, Dict, List, Optional, Union
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from .tool_provider_base import IToolProvider, ToolCallRequest, ToolCallResponse
from app.utils.openai_tool_converter import convert_to_openai_tool

# 延迟导入模型，避免循环引用
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

    Attributes:
        session: 数据库会话
        _tools_cache: 工具缓存
        _clients_cache: MCP 客户端缓存
    """

    @property
    def namespace(self) -> Optional[str]:
        """获取命名空间"""
        return "mcp"

    def __init__(self, session: AsyncSession):
        """初始化 MCP 工具提供者

        Args:
            session: 数据库会话，用于查询 MCP 服务器信息
        """
        from app.services.mcp.mcp_client import MCPClient

        self.session = session
        self._tools_cache: Dict[str, Dict[str, Any]] = {}
        self._clients_cache: Dict[str, Any] = {}  # MCPClient 缓存

    async def _get_tools_internal(
        self, enabled_ids: Optional[Union[List[str], bool]] = None
    ) -> List[Dict[str, Any]]:
        """
        获取 MCP 工具列表

        Args:
            enabled_ids: 已启用的 MCP 服务器 ID 列表
                                - 如果为 True：加载所有已启用的 MCP 服务器
                                - 如果为 False 或 []：返回空字典
                                - 如果为 None：加载所有已启用的 MCP 服务器
                                - 如果是列表：只加载指定的服务器 ID

        Returns:
            Dict: 以 tool_name 为键的工具字典，格式为 {tool_name: openai_format_schema}
                  改进：MCP 格式 → OpenAI Function Calling 格式
        """
        # 延迟导入模型，避免循环引用
        from app.models.mcp_server import MCPServer

        # 处理不同的 enabled_ids 值
        if isinstance(enabled_ids, bool):
            if enabled_ids:
                # True：加载所有启用的服务器
                stmt = select(MCPServer).filter(MCPServer.enabled == True)
            else:
                # False：返回空字典
                return {}
        elif isinstance(enabled_ids, list):
            if enabled_ids:
                # 列表：只加载指定的服务器
                stmt = select(MCPServer).filter(
                    MCPServer.enabled == True, MCPServer.id.in_(enabled_ids)
                )
            else:
                # 空列表：返回空字典
                return {}
        else:
            # None：加载所有启用的服务器
            stmt = select(MCPServer).filter(MCPServer.enabled == True)

        result = await self.session.execute(stmt)
        servers = result.scalars().all()

        all_tools = []

        for server in servers:
            if not server.tools:
                logger.warning(f"No tools cached for MCP server: {server.name}")
                continue

            # MCP 格式 → OpenAI 格式直接转换
            # 注意：不要添加 mcp__ 前缀，父类 get_tools_namespaced() 会自动添加
            for tool_name, tool_schema in server.tools.items():
                # 标准转换逻辑（MCP 使用 inputSchema）
                openai_schema = {
                    "type": "function",
                    "function": {
                        "name": tool_name,
                        "description": tool_schema.get(
                            "description", f"Execute {tool_name}"
                        ),
                        "parameters": tool_schema.get(
                            "inputSchema", {"type": "object", "properties": {}}
                        ),
                    },
                }

                all_tools.append(openai_schema)
                logger.debug(
                    f"Added MCP tool (OpenAI format): {tool_name} from server {server.name}"
                )

        logger.info(f"Total MCP tools loaded: {len(all_tools)}")
        return all_tools

    async def _execute_internal(
        self, request: ToolCallRequest, inject_params: Optional[Dict[str, Any]] = None
    ) -> ToolCallResponse:
        """实际执行 MCP 工具调用（名称已去除前缀）

        Args:
            request: 工具调用请求（名称已去除 mcp__ 前缀）

        Returns:
            ToolCallResponse: 工具调用结果
        """
        try:
            # 使用 MCPToolManager 执行工具调用
            # 注意：execute_tool 会自动查找服务器
            result = await self._execute_tool(
                tool_name=request.name, arguments=request.arguments
            )

            # 判断是否为错误响应
            is_error = (
                result["content"].startswith("Error:")
                if result.get("content")
                else True
            )

            logger.info(f"MCP tool executed: {request.name}, error={is_error}")

            return ToolCallResponse(
                tool_call_id=request.id,
                name=result["name"],
                content=result["content"],
                is_error=is_error,
            )

        except ValueError as e:
            # 工具未找到
            logger.warning(f"MCP tool not found: {request.name}")
            return ToolCallResponse(
                tool_call_id=request.id,
                name=request.name,
                content=str(e),
                is_error=True,
            )

        except Exception as e:
            # 其他异常
            logger.error(f"Error executing MCP tool {request.name}: {e}")
            logger.exception(e)

            return ToolCallResponse(
                tool_call_id=request.id,
                name=request.name,
                content=f"Error: {str(e)}",
                is_error=True,
            )
        except Exception:
            return False

    async def _call_mcp_tool(
        self,
        tool_name: str,
        arguments: Dict[str, Any],
        server_id: str,
        server_url: str,
        headers: Optional[Dict[str, str]] = None,
    ) -> Dict[str, Any]:
        """
        调用 MCP 工具

        Args:
            tool_name: 原始工具名称（不含前缀）
            arguments: 工具调用参数
            server_id: MCP 服务器 ID
            server_url: MCP 服务器 URL
            headers: HTTP 请求头

        Returns:
            Dict: 工具调用结果
        """
        try:
            # 创建或获取客户端
            client_key = f"{server_url}_{server_id}"
            if client_key not in self._clients_cache:
                from app.services.mcp.mcp_client import MCPClient

                self._clients_cache[client_key] = MCPClient(server_url, headers)

            client = self._clients_cache[client_key]

            # 调用工具（使用 JSON-RPC 协议）
            result = await client.call_tool(tool_name, arguments)

            logger.info(
                f"MCP tool {tool_name} called successfully on server {server_id}"
            )
            return result

        except Exception as e:
            logger.error(f"Failed to call MCP tool {tool_name}: {e}")
            raise

    async def _execute_tool(
        self, tool_name: str, arguments: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        执行工具调用（自动判断是否为 MCP 工具）

        Args:
            tool_name: 工具名称
            arguments: 工具调用参数

        Returns:
            Dict: 工具调用结果

        Raises:
            ValueError: 如果工具不存在或不是 MCP 工具
        """
        # 延迟导入模型，避免循环引用
        from app.models.mcp_server import MCPServer

        # 从数据库中获取服务器信息
        # 直接通过 ID 查询，不需要检查工具是否存在（已在 get_all_mcp_tools 中过滤）
        stmt = (
            select(MCPServer).filter(MCPServer.enabled == True).limit(10)
        )  # 限制数量避免过多
        result = await self.session.execute(stmt)
        servers = result.scalars().all()

        # 查找包含该工具的服务器
        target_server = None
        for server in servers:
            if server.tools and tool_name in server.tools:
                target_server = server
                break

        if not target_server:
            raise ValueError(f"MCP tool '{tool_name}' not found or server disabled")

        # 调用 MCP 工具
        mcp_result = await self._call_mcp_tool(
            tool_name=tool_name,
            arguments=arguments,
            server_id=target_server.id,
            server_url=target_server.url,
            headers=target_server.headers,
        )

        # 处理结果格式
        if mcp_result.get("error"):
            # 如果有错误，返回错误信息
            return {
                "tool_call_id": None,  # 会在上层设置
                "role": "tool",
                "name": tool_name,
                "content": f"Error: {mcp_result.get('message', 'Unknown error')}",
            }
        else:
            # 成功，格式化结果
            content_data = mcp_result.get("result", {})
            if isinstance(content_data, dict):
                content = str(content_data)
            else:
                content = str(content_data)

            return {
                "tool_call_id": None,  # 会在上层设置
                "role": "tool",
                "name": tool_name,
                "content": content,
            }
