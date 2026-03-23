from fastapi import APIRouter, Depends, status
from typing import List

from app.dependencies import get_mcp_server_service
from app.schemas.mcp_server import MCPServerCreate, MCPServerUpdate, MCPServerOut
from app.schemas.common import PaginatedResponse
from app.services.mcp_server_service import MCPServerService

mcp_servers_router = APIRouter(prefix="/api/v1/mcp-servers", tags=["MCP Servers"])


@mcp_servers_router.get("", response_model=PaginatedResponse[MCPServerOut])
async def get_all_servers(
    service: MCPServerService = Depends(get_mcp_server_service)
):
    """
    获取所有 MCP 服务器列表
    
    Returns:
        PaginatedResponse[MCPServerOut]: MCP 服务器分页列表
    """
    return await service.get_all_servers()


@mcp_servers_router.get("/{server_id}", response_model=MCPServerOut)
async def get_server(
    server_id: str,
    service: MCPServerService = Depends(get_mcp_server_service)
):
    """
    根据 ID 获取 MCP 服务器详细信息
    
    Args:
        server_id: MCP 服务器 ID
        
    Returns:
        MCPServerOut: MCP 服务器详细信息
    """
    return await service.get_server_by_id(server_id)


@mcp_servers_router.post("", response_model=MCPServerOut, status_code=status.HTTP_201_CREATED)
async def create_server(
    server_data: MCPServerCreate,
    service: MCPServerService = Depends(get_mcp_server_service)
):
    """
    创建新的 MCP 服务器
    
    Args:
        server_data: MCP 服务器创建数据
        
    Returns:
        MCPServerOut: 创建的 MCP 服务器信息
    """
    return await service.create_server(server_data)


@mcp_servers_router.put("/{server_id}", response_model=MCPServerOut)
async def update_server(
    server_id: str,
    server_data: MCPServerUpdate,
    service: MCPServerService = Depends(get_mcp_server_service)
):
    """
    更新 MCP 服务器信息
    
    Args:
        server_id: MCP 服务器 ID
        server_data: MCP 服务器更新数据
        
    Returns:
        MCPServerOut: 更新后的 MCP 服务器信息
    """
    return await service.update_server(server_id, server_data)


@mcp_servers_router.delete("/{server_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_server(
    server_id: str,
    service: MCPServerService = Depends(get_mcp_server_service)
):
    """
    删除 MCP 服务器
    
    Args:
        server_id: MCP 服务器 ID
    """
    await service.delete_server(server_id)


@mcp_servers_router.patch("/{server_id}/toggle", response_model=MCPServerOut)
async def toggle_server_status(
    server_id: str,
    enabled: bool,
    service: MCPServerService = Depends(get_mcp_server_service)
):
    """
    切换 MCP 服务器的启用状态
    
    Args:
        server_id: MCP 服务器 ID
        enabled: 是否启用
        
    Returns:
        MCPServerOut: 更新后的 MCP 服务器信息
    """
    return await service.toggle_server_status(server_id, enabled)


@mcp_servers_router.post("/{server_id}/refresh-tools", response_model=MCPServerOut)
async def refresh_tools(
    server_id: str,
    service: MCPServerService = Depends(get_mcp_server_service)
):
    """
    手动刷新 MCP 服务器的工具列表
    
    Args:
        server_id: MCP 服务器 ID
        
    Returns:
        MCPServerOut: 更新后的 MCP 服务器信息（包含最新工具列表）
    """
    return await service.refresh_tools(server_id)