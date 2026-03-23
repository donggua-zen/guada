from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.models.mcp_server import MCPServer


class MCPServerRepository:
    def __init__(self, session: AsyncSession):
        """
        初始化 MCPServerRepository
        :param session: 异步数据库会话
        """
        self.session = session

    async def get_all(self):
        """获取所有 MCP 服务器"""
        stmt = select(MCPServer).order_by(MCPServer.created_at.desc())
        result = await self.session.execute(stmt)
        return result.scalars().all()

    async def get_by_id(self, server_id: str):
        """根据 ID 获取 MCP 服务器"""
        stmt = select(MCPServer).filter(MCPServer.id == server_id)
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()

    async def create(self, name: str, url: str, description: str = None, 
                     headers: dict = None, enabled: bool = True):
        """创建新的 MCP 服务器"""
        server = MCPServer(
            name=name,
            url=url,
            description=description,
            headers=headers or {},
            enabled=enabled
        )
        self.session.add(server)
        await self.session.flush()  # 获取生成的 ID
        await self.session.refresh(server)
        return server

    async def update(self, server_id: str, **kwargs):
        """更新 MCP 服务器信息"""
        server = await self.get_by_id(server_id)
        if not server:
            return None
        
        for field, value in kwargs.items():
            if hasattr(server, field) and value is not None:
                setattr(server, field, value)
        
        await self.session.flush()
        await self.session.refresh(server)
        return server

    async def delete(self, server_id: str):
        """删除 MCP 服务器"""
        server = await self.get_by_id(server_id)
        if not server:
            return False
        
        await self.session.delete(server)
        return True

    async def toggle_enabled(self, server_id: str, enabled: bool):
        """切换 MCP 服务器的启用状态"""
        return await self.update(server_id, enabled=enabled)