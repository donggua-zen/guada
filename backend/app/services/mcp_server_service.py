import logging
from typing import List, Optional
from fastapi import HTTPException
from app.repositories.mcp_server_repository import MCPServerRepository
from app.schemas.mcp_server import MCPServerOut, MCPServerCreate, MCPServerUpdate
from app.schemas.common import PaginatedResponse
from app.services.mcp.mcp_client import MCPClient

logger = logging.getLogger(__name__)


class MCPServerService:
    def __init__(self, mcp_repo: MCPServerRepository):
        self.mcp_repo = mcp_repo

    async def _fetch_tools_from_server(self, server_url: str, headers: dict) -> dict:
        """
        从 MCP 服务器获取工具列表
        
        Args:
            server_url: MCP 服务器 URL
            headers: HTTP 请求头
            
        Returns:
            dict: 工具列表字典
        """
        try:
            from app.services.mcp.mcp_client import MCPClient
            client = MCPClient(server_url, headers)
            tools = await client.list_tools()
            
            # 转换为以工具名为键的字典格式
            tools_dict = {}
            for tool in tools:
                if isinstance(tool, dict) and 'name' in tool:
                    tools_dict[tool['name']] = tool
                    
            if tools_dict:
                logger.info(f"Successfully fetched {len(tools_dict)} tools from {server_url}")
            else:
                logger.warning(f"No tools found at {server_url}. You can manually configure tools later.")
                
            return tools_dict
        except Exception as e:
            logger.warning(f"Failed to automatically fetch tools from {server_url}: {e}")
            logger.info("Server will be created without tools. You can refresh tools manually later via API.")
            return {}

    async def get_all_servers(self) -> PaginatedResponse[MCPServerOut]:
        """获取所有 MCP 服务器"""
        servers = await self.mcp_repo.get_all()
        return PaginatedResponse(
            items=[MCPServerOut.model_validate(s) for s in servers],
            size=len(servers),
        )

    async def get_server_by_id(self, server_id: str) -> MCPServerOut:
        """根据 ID 获取 MCP 服务器"""
        server = await self.mcp_repo.get_by_id(server_id)
        if not server:
            raise HTTPException(status_code=404, detail="MCP Server not found")
        return MCPServerOut.model_validate(server)

    async def create_server(self, server_data: MCPServerCreate) -> MCPServerOut:
        """创建新的 MCP 服务器，并自动获取工具列表"""
        try:
            # 先创建服务器记录
            server = await self.mcp_repo.create(
                name=server_data.name,
                url=server_data.url,
                description=server_data.description,
                headers=server_data.headers,
                enabled=server_data.enabled
            )
            
            # 尝试获取工具列表（不阻塞创建流程）
            if server_data.headers:
                tools_dict = await self._fetch_tools_from_server(
                    server_data.url, 
                    server_data.headers
                )
            else:
                tools_dict = await self._fetch_tools_from_server(server_data.url, {})
            
            # 如果有获取到工具，更新服务器记录
            if tools_dict:
                await self.mcp_repo.update(server.id, tools=tools_dict)
                server.tools = tools_dict
                logger.info(f"Fetched {len(tools_dict)} tools for MCP server: {server.name}")
            
            logger.info(f"Created MCP server: {server.id} - {server.name}")
            return MCPServerOut.model_validate(server)
        except Exception as e:
            logger.error(f"Failed to create MCP server: {e}")
            raise HTTPException(status_code=500, detail=f"Failed to create server: {str(e)}")

    async def update_server(self, server_id: str, server_data: MCPServerUpdate) -> MCPServerOut:
        """更新 MCP 服务器，如果 URL 或 Headers 变化则重新获取工具列表"""
        update_data = server_data.model_dump(exclude_unset=True)
        if not update_data:
            raise HTTPException(status_code=400, detail="No data to update")
        
        # 获取当前服务器信息
        current_server = await self.mcp_repo.get_by_id(server_id)
        if not current_server:
            raise HTTPException(status_code=404, detail="MCP Server not found")
        
        # 检查是否需要重新获取工具列表
        need_refresh_tools = False
        server_url = current_server.url
        headers = current_server.headers or {}
        
        if 'url' in update_data and update_data['url'] != current_server.url:
            need_refresh_tools = True
            server_url = update_data['url']
        
        if 'headers' in update_data and update_data['headers'] != current_server.headers:
            need_refresh_tools = True
            headers = update_data['headers'] or {}
        
        # 更新服务器信息
        server = await self.mcp_repo.update(server_id, **update_data)
        
        # 如果需要且提供了必要的信息，重新获取工具列表
        if need_refresh_tools and server_url:
            tools_dict = await self._fetch_tools_from_server(server_url, headers)
            if tools_dict:
                await self.mcp_repo.update(server_id, tools=tools_dict)
                server.tools = tools_dict
                logger.info(f"Refreshed {len(tools_dict)} tools for MCP server: {server.name}")
        
        logger.info(f"Updated MCP server: {server.id}")
        return MCPServerOut.model_validate(server)

    async def delete_server(self, server_id: str) -> bool:
        """删除 MCP 服务器"""
        success = await self.mcp_repo.delete(server_id)
        if not success:
            raise HTTPException(status_code=404, detail="MCP Server not found")
        
        logger.info(f"Deleted MCP server: {server_id}")
        return True

    async def toggle_server_status(self, server_id: str, enabled: bool) -> MCPServerOut:
        """切换 MCP 服务器的启用状态"""
        server = await self.mcp_repo.toggle_enabled(server_id, enabled)
        if not server:
            raise HTTPException(status_code=404, detail="MCP Server not found")
        
        logger.info(f"Toggled MCP server status: {server.id} -> {'enabled' if enabled else 'disabled'}")
        return MCPServerOut.model_validate(server)

    async def refresh_tools(self, server_id: str) -> MCPServerOut:
        """手动刷新 MCP 服务器的工具列表"""
        server = await self.mcp_repo.get_by_id(server_id)
        if not server:
            raise HTTPException(status_code=404, detail="MCP Server not found")
        
        if not server.url:
            raise HTTPException(status_code=400, detail="Server URL is required")
        
        headers = server.headers or {}
        tools_dict = await self._fetch_tools_from_server(server.url, headers)
        
        if not tools_dict:
            raise HTTPException(status_code=500, detail="Failed to fetch tools from server")
        
        await self.mcp_repo.update(server_id, tools=tools_dict)
        server.tools = tools_dict
        
        logger.info(f"Manually refreshed {len(tools_dict)} tools for MCP server: {server.name}")
        return MCPServerOut.model_validate(server)