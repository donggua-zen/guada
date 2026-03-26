"""
MCP 工具管理器

该模块负责：
1. 获取所有已启用的 MCP 服务器的工具
2. 将 MCP 工具转换为本地工具格式（添加 mcp__前缀）
3. 调用 MCP 工具
"""

import logging
from typing import Any, Dict, List, Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.models.mcp_server import MCPServer
from app.services.mcp.mcp_client import MCPClient

logger = logging.getLogger(__name__)


class MCPToolManager:
    """MCP 工具管理器"""

    def __init__(self, session: AsyncSession):
        """
        初始化 MCP 工具管理器

        Args:
            session: 数据库会话
        """
        self.session = session
        self._tools_cache: Dict[str, Dict[str, Any]] = {}
        self._clients_cache: Dict[str, MCPClient] = {}

    async def get_all_mcp_tools(
        self, enabled_mcp_servers: Optional[List[str]] = None
    ) -> Dict[str, Dict[str, Any]]:
        """
        获取 MCP 工具列表

        Args:
            enabled_mcp_servers: 已启用的 MCP 服务器 ID 列表 (来自角色的 settings.mcp_servers)
                                如果为 None，则加载所有已启用的 MCP 服务器

        Returns:
            Dict: 以 tool_name 为键的工具字典，格式为 {tool_name: tool_schema}
        """
        # 查询 MCP 服务器
        if enabled_mcp_servers:
            # 只查询角色已启用的 MCP 服务器
            stmt = select(MCPServer).filter(
                MCPServer.enabled == True, MCPServer.id.in_(enabled_mcp_servers)
            )
        else:
            # return {}
            # 查询所有已启用的 MCP 服务器
            stmt = select(MCPServer).filter(
                MCPServer.enabled == True,
            )

        result = await self.session.execute(stmt)
        servers = result.scalars().all()

        all_tools = {}

        for server in servers:
            if not server.tools:
                logger.warning(f"No tools cached for MCP server: {server.name}")
                continue

            # 为每个工具添加 mcp__前缀和服务器信息
            for tool_name, tool_schema in server.tools.items():
                prefixed_tool_name = f"mcp__{tool_name}"

                # 复制工具 schema 并添加元数据
                enhanced_tool_schema = (
                    tool_schema.copy() if isinstance(tool_schema, dict) else {}
                )
                enhanced_tool_schema["_mcp_server_id"] = server.id
                enhanced_tool_schema["_mcp_server_url"] = server.url
                enhanced_tool_schema["_mcp_original_name"] = tool_name
                enhanced_tool_schema["_mcp_headers"] = server.headers or {}

                all_tools[prefixed_tool_name] = enhanced_tool_schema
                logger.debug(
                    f"Added MCP tool: {prefixed_tool_name} from server {server.name}"
                )

        logger.info(f"Total MCP tools loaded: {len(all_tools)}")
        return all_tools

    async def call_mcp_tool(
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

    def parse_tool_name(self, full_tool_name: str) -> tuple[str, bool]:
        """
        解析工具名称，判断是否为 MCP 工具

        Args:
            full_tool_name: 完整的工具名称

        Returns:
            tuple: (原始工具名，是否为 MCP 工具)
        """
        if full_tool_name.startswith("mcp__"):
            original_name = full_tool_name[5:]  # 移除 "mcp__" 前缀
            return original_name, True
        return full_tool_name, False

    async def execute_tool(
        self, full_tool_name: str, arguments: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        执行工具调用（自动判断是否为 MCP 工具）

        Args:
            full_tool_name: 完整的工具名称（可能包含 mcp__前缀）
            arguments: 工具调用参数

        Returns:
            Dict: 工具调用结果

        Raises:
            ValueError: 如果工具不存在或不是 MCP 工具
        """
        original_name, is_mcp = self.parse_tool_name(full_tool_name)

        if not is_mcp:
            # 不是 MCP 工具，抛出异常让本地工具处理器处理
            raise ValueError(f"Not an MCP tool: {full_tool_name}")

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
            if server.tools and original_name in server.tools:
                target_server = server
                break

        if not target_server:
            raise ValueError(f"MCP tool '{original_name}' not found or server disabled")

        # 调用 MCP 工具
        mcp_result = await self.call_mcp_tool(
            tool_name=original_name,
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
                "name": full_tool_name,
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
                "name": full_tool_name,
                "content": content,
            }
